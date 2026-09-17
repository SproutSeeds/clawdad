import SwiftUI
import ClawDadRemoteAssistProtocol

enum CodexAccountRequestRecovery {
  static func retryCancel(_ pending: [String:AssistantValue]?, operation: [String:AssistantValue]) -> Bool {
    guard let pending,pending["action"]?.string=="accounts.cancel",let id=pending["operationId"]?.string,!id.isEmpty else { return false }
    return id==operation["id"]?.string
  }
  static func acknowledged(_ pending: [String:AssistantValue], reply: [String:AssistantValue]) -> Bool {
    guard let id=pending["requestId"]?.string,!id.isEmpty else { return false }
    if let receipt=reply["accountReceipt"]?.object,receipt["requestId"]?.string==id,receipt["accepted"]?.bool==true {
      if let account=pending["accountId"]?.string { return receipt["accountId"]?.string==account }
      if let operation=pending["operationId"]?.string { return receipt["operationId"]?.string==operation }
    }
    // A cancelled exact operation also satisfies an older unacknowledged
    // Cancel, including cancellation completed from the desktop. This never
    // clears a pending switch, sign-in, or a different operation's request.
    guard pending["action"]?.string=="accounts.cancel",let target=pending["operationId"]?.string,!target.isEmpty,
      let state=reply["accounts"]?.object else { return false }
    var operations=state["operations"]?.array?.compactMap(\.object) ?? []
    if let active=state["activeOperation"]?.object { operations.append(active) }
    return operations.contains { operation in
      operation["id"]?.string==target && (operation["cancelRequested"]?.bool==true ||
        operation["status"]?.string=="cancelled" && operation["fenced"]?.bool==false)
    }
  }
}

struct CodexAccountsView: View {
  var body: some View { AppAccountPicker() }
}
