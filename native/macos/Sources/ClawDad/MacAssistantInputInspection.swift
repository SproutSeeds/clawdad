import Foundation

/// Native inspections belong to one worker lifetime. Receipts, not these
/// short-lived capabilities, survive restart. Consuming a token is irreversible.
struct MacAssistantInputInspections<Value> {
  private var entries: [String: (value: Value, expires: Date)] = [:]
  private var reasons: [String: String] = [:]
  var now: () -> Date
  init(now: @escaping () -> Date = Date.init) { self.now = now }

  mutating func insert(_ value: Value, token: String, expires: Date) {
    for (id, entry) in entries where entry.expires <= now() {
      entries.removeValue(forKey: id); remember(id, "The input inspection expired after 45 seconds.")
    }
    if entries.count >= 32 { invalidate("A newer inspection replaced this input observation.") }
    entries[token] = (value, expires)
  }
  mutating func consume(_ token: String) throws -> Value {
    guard let entry = entries.removeValue(forKey: token) else {
      throw assistantTerminalFailure("inspection_unavailable", (reasons[token] ?? "This input inspection is unavailable in the current native worker or was already consumed.")
        + " Focus the intended tab first, then inspect_terminal_input and use that new token. No input was sent.")
    }
    remember(token, "This single-use input inspection was already consumed.")
    guard entry.expires > now() else {
      remember(token, "The input inspection expired after 45 seconds.")
      throw assistantTerminalFailure("inspection_expired", "The input inspection expired after 45 seconds. Inspect the same tab again; no input was sent.")
    }
    return entry.value
  }
  mutating func invalidate(_ reason: String) {
    for id in entries.keys { remember(id, reason) }
    entries.removeAll()
  }
  private mutating func remember(_ token: String, _ reason: String) {
    if reasons.count >= 64 { reasons.removeAll() }
    reasons[token] = reason
  }
}

func assistantSameFocusedInput(before: String?, after: String?, generationUnchanged: Bool) -> Bool {
  before != nil && before == after && generationUnchanged
}

/// Only a paste made and verified by this native worker can supply hidden text.
/// User input, history navigation, process changes, expiry and restart invalidate
/// this provenance; a durable old request or matching character count cannot.
struct MacAssistantDraftProvenance {
  struct Context: Equatable {
    let input: String, process: String, session: String?, foreground: String
    let generation: UInt64
  }
  private(set) var revision: UInt64 = 0
  private var receipt: (context: Context, text: String, expires: Date)?
  mutating func remember(_ text: String, context: Context, now: Date = Date()) {
    revision &+= 1
    receipt = (context, text, now.addingTimeInterval(300))
  }
  mutating func invalidate() { receipt = nil }
  func text(context: Context, screen: String, now: Date = Date()) -> String? {
    guard let receipt, receipt.context == context, receipt.expires > now,
      assistantCollapsedPasteMatches(screen, payload: receipt.text) else { return nil }
    return receipt.text
  }
}
