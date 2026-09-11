#if DEBUG && os(iOS)
import ClawDadRemoteAssistProtocol
import Foundation

/// UI fixtures exchange the production wire messages. The first capability request
/// is deliberately dropped; previews never set capability flags on the controller.
@MainActor
final class RemoteSpeechPreviewHost {
  private let receive: (Data) -> Void
  private var requests = 0
  private var catalogRequests = 0
  private var selectionRequests = 0
  private var tokens: Set<String> = []
  private var capturing = false
  private var selectedTab = "window-1-tab-1"
  private var windowOneOrder = Array(1...20)
  private var windowTwoOrder = [1, 2, 3]
  private var revision = 1
  private var quickChatReceipts: [String: (RemoteQuickChatMessage, RemoteQuickChatMessage)] = [:]
  private var closeReceipts: [String: RemoteTerminalTabCloseMessage] = [:]
  private var closeTokens: [String: String] = [:]
  private let arguments = ProcessInfo.processInfo.arguments
  init(receive: @escaping (Data) -> Void) {
    self.receive = receive
    if arguments.contains("--clawdad-preview-last-tab") { windowTwoOrder = [1] }
  }

  /// Silent PCM exercises transferred-audio playback; it is not voice-quality proof.
  static func audioFixture() -> Data {
    let length: UInt32 = 16_000 * 2 * 15
    var data = Data()
    func tag(_ text: String) { data.append(contentsOf: text.utf8) }
    func u32(_ value: UInt32) { var value = value.littleEndian; withUnsafeBytes(of: &value) { data.append(contentsOf: $0) } }
    func u16(_ value: UInt16) { var value = value.littleEndian; withUnsafeBytes(of: &value) { data.append(contentsOf: $0) } }
    tag("RIFF"); u32(length + 36); tag("WAVEfmt "); u32(16); u16(1); u16(1)
    u32(16_000); u32(32_000); u16(2); u16(16); tag("data"); u32(length)
    data.append(Data(repeating: 0, count: Int(length)))
    return data
  }

