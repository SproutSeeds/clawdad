import AppKit
import ApplicationServices
import ClawDadRemoteAssistProtocol
import CryptoKit
import Darwin
import Foundation

/// Shell input is readable only with an idle foreground shell and an ordinary
/// visible prompt. Password prompts, REPLs and unknown line editors stay intact.
struct MacAssistantShellDraft: Equatable {
  let prompt: String
  let text: String
  static func read(_ screen: String, prompt: String? = nil) -> Self? {
    var lines = screen.components(separatedBy: .newlines)
    while lines.last == "" { lines.removeLast() }
    guard let last = lines.last else { return nil }
    if let prompt {
      guard let start = lines.lastIndex(where: { $0.hasPrefix(prompt) }) else { return nil }
      return Self(prompt: prompt, text: String(lines[start].dropFirst(prompt.count)) + lines.dropFirst(start + 1).joined())
    }
    guard last.range(of: #"(?i)password|passphrase|secret|verification code"#, options: .regularExpression) == nil,
      let range = last.range(of: #"^.{1,200}?[%$#>❯] "#, options: .regularExpression) else { return nil }
    return Self(prompt: String(last[range]), text: String(last[range.upperBound...]))
  }
}

struct MacAssistantForeground: Equatable {
  let identity: String
  let shell: String?
  static func read(tty: String) throws -> Self {
    guard tty.range(of: #"^/dev/tty[A-Za-z0-9]+$"#, options: .regularExpression) != nil else { throw AssistantProtocolError.invalid }
    let value = try parse(macTerminalResponseCommand("/bin/ps", ["-t", String(tty.dropFirst(5)), "-o", "pid=,pgid=,tpgid=,stat=,lstart=,comm="]), tty: tty)
    if value.shell != nil {
      let fd = open(tty, O_RDONLY | O_NOCTTY | O_NONBLOCK)
      guard fd >= 0 else { return Self(identity:value.identity,shell:nil) }
      defer { close(fd) }
      var settings = termios()
      guard tcgetattr(fd,&settings) == 0, settings.c_lflag & tcflag_t(ICANON | ECHO) == 0 else {
        return Self(identity:value.identity,shell:nil)
      }
    }
    return value
  }
  static func parse(_ value: String, tty: String) throws -> Self {
    let rows = value.split(separator: "\n").map { $0.split(maxSplits: 9, whereSeparator: \.isWhitespace).map { $0.trimmingCharacters(in: .whitespaces) } }
    let owners = rows.filter { $0.count == 10 && $0[1] == $0[2] && Int($0[0]) != nil }
    guard !owners.isEmpty else { throw MacAssistantError("The foreground Terminal process could not be identified. Inspect the tab again.") }
    let signature = owners.map { ($0.prefix(3) + $0.dropFirst(4)).joined(separator: "|") }.sorted().joined(separator: "\n")
    let digest = SHA256.hash(data: Data((tty + "\n" + signature).utf8)).map { String(format: "%02x", $0) }.joined()
    let names = owners.map { URL(fileURLWithPath: $0[9]).lastPathComponent.trimmingCharacters(in: CharacterSet(charactersIn: "-")) }
    let shell = owners.count == 1 && ["zsh", "bash", "sh"].contains(names[0]) ? names[0] : nil
    return Self(identity: "native-" + digest, shell: shell)
  }
}

func assistantTerminalRows(_ tty: String) -> Int? {
  guard tty.range(of: #"^/dev/tty[A-Za-z0-9]+$"#, options: .regularExpression) != nil else { return nil }
  let fd = open(tty, O_RDONLY | O_NOCTTY | O_NONBLOCK)
  guard fd >= 0 else { return nil }
  defer { close(fd) }
  var size = winsize()
  guard ioctl(fd, TIOCGWINSZ, &size) == 0, size.ws_row > 0 else { return nil }
  return Int(size.ws_row)
}

/// Fresh observations and native tab identities guard each individual edit or
/// key. Durable job receipts in AssistantRuntime own replay prevention.
@MainActor
final class MacAssistantTerminalInput {
  private struct Inspection {
    let tabId: String, tty: String, identity: String, sessionId: String
    let foreground: MacAssistantForeground
    let generation: UInt64
    let expires: Date
    let screen: String
    let draft: String?
    let shellPrompt: String?
  }
  private let tabs = MacTerminalTabController.shared
  private let interaction = MacAssistantInteractionGate.shared
  private var inspections: [String: Inspection] = [:]
  private var verifiedEmptyScreens: [String: String] = [:]
  var observationStep: ((String) -> Void)?

  private func screen(shellIdentity: String? = nil, allowEmptyTrim: Bool = false) throws -> String {
    guard let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier == "com.apple.Terminal" else {
      throw MacAssistantError("The intended Terminal tab is no longer focused.")
    }
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
      var result: CFTypeRef?
      guard AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success else { return nil }
      return result
    }
    guard let raw = attribute(appElement, kAXFocusedUIElementAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { throw AssistantProtocolError.invalid }
    let element = unsafeBitCast(raw, to: AXUIElement.self)
    guard attribute(element, kAXRoleAttribute) as? String == kAXTextAreaRole as String,
      attribute(element, kAXSubroleAttribute) as? String != kAXSecureTextFieldSubrole as String,
      let value = attribute(element, kAXValueAttribute) as? String else {
      throw MacAssistantError("Choose the Terminal input outside any dialog or password field.")
    }
    if let shellIdentity, let rangeValue = attribute(element,kAXSelectedTextRangeAttribute),
      CFGetTypeID(rangeValue) == AXValueGetTypeID() {
      var range = CFRange()
      if AXValueGetValue(unsafeBitCast(rangeValue,to:AXValue.self),.cfRange,&range), range.length == 0 {
        return String(assistantShellScreen(value,cursor:range.location,
          allowEmptyTrim:allowEmptyTrim || verifiedEmptyScreens[shellIdentity] == String(value.suffix(24_000))).suffix(24_000))
      }
    }
    return String(value.suffix(24_000))
  }

  func inspect(tabId: String, input: MacInputController, ticket: UInt64) async throws -> [String: AssistantValue] {
    observationStep?("catalog")
    let state = try await tabs.catalog()
    observationStep?("focus")
    let focused = try await tabs.focus(tabID: tabId, expectedRevision: state.revision)
    observationStep?("identity")
    guard let tab = tabs.assistantSnapshot(tabID: tabId), !tab.tty.isEmpty,
      let identity = try await tabs.inputIdentity(), interaction.isCurrent(ticket) else { throw AssistantProtocolError.invalid }
    let foreground = try await Task.detached { try MacAssistantForeground.read(tty: tab.tty) }.value
    observationStep?("context")
    let conversation = try? await Task.detached { try MacTerminalResponseReader().resolve(tty: tab.tty) }.value
    observationStep?("screen")
    let value = try screen(shellIdentity:foreground.shell != nil ? identity : nil)
    let shellDraft = foreground.shell != nil ? MacAssistantShellDraft.read(value) : nil
    let draft = shellDraft?.text ?? (conversation == nil ? nil : assistantEditableDraft(value, allowQueueFooter: true))
    let sessionId = conversation?.sessionId ?? foreground.identity
    let token = UUID().uuidString
    let captured = await input.captureDictationTarget(.request(.captureTarget, requestId: token)) { [tabs] in try await tabs.inputIdentity() }
    observationStep?("capture")
    guard captured.ok == true, interaction.isCurrent(ticket), try await tabs.inputIdentity() == identity,
      try screen(shellIdentity:foreground.shell != nil ? identity : nil) == value else { throw MacAssistantError("The input changed during inspection. Inspect it again.") }
    inspections = inspections.filter { $0.value.expires > Date() }
    if inspections.count >= 32 { inspections.removeAll() }
    inspections[token] = Inspection(tabId: tabId, tty: tab.tty, identity: identity, sessionId: sessionId,
      foreground: foreground, generation: ticket, expires: Date().addingTimeInterval(45), screen: value,
      draft: draft, shellPrompt: shellDraft?.prompt)
    observationStep?("inspected")
    return ["tabId": .string(tabId), "inputToken": .string(token), "inputSessionId": .string(sessionId),
      "tty": .string(tab.tty), "windowGroupId": .string(focused.tabs.first { $0.id == tabId }?.windowGroupId ?? ""),
      "kind": .string(conversation != nil ? "agent" : foreground.shell != nil ? "shell" : "native"),
      "shell": foreground.shell.map(AssistantValue.string) ?? .null,
      "canTypeDraft": .bool(shellDraft != nil), "draftText": draft.map(AssistantValue.string) ?? .null,
      "screenText": .string(value), "expiresInSeconds": .number(45),
      "guidance": .string(shellDraft != nil ? "Type a single-line shell draft without Enter or Tab. Existing text requires explicit replacement." : "Use agent draft/queue tools for Codex. Explicit keys require this token; unsupported drafts are preserved.")]
  }

  func execute(_ action: String, args: [String: AssistantValue], input: MacInputController) async throws -> [String: AssistantValue] {
    guard let token = args["inputToken"]?.string, let saved = inspections.removeValue(forKey: token),
      args["tabId"]?.string == saved.tabId, args["inputSessionId"]?.string == saved.sessionId else {
      throw MacAssistantError("Inspect the exact native Terminal input before acting.")
    }
    func current(allowEmptyTrim: Bool = false) async throws -> String {
      guard Date() < saved.expires, interaction.isCurrent(saved.generation), !MacConsoleSessionState.isLocked(), AXIsProcessTrusted(),
        try await tabs.inputIdentity() == saved.identity,
        try await Task.detached(operation: { try MacAssistantForeground.read(tty: saved.tty) }).value == saved.foreground else {
        throw MacAssistantError("The targeted tab, process or input changed. It was preserved; inspect it again.")
      }
      if !saved.sessionId.hasPrefix("native-") {
        let owner = try await Task.detached { try MacTerminalResponseReader().resolve(tty: saved.tty) }.value
        guard owner.sessionId == saved.sessionId else { throw MacAssistantError("The agent session changed. Inspect it again.") }
      }
      return try screen(shellIdentity:saved.shellPrompt != nil ? saved.identity : nil,allowEmptyTrim:allowEmptyTrim)
    }
    func draft(_ value: String) -> String? {
      if let prompt = saved.shellPrompt { return MacAssistantShellDraft.read(value, prompt: prompt)?.text }
      return assistantEditableDraft(value, allowQueueFooter: true)
    }
    let before = try await current()
    guard saved.draft != nil ? draft(before) == saved.draft : before == saved.screen else {
      throw MacAssistantError("The inspected draft changed. It was preserved.")
    }
    defer { input.invalidateDictationTarget() }
    var result: [String: AssistantValue] = ["tabId": .string(saved.tabId), "inputSessionId": .string(saved.sessionId)]
    if action == "terminal.context" {
      let source = args["source"]?.string ?? "auto"
      guard ["auto","selection","latest"].contains(source) else { throw AssistantProtocolError.invalid }
      if source != "latest" {
        let selected = await input.readSpeechSelection(.request(.selection,requestId:UUID().uuidString))
        _ = try await current()
        guard selected.ok == true else { throw MacAssistantError(selected.error ?? "The selection could not be verified.") }
        if source == "selection" || selected.text?.isEmpty == false {
          result["text"] = .string(selected.text ?? ""); result["source"] = .string("selection"); return result
        }
      }
      let response = try await Task.detached {
        let conversation = try MacTerminalResponseReader().resolve(tty:saved.tty)
        return try MacCodexResponseParser.read(conversation:conversation)
      }.value
      _ = try await current()
      result["text"] = .string(response.text); result["source"] = .string("latest-response")
      return result
    }
    if action == "terminal.pointer" {
      guard let app = NSWorkspace.shared.frontmostApplication,
        let gesture = args["gesture"]?.string, ["click","move","drag","scroll"].contains(gesture),
        let x = args["x"]?.number, let y = args["y"]?.number else { throw AssistantProtocolError.invalid }
      let application = AXUIElementCreateApplication(app.processIdentifier)
      var value: CFTypeRef?
      guard AXUIElementCopyAttributeValue(application,kAXFocusedUIElementAttribute as CFString,&value) == .success,
        let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { throw AssistantProtocolError.invalid }
      let element = unsafeBitCast(value,to:AXUIElement.self)
      func attribute(_ name: String) -> AXValue? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element,name as CFString,&value) == .success, let value,
          CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        return unsafeBitCast(value,to:AXValue.self)
      }
      var origin = CGPoint.zero, size = CGSize.zero
      guard let position=attribute(kAXPositionAttribute),let dimensions=attribute(kAXSizeAttribute),
        AXValueGetValue(position,.cgPoint,&origin),AXValueGetValue(dimensions,.cgSize,&size) else { throw AssistantProtocolError.invalid }
      let rect = CGRect(origin:origin,size:size)
      let point = try assistantTerminalPoint(x:x,y:y,rect:rect)
      let end: CGPoint?
      if gesture == "drag" {
        guard let toX=args["toX"]?.number,let toY=args["toY"]?.number else { throw AssistantProtocolError.invalid }
        end = try assistantTerminalPoint(x:toX,y:toY,rect:rect)
      } else { end = nil }
      let dx=args["deltaX"]?.number ?? 0, dy=args["deltaY"]?.number ?? 0
      guard (-10_000...10_000).contains(dx),(-10_000...10_000).contains(dy),
        input.sendAssistantTerminalPointer(action:gesture,point:point,end:end,deltaX:dx,deltaY:dy,
          right:args["button"]?.string == "right",targetPID:app.processIdentifier) else { throw MacAssistantError("The inspected Terminal area could not receive this gesture.") }
      try? await Task.sleep(nanoseconds:180_000_000)
      result["inputRequested"] = .bool(true)
      result["screenText"] = (try? await current()).map(AssistantValue.string) ?? .null
      result["verification"] = .string("native-gesture-dispatched-reinspect-required")
      return result
    }
    if action == "terminal.images" {
      guard !saved.sessionId.hasPrefix("native-"), saved.draft == "",
        let paths = args["paths"]?.array?.compactMap(\.string), !paths.isEmpty,
        paths.count <= RemoteImageLimits.count, paths.allSatisfy({ $0.hasPrefix("/") && !$0.contains("\0") }) else {
        throw MacAssistantError("Attach authorized local images to an inspected empty agent draft. Existing drafts are preserved.")
      }
      let images = try await Task.detached {
        try MacPreparedImages.load(paths.map { path in
          let url = URL(fileURLWithPath: path)
          guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 0, size <= RemoteImageLimits.fileBytes else { throw RemoteFileError.tooLarge }
          let data = try Data(contentsOf: url, options: .mappedIfSafe)
          return MacReceivedImage(path: path, sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), size: data.count)
        })
      }.value
      guard draft(try await current()) == "" else { throw MacAssistantError("The input changed; its draft was preserved.") }
      let response = await input.deliverImages(images,
        request: .request(uploadIds: paths.indices.map { "image-\($0)" }, targetToken: token),
        isAllowed: { self.interaction.isCurrent(saved.generation) },
        terminalIdentity: { [tabs] in try await tabs.inputIdentity() })
      var observed = false
      for _ in 0..<16 {
        let value = try await current()
        if let prompt = value.components(separatedBy: .newlines).last(where: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("›") }),
          (1...paths.count).allSatisfy({ prompt.contains("[Image #\($0)]") }) { observed = true; break }
        try await Task.sleep(nanoseconds: 100_000_000)
      }
      guard response.pastedCount == paths.count, observed else {
        throw MacAssistantError("The image paste was requested once, but its attachments could not be verified. Inspect this tab before retrying.")
      }
      result.merge(["attachmentsVerified": .bool(true), "imageCount": .number(Double(paths.count)),
        "submitted": .bool(false), "verification": .string("native-image-paste-and-rendered-attachments")]) { _, new in new }
      return result
    }
    if action == "terminal.native.type" {
      guard saved.shellPrompt != nil, let expected = saved.draft, args["expectedText"]?.string == expected,
        let text = args["text"]?.string, text.utf8.count <= 16 * 1024,
        !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
        let mode = args["mode"]?.string, ["insert", "replace", "clear"].contains(mode),
        mode != "insert" || expected.isEmpty, mode != "clear" || text.isEmpty else {
        throw MacAssistantError("Type into an inspected shell prompt. Preserve existing drafts unless replacement was authorized; newlines and control characters require explicit keys.")
      }
      if text != expected {
        if !expected.isEmpty {
          // These are native line-editor edit keys, never an interrupt or submit.
          guard let app = NSWorkspace.shared.frontmostApplication,
            input.sendAssistantKey("e", modifiers: ["control"], targetPID: app.processIdentifier),
            input.sendAssistantKey("u", modifiers: ["control"], targetPID: app.processIdentifier) else { throw AssistantProtocolError.invalid }
          try await verify("")
          verifiedEmptyScreens[saved.identity] = try screen()
          if verifiedEmptyScreens.count > 32 { verifiedEmptyScreens = [saved.identity:try screen()] }
        }
        if !text.isEmpty {
          // Editing moved the cursor. Capture again only after exact empty readback.
          let fresh = UUID().uuidString
          let captured = await input.captureDictationTarget(.request(.captureTarget, requestId: fresh)) { [tabs] in try await tabs.inputIdentity() }
          guard captured.ok == true, draft(try await current()) == "",
            await input.insertAssistantDraft(text, targetToken: fresh,
              isAllowed: { self.interaction.isCurrent(saved.generation) && (try? self.screen(shellIdentity:saved.identity)).flatMap(draft) == "" },
              verifyPaste: { (try? await current()).flatMap(draft) == text },
              terminalIdentity: { [tabs] in try await tabs.inputIdentity() }) else {
            throw MacAssistantError("Shell paste could not be verified. Inspect this request and the input before retrying; Enter and Tab were not sent.")
          }
          try await verify(text)
        }
      }
      result.merge(["draftVerified": .bool(true), "text": .string(text), "submitted": .bool(false),
        "verification": .string("rendered-shell-input")]) { _, new in new }
      return result
    }
    guard action == "terminal.key", let intent = args["intent"]?.string,
      let command = MacAssistantTerminalKey(args: args), command.permits(intent: intent) else {
      throw MacAssistantError("Choose an explicit Remote Assist key and its intended effect.")
    }
    // Agent queue acceptance needs its own exact draft and log verification.
    if command.shortcut == .tab, !saved.sessionId.hasPrefix("native-") {
      let owner = try await Task.detached { try MacTerminalResponseReader().resolve(tty: saved.tty) }.value
      var activity = MacCodexRequestActivityLog()
      if try activity.read(owner.path) {
        throw MacAssistantError("Use queue_tab_draft for this working agent's existing draft, or queue_in_tab for a new message. Native queue acceptance must be verified.")
      }
    }
    guard let app = NSWorkspace.shared.frontmostApplication,
      input.sendAssistantRemoteKey(command, targetPID: app.processIdentifier) else { throw MacAssistantError("The native key could not be delivered.") }
    try? await Task.sleep(nanoseconds: 180_000_000)
    result["keySent"] = .bool(true)
    result["intent"] = .string(intent)
    result["taskCompletionVerified"] = .bool(false)
    result["screenText"] = (try? await current()).map(AssistantValue.string) ?? .null
    result["frontmostApplication"] = NSWorkspace.shared.frontmostApplication?.bundleIdentifier.map(AssistantValue.string) ?? .null
    result["verification"] = .string(result["screenText"] == .null ? "key-dispatched-observation-unavailable" : "key-dispatched-screen-observed")
    return result

    func verify(_ expected: String) async throws {
      for _ in 0..<16 {
        if draft(try await current(allowEmptyTrim:expected.isEmpty)) == expected { return }
        try await Task.sleep(nanoseconds: 100_000_000)
      }
      throw MacAssistantError("This shell's input edit could not be verified. Inspect the remaining draft; no submit or interrupt key was sent.")
    }
  }
}

