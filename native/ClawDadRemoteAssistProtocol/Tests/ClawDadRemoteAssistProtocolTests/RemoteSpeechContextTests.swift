import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteSpeechContextTests: XCTestCase {
  func testJSONEscapingPreservesTheFullSelectedTextAllowance() throws {
    let text = String(repeating: "\"\n", count: 32_768)
    let response = RemoteSpeechContextMessage.request(.selection, requestId: "code").success(text: text)
    let data = try response.encode()
    XCTAssertGreaterThan(data.count, RemoteClipboardMessage.maximumEnvelopeBytes)
    XCTAssertEqual(try RemoteSpeechContextMessage.decode(data).text, text)
    XCTAssertThrowsError(try RemoteSpeechContextMessage.decode(Data(repeating: 32, count: RemoteSpeechContextMessage.maximumEnvelopeBytes + 1)))
  }

  func testLostAdvertisementCanBeReplacedByCorrelatedRequestAndReply() throws {
    var capabilities = RemoteSessionCapabilities()
    capabilities.begin(requestId: "receiver-ready")
    let request = try RemoteSessionStateRequest.decode(RemoteSessionStateRequest(requestId: capabilities.requestId).encode())
    XCTAssertFalse(capabilities.received)
    let wire = try RemoteSessionStateCodec.encode(.state(screenLocked: false, supportsDictation: true,
      supportsTerminalReadAloud: true, supportsInlineSpeech: true, requestId: request.requestId))
    XCTAssertTrue(capabilities.receive(try RemoteSessionStateCodec.decode(wire)))
    XCTAssertTrue(capabilities.received)
    XCTAssertEqual(capabilities.inlineSpeech, true)
  }

  func testLockOnlyMessagesPreserveCapabilitiesAndOldRepliesCannotChangeNewConnection() {
    var capabilities = RemoteSessionCapabilities()
    capabilities.begin(requestId: "new")
    XCTAssertFalse(capabilities.receive(.state(screenLocked: true, supportsDictation: false, requestId: "old")))
    XCTAssertFalse(capabilities.received)
    capabilities.receive(.state(screenLocked: false, supportsDictation: true, supportsTerminalReadAloud: true, supportsInlineSpeech: true, requestId: "new"))
    capabilities.receive(.state(screenLocked: true))
    XCTAssertEqual(capabilities.dictation, true)
    XCTAssertEqual(capabilities.inlineSpeech, true)
    capabilities.receive(.state(screenLocked: false, supportsDictation: false))
    XCTAssertEqual(capabilities.dictation, false, "Explicit capability revocation remains authoritative.")
  }

  func testMissingStateTimesOutWithoutClaimingThatAnUpdateIsRequired() {
    var capabilities = RemoteSessionCapabilities()
    capabilities.begin(requestId: "current")
    capabilities.expire(requestId: "stale")
    XCTAssertFalse(capabilities.timedOut)
    capabilities.expire(requestId: "current")
    XCTAssertTrue(capabilities.timedOut)
    XCTAssertNil(capabilities.inlineSpeech)
    XCTAssertFalse(capabilities.received)
    capabilities.receive(.state(screenLocked: false, supportsInlineSpeech: true, requestId: "current"))
    XCTAssertFalse(capabilities.timedOut)
  }

  func testNoInputCaptureStillReturnsAnExplicitTokenAndDictationUsesIt() throws {
    let capture = RemoteSpeechContextMessage.request(.captureTarget, requestId: "menu")
    let reply = try RemoteSpeechContextMessage.decode(capture.success(token: "no-input").encode())
    XCTAssertNil(reply.targetName)
    let delivery = RemoteClipboardMessage.dictationRequest(text: "For later", requestId: "delivery", targetToken: reply.token)
    XCTAssertEqual(try RemoteClipboardCodec.decode(RemoteClipboardCodec.encode(delivery)), delivery)
    let fallback = RemoteClipboardMessage.dictationRequest(text: "For later", requestId: "fallback", copyOnly: true)
    XCTAssertEqual(try RemoteClipboardCodec.decode(RemoteClipboardCodec.encode(fallback)).copyOnly, true)
  }

  func testEmptySelectionIsDifferentFromFailureAndOversizedTextIsRejected() throws {
    let request = RemoteSpeechContextMessage.request(.selection, requestId: "read")
    let empty = try RemoteSpeechContextMessage.decode(request.success(text: "").encode())
    let failure = try RemoteSpeechContextMessage.decode(request.failure("App changed").encode())
    XCTAssertEqual(empty.ok, true)
    XCTAssertEqual(empty.text, "")
    XCTAssertEqual(failure.ok, false)
    XCTAssertNil(failure.text)
    XCTAssertThrowsError(try request.success(text: String(repeating: "x", count: 65_537)).encode())
    XCTAssertThrowsError(try request.success(token: "wrong", text: "selection").encode())
    XCTAssertThrowsError(try RemoteSpeechContextMessage.request(.captureTarget, requestId: "a").success(text: "bad").encode())
    XCTAssertThrowsError(try RemoteSessionStateRequest.decode(Data(#"{"type":"pointer","requestId":"x"}"#.utf8)))
  }
}
