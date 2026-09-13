import CoreGraphics
import XCTest
@testable import ClawDad

final class MacTerminalWindowGeometryTests: XCTestCase {
  let large = CGRect(x: 0, y: 30, width: 1800, height: 1200)
  let small = CGRect(x: 0, y: 30, width: 1800, height: 800)
  func testStaleTabSizeIsPreservedOnlyWithinTheSelectionTransaction() {
    XCTAssertTrue(MacTerminalWindowGeometry.shouldPreserve(before: large, after: small,
      beforeFullScreen: false, afterFullScreen: false, elapsed: 0.3, manualInputIdle: 4, displaysUnchanged: true))
    for elapsed in [1.6, 3] {
      XCTAssertFalse(MacTerminalWindowGeometry.shouldPreserve(before: large, after: small,
        beforeFullScreen: false, afterFullScreen: false, elapsed: elapsed, manualInputIdle: 9, displaysUnchanged: true))
    }
  }
  func testManualSizingFullscreenDisplayChangesAndUnknownGeometryArePreserved() {
    for values in [(false as Bool?, false as Bool?, 0.2, true), (true, true, 4, true),
      (nil, false, 4, true), (false, nil, 4, true), (false, true, 4, true), (false, false, 4, false)] {
      XCTAssertFalse(MacTerminalWindowGeometry.shouldPreserve(before: large, after: small,
        beforeFullScreen: values.0, afterFullScreen: values.1, elapsed: 0.3,
        manualInputIdle: values.2, displaysUnchanged: values.3))
    }
    for after in [nil, large, large.offsetBy(dx: 30, dy: 0), CGRect(x: 0, y: 30, width: 1795, height: 1190)] {
      XCTAssertFalse(MacTerminalWindowGeometry.shouldPreserve(before: large, after: after,
        beforeFullScreen: false, afterFullScreen: false, elapsed: 0.3, manualInputIdle: 4, displaysUnchanged: true))
    }
  }
}
