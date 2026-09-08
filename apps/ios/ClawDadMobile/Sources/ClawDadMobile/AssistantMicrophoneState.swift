import Foundation

/// A running engine alone does not establish that its input tap is delivering.
struct AssistantMicrophoneState {
  private(set) var active = false
  var muted = false
  private(set) var lastBufferAt: TimeInterval?
  private var beganAt: TimeInterval = 0

  mutating func begin(at time: TimeInterval) {
    active = true
    muted = false
    beganAt = time
    lastBufferAt = nil
  }

  mutating func receivedBuffer(at time: TimeInterval) {
    guard active else { return }
    lastBufferAt = time
  }

  func receiving(at time: TimeInterval) -> Bool {
    active && lastBufferAt.map { time - $0 < 2 } == true
  }

  func needsRecovery(at time: TimeInterval, engineRunning: Bool) -> Bool {
    guard active else { return false }
    return time - (lastBufferAt ?? beganAt) >= 2
      || (!engineRunning && time - beganAt >= 0.5)
  }

  mutating func end() {
    active = false
    muted = false
    lastBufferAt = nil
  }
}
