import XCTest
@testable import ClawDadMobile

final class RemoteAssistOfferGateTests: XCTestCase {
  func testOnlyFirstOfferClaimsActiveSession() throws {
    var gate = RemoteAssistOfferGate()
    gate.beginSession("session-1")

    let first = try XCTUnwrap(gate.claimOffer(for: "session-1"))

    XCTAssertEqual(first.sessionId, "session-1")
    XCTAssertTrue(gate.isCurrent(first))
    XCTAssertNil(gate.claimOffer(for: "session-1"))
  }

  func testOfferForAnotherSessionCannotClaimGate() {
    var gate = RemoteAssistOfferGate()
    gate.beginSession("session-1")

    XCTAssertNil(gate.claimOffer(for: "session-2"))
    XCTAssertNotNil(gate.claimOffer(for: "session-1"))
  }

  func testRetryInvalidatesOldAttemptAndPreservesCapturedSession() throws {
    var gate = RemoteAssistOfferGate()
    gate.beginSession("old-session")
    let oldAttempt = try XCTUnwrap(
      gate.claimOffer(for: "old-session")
    )

    gate.reset()
    gate.beginSession("new-session")
    let newAttempt = try XCTUnwrap(
      gate.claimOffer(for: "new-session")
    )

    XCTAssertEqual(oldAttempt.sessionId, "old-session")
    XCTAssertFalse(gate.isCurrent(oldAttempt))
    XCTAssertEqual(newAttempt.sessionId, "new-session")
    XCTAssertTrue(gate.isCurrent(newAttempt))
  }
}
