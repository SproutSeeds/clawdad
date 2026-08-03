import XCTest
@testable import ClawDad

final class RemoteAssistSessionTests: XCTestCase {
  func testAcceptsWhenNoSessionIsActive() {
    XCTAssertEqual(
      remoteAssistRequestDisposition(
        currentSessionId: "",
        currentDeviceId: "",
        incomingSessionId: "new-session",
        incomingDeviceId: "iphone-a"
      ),
      .accept
    )
  }

  func testIgnoresDuplicateRequestForCurrentSession() {
    XCTAssertEqual(
      remoteAssistRequestDisposition(
        currentSessionId: "active-session",
        currentDeviceId: "iphone-a",
        incomingSessionId: "active-session",
        incomingDeviceId: "iphone-a"
      ),
      .ignoreDuplicate
    )
  }

  func testSameIPhoneReplacesItsStaleSessionWithNewSession() {
    XCTAssertEqual(
      remoteAssistRequestDisposition(
        currentSessionId: "old-session",
        currentDeviceId: "iphone-a",
        incomingSessionId: "new-session",
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
        incomingSessionId: "other-session",
        incomingDeviceId: "iphone-b"
      ),
      .rejectBusy
    )
  }
}
