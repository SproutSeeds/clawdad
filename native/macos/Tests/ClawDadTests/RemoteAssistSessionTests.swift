import XCTest
@testable import ClawDad

final class RemoteAssistSessionTests: XCTestCase {
  func testAcceptsWhenNoSessionIsActive() {
    XCTAssertEqual(
      remoteAssistRequestDisposition(
        currentSessionId: "",
        currentDeviceId: "",
        incomingDeviceId: "iphone-a"
      ),
      .accept
    )
  }

  func testSameIPhoneReplacesItsStaleSession() {
    XCTAssertEqual(
      remoteAssistRequestDisposition(
        currentSessionId: "old-session",
        currentDeviceId: "iphone-a",
        incomingDeviceId: "iphone-a"
      ),
      .replaceCurrent
    )
  }

  func testDifferentIPhoneCannotPreemptActiveSession() {
    XCTAssertEqual(
      remoteAssistRequestDisposition(
        currentSessionId: "active-session",
        currentDeviceId: "iphone-a",
        incomingDeviceId: "iphone-b"
      ),
      .rejectBusy
    )
  }
}
