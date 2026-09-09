import Foundation

/// Bound consecutive failures, not the number of route changes in a long call.
struct AssistantCaptureRecovery {
  private(set) var attempts = 0
  private var healthySince: TimeInterval?
  mutating func healthy(at time: TimeInterval) {
    healthySince = healthySince ?? time
    if time - (healthySince ?? time) >= 10 { attempts = 0 }
  }
  mutating func begin() -> Bool {
    healthySince = nil
    guard attempts < 2 else { return false }
    attempts += 1
    return true
  }
}
