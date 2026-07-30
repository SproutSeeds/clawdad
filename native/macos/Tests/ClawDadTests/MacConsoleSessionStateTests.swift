import XCTest
@testable import ClawDad

final class MacConsoleSessionStateTests: XCTestCase {
  func testLockedValueAcceptsBooleanAndNumber() {
    XCTAssertTrue(MacConsoleSessionState.lockedValue(true))
    XCTAssertTrue(MacConsoleSessionState.lockedValue(NSNumber(value: true)))
    XCTAssertFalse(MacConsoleSessionState.lockedValue(false))
    XCTAssertFalse(MacConsoleSessionState.lockedValue(nil))
  }
}
