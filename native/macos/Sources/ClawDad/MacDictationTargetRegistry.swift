import Foundation

/// Captures are immutable, bounded and scoped to one input controller/connection.
/// A nil value records that no input was focused; it never means "resolve later".
struct MacDictationTargetRegistry<Value> {
  struct Capture {
    let value: Value?
    let generation: UInt64
    let expiresAt: Date
    let requiresTerminalIdentity: Bool
    let terminalIdentity: String?
  }
  private var captures: [String: Capture] = [:]
  private var order: [String] = []

  func capture(for token: String) -> Capture? { captures[token] }

  mutating func remember(_ capture: Capture, token: String) {
    guard captures[token] == nil else { return }
    captures[token] = capture
    order.append(token)
    if order.count > 16 { captures.removeValue(forKey: order.removeFirst()) }
  }

  func resolve(token: String, generation: UInt64, terminalIdentity: String?, now: Date = Date(),
               isCurrent: (Value) -> Bool) -> Value? {
    guard let capture = captures[token], capture.generation == generation,
          capture.expiresAt > now, let value = capture.value else { return nil }
    if capture.requiresTerminalIdentity {
      guard let expected = capture.terminalIdentity, expected == terminalIdentity else { return nil }
    }
    return isCurrent(value) ? value : nil
  }
}
