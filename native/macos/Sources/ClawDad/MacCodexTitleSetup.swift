import Foundation

/// The local /title display editor is separate from agent submission. The
/// caller must bind every observation and key to the same native owner and
/// reject manual input. This adapter never dispatches a task or a Tab key.
enum MacCodexTitleSetup {
  struct Row: Equatable {
    let id: String
    let checked: Bool
  }
  static func offered(_ text: String) -> Bool {
    let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
    guard let prompt = lines.lastIndex(of: "› /title") else { return false }
    let tail = lines.dropFirst(prompt + 1).filter { !$0.isEmpty }
    return tail.count == 1 && tail.first == "/title  configure which items appear in the terminal title"
  }
  static func focusedRow(_ text: String) -> Row? {
    guard let panel = text.range(of: "Configure Terminal Title", options: .backwards) else { return nil }
    let body = String(text[panel.lowerBound...])
    guard body.contains("Select which items to display in the terminal title."),
      body.contains("Press space to toggle;"), body.contains("enter to confirm and close; esc to close") else { return nil }
    let rows = body.components(separatedBy: .newlines).filter { $0.trimmingCharacters(in: .whitespaces).hasPrefix("› [") }
    guard rows.count == 1, let line = rows.first,
      let match = line.range(of: #"^\s*› \[([x ])\] [a-z][a-z-]*\s"#, options: .regularExpression) else { return nil }
    let fields = line[match].split(whereSeparator: \.isWhitespace)
    guard let id = fields.last else { return nil }
    return Row(id: String(id), checked: line.contains("[x]"))
  }
  @MainActor static func disable(read: () async throws -> String,
    key: (String) async throws -> Void, journal: (String) throws -> Void) async throws {
    var visited = Set<String>()
    for _ in 0..<64 {
      guard let row = focusedRow(try await read()) else { throw MacAssistantError("Codex's title settings changed. No further key was sent; inspect its display editor.") }
      if visited.contains(row.id) {
        guard !row.checked else { throw MacAssistantError("A title option changed during verification. The display editor was preserved.") }
        try journal("confirm-disabled-title")
        try await key("enter")
        return
      }
      if row.checked {
        try journal("uncheck:" + row.id)
        try await key("space")
        guard focusedRow(try await read()) == Row(id: row.id, checked: false) else {
          throw MacAssistantError("The title option did not confirm its change. The display editor was preserved.")
        }
      }
      visited.insert(row.id)
      try journal("next-option:" + row.id)
      try await key("down")
    }
    throw MacAssistantError("Codex's title options did not converge. The display editor was preserved.")
  }
}
