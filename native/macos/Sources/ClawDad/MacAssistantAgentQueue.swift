import Foundation

/// Queue acceptance is an observed change in Codex's pending-input area, never
/// inferred from a posted key or an empty composer. Unknown renderers fail closed.
struct MacAssistantAgentQueueSnapshot: Equatable {
  let draft: String
  let messages: [String]
  let tabQueues: Bool

  static func read(_ screen: String) -> Self? {
    guard let draft = assistantEditableDraft(screen, allowQueueFooter: true) else { return nil }
    let lines = screen.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
    guard let prompt = lines.lastIndex(where: { $0.hasPrefix("›") }),
      let working = lines[..<prompt].lastIndex(where: { $0.hasPrefix("• ") && $0.contains("esc to interrupt") }),
      !lines[(working + 1)..<prompt].contains(where: { $0.hasPrefix("›") }) else { return nil }
    let footer = lines.dropFirst(prompt + 1)
    let tabQueues = footer.contains { $0.range(of: #"^tab to queue message\b"#, options: .regularExpression) != nil }
    var messages: [String] = []
    if let header = lines[(working + 1)..<prompt].lastIndex(of: "• Queued follow-up inputs") {
      var ended = false
      for line in lines[(header + 1)..<prompt] where !line.isEmpty {
        if line.hasSuffix("edit last queued message") { ended = true; continue }
        // Previously accepted long entries may be clipped to an ellipsis.
        // Keep their visible representation opaque and unchanged; only the
        // newly inserted message must match its complete authorized text.
        if ended || line.hasPrefix("• ") { return nil }
        if line.hasPrefix("↳ ") { messages.append(String(line.dropFirst(2))) }
        else if !messages.isEmpty { messages[messages.count - 1] += "\n" + line }
        else { return nil }
      }
      guard ended, !messages.isEmpty else { return nil }
    }
    return Self(draft: draft, messages: messages, tabQueues: tabQueues)
  }

}

@MainActor
func assistantQueueVerifiedMessage(_ text: String, useExistingDraft: Bool = false,
  read: () async throws -> MacAssistantAgentQueueSnapshot?,
  insert: () async -> Bool, prepare: () async throws -> Void, pressTab: () async -> Bool,
  wait: () async throws -> Void = { try await Task.sleep(nanoseconds: 150_000_000) }
) async throws {
  // Codex redraws this region as tool output arrives. Wait only while it is
  // unreadable, before any input; a visible draft always stops immediately.
  var initial: MacAssistantAgentQueueSnapshot?
  for attempt in 0..<8 {
    if let observed = try await read() { initial = observed; break }
    if attempt < 7 { try await wait() }
  }
  guard let before = initial, useExistingDraft ? before.draft == text : before.draft.isEmpty else {
    throw MacAssistantError("Native queue unsupported in this input state. Its draft and pending messages were preserved. Inspect the working Codex tab.")
  }
  if !useExistingDraft {
    guard await insert() else { throw MacAssistantError("The input changed before insertion. The message was not queued.") }
  }
  var verified = false
  for attempt in 0..<12 {
    if let current = try await read(), current.messages == before.messages,
      assistantEditableDraftMatches(current.draft, expected: text), current.tabQueues {
      verified = true; break
    }
    if attempt < 11 { try await wait() }
  }
  guard verified else {
    throw MacAssistantError("The draft or Tab queue binding could not be verified. The inserted text remains for inspection; Tab and Enter were not sent.")
  }
  try await prepare()
  guard let current = try await read(), current.messages == before.messages, current.tabQueues,
    assistantEditableDraftMatches(current.draft, expected: text), await pressTab() else {
    throw MacAssistantError("The agent or input changed before Tab. Inspect the draft and this request; it will not be sent again automatically.")
  }
  let expected = before.messages + [text]
  for attempt in 0..<16 {
    if let current = try await read(), current.draft.isEmpty, current.messages.count == expected.count,
      zip(current.messages, expected).allSatisfy({ assistantEditableDraftMatches($0, expected: $1) }) { return }
    if attempt < 15 { try await wait() }
  }
  throw MacAssistantError("Tab was sent once, but the agent queue could not be fully read. Delivery is uncertain; inspect this request and the tab before taking further action.")
}
