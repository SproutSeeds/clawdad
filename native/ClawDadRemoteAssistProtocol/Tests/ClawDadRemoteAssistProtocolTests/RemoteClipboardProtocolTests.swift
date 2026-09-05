import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteClipboardProtocolTests: XCTestCase {
  func testDictationRoundTripsWithExplicitDeliveryOutcome() throws {
    let request = RemoteClipboardMessage.dictationRequest(text: "Café\nSecond line", requestId: "voice-1")
    XCTAssertEqual(try RemoteClipboardCodec.decode(RemoteClipboardCodec.encode(request)), request)
    for disposition in [RemoteDictationDisposition.inserted, .copied] {
      let response = RemoteClipboardMessage.success(action: .dictation, requestId: request.requestId,
                                                    disposition: disposition)
      XCTAssertEqual(try RemoteClipboardCodec.decode(RemoteClipboardCodec.encode(response)), response)
    }
  }

  func testDictationCannotReportSuccessWithoutOutcome() {
    XCTAssertThrowsError(try RemoteClipboardCodec.encode(
      .success(action: .dictation, requestId: "unknown")
    ))
  }

  func testOlderHostStateRemainsDecodableWithoutDictationCapability() throws {
    let old = Data(#"{"type":"session.state","screenLocked":false}"#.utf8)
    XCTAssertNil(try RemoteSessionStateCodec.decode(old).supportsDictation)
    let current = RemoteSessionStateMessage.state(screenLocked: false, supportsDictation: true)
    XCTAssertEqual(try RemoteSessionStateCodec.decode(RemoteSessionStateCodec.encode(current)), current)
  }

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
