#if DEBUG && os(iOS)
import ClawDadRemoteAssistProtocol
import Foundation

/// UI fixtures exchange the production wire messages. The first capability request
/// is deliberately dropped; previews never set capability flags on the controller.
@MainActor
final class RemoteSpeechPreviewHost {
  private let receive: (Data) -> Void
  private var requests = 0
  private var tokens: Set<String> = []
  private var capturing = false
  private let arguments = ProcessInfo.processInfo.arguments
  init(receive: @escaping (Data) -> Void) { self.receive = receive }

  func send(_ data: Data) -> Bool {
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(40))
      if let request = try? RemoteSessionStateRequest.decode(data) {
        requests += 1
        if requests == 1 { return }
        if arguments.contains("--clawdad-preview-slow-context") { try? await Task.sleep(for: .seconds(2)) }
        let state = RemoteSessionStateMessage.state(screenLocked: false, supportsDictation: true,
          supportsTerminalReadAloud: true, supportsInlineSpeech: true, requestId: request.requestId)
        if let reply = try? RemoteSessionStateCodec.encode(state) { receive(reply) }
      } else if let request = try? RemoteSpeechContextMessage.decode(data) {
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
      } else if let request = try? RemoteTerminalTabCodec.decode(data) {
        let state = RemoteTerminalTabState(revision: 1, selectedTabId: "preview-tab", tabs: [
          .init(id: "preview-tab", title: "Preview Terminal", detail: "Window 1", isSelected: true, isBusy: false)
        ])
        if let reply = try? RemoteTerminalTabCodec.encode(.listSuccess(requestId: request.requestId, state: state)) { receive(reply) }
      } else if let request = try? RemoteTerminalResponseCodec.decode(data) {
        let response = RemoteTerminalResponse(sessionId: "preview-session", turnId: "preview-turn",
          text: "This is the latest completed answer from the focused Terminal tab. " + String(repeating: "Completed answer. ", count: 12),
          completedAt: "2026-09-05T22:00:00Z", inProgress: false)
        if let reply = try? RemoteTerminalResponseCodec.encode(request.success(tabTitle: "Preview Terminal", response: response)) { receive(reply) }
      }
    }
    return true
  }
}
#endif
