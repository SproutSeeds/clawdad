import ClawDadRemoteAssistProtocol
import Foundation

enum MacTerminalNativeCloseOutcome {
  case closed
  case confirmation(token: String, prompt: String, button: String)
  case cancelled
}

@MainActor
final class MacTerminalTabCloseController {
  private let automation: MacTerminalAutomating
  private let catalog: () async throws -> RemoteTerminalTabState
  private let snapshot: (String) -> MacTerminalTabSnapshot?
  private var receipts: [String: (RemoteTerminalTabCloseMessage, RemoteTerminalTabCloseMessage)] = [:]
  private var receiptOrder: [String] = []
  private var pending: (request: RemoteTerminalTabCloseMessage, token: String)?
  private var expiry: Task<Void, Never>?
  private var executing = false
  private var generation = UUID()
  var hasPendingConfirmation: Bool { pending != nil }

  init(automation: MacTerminalAutomating, catalog: @escaping () async throws -> RemoteTerminalTabState,
       snapshot: @escaping (String) -> MacTerminalTabSnapshot?) {
    self.automation = automation; self.catalog = catalog; self.snapshot = snapshot
  }

  func handle(_ request: RemoteTerminalTabCloseMessage) async -> RemoteTerminalTabCloseMessage {
    if let (original, result) = receipts[request.requestId] {
      return original == request ? result : request.result(.failed, state: nil,
        prompt: "This close request changed. Choose the tab again.", errorCode: "request_conflict")
    }
    guard !executing else {
      return request.result(.failed, state: nil, prompt: "Wait for the current tab close.", errorCode: "request_in_progress")
    }
    if request.type == "terminal.tab.close", pending != nil {
      return request.result(.failed, state: nil, prompt: "Finish the current close confirmation first.", errorCode: "request_in_progress")
    }
    if request.type == "terminal.tab.close.resolve",
       pending?.token != request.confirmationToken || pending?.request.tabId != request.tabId || pending == nil {
      return request.result(.failed, state: nil, prompt: "This close confirmation expired. Choose the tab again.", errorCode: "confirmation_expired")
    }
    executing = true
    defer { executing = false }
    let operationGeneration = generation
    let response: RemoteTerminalTabCloseMessage
    var initialState: RemoteTerminalTabState?
    do {
      try Task.checkCancellation()
      let outcome: MacTerminalNativeCloseOutcome
      if request.type == "terminal.tab.close" {
        guard pending == nil else { throw failure("request_in_progress", "Finish the current close confirmation first.") }
        let state = try await catalog()
        initialState = state
        guard state.revision == request.expectedRevision else {
          throw MacTerminalTabFailure(code: "stale_catalog", message: "The tabs changed. Check the refreshed picker and close the tab again.", state: state)
        }
        guard let target = snapshot(request.tabId) else { throw failure("tab_unavailable", "That tab is already closed.") }
        try Task.checkCancellation()
        guard generation == operationGeneration else { throw CancellationError() }
        outcome = try await automation.closeTab(target)
      } else {
        guard let pending, pending.token == request.confirmationToken, pending.request.tabId == request.tabId else {
          throw failure("confirmation_expired", "This close confirmation expired. Choose the tab again.")
        }
        self.pending = nil
        expiry?.cancel(); expiry = nil
        outcome = try await automation.resolveTabClose(token: pending.token, confirm: request.confirm == true)
        // Retrying the original request after a decision must never reopen the warning.
        remember(pending.request, result: pending.request.result(.failed, state: nil,
          prompt: "This close confirmation has already been answered.", errorCode: "confirmation_resolved"))
      }
      try Task.checkCancellation()
      guard generation == operationGeneration else { throw CancellationError() }
      switch outcome {
      case .confirmation(let token, let prompt, let button):
        let refreshed = try? await catalog()
        guard let state = refreshed ?? initialState else { throw failure("close_unconfirmed", "The Terminal close confirmation could not be verified.") }
        guard state.tabs.contains(where: { $0.id == request.tabId }) else { throw failure("tab_unavailable", "That tab changed while closing.") }
        pending = (request, token)
        expiry = Task { [weak self] in
          try? await Task.sleep(nanoseconds: 60_000_000_000)
          guard !Task.isCancelled, let self, self.pending?.token == token else { return }
          await self.cancel()
        }
        response = request.result(.confirmationRequired, state: state, token: token, prompt: prompt, confirmLabel: button)
      case .closed:
        let state = try await catalog()
        guard !state.tabs.contains(where: { $0.id == request.tabId }) else {
          throw MacTerminalTabFailure(code: "close_unconfirmed", message: "Terminal has not confirmed this tab closed. The picker still shows the Mac’s current tabs.", state: state)
        }
        response = request.result(.closed, state: state)
      case .cancelled:
        response = request.result(.cancelled, state: try await catalog())
      }
    } catch {
      await automation.cancelTabClose()
      pending = nil; expiry?.cancel(); expiry = nil
      let failure = error as? MacTerminalTabFailure
      var state = failure?.state
      if state == nil { state = try? await catalog() }
      response = request.result(.failed, state: state,
        prompt: String((failure?.message ?? "The tab close was interrupted. Check the picker before trying again.").prefix(400)),
        errorCode: failure?.code ?? "close_interrupted")
    }
    remember(request, result: response)
    return response
  }

  func cancel() async {
    generation = UUID()
    let previous = pending
    pending = nil; expiry?.cancel(); expiry = nil
    await automation.cancelTabClose()
    if let previous {
      remember(previous.request, result: previous.request.result(.failed, state: nil,
        prompt: "This close confirmation expired or was cancelled. The tab was kept open.", errorCode: "confirmation_expired"))
    }
  }

  private func remember(_ request: RemoteTerminalTabCloseMessage, result: RemoteTerminalTabCloseMessage) {
    if receipts[request.requestId] == nil { receiptOrder.append(request.requestId) }
    receipts[request.requestId] = (request, result)
    while receiptOrder.count > 256 { receipts.removeValue(forKey: receiptOrder.removeFirst()) }
  }
  private func failure(_ code: String, _ message: String) -> MacTerminalTabFailure {
    MacTerminalTabFailure(code: code, message: message, state: nil)
  }
}
