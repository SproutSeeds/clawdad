import Foundation
import OSLog

/// Retry a read, never an input action, and only for an already captured tab.
/// A missing identity is not permission to adopt whichever tab is focused later.
@MainActor
func macRecoverTerminalInputIdentity(
  expected: String?, isCurrent: () -> Bool,
  read: () async throws -> String?,
  pause: (Int) async throws -> Void = { attempt in
    try await Task.sleep(nanoseconds: UInt64(attempt + 1) * 75_000_000)
  }
) async -> String? {
  guard let expected else { return nil }
  for attempt in 0..<3 {
    guard !Task.isCancelled, isCurrent() else { return nil }
    do {
      let current = try await read()
      return !Task.isCancelled && isCurrent() && current == expected ? current : nil
    } catch {
      let code = (error as? MacTerminalTabFailure)?.code ?? "input_identity_failed"
      Logger(subsystem: "earth.frg.ClawDad", category: "Terminal").info(
        "input_identity_read=\(code, privacy: .public) attempt=\(attempt + 1)"
      )
      guard code == "layout_unavailable", attempt < 2, !Task.isCancelled, isCurrent() else { return nil }
      do { try await pause(attempt) } catch { return nil }
    }
  }
  return nil
}

/// Captures are immutable, bounded and scoped to one input controller/connection.
/// A nil value records that no input was focused; it never means "resolve later".
struct MacDictationTargetRegistry<Value> {
  struct Capture {
    let value: Value?
    let generation: UInt64
    let expiresAt: Date
    let requiresTerminalIdentity: Bool
    let terminalIdentity: String?
    var failure: String? = nil
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
          capture.expiresAt > now, capture.failure == nil, let value = capture.value else { return nil }
    if capture.requiresTerminalIdentity {
      guard let expected = capture.terminalIdentity, expected == terminalIdentity else { return nil }
    }
    return isCurrent(value) ? value : nil
  }
}
