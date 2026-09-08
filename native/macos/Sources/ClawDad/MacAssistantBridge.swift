import AppKit
import ApplicationServices
import ClawDadRemoteAssistProtocol
import Foundation

/// A local worker consumes durable jobs. It never launches app-server turns.
@MainActor
final class MacAssistantBridge {
  private let runtime: MacAssistantRuntime
  private let root: URL
  private let tabs = MacTerminalTabController.shared
  private let input = MacInputController()
  private var loop: Task<Void, Never>?
  private var inventoryRequested = false
  private var inspection:
    (token: String, pid: pid_t, element: AXUIElement, window: CFTypeRef?, launch: Date?, generation: UInt64, expires: Date, display: CGDirectDisplayID)?
  private struct DraftInspection {
    let tabId: String
    let sessionId: String
    let identity: String
    let generation: UInt64
    let text: String
    let expires: Date
  }
  private var draftInspections: [String: DraftInspection] = [:]
  private let workerId = UUID().uuidString
  private let interaction = MacAssistantInteractionGate.shared
  private let nativeInput = MacAssistantTerminalInput()

  init(runtime: MacAssistantRuntime) {
    self.runtime = runtime
    root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(
      "Library/Application Support/ClawDad/Assistant", isDirectory: true)
  }

  func start() {
    guard loop == nil else { return }
    loop = Task { @MainActor [weak self] in
      guard let self else { return }
      do {
        try FileManager.default.createDirectory(
          at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try save(["baseURL": .string(runtime.baseURL.absoluteString)], to: "connection.json")
      } catch { return }
      while !Task.isCancelled {
        do {
          var observation: [String: AssistantValue] = ["workerId": .string(workerId)]
          if inventoryRequested {
            try? await tabs.prewarmActivity()
            do {
              observation["catalog"] = try .encode(await tabs.catalog())
            } catch {
              observation["catalogError"] = .string(error.localizedDescription)
            }
          }
          let next = try await runtime.json("/v1/assistant/native/poll", observation)
          inventoryRequested = next["enabled"]?.bool == true
          if let job = next["job"]?.object, let id = job["id"]?.string {
            let completion: [String: AssistantValue]
            do {
              let result = try await execute(job)
              completion = ["id": .string(id), "result": .object(result)]
            } catch let deferred as MacAssistantDeferred {
              completion = [
                "id": .string(id), "error": .string(deferred.message), "deferred": .bool(true),
              ]
            } catch {
              completion = ["id": .string(id), "error": .string(error.localizedDescription)]
            }
            // A failed HTTP receipt is retried, never the native input action.
            while !Task.isCancelled {
              do {
                _ = try await runtime.json("/v1/assistant/native/result", completion)
                break
              } catch { try? await Task.sleep(nanoseconds: 1_000_000_000) }
            }
          }
        } catch { /* Durable pending requests remain on the local runtime. */  }
        try? await Task.sleep(nanoseconds: 1_500_000_000)
      }
    }
  }
  func stop() {
    loop?.cancel()
    loop = nil
    input?.cancelPendingOperations()
    inspection = nil
    draftInspections.removeAll()
  }

  private func save(_ value: [String: AssistantValue], to name: String) throws {
    let url = root.appendingPathComponent(name)
    try JSONEncoder().encode(value).write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }

  private func execute(_ job: [String: AssistantValue]) async throws -> [String: AssistantValue] {
    guard !MacConsoleSessionState.isLocked(), AXIsProcessTrusted(), let input else {
      throw MacAssistantDeferred(
        message: "Unlock the Mac and allow ClawDad Accessibility to continue.")
    }
    let args = job["args"]?.object ?? [:]
    let action = job["action"]?.string ?? ""
    let id = job["id"]?.string ?? ""
    let ticket = try interaction.ticket()
    guard action != "start", action != "message" else {
      throw MacAssistantError("Update ClawDad to use the background Assistant conversation.")
    }
    if action.hasPrefix("computer.") { return try await computer(action, args: args) }
    if action.hasPrefix("files.") { return try await assistantFiles(action, args: args, runtime: runtime) }
    if action == "remote.clipboard" {
      switch args["operation"]?.string {
      case "read": return ["text": .string(NSPasteboard.general.string(forType: .string) ?? ""), "device": .string("Mac")]
      case "write":
        guard let text = args["text"]?.string, text.utf8.count <= 64 * 1024, !text.contains("\0") else { throw AssistantProtocolError.invalid }
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(text, forType: .string), NSPasteboard.general.string(forType: .string) == text else { throw MacAssistantError("The Mac clipboard write could not be verified.") }
        return ["copied": .bool(true), "text": .string(text), "device": .string("Mac")]
      case "selection":
        let selection = await input.readSpeechSelection(.request(.selection, requestId: id))
        guard selection.ok == true else { throw MacAssistantError(selection.error ?? "The selected text could not be read.") }
        return ["text": .string(selection.text ?? ""), "device": .string("Mac"),
          "bundleId": .string(NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "")]
      default: throw AssistantProtocolError.invalid
      }
    }
    if action == "terminal.native.inspect" {
      guard let tabId = args["tabId"]?.string else { throw AssistantProtocolError.invalid }
      return try await nativeInput.inspect(tabId: tabId, input: input, ticket: ticket)
    }
    if ["terminal.native.type", "terminal.key", "terminal.images", "terminal.pointer", "terminal.context"].contains(action) {
      return try await nativeInput.execute(action, args: args, input: input)
    }
    if action == "terminal.new" {
      guard let anchor = args["tabId"]?.string, let revision = args["expectedRevision"]?.number,
        interaction.isCurrent(ticket) else { throw AssistantProtocolError.invalid }
      let (created, catalog) = try await tabs.createTab(anchorId: anchor, expectedRevision: Int(revision))
      return ["created": .bool(true), "tabId": .string(created.id), "tab": try .encode(created),
        "catalog": try .encode(catalog), "verification": .string("native-window-and-new-tty"),
        "input": (try? await nativeInput.inspect(tabId: created.id, input: input, ticket: ticket)).map(AssistantValue.object) ?? .null]
    }
    let editing = ["terminal.clear", "terminal.replace"].contains(action)
    let editToken = args["token"]?.string ?? ""
    let draftInspection = editing ? draftInspections.removeValue(forKey: editToken) : nil
    if editing {
      guard let draftInspection, draftInspection.expires > Date(),
        draftInspection.tabId == args["tabId"]?.string,
        draftInspection.text == args["expectedText"]?.string,
        interaction.isCurrent(draftInspection.generation) else {
        throw MacAssistantError("The draft inspection expired or changed. Inspect the intended tab again; its draft was preserved.")
      }
    }
    var state = try await tabs.catalog()
    let tabID = args["tabId"]?.string
    guard let tabID, let tab = state.tabs.first(where: { $0.id == tabID }) else {
      throw MacAssistantError(
        "The intended Terminal tab is no longer available. Choose its replacement in Assistant.")
    }
    if action == "terminal.move" {
      guard interaction.isCurrent(ticket) else {
        throw MacAssistantDeferred(
          message: "You took control of the Mac. Waiting before moving the tab.")
      }
      guard let neighbor = args["neighborTabId"]?.string,
        let revision = args["expectedRevision"]?.number
      else { throw AssistantProtocolError.invalid }
      return [
        "catalog": try .encode(
          await tabs.move(
            .moveRequest(
              tabId: tabID, neighborTabId: neighbor, placeBefore: args["placeBefore"]?.bool ?? true,
              expectedRevision: Int(revision), requestId: id)))
      ]
    }
    if action == "terminal.close" || action == "terminal.close.resolve" {
      guard interaction.isCurrent(ticket) else {
        throw MacAssistantDeferred(
          message: "You took control of the Mac. Waiting before closing the tab.")
      }
      let request: RemoteTerminalTabCloseMessage
      if action == "terminal.close.resolve" {
        guard let token = args["token"]?.string, let confirm = args["confirm"]?.bool else {
          throw AssistantProtocolError.invalid
        }
        request = .resolve(tabId: tabID, token: token, confirm: confirm, requestId: id)
      } else {
        guard let revision = args["expectedRevision"]?.number else {
          throw AssistantProtocolError.invalid
        }
        request = .request(tabId: tabID, revision: Int(revision), requestId: id)
      }
      return ["close": try .encode(await tabs.closing.handle(request))]
    }
    if action == "terminal.send", tab.isBusy {
      throw MacAssistantDeferred(message: "Waiting for \(tab.title)'s agent to finish.")
    }
    guard interaction.isCurrent(ticket) else {
      throw MacAssistantDeferred(
        message: "You took control of the Mac. Waiting before selecting the tab.")
    }
    state = try await tabs.focus(tabID: tabID, expectedRevision: state.revision)
    if action == "terminal.focus" { return ["catalog": try .encode(state)] }
    guard let target = tabs.assistantSnapshot(tabID: tabID), !target.tty.isEmpty else {
      throw MacAssistantError(
        "The tab's shell identity is still being resolved. Refresh its context.")
    }
    if action == "terminal.inspect" {
      guard
        let conversation = try? await Task.detached(operation: {
          try MacTerminalResponseReader().resolve(tty: target.tty)
        }).value
      else {
        return [
          "tabId": .string(tabID), "tabTitle": .string(tab.title), "detail": .string(tab.detail),
          "terminalTitle": .string(target.customTitle),
          "screenText": .string(try focusedTerminalText()), "agentAvailable": .bool(false),
          "draft": .object(["editable": .bool(false), "reason": .string("A supported idle Codex input is required.")]),
        ]
      }
      let response = try? await Task.detached {
        try MacCodexResponseParser.read(conversation: conversation)
      }.value
      let screen = try focusedTerminalText()
      let queueVersion = try? await Task.detached { try MacTerminalResponseReader().queueCLIVersion(tty: target.tty, conversation: conversation) }.value
      let draft = await inspectDraft(tabId: tabID, conversation: conversation, screen: screen,
        busy: tab.isBusy, supportsBusy: MacAssistantAgentQueueSnapshot.supports(version: queueVersion), ticket: ticket)
      return [
        "tabId": .string(tabID), "tabTitle": .string(tab.title), "detail": .string(tab.detail),
        "terminalTitle": .string(target.customTitle),
        "sessionId": .string(conversation.sessionId),
        "conversationPath": .string(conversation.path.path),
        "latestResponse": response.map { .string($0.text) } ?? .null,
        "screenText": .string(screen), "draft": .object(draft),
        "queue": .object([
          "supported": .bool(MacAssistantAgentQueueSnapshot.supports(version: queueVersion)),
          "ready": .bool(MacAssistantAgentQueueSnapshot.supports(version: queueVersion)
            && MacAssistantAgentQueueSnapshot.read(screen)?.draft == ""),
          "cliVersion": queueVersion.map(AssistantValue.string) ?? .null,
          "requires": .string("A working Codex agent with an empty, fully readable composer. Use this sessionId with queue_in_tab."),
        ]),
      ]
    }
    let conversation = try await Task.detached {
      try MacTerminalResponseReader().resolve(tty: target.tty)
    }.value
    if action == "terminal.queue" {
      return try await queueInAgent(id: id, args: args, tabId: tabID, tabTitle: tab.title,
        tty: target.tty, conversation: conversation, ticket: ticket, input: input)
    }
    if action == "terminal.insert" {
      return try await insertInAgent(id: id, args: args, tabId: tabID, tabTitle: tab.title,
        tty: target.tty, conversation: conversation, ticket: ticket, input: input)
    }
    if editing, let draftInspection {
      guard draftInspection.sessionId == conversation.sessionId,
        try await tabs.inputIdentity() == draftInspection.identity,
        let expected = args["expectedText"]?.string,
        let replacement = action == "terminal.clear" ? "" : args["text"]?.string,
        expected.utf8.count <= 16 * 1024, replacement.utf8.count <= 16 * 1024,
        !replacement.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) && $0 != "\n" && $0 != "\t" })
      else { throw MacAssistantError("The Terminal input identity changed or the edit is invalid. Inspect it again.") }
      let version = try await Task.detached { try MacTerminalResponseReader().queueCLIVersion(tty: target.tty, conversation: conversation) }.value
      var currentActivity = MacCodexRequestActivityLog()
      guard try !currentActivity.read(conversation.path) || MacAssistantAgentQueueSnapshot.supports(version: version) else {
        throw MacAssistantError("This working agent's draft controls could not be verified. Its input was preserved.")
      }
      defer { input.invalidateDictationTarget() }
      func allowed(_ value: String) -> Bool {
        return interaction.isCurrent(draftInspection.generation)
          && !MacConsoleSessionState.isLocked() && AXIsProcessTrusted()
          && (try? focusedTerminalText()).flatMap { assistantEditableDraft($0, allowQueueFooter: true) } == value
      }
      try await assistantEditVerifiedDraft(expected: expected, replacement: replacement, read: { [self] in
        guard interaction.isCurrent(draftInspection.generation),
          !MacConsoleSessionState.isLocked(), AXIsProcessTrusted(),
          try await tabs.inputIdentity() == draftInspection.identity else {
          throw MacAssistantError("The targeted input changed during editing. Inspect the tab; Enter was not sent.")
        }
        let owner = try await Task.detached { try MacTerminalResponseReader().resolve(tty: target.tty) }.value
        guard owner == conversation else { throw MacAssistantError("The inspected agent changed. Its input was preserved.") }
        return assistantEditableDraft(try focusedTerminalText(), allowQueueFooter: true)
      }, clear: {
        await input.clearAssistantDraft(targetToken: editToken, isAllowed: { !expected.isEmpty && allowed(expected) }) {
          [tabs] in try await tabs.inputIdentity()
        }
      }, insert: { text in
        await input.insertAssistantDraft(text, targetToken: editToken, isAllowed: { allowed("") }) {
          [tabs] in try await tabs.inputIdentity()
        }
      })
      return ["tabId": .string(tabID), "tabTitle": .string(tab.title),
        "sessionId": .string(conversation.sessionId),
        "draftVerified": .bool(true), "submitted": .bool(false), "text": .string(replacement),
        "verification": .string("rendered-composer")]
    }
    guard action == "terminal.send", let text = args["text"]?.string,
      !text.isEmpty, text.utf8.count <= 32_000
    else { throw AssistantProtocolError.invalid }
    var activity = MacCodexRequestActivityLog()
    if try activity.read(conversation.path) {
      throw MacAssistantDeferred(message: "Waiting for this agent's request to finish.")
    }
    guard assistantPromptIsEmpty(try focusedTerminalText()) else {
      throw MacAssistantError(
        "This tab has a draft or an unresolved prompt. It was preserved. Finish it in Terminal before sending this task again."
      )
    }
    let capture = await input.captureDictationTarget(.request(.captureTarget, requestId: id)) {
      [tabs] in try await tabs.inputIdentity()
    }
    guard capture.ok == true, let token = capture.token else {
      throw MacAssistantError("The Terminal input could not be captured.")
    }
    // Re-read immediately before insertion; neither a changed tab nor a new draft
    // is allowed to inherit a previous capture.
    guard try await tabs.catalog().selectedTabId == tabID,
      assistantPromptIsEmpty(try focusedTerminalText())
    else { throw MacAssistantError("The Terminal input changed. Your draft was preserved.") }
    // Register the exact CLI log before pressing Enter. Very fast responses can
    // otherwise be consumed before the delivery receipt reaches the runtime.
    _ = try await runtime.json(
      "/v1/assistant/native/prepare",
      [
        "id": .string(id), "conversationPath": .string(conversation.path.path),
        "sessionId": .string(conversation.sessionId), "tabTitle": .string(tab.title),
      ])
    let result = await input.sendQuickChat(
      .request(text: text, targetToken: token, requestId: id),
      isAllowed: { [interaction] in interaction.isCurrent(ticket) }
    ) { [tabs] in try await tabs.inputIdentity() }
    guard result.ok == true else {
      throw MacAssistantError(result.error ?? "Terminal input was not confirmed.")
    }
    return [
      "tabId": .string(tabID), "tabTitle": .string(tab.title),
      "conversationPath": .string(conversation.path.path),
      "sessionId": .string(conversation.sessionId),
    ]
  }

  private func insertInAgent(id: String, args: [String: AssistantValue], tabId: String, tabTitle: String,
    tty: String, conversation: MacCodexConversation, ticket: UInt64, input: MacInputController
  ) async throws -> [String: AssistantValue] {
    guard args["sessionId"]?.string == conversation.sessionId, let text = args["text"]?.string,
      !text.isEmpty, text.utf8.count <= 16 * 1024,
      !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) && $0 != "\n" && $0 != "\t" }) else {
      throw MacAssistantError("Inspect the exact agent again before inserting this draft. Its existing input was preserved.")
    }
    let version = try await Task.detached { try MacTerminalResponseReader().queueCLIVersion(tty: tty, conversation: conversation) }.value
    guard MacAssistantAgentQueueSnapshot.supports(version: version) else {
      throw MacAssistantError("This agent's draft controls could not be verified. Nothing was typed.")
    }
    let identity = try await tabs.inputIdentity()
    func current() async throws -> String {
      guard interaction.isCurrent(ticket), !MacConsoleSessionState.isLocked(), AXIsProcessTrusted(),
        try await tabs.inputIdentity() == identity,
        try await Task.detached(operation: { try MacTerminalResponseReader().resolve(tty: tty) }).value == conversation,
        interaction.isCurrent(ticket) else {
        throw MacAssistantError("The targeted input changed. Inspect the draft before trying again.")
      }
      return try focusedTerminalText()
    }
    guard assistantEditableDraft(try await current(), allowQueueFooter: true) == "" else {
      throw MacAssistantError("This tab already has a draft or an unreadable input. It was preserved. Replacement needs your explicit approval and a fresh draft inspection.")
    }
    let capture = await input.captureDictationTarget(.request(.captureTarget, requestId: id)) {
      [tabs] in try await tabs.inputIdentity()
    }
    guard capture.ok == true, let token = capture.token else { throw MacAssistantError("The exact Terminal draft could not be captured.") }
    defer { input.invalidateDictationTarget() }
    var activity = MacCodexRequestActivityLog()
    _ = try activity.read(conversation.path)
    _ = try await runtime.json("/v1/assistant/native/prepare", ["id": .string(id),
      "conversationPath": .string(conversation.path.path), "sessionId": .string(conversation.sessionId),
      "tabTitle": .string(tabTitle), "priorTurnId": activity.turnId.map(AssistantValue.string) ?? .null])
    var collapsed = false
    let inserted = await input.insertAssistantDraft(text, targetToken: token, isAllowed: { [self] in
      interaction.isCurrent(ticket) && (try? focusedTerminalText()).flatMap { assistantEditableDraft($0, allowQueueFooter: true) } == ""
    }, verifyPaste: {
      guard let screen = try? await current() else { return false }
      collapsed = assistantCollapsedPasteMatches(screen, payload: text)
      return assistantDraftMatches(screen, expected: text) || collapsed
    }) { [tabs] in try await tabs.inputIdentity() }
    guard inserted else {
      throw MacAssistantError("The draft insertion could not be confirmed. Inspect this tab before retrying; Enter and Tab were not pressed.")
    }
    return ["tabId": .string(tabId), "tabTitle": .string(tabTitle), "sessionId": .string(conversation.sessionId),
      "conversationPath": .string(conversation.path.path), "draftVerified": .bool(true), "submitted": .bool(false),
      "text": .string(text), "expandedTextReadBack": .bool(!collapsed),
      "verification": .string(collapsed ? "exact-native-paste-and-collapsed-length" : "rendered-composer")]
  }

  private func queueInAgent(id: String, args: [String: AssistantValue], tabId: String, tabTitle: String,
    tty: String, conversation: MacCodexConversation, ticket: UInt64, input: MacInputController
  ) async throws -> [String: AssistantValue] {
    guard args["sessionId"]?.string == conversation.sessionId else {
      throw MacAssistantError("The agent in this tab changed. Inspect it again; no message was inserted.")
    }
    let queueVersion = try await Task.detached { try MacTerminalResponseReader().queueCLIVersion(tty: tty, conversation: conversation) }.value
    guard MacAssistantAgentQueueSnapshot.supports(version: queueVersion) else {
      throw MacAssistantError("Native Tab queue is unsupported for this agent version. This tool has been verified with Codex 0.153.4; the input was preserved.")
    }
    guard let text = args["text"]?.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      text.utf8.count <= 16 * 1024,
      text.range(of: #"^\s*[!/]"#, options: .regularExpression) == nil,
      !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) && $0 != "\n" }) else {
      throw MacAssistantError("Native queue accepts authorized plain-text messages. Commands and control characters are unsupported.")
    }
    var activity = MacCodexRequestActivityLog()
    guard try activity.read(conversation.path), let priorTurnId = activity.turnId else {
      throw MacAssistantError("This agent is idle. Native queue requires a working agent; use send_to_tab only if the user authorized immediate submission.")
    }
    let identity = try await tabs.inputIdentity()
    let useExisting = args["useExistingDraft"]?.bool == true
    if useExisting {
      guard let token = args["token"]?.string, let inspected = draftInspections.removeValue(forKey: token),
        inspected.expires > Date(), inspected.tabId == tabId, inspected.sessionId == conversation.sessionId,
        inspected.identity == identity, inspected.text == text, interaction.isCurrent(inspected.generation) else {
        throw MacAssistantError("Inspect the existing draft before queuing it. The input was preserved.")
      }
    }
    func allowed(_ expected: String, requireTab: Bool = false) -> Bool {
      var log = MacCodexRequestActivityLog()
      guard interaction.isCurrent(ticket), !MacConsoleSessionState.isLocked(), AXIsProcessTrusted(),
        (try? log.read(conversation.path)) == true, log.turnId == priorTurnId,
        let current = (try? focusedTerminalText()).flatMap(MacAssistantAgentQueueSnapshot.read),
        assistantEditableDraftMatches(current.draft, expected: expected) else { return false }
      return !requireTab || current.tabQueues
    }
    func capture() async throws -> String {
      let capture = await input.captureDictationTarget(.request(.captureTarget, requestId: UUID().uuidString)) {
        [tabs] in try await tabs.inputIdentity()
      }
      guard capture.ok == true, let token = capture.token else { throw MacAssistantError("The exact Terminal input could not be captured.") }
      return token
    }
    defer { input.invalidateDictationTarget() }
    let token = try await capture()
    try await assistantQueueVerifiedMessage(text, useExistingDraft: useExisting, read: { [self] in
      guard interaction.isCurrent(ticket), !MacConsoleSessionState.isLocked(), AXIsProcessTrusted(),
        try await tabs.inputIdentity() == identity else {
        throw MacAssistantError("The targeted input changed. Inspect this request; its input will not be repeated.")
      }
      let owner = try await Task.detached { try MacTerminalResponseReader().resolve(tty: tty) }.value
      guard owner == conversation else { throw MacAssistantError("The agent changed during queue delivery. Inspect the tab and receipt.") }
      return MacAssistantAgentQueueSnapshot.read(try focusedTerminalText())
    }, insert: {
      await input.insertAssistantDraft(text, targetToken: token, isAllowed: { allowed("") }) {
        [tabs] in try await tabs.inputIdentity()
      }
    }, prepare: { [runtime] in
      guard allowed(text, requireTab: true) else { throw MacAssistantError("The agent finished or the draft changed. Tab was not sent; inspect the inserted draft.") }
      _ = try await runtime.json("/v1/assistant/native/prepare", ["id": .string(id),
        "conversationPath": .string(conversation.path.path), "sessionId": .string(conversation.sessionId),
        "tabTitle": .string(tabTitle), "priorTurnId": .string(priorTurnId)])
    }, pressTab: {
      guard let token = try? await capture() else { return false }
      return await input.queueAssistantDraft(targetToken: token, isAllowed: { allowed(text, requireTab: true) }) {
        [tabs] in try await tabs.inputIdentity()
      }
    })
    return ["tabId": .string(tabId), "tabTitle": .string(tabTitle), "sessionId": .string(conversation.sessionId),
      "conversationPath": .string(conversation.path.path), "queueAccepted": .bool(true),
      "submitted": .bool(false), "verification": .string("rendered-agent-queue")]
  }

  private func inspectDraft(tabId: String, conversation: MacCodexConversation, screen: String,
    busy: Bool, supportsBusy: Bool, ticket: UInt64) async -> [String: AssistantValue] {
    let unavailable: [String: AssistantValue] = ["editable": .bool(false),
      "reason": .string("Inspect an idle, fully visible text draft. Attachments, collapsed pastes and unresolved prompts are preserved.")]
    var activity = MacCodexRequestActivityLog()
    guard (!(busy || (try? activity.read(conversation.path)) == true) || supportsBusy),
      let text = assistantEditableDraft(screen, allowQueueFooter: true), let input,
      let identity = try? await tabs.inputIdentity() else { return unavailable }
    let token = UUID().uuidString
    let capture = await input.captureDictationTarget(.request(.captureTarget, requestId: token)) {
      [tabs] in try await tabs.inputIdentity()
    }
    guard capture.ok == true, interaction.isCurrent(ticket),
      (try? await tabs.inputIdentity()) == identity,
      (try? focusedTerminalText()).flatMap({ assistantEditableDraft($0, allowQueueFooter: true) }) == text else { return unavailable }
    draftInspections = draftInspections.filter { $0.value.expires > Date() }
    if draftInspections.count >= 20 { draftInspections.removeAll() }
    draftInspections[token] = DraftInspection(tabId: tabId, sessionId: conversation.sessionId,
      identity: identity, generation: ticket, text: text, expires: Date().addingTimeInterval(45))
    return ["editable": .bool(true), "text": .string(text), "token": .string(token),
      "expiresInSeconds": .number(45)]
  }

  private func ax(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success
      ? value : nil
  }
  private func focusedElement() throws -> (NSRunningApplication, AXUIElement) {
    guard let app = NSWorkspace.shared.frontmostApplication,
      let value = ax(
        AXUIElementCreateApplication(app.processIdentifier), kAXFocusedUIElementAttribute),
      CFGetTypeID(value) == AXUIElementGetTypeID()
    else { throw MacAssistantError("The active input could not be read.") }
    let element = unsafeBitCast(value, to: AXUIElement.self)
    guard ax(element, kAXSubroleAttribute) as? String != kAXSecureTextFieldSubrole as String else {
      throw MacAssistantError("Choose an input outside the password field.")
    }
    return (app, element)
  }
  private func focusedTerminalText() throws -> String {
    let (app, element) = try focusedElement()
    guard app.bundleIdentifier == "com.apple.Terminal",
      let text = ax(element, kAXValueAttribute) as? String
    else { throw MacAssistantError("Focus the intended Terminal prompt first.") }
    return String(text.suffix(24_000))
  }
  private func computer(_ action: String, args: [String: AssistantValue]) async throws -> [String:
    AssistantValue]
  {
    if action == "computer.displays" {
      var count: UInt32 = 0
      guard CGGetActiveDisplayList(0, nil, &count) == .success else { throw AssistantProtocolError.invalid }
      var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
      guard CGGetActiveDisplayList(count, &ids, &count) == .success else { throw AssistantProtocolError.invalid }
      return ["displays": .array(ids.map { id in
        let bounds = CGDisplayBounds(id)
        return .object(["id": .number(Double(id)), "main": .bool(id == CGMainDisplayID()),
          "width": .number(bounds.width), "height": .number(bounds.height)])
      })]
    }
    if action == "computer.open" {
      guard let bundle = args["bundleId"]?.string,
        let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle)
      else { throw AssistantProtocolError.invalid }
      try await NSWorkspace.shared.openApplication(
        at: url, configuration: NSWorkspace.OpenConfiguration())
      inspection = nil
      return ["opened": .bool(true)]
    }
    let (app, element) = try focusedElement()
    if action == "computer.inspect" || action == "computer.capture" {
      let requested = args["displayId"]?.number ?? Double(CGMainDisplayID())
      guard requested >= 0, requested <= Double(UInt32.max), requested.rounded() == requested,
        CGDisplayIsActive(UInt32(requested)) != 0 else { throw MacAssistantError("Choose an available display from computer displays.") }
      let display = UInt32(requested)
      let token = UUID().uuidString
      inspection = (
        token, app.processIdentifier, element, ax(element, kAXWindowAttribute), app.launchDate,
        interaction.generation, Date().addingTimeInterval(30), display
      )
      var result: [String: AssistantValue] = [
        "token": .string(token), "application": .string(app.localizedName ?? "Application"),
        "bundleId": .string(app.bundleIdentifier ?? ""),
        "text": .string(String((ax(element, kAXValueAttribute) as? String ?? "").suffix(24_000))),
        "canEditText": .bool(canEditInput(app, element)),
        "displayId": .number(Double(display)),
      ]
      if action == "computer.capture" {
        guard CGPreflightScreenCaptureAccess(), let image = CGDisplayCreateImage(display)
        else { throw MacAssistantError("Allow ClawDad Screen Recording to inspect the display.") }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.5]),
          data.count < 4 * 1024 * 1024
        else { throw AssistantProtocolError.invalid }
        result["imageBase64"] = .string(data.base64EncodedString())
        result["width"] = .number(Double(image.width))
        result["height"] = .number(Double(image.height))
      }
      return result
    }
    guard app.bundleIdentifier != "com.apple.Terminal" else {
      throw MacAssistantError("Use the dedicated native Terminal tools for this tab. General desktop input does not bypass Terminal draft, queue or confirmation checks.")
    }
    if action == "computer.shortcut" {
      guard let captured = inspection, args["token"]?.string == captured.token, Date() < captured.expires,
        app.processIdentifier == captured.pid, CFEqual(element, captured.element),
        interaction.isCurrent(captured.generation), let raw = args["shortcut"]?.string,
        let shortcut = RemoteShortcut(rawValue: raw), let input else { throw AssistantProtocolError.invalid }
      inspection = nil
      guard input.sendAssistantShortcut(shortcut, targetPID: captured.pid) else { throw MacAssistantError("The special command could not be delivered.") }
      return ["keySent": .bool(true), "verification": .string("native-shortcut-dispatched-reinspect-required")]
    }
    if ["computer.clear", "computer.replace"].contains(action) {
      guard let captured = inspection, args["token"]?.string == captured.token,
        let expected = args["expectedText"]?.string,
        let replacement = action == "computer.clear" ? "" : args["text"]?.string,
        expected.utf8.count <= 16 * 1024, replacement.utf8.count <= 16 * 1024,
        !replacement.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) && $0 != "\n" && $0 != "\t" })
      else { throw MacAssistantError("Inspect the intended input before editing it.") }
      inspection = nil
      func read() throws -> String {
        let (current, focused) = try focusedElement()
        guard Date() < captured.expires, !MacConsoleSessionState.isLocked(), AXIsProcessTrusted(),
          interaction.isCurrent(captured.generation), current.processIdentifier == captured.pid,
          current.launchDate == captured.launch, CFEqual(focused, captured.element),
          let window = captured.window, let currentWindow = ax(focused, kAXWindowAttribute),
          CFEqual(window, currentWindow), canEditInput(current, focused),
          let text = ax(focused, kAXValueAttribute) as? String else {
          throw MacAssistantError("This input changed or does not support verified text editing. Inspect it again; use the dedicated tab tools for Terminal.")
        }
        return text
      }
      try await assistantReplaceVerifiedInput(expected: expected, replacement: replacement, read: read,
        write: { text in
          guard (try? read()) == expected else { return false }
          return AXUIElementSetAttributeValue(captured.element, kAXValueAttribute as CFString, text as CFString) == .success
        })
      return ["inputVerified": .bool(true), "submitted": .bool(false), "text": .string(replacement),
        "bundleId": .string(app.bundleIdentifier ?? "")]
    }
    guard action == "computer.input", let captured = inspection,
      args["token"]?.string == captured.token, Date() < captured.expires,
      app.processIdentifier == captured.pid, let object = args["input"]?.object,
      CFEqual(element, captured.element), interaction.isCurrent(captured.generation),
      let type = object["type"]?.string, ["pointer", "scroll", "key", "text"].contains(type),
      let input
    else {
      throw MacAssistantError("The desktop changed. Inspect it again before providing input.")
    }
    inspection = nil
    if type == "key" {
      guard let key = object["key"]?.string,
        input.sendAssistantKey(
          key, modifiers: object["modifiers"]?.array?.compactMap(\.string) ?? [],
          targetPID: captured.pid)
      else { throw MacAssistantError("That keyboard shortcut could not be delivered.") }
      return ["inputRequested": .bool(true)]
    }
    if type == "text" {
      guard let text = object["text"]?.string, !text.isEmpty, text.utf8.count <= 16 * 1024,
        !text.contains("\0"),
        await input.sendAssistantText(
          text,
          isAllowed: { [self] in
            guard interaction.isCurrent(captured.generation),
              let (current, focused) = try? focusedElement()
            else { return false }
            return current.processIdentifier == captured.pid && CFEqual(focused, captured.element)
          })
      else { throw MacAssistantError("The text input changed. Inspect the intended input again.") }
      return ["inputRequested": .bool(true)]
    }
    if type == "pointer" {
      guard let x = object["x"]?.number, let y = object["y"]?.number, (0...1).contains(x),
        (0...1).contains(y),
        ["click", "move", "drag"].contains(object["action"]?.string ?? "")
      else { throw AssistantProtocolError.invalid }
      if object["action"]?.string == "drag" {
        guard let toX = object["toX"]?.number, let toY = object["toY"]?.number,
          (0...1).contains(toX), (0...1).contains(toY) else { throw AssistantProtocolError.invalid }
        input.commitDisplayTransition(to: captured.display)
        var down = object; down["action"] = .string("down")
        input.handle(try JSONEncoder().encode(down), respondClipboard: { _ in }, respondInput: { _ in })
        defer { input.finishAssistantPointer() }
        var end = object; end["action"] = .string("drag"); end["x"] = .number(toX); end["y"] = .number(toY)
        input.handle(try JSONEncoder().encode(end), respondClipboard: { _ in }, respondInput: { _ in })
        return ["inputRequested": .bool(true), "verification": .string("native-drag-dispatched-reinspect-required")]
      }
    }
    if type == "scroll" {
      for name in ["deltaX", "deltaY"] {
        guard let delta = object[name]?.number, (-10_000...10_000).contains(delta) else {
          throw AssistantProtocolError.invalid
        }
      }
    }
    guard CGDisplayIsActive(captured.display) != 0 else { throw MacAssistantError("The inspected display disconnected.") }
    input.commitDisplayTransition(to: captured.display)
    input.handle(
      try JSONEncoder().encode(object), respondClipboard: { _ in }, respondInput: { _ in })
    return ["inputRequested": .bool(true)]
  }

  private func canEditInput(_ app: NSRunningApplication, _ element: AXUIElement) -> Bool {
    var settable = DarwinBoolean(false)
    guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success else { return false }
    return MacAssistantInputEditPolicy.permits(bundleIdentifier: app.bundleIdentifier,
      role: ax(element, kAXRoleAttribute) as? String ?? "", subrole: ax(element, kAXSubroleAttribute) as? String,
      editable: ax(element, kAXIsEditableAttribute as String) as? Bool,
      enabled: ax(element, kAXEnabledAttribute) as? Bool, focused: ax(element, kAXFocusedAttribute) as? Bool,
      valueSettable: settable.boolValue, text: ax(element, kAXValueAttribute) as? String)
  }
}

