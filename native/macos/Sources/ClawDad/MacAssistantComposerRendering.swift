import Foundation

/// Codex 0.154 decorates blank composer cells with Astra stars. Terminal's AX
/// string includes them but does not expose attributed text. A character may
/// be removed ONLY after that exact cell was observed blank in the same stable
/// composer, with no intervening human input. Literal Braille stays protected.
struct MacAssistantComposerFrame {
  static let stars = Set("⠁⠂⠄⠈⠐⠠⡀⢀")
  let prefix: [String]
  let body: [[Character]]
  let suffix: [String]
  let signature: String
  init?(_ screen: String) {
    let lines = screen.components(separatedBy: .newlines)
    guard let prompt = lines.lastIndex(where: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("›") }),
      let end = lines.indices.first(where: { $0 > prompt && assistantComposerFooter(lines[$0], allowQueue: true) }) else { return nil }
    // The composer decoration also occupies its top border immediately above
    // the prompt, including the boundary below native pending-queue entries.
    let start = prompt > 0 && lines[prompt - 1].allSatisfy({ $0.isWhitespace || Self.stars.contains($0) }) ? prompt - 1 : prompt
    prefix = Array(lines[..<start]); body = lines[start..<end].map(Array.init); suffix = Array(lines[end...])
    signature = body.map { String($0.map { Self.stars.contains($0) ? Character(" ") : $0 }).trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")
  }
  var hasStars: Bool { body.contains { $0.contains(where: Self.stars.contains) } }
  var spaces: Set<String> {
    var result = Set<String>()
    // Pad within the observed line width: AX can trim trailing empty cells.
    let width = body.map(\.count).max() ?? 0
    for (row, chars) in body.enumerated() {
      for column in 0..<width where column >= chars.count || chars[column] == " " { result.insert("\(row):\(column)") }
    }
    return result
  }
  func clean(spaces: Set<String>) -> String? {
    var rows = body
    for row in rows.indices {
      for column in rows[row].indices where Self.stars.contains(rows[row][column]) {
        guard spaces.contains("\(row):\(column)") else { return nil }
        rows[row][column] = " "
      }
    }
    return (prefix + rows.map { String($0).replacingOccurrences(of: #" +$"#, with: "", options: .regularExpression) } + suffix).joined(separator: "\n")
  }
}

@MainActor
final class MacAssistantComposerRendering {
  static let shared = MacAssistantComposerRendering()
  private var signature: String?
  private var spaces = Set<String>()
  private var generation: UInt64?
  func invalidate() { signature = nil; spaces = []; generation = nil }
  func normalized(_ screen: String) -> String {
    guard let frame = MacAssistantComposerFrame(screen), frame.hasStars else { return screen }
    guard frame.signature == signature, let generation,
      MacAssistantInteractionGate.shared.isCurrent(generation) else { return screen }
    return frame.clean(spaces: spaces) ?? screen
  }
  func read(ticket: UInt64, raw: () throws -> String,
    wait: () async throws -> Void = { try await Task.sleep(nanoseconds: 180_000_000) }) async throws -> String {
    var value = try raw()
    guard let initial = MacAssistantComposerFrame(value), initial.hasStars else { return value }
    if generation != ticket || signature != initial.signature { invalidate(); generation = ticket; signature = initial.signature }
    for _ in 0..<50 {
      guard MacAssistantInteractionGate.shared.isCurrent(ticket), let frame = MacAssistantComposerFrame(value),
        frame.signature == initial.signature else { invalidate(); throw MacAssistantError("The composer changed during native inspection. Its draft was preserved; inspect again.") }
      spaces.formUnion(frame.spaces)
      if let clean = frame.clean(spaces: spaces) { return clean }
      try await wait(); value = try raw()
    }
    invalidate()
    throw MacAssistantError("Animated or Braille input could not be distinguished safely. The draft was preserved. Inspect again after the animation settles, or launch a future Codex session with tui.whimsy=false. Persistent Braille input needs manual editing.")
  }
}
