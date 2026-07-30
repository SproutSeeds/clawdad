import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteSessionStateProtocolTests: XCTestCase {
  func testLockedStateRoundTrips() throws {
    let message = RemoteSessionStateMessage.state(screenLocked: true)

    let decoded = try RemoteSessionStateCodec.decode(
      RemoteSessionStateCodec.encode(message)
    )

    XCTAssertEqual(decoded, message)
  }

  func testUnknownStateTypeIsRejected() {
    let message = RemoteSessionStateMessage(
      type: "session.unknown",
      screenLocked: false
    )

    XCTAssertThrowsError(try RemoteSessionStateCodec.encode(message)) { error in
      XCTAssertEqual(
        error as? RemoteSessionStateProtocolError,
        .invalidType
      )
    }
  }
}
