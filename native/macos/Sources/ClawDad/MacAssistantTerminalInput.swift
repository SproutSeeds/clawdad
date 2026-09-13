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

func assistantTerminalCanonicalEcho(_ tty: String) -> Bool {
  guard tty.range(of: #"^/dev/tty[A-Za-z0-9]+$"#, options: .regularExpression) != nil else { return false }
  let fd = open(tty, O_RDONLY | O_NOCTTY | O_NONBLOCK)
  guard fd >= 0 else { return false }; defer { close(fd) }
  var settings = termios()
  return tcgetattr(fd, &settings) == 0 && settings.c_lflag & tcflag_t(ICANON | ECHO) == tcflag_t(ICANON | ECHO)
}

/// Fresh observations and native tab identities guard each individual edit or
/// key. Durable job receipts in AssistantRuntime own replay prevention.
@MainActor
final class MacAssistantTerminalInput {
  private struct Inspection {
    let tabId: String, tty: String, identity: String, sessionId: String
    let foreground: MacAssistantForeground
    let agent: MacCodexInputBinding?
    let generation: UInt64
    let expires: Date
    let screen: String
    let draft: String?
    let composer: MacAssistantSubmissionDraft?
    let shellPrompt: String?
    let prompt: MacAssistantTerminalPrompt?
  }
  private let tabs = MacTerminalTabController.shared
  private let interaction = MacAssistantInteractionGate.shared
  private var inspections = MacAssistantInputInspections<Inspection>()
  private var verifiedEmptyScreens: [String: String] = [:]
  private struct ShellContinuation {
    let foreground: MacAssistantForeground
    let generation: UInt64
    let prompt: String
    let text: String
    let expires: Date
  }
  private var shellContinuations: [String: ShellContinuation] = [:]
  var observationStep: ((String) -> Void)?
  func invalidate(reason: String = "A separate native input action invalidated this inspection.") { inspections.invalidate(reason) }

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
    return MacAssistantComposerRendering.shared.normalized(String(value.suffix(24_000)))
  }

  func inspect(tabId: String, input: MacInputController, ticket: UInt64) async throws -> [String: AssistantValue] {
    observationStep?("catalog")
    let state = try await tabs.catalog()
    observationStep?("focus")
    let focused = try await tabs.focus(tabID: tabId, expectedRevision: state.revision)
    observationStep?("identity")
    guard let tab = tabs.assistantSnapshot(tabID: tabId), !tab.tty.isEmpty else {
      throw assistantTerminalFailure("catalog_binding_unresolved", "The selected tab's native shell identity is still resolving. Inspect this same tab again; no input was sent.")
    }
    guard interaction.isCurrent(ticket) else {
      throw assistantTerminalFailure("manual_input_changed", "Manual input changed during inspection. Your input was preserved; inspect the intended tab again when ready.")
    }
    guard let identity = try await tabs.inputIdentity() else {
      throw assistantTerminalFailure("terminal_input_not_focused", "Terminal has not confirmed keyboard focus for this input. Bring the intended tab forward and inspect it again; no input was sent.")
    }
    let foreground = try await Task.detached { try MacAssistantForeground.read(tty: tab.tty) }.value
    observationStep?("context")
    let agent = try? await Task.detached { try MacTerminalResponseReader().inputBinding(tty: tab.tty) }.value
    observationStep?("screen")
    MacAssistantComposerRendering.shared.invalidate()
    let value = try await MacAssistantComposerRendering.shared.read(ticket: ticket) { try screen(shellIdentity:foreground.shell != nil ? identity : nil) }
    var shellDraft = foreground.shell != nil ? MacAssistantShellDraft.read(value) : nil
    // Reinspect our own verified wrapped paste without guessing a prompt from
    // historical screen output. The complete current text must still match.
    if shellDraft == nil,foreground.shell != nil,let prior=shellContinuations[identity],
      prior.foreground==foreground,prior.generation==ticket,prior.expires>Date(),
      let wrapped=MacAssistantShellDraft.read(value,prompt:prior.prompt),wrapped.text==prior.text {
      shellDraft=wrapped
    }
    let draft = shellDraft?.text ?? (agent == nil ? nil : assistantEditableDraft(value, allowQueueFooter: true))
    let composer = agent == nil ? nil : MacAssistantSubmissionDraft(value, rows: assistantTerminalRows(tab.tty))
    let prompt = MacAssistantTerminalPrompt.read(value, codexDirectory: agent?.directory, foregroundShell: foreground.shell != nil)
    let sessionId = agent?.conversation?.sessionId ?? agent?.instanceId ?? foreground.identity
    let token = UUID().uuidString
    let captured = await input.captureDictationTarget(.request(.captureTarget, requestId: token)) { [tabs] in try await tabs.inputIdentity() }
    observationStep?("capture")
    guard captured.ok == true, interaction.isCurrent(ticket), try await tabs.inputIdentity() == identity,
      (composer != nil ? MacAssistantSubmissionDraft(try screen(), rows: assistantTerminalRows(tab.tty)) == composer : try screen(shellIdentity:foreground.shell != nil ? identity : nil) == value) else { throw MacAssistantError("The input changed during inspection. Inspect it again.") }
    let expires = Date().addingTimeInterval(45)
    inspections.insert(Inspection(tabId: tabId, tty: tab.tty, identity: identity, sessionId: sessionId,
      foreground: foreground, agent: agent, generation: ticket, expires: expires, screen: value,
      draft: draft, composer: composer, shellPrompt: shellDraft?.prompt, prompt: prompt), token: token, expires: expires)
    observationStep?("inspected")
    let project = try? await Task.detached { try MacTerminalTitleMetadata.read(tab.tty) }.value
    return ["directory": (agent?.directory ?? project?.directory).map(AssistantValue.string) ?? .null,
      "tabLifetime": project.map { .string($0.lifetime) } ?? .null,
      "tabId": .string(tabId), "inputToken": .string(token), "inputSessionId": .string(sessionId),
      "tty": .string(tab.tty), "windowGroupId": .string(focused.tabs.first { $0.id == tabId }?.windowGroupId ?? ""),
      "kind": .string(agent != nil ? "agent" : foreground.shell != nil ? "shell" : "native"),
      "prompt": prompt.map { .object($0.fields) } ?? .null,
      "inputState": .string(prompt != nil ? "interactive_prompt" : composer != nil ? "agent_composer" : shellDraft != nil ? "shell_composer" : "unsupported_input"),
      "reasonCode": .string(prompt != nil || composer != nil || shellDraft != nil ? "ready" : "unsupported_ui"),
      "foregroundIdentity": .string(foreground.identity),
      "shell": foreground.shell.map(AssistantValue.string) ?? .null,
      "canTypeDraft": .bool(shellDraft != nil), "draftText": draft.map(AssistantValue.string) ?? .null,
      "screenText": .string(value), "expiresInSeconds": .number(45),
      "guidance": .string(prompt != nil ? "This is an interactive decision, not a message composer. Use respond_terminal_prompt with its exact prompt/choice and Cody's existing authorization." : shellDraft != nil ? "Type a single-line shell draft without Enter or Tab. Existing text requires explicit replacement." : composer != nil ? "Use agent draft/queue tools for Codex. Explicit keys require this token; unsupported drafts are preserved." : "No supported composer or interactive-choice adapter was observed. Preserve this input; inspect the visible prompt or use its user-operated Terminal control. Passwords and sign-in challenges require their existing user flow.")]
  }

  func execute(_ action: String, args: [String: AssistantValue], input: MacInputController,
    authorization: [String: AssistantValue]? = nil,
    prepareSubmission: ([String: AssistantValue]) async throws -> Void = { _ in throw MacAssistantError("A durable submission receipt is required.") }
  ) async throws -> [String: AssistantValue] {
    defer { invalidate() }
    MacAssistantComposerRendering.shared.invalidate()
    guard let token = args["inputToken"]?.string else { throw AssistantProtocolError.invalid }
    let saved = try inspections.consume(token)
    guard args["tabId"]?.string == saved.tabId, args["inputSessionId"]?.string == saved.sessionId else {
      throw assistantTerminalFailure("stale_identity", "This inspection belongs to another tab or input owner. Inspect the intended tab again; no input was sent.")
    }
    func current(allowEmptyTrim: Bool = false) async throws -> String {
      guard Date() < saved.expires, interaction.isCurrent(saved.generation), !MacConsoleSessionState.isLocked(), AXIsProcessTrusted(),
        try await tabs.inputIdentity() == saved.identity,
        try await Task.detached(operation: { try MacAssistantForeground.read(tty: saved.tty) }).value == saved.foreground else {
        throw assistantTerminalFailure("stale_identity", "The targeted tab, process, focus or manual-input generation changed. It was preserved; inspect it again.")
      }
      if let agent = saved.agent {
        let owner = try await Task.detached { try MacTerminalResponseReader().inputBinding(tty: saved.tty) }.value
        guard owner.continues(agent) else { throw MacAssistantError("The agent session changed. Inspect it again.") }
      }
      return try await MacAssistantComposerRendering.shared.read(ticket: saved.generation) { try screen(shellIdentity:saved.shellPrompt != nil ? saved.identity : nil,allowEmptyTrim:allowEmptyTrim) }
    }
    func draft(_ value: String) -> String? {
      if let prompt = saved.shellPrompt { return MacAssistantShellDraft.read(value, prompt: prompt)?.text }
      return assistantEditableDraft(value, allowQueueFooter: true)
    }
    let before = try await current()
    guard saved.composer != nil ? MacAssistantSubmissionDraft(before, rows: assistantTerminalRows(saved.tty)) == saved.composer : (saved.draft != nil ? draft(before) == saved.draft : before == saved.screen) else {
      throw assistantTerminalFailure(saved.prompt == nil ? "draft_changed" : "prompt_changed", "The inspected input changed. It was preserved; inspect it again.")
    }
    defer { input.invalidateDictationTarget() }
    var result: [String: AssistantValue] = ["tabId": .string(saved.tabId), "inputSessionId": .string(saved.sessionId)]
    if action == "terminal.prompt" {
      guard authorization?["source"]?.string == "user_message", authorization?["userRequestId"]?.string != nil,
        authorization?["quoteHash"]?.string != nil else {
        throw assistantTerminalFailure("authorization_missing", "Use Cody's explicit instruction for this exact prompt choice. No decision was sent.")
      }
      guard let expected = saved.prompt, expected.id == args["promptId"]?.string, let choice = args["choiceId"]?.string else {
        throw assistantTerminalFailure("unsupported_ui", "Inspect a supported interactive prompt and choose one of its exact options. No key was sent.")
      }
      guard !expected.lineInput || assistantTerminalCanonicalEcho(saved.tty) else {
        throw assistantTerminalFailure("unsupported_line_mode", "This confirmation does not expose a canonical, echoing line input. Use the visible Terminal control; no key was sent.")
      }
      let outcome = try await assistantRespondToPrompt(expected, choiceId: choice, read: {
        MacAssistantTerminalPrompt.read(try await current(), codexDirectory: saved.agent?.directory, foregroundShell: saved.foreground.shell != nil)
      }, prepare: {
        try await prepareSubmission(["nativeControl": .bool(true), "inputSessionId": .string(saved.sessionId),
          "promptId": .string(expected.id), "choiceId": .string(choice), "tty": .string(saved.tty),
          "inputIdentity": .string(saved.identity), "foregroundIdentity": .string(saved.foreground.identity)])
      }, key: { name in
        guard self.interaction.isCurrent(saved.generation), !MacConsoleSessionState.isLocked(),
          (try? await self.tabs.inputIdentity()) == saved.identity,
          (try? await Task.detached { try MacAssistantForeground.read(tty: saved.tty) }.value) == saved.foreground,
          let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier == "com.apple.Terminal" else { return false }
        return input.sendAssistantKey(name, modifiers: [], targetPID: app.processIdentifier)
      }, verifyLineChoice: { letter in
        for _ in 0..<8 {
          let value = try await current()
          let last = value.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.last(where: { !$0.isEmpty })
          if assistantTerminalCanonicalEcho(saved.tty), last == expected.text + letter || last == expected.text + " " + letter { return true }
          try await Task.sleep(for: .milliseconds(100))
        }
        return false
      }, observeResult: {
        guard self.interaction.isCurrent(saved.generation), !MacConsoleSessionState.isLocked(),
          try await self.tabs.inputIdentity() == saved.identity else { throw assistantTerminalFailure("stale_identity", "The Terminal destination changed after the decision.") }
        let foreground = try await Task.detached { try MacAssistantForeground.read(tty: saved.tty) }.value
        let frame = try self.screen(shellIdentity: foreground.shell != nil ? saved.identity : nil)
        let owner = try? await Task.detached { try MacTerminalResponseReader().inputBinding(tty: saved.tty) }.value
        if expected.kind == "codex_directory_trust", choice != "1", foreground.shell != nil,
          owner == nil, MacAssistantShellDraft.read(frame) != nil {
          return ["trustAccepted": .bool(false), "trustDeclined": .bool(true), "resultVerified": .bool(true),
            "verification": .string("trust-declined-returned-to-shell"), "screenText": .string(frame)]
        }
        if expected.kind != "codex_directory_trust", foreground.shell != nil, MacAssistantShellDraft.read(frame) != nil {
          return ["resultVerified": .bool(true), "screenText": .string(frame), "verification": .string("confirmation-returned-to-shell")]
        }
        guard foreground == saved.foreground, saved.agent == nil || owner?.continues(saved.agent!) == true else { return nil }
        let next = MacAssistantTerminalPrompt.read(frame, codexDirectory: owner?.directory, foregroundShell: foreground.shell != nil)
        guard next?.id != expected.id, frame != saved.screen else { return nil }
        let composerVisible = owner != nil && MacAssistantSubmissionDraft(frame, rows: assistantTerminalRows(saved.tty)) != nil
        let ready = composerVisible && frame.range(of: #"model:\s+loading\b"#, options: .regularExpression) == nil
        if !composerVisible && next == nil { return nil }
        return ["trustAccepted": .bool(expected.kind == "codex_directory_trust" && choice == "1"),
          "resultVerified": .bool(true), "readyForAgentInput": .bool(ready), "screenText": .string(frame),
          "nextPrompt": next.map { .object($0.fields) } ?? .null,
          "verification": .string(ready ? "decision-observed-agent-composer" : "decision-observed-next-terminal-state")]
      })
      result.merge(outcome) { _, new in new }; return result
    }
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
      guard saved.agent != nil, saved.draft == "",
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
      shellContinuations=shellContinuations.filter { $0.value.expires>Date() }
      if shellContinuations.count>=32 { shellContinuations.removeAll() }
      shellContinuations[saved.identity]=ShellContinuation(foreground:saved.foreground,generation:saved.generation,
        prompt:saved.shellPrompt!,text:text,expires:Date().addingTimeInterval(45))
      return result
    }
    guard action == "terminal.key", let intent = args["intent"]?.string,
      let command = MacAssistantTerminalKey(args: args), command.permits(intent: intent) else {
      throw MacAssistantError("Choose an explicit Remote Assist key and its intended effect.")
    }
    if saved.prompt != nil {
      throw assistantTerminalFailure("prompt_decision_required", "This input is an interactive prompt. Use respond_terminal_prompt with its exact observed choice and Cody's existing instruction; composer submission sends no key here.")
    }
    if intent == "submit", let original = saved.agent {
      guard command.key == "enter", let expected = saved.composer,
        MacCodexComposerCapabilities(screen: before, version: original.version, viewportRows: assistantTerminalRows(saved.tty)).canSubmit else {
        throw assistantTerminalFailure("submit_capability_unavailable", "An ordinary supported agent composer and verified Enter binding are required for message submission. Inspect prompt for a separate interactive decision; no key was sent.")
      }
      var cursor: MacAssistantSubmissionLog?
      var acceptedOwner = original
      func guardedComposer() async throws -> MacAssistantSubmissionDraft? {
        let value = try await current()
        let owner = try await Task.detached { try MacTerminalResponseReader().inputBinding(tty: saved.tty) }.value
        var activity = MacCodexRequestActivityLog()
        let lines=value.components(separatedBy:.newlines)
        let footer=lines.lastIndex(where:{$0.trimmingCharacters(in:.whitespaces).hasPrefix("›")}).map{lines.dropFirst($0+1).joined(separator:"\n")} ?? ""
        guard owner.continues(original), !(try owner.conversation.map { try activity.read($0.path) } ?? false),
          !footer.contains("tab to queue message") else {
          throw MacAssistantError("This agent is working or has pending native input. Use its verified Tab queue; Enter was not sent.")
        }
        guard interaction.isCurrent(saved.generation) else { throw MacAssistantError("Input changed; inspect again.") }
        return MacAssistantSubmissionDraft(value, rows: assistantTerminalRows(saved.tty))
      }
      let submitted = try await assistantSubmitExistingDraft(expected, read: guardedComposer, prepare: {
        if let conversation = original.conversation { cursor = try .capture(conversation.path) }
        var fields = original.fields
        fields["draftRepresentation"] = .string(expected.representation)
        fields["transcriptOffset"] = cursor.map { .number(Double($0.offset)) } ?? .null
        try await prepareSubmission(fields)
      }, dispatch: {
        guard self.interaction.isCurrent(saved.generation), let app = NSWorkspace.shared.frontmostApplication,
          app.bundleIdentifier == "com.apple.Terminal" else { return false }
        return input.sendAssistantRemoteKey(command, targetPID: app.processIdentifier)
      }, accepted: {
        guard self.interaction.isCurrent(saved.generation),try await self.tabs.inputIdentity()==saved.identity,
          !MacConsoleSessionState.isLocked() else { throw MacAssistantError("Terminal focus or user input changed after Enter. Review this receipt before retrying.") }
        let owner = try await Task.detached { try MacTerminalResponseReader().inputBinding(tty: saved.tty) }.value
        guard owner.continues(original) else { throw MacAssistantError("The input owner changed after Enter. Inspect this receipt before retrying.") }
        acceptedOwner = owner
        if cursor == nil, original.conversation == nil, let conversation = owner.conversation {
          let captured = try MacAssistantSubmissionLog.capture(conversation.path)
          cursor = MacAssistantSubmissionLog(path: captured.path, fileIdentity: captured.fileIdentity, offset: 0)
        }
        return try cursor?.read(expected:expected)
      }, allowPendingFirstConversation: original.conversation == nil)
      result.merge(acceptedOwner.fields) { _, new in new }
      result.merge(submitted) { _, new in new }
      result["intent"] = .string(intent)
      return result
    }
    guard saved.composer != nil || saved.shellPrompt != nil else {
      throw assistantTerminalFailure("unsupported_ui", "This process has no supported composer or prompt adapter. Preserve its input and use the observed Terminal control.")
    }
    if intent == "edit", assistantObserveDraft(before, viewportRows: assistantTerminalRows(saved.tty)).requiresWholeDraftAuthorization {
      throw assistantTerminalFailure("opaque_draft_edit", "This draft contains collapsed text. Use the verified clear/replace/append tools with explicit authorization; single-key editing cannot verify hidden content.")
    }
    if command.shortcut == .controlJ, intent == "newline", saved.agent == nil {
      throw assistantTerminalFailure("newline_would_submit", "Control-J submits a shell line. Use explicit Enter with intent submit if that is authorized; no key was sent.")
    }
    if command.editsQueuedDraft, before.contains("edit last queued message") {
      guard intent == "edit_queue", MacAssistantAgentQueueSnapshot.read(before)?.draft == "" else {
        throw assistantTerminalFailure("queue_edit_authorization_required", "Shift-Left can recall an accepted queued message into this empty composer. Use intent edit_queue only when Cody requested editing that queue entry.")
      }
    } else if intent == "edit_queue" {
      throw assistantTerminalFailure("queue_edit_binding_unavailable", "The exact empty composer and Shift-Left queue-edit hint are required. Its pending messages were preserved.")
    }
    // Agent queue acceptance needs its own exact draft and log verification.
    if command.isTab, let owner = saved.agent?.conversation {
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
  let chord: RemoteKeyChord?
  init?(args: [String: AssistantValue]) {
    shortcut = args["shortcut"]?.string.flatMap(RemoteShortcut.init(rawValue:))
    key = args["key"]?.string
    if let value = args["chord"]?.object, let name = value["key"]?.string {
      let raw = value["modifiers"]?.array?.compactMap(\.string) ?? []
      let modifiers = raw.compactMap(RemoteKeyModifier.init(rawValue:))
      let candidate = RemoteKeyChord(key: name, modifiers: modifiers)
      guard raw.count == modifiers.count, candidate.isValid else { return nil }
      chord = candidate
    } else { chord = nil }
    guard [args["shortcut"], args["key"], args["chord"]].compactMap({ $0 }).count == 1,
      args["shortcut"] == nil || shortcut != nil, args["chord"] == nil || chord != nil,
      key == nil || ["enter", "delete", "backspace"].contains(key!), shortcut != .commandT else { return nil }
  }
  var isTab: Bool { shortcut == .tab }
  var editsQueuedDraft: Bool { chord?.key == "left" && chord?.modifiers == [.shift] }
  func permits(intent: String) -> Bool {
    if let chord {
      let mods = Set(chord.modifiers)
      if editsQueuedDraft && intent == "edit_queue" { return true }
      if ["left","right","up","down","home","end","page_up","page_down"].contains(chord.key),
        !mods.contains(.command) { return intent == "navigation" }
      if mods == [.control], ["a","e","l"].contains(chord.key) { return intent == "navigation" }
      if mods == [.control], ["k","u","w"].contains(chord.key) { return intent == "edit" }
      if mods == [.control], ["r","p","n"].contains(chord.key) { return intent == "history" }
      if mods.isEmpty, ["backspace","forward_delete"].contains(chord.key) { return intent == "edit" }
      // Submission, queue, interrupt, clipboard and window operations retain
      // their dedicated paths; custom chords cannot bypass those adapters.
      return false
    }
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