func assistantKeyStroke(_ key: String, modifiers: [String]) -> MacKeyStroke? {
  let named: [String: CGKeyCode] = [
    "enter": 36, "return": 36, "escape": 53, "tab": 48, "backspace": 51, "delete": 51, "left": 123,
    "right": 124, "down": 125, "up": 126, "space": 49,
  ]
  let base: MacKeyStroke
  if let code = named[key.lowercased()] {
    base = MacKeyStroke(keyCode: code, flags: [])
  } else {
    guard key.count == 1, let strokes = MacKeyboardLayout.keyStrokes(for: key), strokes.count == 1
    else { return nil }
    base = strokes[0]
  }
  var flags = base.flags
  for modifier in modifiers {
    switch modifier {
    case "command": flags.insert(.maskCommand)
    case "control": flags.insert(.maskControl)
    case "option": flags.insert(.maskAlternate)
    case "shift": flags.insert(.maskShift)
    default: return nil
    }
  }
  return MacKeyStroke(keyCode: base.keyCode, flags: flags)
}

/// Fail closed on modal prompts and existing drafts. Placeholder text is the CLI's
/// visible empty composer, not a shell prompt or output from an earlier turn.
func assistantPromptIsEmpty(_ text: String) -> Bool {
  let lines = Array(text.components(separatedBy: .newlines).suffix(12))
  guard let index = lines.lastIndex(where: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("›") })
  else { return false }
  let value = lines[index].trimmingCharacters(in: .whitespaces).dropFirst().trimmingCharacters(
    in: .whitespaces)
  guard value.isEmpty
    || ["Ask Codex to do anything", "Ask Codex to do anything.", "Ask anything"].contains(value)
  else { return false }
  // An empty first line can still contain a multiline draft. Only known CLI
  // footer text may follow the composer; unfamiliar text requires inspection.
  return lines.dropFirst(index + 1).allSatisfy { line in
    let value = line.trimmingCharacters(in: .whitespaces)
    return value.isEmpty
      || value.range(of: #"^(?:gpt[-\s]|\d+% context left\b|\? for shortcuts\b)"#,
                     options: .regularExpression) != nil
      || value.allSatisfy { "─━╌┄┈═".contains($0) }
  }
}
