import Foundation

enum AssistantCaptureMode: Equatable, Sendable {
  case conversation, off
}

/// The timestamp fence also rejects audio-thread callbacks already queued on
/// MainActor at a transition. No private buffer can become conversation audio
/// just because it is delivered after unmuting.
struct AssistantCaptureBoundary {
  private(set) var mode: AssistantCaptureMode = .off
  private(set) var beganAt: TimeInterval = .infinity
  mutating func move(to mode: AssistantCaptureMode, at time: TimeInterval) {
    self.mode = mode
    beganAt = time
  }
  func route(capturedAt: TimeInterval) -> AssistantCaptureMode {
    capturedAt >= beganAt ? mode : .off
  }
}
