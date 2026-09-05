import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteTerminalResponseProtocolTests: XCTestCase {
  func testRequestAndResponseRoundTripPreservesSourceAndText() throws {
    let request = RemoteTerminalResponseMessage.request(requestId: "request", tabId: "tab", expectedRevision: 4)
    XCTAssertEqual(try RemoteTerminalResponseCodec.decode(RemoteTerminalResponseCodec.encode(request)), request)
    let result = request.success(tabTitle: "ClawDad", response: RemoteTerminalResponse(
      sessionId: "session", turnId: "turn", text: "Exact answer 🦞\n\nSecond paragraph.",
      completedAt: "2026-09-05T08:00:00Z", inProgress: true
    ))
    XCTAssertEqual(try RemoteTerminalResponseCodec.decode(RemoteTerminalResponseCodec.encode(result)), result)
    let failure = request.failure("The selected tab changed.")
    XCTAssertEqual(try RemoteTerminalResponseCodec.decode(RemoteTerminalResponseCodec.encode(failure)), failure)
  }

  func testInvalidAndOversizedRequestsAreRejected() {
    XCTAssertThrowsError(try RemoteTerminalResponseCodec.encode(.request(requestId: "x", tabId: "", expectedRevision: 1)))
    XCTAssertThrowsError(try RemoteTerminalResponseCodec.encode(.request(requestId: "x", tabId: "tab", expectedRevision: 0)))
    XCTAssertThrowsError(try RemoteTerminalResponseCodec.decode(Data(repeating: 32, count: RemoteTerminalResponseMessage.maximumEnvelopeBytes + 1)))
  }

  func testOldHostsHaveNoReadCapabilityAndSelectionCopyIsExplicit() throws {
    let old = try RemoteSessionStateCodec.decode(Data(#"{"type":"session.state","screenLocked":false}"#.utf8))
    XCTAssertNil(old.supportsTerminalReadAloud)
    let current = RemoteSessionStateMessage.state(screenLocked: false, supportsTerminalReadAloud: true)
    XCTAssertEqual(try RemoteSessionStateCodec.decode(RemoteSessionStateCodec.encode(current)), current)
    let selection = RemoteClipboardMessage.copyRequest(requestId: "selection", foregroundOnly: true)
    XCTAssertTrue(try XCTUnwrap(RemoteClipboardCodec.decode(RemoteClipboardCodec.encode(selection)).foregroundOnly))
    XCTAssertNil(RemoteClipboardMessage.copyRequest(requestId: "ordinary").foregroundOnly)
  }
}
