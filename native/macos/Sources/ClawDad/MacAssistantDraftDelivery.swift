import Foundation

/// A paste acknowledgement is not proof that the intended composer changed.
/// Observe its rendered draft, while making at most one insertion attempt.
@MainActor
func assistantInsertVerifiedDraft(_ text: String,
  insert: () async -> Bool, read: () async throws -> String,
  wait: () async throws -> Void = { try await Task.sleep(nanoseconds: 150_000_000) }
) async throws {
  guard !Task.isCancelled, await insert() else {
    throw MacAssistantError("The draft could not be inserted. Inspect the intended tab before trying again.")
  }
  for attempt in 0..<8 {
    try Task.checkCancellation()
    if assistantDraftMatches(try await read(), expected: text) { return }
    if attempt < 7 { try await wait() }
  }
  throw MacAssistantError("The paste was requested, but the draft could not be verified. Inspect the tab before trying again; Enter was not sent.")
}

func assistantDraftMatches(_ screen: String, expected: String) -> Bool {
  let lines = screen.components(separatedBy: .newlines)
  guard let start = lines.lastIndex(where: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("›") }) else { return false }
  var draft = [String(lines[start].trimmingCharacters(in: .whitespaces).dropFirst())]
  for line in lines.dropFirst(start + 1) {
    let value = line.trimmingCharacters(in: .whitespaces)
    if value.range(of: #"^(?:gpt[-\s]|\d+% context left\b|\? for shortcuts\b)"#, options: .regularExpression) != nil { break }
    if !value.isEmpty, value.allSatisfy({ "─━╌┄┈═".contains($0) }) { break }
    draft.append(value)
  }
  // Terminal wraps long lines to the current window width. Compare the full
  // composer, allowing that visual whitespace while rejecting additional text.
  func normalized(_ value: String) -> String { value.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
  return !expected.isEmpty && normalized(draft.joined(separator: "\n")) == normalized(expected)
}
