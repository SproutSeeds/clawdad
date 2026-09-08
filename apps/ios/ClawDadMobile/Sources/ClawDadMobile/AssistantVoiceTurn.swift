import Foundation

/// Recording segments belong to a thought until it is explicitly committed.
/// A sealed turn keeps its identity through delayed STT and delivery retries.
@MainActor
final class AssistantVoiceTurn {
  let id = UUID().uuidString.lowercased()
  var parts: [String] = []
  var pendingSegments = 0
  var sealed = false
  var lastAudioAt: TimeInterval = 0
  var endpointAt: TimeInterval?
  var metrics: [String: Double] = [:]
  var text: String { parts.joined(separator: " ") }
  func add(_ key: String, _ value: Double) { metrics[key, default: 0] += max(0, value) }
}
