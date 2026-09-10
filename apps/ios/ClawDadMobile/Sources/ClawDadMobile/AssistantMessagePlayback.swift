import Foundation

enum AssistantMessagePlaybackText {
  /// Strip presentation delimiters only. Keep code, numbers, links and wording;
  /// speech never asks a model to paraphrase or create a conversation turn.
  static func spoken(_ source: String) -> String {
    var fenced = false
    return source.components(separatedBy: .newlines).compactMap { line -> String? in
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") { fenced.toggle(); return nil }
      if fenced { return line }
      var text = line.replacingOccurrences(of: #"^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+)"#, with: "", options: .regularExpression)
      for marker in [#"\*\*(.+?)\*\*"#, #"__(.+?)__"#, #"`([^`]+)`"#] {
        text = text.replacingOccurrences(of: marker, with: "$1", options: .regularExpression)
      }
      text = text.replacingOccurrences(of: #"!?\[([^\]]+)\]\(([^)]+)\)"#, with: "$1 ($2)", options: .regularExpression)
      return text
    }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
  }
  static func batches(_ source: String, maxBytes: Int = 24_000) -> [String] {
    var result: [String] = [], current = "", bytes = 0
    for character in source {
      let next = String(character), size = next.utf8.count
      if bytes + size > maxBytes && !current.isEmpty { result.append(current); current = ""; bytes = 0 }
      current += next; bytes += size
    }
    if !current.isEmpty { result.append(current) }
    return result
  }
}
