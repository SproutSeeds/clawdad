import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteQuickChatTests: XCTestCase {
  func testExactTextAndTargetSurviveWireAndReceiptOmitsText() throws {
    let text = "  Keep this exact text.\nCafé 🎙️  "
    let request = RemoteQuickChatMessage.request(text: text, targetToken: "window-1-tab-2", requestId: "tap")
    XCTAssertEqual(try RemoteQuickChatMessage.decode(request.encode()), request)
    let reply = try RemoteQuickChatMessage.decode(request.result().encode())
    XCTAssertEqual(reply.ok, true)
    XCTAssertNil(reply.text)
    XCTAssertNil(reply.targetToken)
    XCTAssertEqual(reply.requestId, request.requestId)
  }

  func testRejectsMissingTargetOversizeAndInvalidResult() throws {
    for text in [" \n", "a\0b", String(repeating: "x", count: 16_385)] {
      XCTAssertThrowsError(try RemoteQuickChatMessage.request(text: text, targetToken: "t", requestId: "r").encode())
    }
    XCTAssertThrowsError(try RemoteQuickChatMessage.request(text: "pwd", targetToken: "", requestId: "r").encode())
    XCTAssertThrowsError(try RemoteQuickChatMessage.decode(Data(#"{"type":"quick.chat.result","requestId":"r","ok":true,"text":"pwd"}"#.utf8)))
  }

  func testCapabilityIsOptionalForOlderHostsAndSurvivesLockOnlyUpdates() throws {
    var state = RemoteSessionCapabilities()
    state.begin(requestId: "new")
    state.receive(.state(screenLocked: false, supportsInlineSpeech: true))
    XCTAssertNil(state.quickChat)
    let reply = try RemoteSessionStateCodec.decode(RemoteSessionStateCodec.encode(.state(screenLocked: false, supportsQuickChat: true, requestId: "new")))
    state.receive(reply)
    state.receive(.state(screenLocked: true))
    XCTAssertEqual(state.quickChat, true)
    state.begin(requestId: "next")
    XCTAssertFalse(state.receive(reply))
    XCTAssertNil(state.quickChat)
  }
}
