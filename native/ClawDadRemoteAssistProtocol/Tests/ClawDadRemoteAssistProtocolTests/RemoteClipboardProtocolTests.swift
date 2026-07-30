import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteClipboardProtocolTests: XCTestCase {
  func testPasteRequestRoundTripsMultilineUnicode() throws {
    let message = RemoteClipboardMessage.pasteRequest(
      text: "first line\nsecond line with cafe\u{301}",
      requestId: "paste-123"
    )

    let decoded = try RemoteClipboardCodec.decode(
      RemoteClipboardCodec.encode(message)
    )

    XCTAssertEqual(decoded, message)
  }

  func testCopyResultRoundTrips() throws {
    let message = RemoteClipboardMessage.success(
      action: .copy,
      requestId: "copy-123",
      text: "Copied on the Mac"
    )

    let decoded = try RemoteClipboardCodec.decode(
      RemoteClipboardCodec.encode(message)
    )

    XCTAssertEqual(decoded, message)
  }

  func testOversizedMultibyteTextIsRejected() {
    let oversized = String(repeating: "\u{00e9}", count: 32_769)
    let message = RemoteClipboardMessage.pasteRequest(
      text: oversized,
      requestId: "paste-large"
    )

    XCTAssertThrowsError(try RemoteClipboardCodec.encode(message)) { error in
      XCTAssertEqual(error as? RemoteClipboardProtocolError, .textTooLarge)
    }
  }

  func testCopySuccessRequiresText() {
    let message = RemoteClipboardMessage.success(
      action: .copy,
      requestId: "copy-empty"
    )

    XCTAssertThrowsError(try RemoteClipboardCodec.encode(message)) { error in
      XCTAssertEqual(error as? RemoteClipboardProtocolError, .emptyText)
    }
  }

  func testFailureRequiresAnErrorMessage() {
    let message = RemoteClipboardMessage.failure(
      action: .paste,
      requestId: "paste-failed",
      error: ""
    )

    XCTAssertThrowsError(try RemoteClipboardCodec.encode(message)) { error in
      XCTAssertEqual(error as? RemoteClipboardProtocolError, .invalidResult)
    }
  }
}
