import ApplicationServices
import Foundation

/// Only a fully readable, ordinary Codex composer can grant an edit token.
/// Keep its rendered whitespace for the compare-before-edit check. Opaque paste
/// and image placeholders cannot establish what would be deleted.
func assistantEditableDraft(_ screen: String) -> String? {
  let lines = screen.components(separatedBy: .newlines)
  guard let start = lines.lastIndex(where: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("›") }),
    let end = lines.indices.first(where: { $0 > start && assistantComposerFooter(lines[$0]) }),
    lines.dropFirst(end).allSatisfy({ $0.trimmingCharacters(in: .whitespaces).isEmpty || assistantComposerFooter($0) })
  else { return nil }
  var body = [String(lines[start].trimmingCharacters(in: .whitespaces).dropFirst())]
  if body[0].hasPrefix(" ") { body[0].removeFirst() }
  for line in lines[(start + 1)..<end] {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if !trimmed.isEmpty, trimmed.allSatisfy({ "─━╌┄┈═".contains($0) }) { continue }
    body.append(line.hasPrefix("  ") ? String(line.dropFirst(2)) : line)
  }
  while body.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { body.removeLast() }
  // A tall/clipped composer cannot prove that the visible text is the whole draft.
  guard body.count < 8 else { return nil }
  let value = body.joined(separator: "\n")
  let nearby = lines[max(0, start - 2)..<end].joined(separator: "\n")
  guard value.utf8.count <= 16 * 1024,
    nearby.range(of: #"\[(?:Image\s*#?\d|Pasted (?:Content|content|text))|[↑↓]"#, options: .regularExpression) == nil,
    !value.contains("›") else { return nil }
  if ["Ask Codex to do anything", "Ask Codex to do anything.", "Ask anything"].contains(value) { return "" }
  return value
}

private func assistantComposerFooter(_ line: String) -> Bool {
  let value = line.trimmingCharacters(in: .whitespaces)
  return value.range(of: #"^(?:gpt[-\s]|\d+% context left\b|\? for shortcuts\b|(?:press )?ctrl\+c again to (?:quit|exit)\b)"#,
    options: [.regularExpression, .caseInsensitive]) != nil
}

func assistantEditableDraftMatches(_ actual: String, expected: String) -> Bool {
  // Terminal adds visual line wraps. The paste itself retains the exact text;
  // verification compares the whole rendered composer, never a substring.
  actual.split(whereSeparator: \.isWhitespace) == expected.split(whereSeparator: \.isWhitespace)
}

/// No submission callback exists here. Every mutation runs at most once;
/// failed/uncertain verification never repeats a clear or a paste.
@MainActor
func assistantEditVerifiedDraft(expected: String, replacement: String,
  read: () async throws -> String?, clear: () async -> Bool, insert: (String) async -> Bool,
  wait: () async throws -> Void = { try await Task.sleep(nanoseconds: 150_000_000) }
) async throws {
  guard try await read() == expected else {
    throw MacAssistantError("The inspected draft changed or is unreadable. It was preserved. Inspect the tab again.")
  }
  if expected == replacement { return }
  if !expected.isEmpty {
    guard await clear() else { throw MacAssistantError("The draft changed before clearing. Inspect the tab again.") }
    try await verify("")
  }
  if !replacement.isEmpty {
    guard try await read() == "", await insert(replacement) else {
      throw MacAssistantError("The input changed before replacement. Inspect the tab; Enter was not sent.")
    }
    try await verify(replacement)
  }
  func verify(_ text: String) async throws {
    for attempt in 0..<12 {
      try Task.checkCancellation()
      if let current = try await read(), assistantEditableDraftMatches(current, expected: text) { return }
      if attempt < 11 { try await wait() }
    }
    throw MacAssistantError("The draft edit could not be verified. Inspect the tab before trying again; Enter was not sent.")
  }
}

enum MacAssistantInputEditPolicy {
  static func permits(bundleIdentifier: String?, role: String, subrole: String?,
    editable: Bool?, enabled: Bool?, focused: Bool?, valueSettable: Bool, text: String?) -> Bool {
    bundleIdentifier != "com.apple.Terminal"
      && MacEditableTargetPolicy.acceptsDictation(role: role, subrole: subrole,
        explicitlyEditable: editable, selectedTextSettable: false,
        enabled: enabled, focused: focused, bundleIdentifier: bundleIdentifier)
      && valueSettable && text != nil && (text?.utf8.count ?? Int.max) <= 16 * 1024
  }
}

@MainActor
func assistantReplaceVerifiedInput(expected: String, replacement: String,
  read: () throws -> String, write: (String) -> Bool,
  wait: () async throws -> Void = { try await Task.sleep(nanoseconds: 100_000_000) }
) async throws {
  guard try read() == expected else {
    throw MacAssistantError("The inspected input changed. Its text was preserved. Inspect it again.")
  }
  if expected == replacement { return }
  guard write(replacement) else { throw MacAssistantError("This app did not accept the edit. Inspect its input before retrying.") }
  for attempt in 0..<10 {
    try Task.checkCancellation()
    if try read() == replacement { return }
    if attempt < 9 { try await wait() }
  }
  throw MacAssistantError("The app did not confirm the resulting text. Inspect its input before retrying; Enter was not sent.")
}
