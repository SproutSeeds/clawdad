import CoreGraphics
import XCTest
@testable import ClawDad

final class MacKeyboardLayoutTests: XCTestCase {
  func testCurrentLayoutMapsCommonPasswordCharacters() throws {
    let strokes = try XCTUnwrap(
      MacKeyboardLayout.keyStrokes(for: "aA1!")
    )

    XCTAssertEqual(strokes.count, 4)
    XCTAssertFalse(strokes[0].flags.contains(.maskShift))
    XCTAssertTrue(strokes[1].flags.contains(.maskShift))
    XCTAssertFalse(strokes[2].flags.contains(.maskShift))
    XCTAssertTrue(strokes[3].flags.contains(.maskShift))
  }

  func testUnmappableTextFailsBeforeAnyEventsArePosted() {
    XCTAssertNil(MacKeyboardLayout.keyStrokes(for: "\u{1F980}"))
  }

  func testReturnAndTabUsePhysicalControlKeys() throws {
    let strokes = try XCTUnwrap(
      MacKeyboardLayout.keyStrokes(for: "\n\t")
    )

    XCTAssertEqual(strokes.map(\.keyCode), [36, 48])
  }
}
