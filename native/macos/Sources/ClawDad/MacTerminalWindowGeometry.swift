import CoreGraphics
import Foundation

/// A one-operation guard, never a background size lock. The current physical
/// window is authoritative; logical tab windows can retain older row counts.
enum MacTerminalWindowGeometry {
  static func shouldPreserve(before: CGRect?, after: CGRect?, beforeFullScreen: Bool?,
    afterFullScreen: Bool?, elapsed: TimeInterval, manualInputIdle: TimeInterval,
    displaysUnchanged: Bool) -> Bool {
    guard let before, let after, beforeFullScreen == false, afterFullScreen == false,
      displaysUnchanged, elapsed >= 0, elapsed <= 1.5, manualInputIdle > elapsed + 0.05,
      [before, after].allSatisfy({ rect in
        [rect.minX, rect.minY, rect.width, rect.height].allSatisfy(\.isFinite)
          && rect.width >= 200 && rect.height >= 100
      }), abs(before.minX - after.minX) <= 2, abs(before.minY - after.minY) <= 2 else { return false }
    // Terminal rounds to its character grid. Ignore a small rounding adjustment.
    return abs(before.width - after.width) > 20 || abs(before.height - after.height) > 20
  }

  static func manualInputIdle() -> TimeInterval {
    [CGEventType.keyDown, .leftMouseDown, .leftMouseDragged, .rightMouseDown, .scrollWheel]
      .map { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0) }.min() ?? 0
  }

  static func displays() -> String {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success else { return "unavailable" }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return "unavailable" }
    return ids.sorted().map { "\($0):\(CGDisplayBounds($0))" }.joined(separator: "|")
  }
}