struct MacAssistantTerminalKey {
  let shortcut: RemoteShortcut?
  let key: String?
  init?(args: [String: AssistantValue]) {
    shortcut = args["shortcut"]?.string.flatMap(RemoteShortcut.init(rawValue:))
    key = args["key"]?.string
    guard args["shortcut"] == nil || shortcut != nil,
      (shortcut != nil) != (key != nil), key == nil || ["enter", "delete", "backspace"].contains(key!), shortcut != .commandT else { return nil }
  }
  func permits(intent: String) -> Bool {
    if key == "enter" { return intent == "submit" }
    if key != nil { return intent == "edit" }
    switch shortcut {
    case .controlC, .escape: return intent == "interrupt" || intent == "dismiss"
    case .controlJ: return intent == "submit" || intent == "newline"
    case .tab: return intent == "completion"
    case .commandTab: return intent == "switch_app"
    default: return intent == "navigation"
    }
  }
}

func assistantTerminalPoint(x: Double, y: Double, rect: CGRect) throws -> CGPoint {
  guard (0...1).contains(x),(0...1).contains(y),rect.width>4,rect.height>4,
    rect.origin.x.isFinite,rect.origin.y.isFinite,rect.width.isFinite,rect.height.isFinite else { throw AssistantProtocolError.invalid }
  return CGPoint(x:rect.minX+2+x*(rect.width-4),y:rect.minY+2+y*(rect.height-4))
}

/// Terminal retains erased cells as spaces. Use the native UTF-16 cursor to
/// distinguish that padding from text. An unknown whitespace-only draft remains
/// nonempty; only our verified clear may identify those particular cells as blank.
func assistantShellScreen(_ value: String, cursor: Int, allowEmptyTrim: Bool) -> String {
  let text = value as NSString
  guard cursor >= 0, cursor <= text.length else { return value }
  let prefix = text.substring(to:cursor), suffix = text.substring(from:cursor)
  guard suffix.allSatisfy(\.isWhitespace) else { return value }
  let sameLine = suffix.components(separatedBy:.newlines).first ?? ""
  let hasDraft = MacAssistantShellDraft.read(prefix)?.text.isEmpty == false
  return allowEmptyTrim || hasDraft || sameLine.isEmpty ? prefix : value
}
