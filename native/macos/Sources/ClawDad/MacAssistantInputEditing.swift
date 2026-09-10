import ApplicationServices
import Foundation

/// A native composer observation is separate from authorization to discard an
/// opaque paste. No retained clipboard payload is used to guess current text.
struct MacAssistantDraftObservation: Equatable {
  let text: String?
  let reasonCode: String
  let reason: String
  var requiresWholeDraftAuthorization: Bool { reasonCode == "collapsed_paste" }
}

func assistantObserveDraft(_ screen: String, viewportRows: Int? = nil) -> MacAssistantDraftObservation {
  func unavailable(_ code: String, _ reason: String) -> MacAssistantDraftObservation {
    .init(text: nil, reasonCode: code, reason: reason)
  }
  let lines = screen.components(separatedBy: .newlines)
  guard let start = lines.lastIndex(where: { $0.hasPrefix("›") || $0.hasPrefix(" ›") }) else {
    return unavailable("composer_not_visible", "The Codex composer is not visible. Dismiss overlays or return to its input, then inspect again.")
  }
  guard let end = lines.indices.first(where: { $0 > start && assistantComposerFooter(lines[$0], allowQueue: true) }),
    lines.dropFirst(end).allSatisfy({ $0.trimmingCharacters(in: .whitespaces).isEmpty || assistantComposerFooter($0, allowQueue: true) }) else {
    return unavailable("unresolved_prompt", "The normal Codex input footer is obscured or a prompt is open. Resolve it in Terminal, then inspect again.")
  }
  var body = [String(lines[start].trimmingCharacters(in: .whitespaces).dropFirst())]
  if body[0].hasPrefix(" ") { body[0].removeFirst() }
  for line in lines[(start + 1)..<end] {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if !trimmed.isEmpty, trimmed.allSatisfy({ "─━╌┄┈═".contains($0) }) { continue }
    body.append(line.hasPrefix("  ") ? String(line.dropFirst(2)) : line)
  }
  while body.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { body.removeLast() }
  let value = body.joined(separator: "\n")
  guard !value.contains(where: MacAssistantComposerFrame.stars.contains) else {
    return unavailable("animated_or_braille_input", "Decorative dots or Braille text require a stable native observation. The draft was preserved; inspect again after the display settles.")
  }
  let nearby = lines[max(0, start - 2)..<end].joined(separator: "\n")
  guard nearby.range(of: #"\[Image\s*#?\d"#, options: .regularExpression) == nil else {
    return unavailable("attachments_present", "This draft has image attachments. They were preserved. Remove them manually before whole-draft text editing.")
  }
  guard !value.contains("›"), value.utf8.count <= 16 * 1024 else {
    return unavailable("ambiguous_composer", "The complete text input could not be identified. Expand or shorten it in Terminal, then inspect again.")
  }
  // Read the real TTY dimensions instead of assuming an eight-line editor. A
  // composer filling the viewport can hide text or attachments; never clear it.
  if body.count >= 8 && (viewportRows == nil || end - start >= (viewportRows ?? 0) - 6)
      || nearby.range(of: #"[↑↓]"#, options: .regularExpression) != nil {
    return unavailable("composer_clipped", "The draft may extend beyond the visible Terminal input. Enlarge the window to show the entire composer, then inspect again. Its text and attachments were preserved.")
  }
  if value.range(of: #"\[Pasted (?:Content|content|text)"#, options: .regularExpression) != nil {
    guard value.range(of: #"\[Pasted (?:Content|content|text) [1-9][0-9]* chars\]"#, options: .regularExpression) != nil else {
      return unavailable("unknown_paste", "This paste representation is unsupported. Expand it in Terminal before editing.")
    }
    return .init(text: value, reasonCode: "collapsed_paste", reason: "This text includes a collapsed paste. expectedText compares its visible representation, not hidden contents. Set allowWholeDraft=true only when Cody explicitly authorizes clearing or replacing the entire draft, including the collapsed text. Attachments remain protected.")
  }
  let empty = ["Ask Codex to do anything", "Ask Codex to do anything.", "Ask anything"].contains(value)
  return .init(text: empty ? "" : value, reasonCode: "rendered_text", reason: "The complete rendered composer is visible. Terminal visual wraps may appear as newlines.")
}

func assistantEditableDraft(_ screen: String) -> String? { assistantEditableDraft(screen, allowQueueFooter: false) }
func assistantEditableDraft(_ screen: String, allowQueueFooter: Bool) -> String? {
  assistantEditableDraft(screen, allowQueueFooter: allowQueueFooter, allowCollapsedPaste: false)
}
func assistantEditableDraft(_ screen: String, allowQueueFooter: Bool, allowCollapsedPaste: Bool) -> String? {
  let view = assistantObserveDraft(screen)
  guard allowQueueFooter || !screen.components(separatedBy: .newlines).contains(where: {
    $0.trimmingCharacters(in: .whitespaces).range(of: #"^[a-z+ ⇧←]+ to queue message\b"#, options: .regularExpression) != nil
  }), allowCollapsedPaste || !view.requiresWholeDraftAuthorization else { return nil }
  return view.text
}

func assistantComposerFooter(_ line: String, allowQueue: Bool) -> Bool {
  let value = line.trimmingCharacters(in: .whitespaces)
  if allowQueue, value.range(of: #"^[a-z+ ⇧←]+ to queue message\b"#, options: .regularExpression) != nil { return true }
  return value.range(of: #"^(?:enter to (?:send|submit)\b|gpt[-\s]|\d+% context left\b|\? for shortcuts\b|(?:press )?ctrl\+c again to (?:quit|exit)\b)"#,
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
  forceReplacement: Bool = false,
  read: () async throws -> String?, clear: () async -> Bool, insert: (String) async -> Bool,
  verifyInserted: (() async throws -> Bool)? = nil,
  wait: () async throws -> Void = { try await Task.sleep(nanoseconds: 150_000_000) }
) async throws {
  guard try await read() == expected else {
    throw MacAssistantError("The inspected draft changed or is unreadable. It was preserved. Inspect the tab again.")
  }
  if expected == replacement && !forceReplacement { return }
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
      if !text.isEmpty, let verifyInserted {
        if try await verifyInserted() { return }
      } else if let current = try await read(), assistantEditableDraftMatches(current, expected: text) { return }
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
