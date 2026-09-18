import ClawDadRemoteAssistProtocol

enum AppAccountPresentation {
  static func activeTitle(_ state: [String: AssistantValue], disconnected: Bool) -> String {
    let current = state["current"]?.object ?? [:]
    if disconnected || current["status"]?.string == "unavailable" { return "Active account unavailable" }
    if let email = current["email"]?.string { return "Active · \(email)" }
    let active = state["activeAccountId"]?.string
    if let email = state["accounts"]?.array?.compactMap(\.object).first(where: { $0["id"]?.string == active })?["email"]?.string {
      return "Active · \(email)"
    }
    return state["requiresActivation"]?.bool == true ? "Choose an account" : "Checking active account…"
  }

  static func activationTitle(_ operation: [String: AssistantValue], isActive: Bool) -> String {
    guard operation["fenced"]?.bool == true else { return isActive ? "Active for ClawDad" : "Activate account" }
    switch operation["status"]?.string {
    case "needs_attention": return "Needs attention"
    case "waiting":
      switch operation["reasonCode"]?.string {
      case "app_process_reader_unavailable": return "Waiting for Mac…"
      case "accepted_app_work", "shared_thread_working", "shared_thread_pending": return "Waiting for app work…"
      default: return "Checking app state…"
      }
    default: return "Activating…"
    }
  }

  static func status(_ state: [String: AssistantValue]) -> String? {
    let operation = state["activeOperation"]?.object ?? [:]
    if operation["fenced"]?.bool == true { return operation["reason"]?.string ?? "Checking activation…" }
    if state["requiresActivation"]?.bool == true { return "Activate a saved account to start ClawDad work." }
    let current = state["current"]?.object ?? [:]
    if ["unavailable", "needs_check"].contains(current["status"]?.string ?? "") {
      return current["message"]?.string ?? "Reconnect to verify the running app account."
    }
    return nil
  }
}