  func send(_ data: Data) -> Bool {
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(40))
      if let request = try? RemoteSessionStateRequest.decode(data) {
        requests += 1
        if requests == 1 { return }
        if arguments.contains("--clawdad-preview-slow-context") { try? await Task.sleep(for: .seconds(2)) }
        let state = RemoteSessionStateMessage.state(screenLocked: false, supportsDictation: true,
          supportsTerminalReadAloud: true, supportsInlineSpeech: true,
          supportsImageAttachments: arguments.contains("--clawdad-image-transfer-test"), supportsQuickChat: true,
          supportsTerminalTabClose: !arguments.contains("--clawdad-preview-old-close-host"),
          supportsKeyChords: !arguments.contains("--clawdad-preview-old-key-host"), requestId: request.requestId)
        if let reply = try? RemoteSessionStateCodec.encode(state) { receive(reply) }
      } else if let request = try? RemoteInputCodec.decode(data), request.type == RemoteInputMessage.commandType {
        let expected = arguments.contains("--clawdad-special-keys-expect-shift-left")
        let valid = !expected || (request.action == .chord && request.chord == RemoteKeyChord(key: "left", modifiers: [.shift]))
        let result: RemoteInputMessage = valid
          ? .success(action: request.action, requestId: request.requestId,
              target: .init(applicationName: "Fixture editor", bundleIdentifier: nil, role: "AXTextArea"))
          : .failure(action: request.action, requestId: request.requestId, error: "The fixture received a different key combination.")
        if let reply = try? RemoteInputCodec.encode(result) { receive(reply) }
      } else if let request = try? RemoteQuickChatMessage.decode(data), request.type == "quick.chat" {
        if let (original, receipt) = quickChatReceipts[request.requestId] {
          let response = original == request ? receipt : request.result(error: "Replay changed the preset.")
          if let reply = try? response.encode() { receive(reply) }
          return
        }
        let expected = arguments.firstIndex(of: "--clawdad-quick-chat-expect").flatMap { index in
          index + 1 < arguments.count ? arguments[index + 1] : nil
        }
        let valid = tokens.contains(request.targetToken ?? "") &&
          !arguments.contains("--clawdad-preview-clipboard-only") &&
          !arguments.contains("--clawdad-quick-chat-focus-changed") &&
          (expected == nil || request.text == expected)
        let response = request.result(error: valid ? nil : "Preset not sent. Tap the intended Mac input, then reopen Quick Chat.")
        quickChatReceipts[request.requestId] = (request, response)
        if let token = request.targetToken { tokens.remove(token) }
        if arguments.contains("--clawdad-quick-chat-drop-receipt") { return }
        if let reply = try? response.encode() { receive(reply) }
      } else if let request = try? RemoteImageAttachmentMessage.decode(data), request.type == "images.attach" {
        let copied = request.copyOnly == true || !tokens.contains(request.targetToken ?? "") || arguments.contains("--clawdad-preview-clipboard-only")
        if let reply = try? request.result(disposition: copied ? "copied" : "pasteRequested").encode() { receive(reply) }
      } else if let request = try? RemoteSpeechContextMessage.decode(data) {
        if request.action == .selection { selectionRequests += 1 }
        let result: RemoteSpeechContextMessage
        if request.action == .captureTarget {
          capturing = true
          if arguments.contains("--clawdad-preview-slow-context") { try? await Task.sleep(for: .seconds(2)) }
          tokens.insert(request.requestId)
          capturing = false
          result = request.success(token: request.requestId,
            targetName: arguments.contains("--clawdad-preview-clipboard-only") ? nil : "Preview editor")
        } else if capturing {
          result = request.failure("Selection collided with target capture.")
        } else if selectionRequests == 1, arguments.contains("--clawdad-preview-selection-busy-once") {
          result = request.failure("Wait for the current speech operation to finish.")
        } else if arguments.contains("--clawdad-preview-selection-error") {
          result = request.failure("Selection unavailable. Tap the speaker to retry.")
        } else {
          result = request.success(text: arguments.contains("--clawdad-preview-no-selection") ? "" :
            "Highlighted text takes priority over the Terminal response. " + String(repeating: "Selected text. ", count: 12))
        }
        if let reply = try? result.encode() { receive(reply) }
      } else if let request = try? RemoteClipboardCodec.decode(data) {
        let result: RemoteClipboardMessage
        if request.action == .dictation {
          let copied = request.copyOnly == true || !tokens.contains(request.targetToken ?? "") || arguments.contains("--clawdad-preview-clipboard-only")
          result = .success(action: .dictation, requestId: request.requestId, disposition: copied ? .copied : .inserted)
          if let token = request.targetToken { tokens.remove(token) }
        } else {
          result = request.text == "Check one check two."
            ? .success(action: .paste, requestId: request.requestId)
            : .failure(action: .paste, requestId: request.requestId, error: "Paste contained stale text.")
        }
        if let reply = try? RemoteClipboardCodec.encode(result) { receive(reply) }
      } else if let request = try? RemoteTerminalTabCloseMessage.decode(data) {
        if let receipt = closeReceipts[request.requestId], let reply = try? receipt.encode() { receive(reply); return }
        let response: RemoteTerminalTabCloseMessage
        if request.type == "terminal.tab.close", arguments.contains("--clawdad-preview-close-process") {
          let token = UUID().uuidString.lowercased()
          closeTokens[token] = request.tabId
          response = request.result(.confirmationRequired, state: terminalState(), token: token,
            prompt: "Closing this tab will terminate the running process: codex.", confirmLabel: "Terminate")
        } else if request.confirm == false {
          closeTokens.removeValue(forKey: request.confirmationToken ?? "")
          response = request.result(.cancelled, state: terminalState())
        } else if request.type == "terminal.tab.close" || closeTokens[request.confirmationToken ?? ""] == request.tabId {
          if let number = Int(request.tabId.split(separator: "-").last ?? "") {
            if request.tabId.hasPrefix("window-1-") { windowOneOrder.removeAll { $0 == number } }
            else { windowTwoOrder.removeAll { $0 == number } }
          }
          if selectedTab == request.tabId {
            selectedTab = windowOneOrder.first.map { "window-1-tab-\($0)" } ?? windowTwoOrder.first.map { "window-2-tab-\($0)" } ?? ""
          }
          revision += 1
          closeTokens.removeValue(forKey: request.confirmationToken ?? "")
          response = request.result(.closed, state: terminalState())
        } else {
          response = request.result(.failed, state: terminalState(), prompt: "Confirmation expired.", errorCode: "confirmation_expired")
        }
        closeReceipts[request.requestId] = response
        if arguments.contains("--clawdad-preview-close-drop-receipt") { return }
        if arguments.contains("--clawdad-preview-close-delay") { try? await Task.sleep(for: .seconds(2)) }
        if let reply = try? response.encode() { receive(reply) }
      } else if let request = try? RemoteTerminalTabCodec.decode(data) {
        if request.type == RemoteTerminalTabMessage.listType {
          catalogRequests += 1
          if catalogRequests == 1, arguments.contains("--clawdad-preview-slow-catalog") {
            try? await Task.sleep(for: .seconds(9))
          }
        }
        if request.type == RemoteTerminalTabMessage.focusType, let tab = request.tabId { selectedTab = tab }
        if request.type == RemoteTerminalTabMessage.moveType, let id = request.tabId, let neighborID = request.neighborTabId,
           let source = Int(id.split(separator: "-").last ?? ""), let neighbor = Int(neighborID.split(separator: "-").last ?? "") {
          let firstWindow = id.hasPrefix("window-1-")
          var order = firstWindow ? windowOneOrder : windowTwoOrder
          if firstWindow == neighborID.hasPrefix("window-1-"), source != neighbor,
             order.contains(source), order.contains(neighbor) {
            order.removeAll { $0 == source }
            if let index = order.firstIndex(of: neighbor) {
              order.insert(source, at: index + (request.placeBefore == true ? 0 : 1))
              if firstWindow { windowOneOrder = order } else { windowTwoOrder = order }
              revision += 1
            }
          }
        }
        let state = terminalState()
        let reply = request.type == RemoteTerminalTabMessage.moveType ? RemoteTerminalTabMessage.moveResult(requestId: request.requestId, state: state)
          : request.type == RemoteTerminalTabMessage.focusType
          ? RemoteTerminalTabMessage.focusSuccess(requestId: request.requestId, state: state)
          : RemoteTerminalTabMessage.listSuccess(requestId: request.requestId, state: state)
        if let data = try? RemoteTerminalTabCodec.encode(reply) { receive(data) }
      } else if let request = try? RemoteTerminalResponseCodec.decode(data) {
        let response = RemoteTerminalResponse(sessionId: "preview-session", turnId: "preview-turn",
          text: "This is the latest completed answer from the focused Terminal tab. " + String(repeating: "Completed answer. ", count: 12),
          completedAt: "2026-09-05T22:00:00Z", inProgress: false)
        if let reply = try? RemoteTerminalResponseCodec.encode(request.success(tabTitle: "Preview Terminal", response: response)) { receive(reply) }
      }
    }
    return true
  }

  private func terminalState() -> RemoteTerminalTabState {
    let grouped = arguments.contains("--clawdad-preview-window-groups")
    let tabs: [RemoteTerminalTabDescriptor] = grouped ? [(1, windowOneOrder), (2, windowTwoOrder)].flatMap { window, order in
      order.enumerated().map { offset, number in
        let id = "window-\(window)-tab-\(number)", position = offset + 1
        let detail = "Tab \(position)" + (arguments.contains("--clawdad-preview-terminal-poll-count") ? " · Update \(catalogRequests)" : "")
        return .init(id: id, title: "same-directory", detail: detail, isSelected: id == selectedTab,
          isBusy: arguments.contains("--clawdad-preview-close-process") && number == 2,
          windowTitle: "Terminal Window \(window)", windowGroupId: "window-\(window)", tabPosition: position, canReorder: order.count > 1)
      }
    } : [.init(id: "preview-tab", title: "Preview Terminal", detail: "Window 1", isSelected: true, isBusy: false)]
    return RemoteTerminalTabState(revision: revision, selectedTabId: grouped ? (selectedTab.isEmpty ? nil : selectedTab) : "preview-tab", tabs: tabs)
  }
}
#endif
