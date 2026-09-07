import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDad

@MainActor
final class MacQuickChatDeliveryTests: XCTestCase {
  func testDelayedReceiptReplaySubmitsExactlyOnce() async {
    let delivery = MacQuickChatDelivery()
    let request = RemoteQuickChatMessage.request(text: "Continue.", targetToken: "tab-one", requestId: "send")
    var actions: [String] = []
    for _ in 0..<3 {
      let result = await delivery.deliver(request, insertIfCurrent: { actions.append("insert"); return true },
        submitIfCurrent: { actions.append("enter"); return true })
      XCTAssertEqual(result.ok, true)
    }
    XCTAssertEqual(actions, ["insert", "enter"])
    let conflict = await delivery.deliver(.request(text: "Other", targetToken: "tab-two", requestId: "send"),
      insertIfCurrent: { XCTFail(); return true }, submitIfCurrent: { XCTFail(); return true })
    XCTAssertEqual(conflict.ok, false)
  }

  func testMissingOrChangedTargetNeverSendsEnter() async {
    let result = await MacQuickChatDelivery().deliver(.request(text: "pwd", targetToken: "missing", requestId: "1"),
      insertIfCurrent: { false }, submitIfCurrent: { XCTFail("Cannot submit into a different input"); return true })
    XCTAssertEqual(result.ok, false)
  }

  func testFocusChangeAfterPasteDoesNotSubmitAndRetryCannotDuplicateText() async {
    let delivery = MacQuickChatDelivery()
    let request = RemoteQuickChatMessage.request(text: "ls", targetToken: "original", requestId: "2")
    var inserts = 0
    let response = await delivery.deliver(request, insertIfCurrent: { inserts += 1; return true }, submitIfCurrent: { false })
    XCTAssertEqual(response.ok, false)
    let replay = await delivery.deliver(request, insertIfCurrent: { inserts += 1; return true },
      submitIfCurrent: { XCTFail("An uncertain delivery must never resubmit"); return true })
    XCTAssertEqual(replay, response)
    XCTAssertEqual(inserts, 1)
  }

  func testDisconnectDuringInsertionPreventsEnter() async {
    let delivery = MacQuickChatDelivery()
    let task = Task { @MainActor in
      await delivery.deliver(.request(text: "Continue", targetToken: "input", requestId: "3"), insertIfCurrent: {
        try? await Task.sleep(for: .milliseconds(100))
        return true
      }, submitIfCurrent: { XCTFail("A disconnected session must not press Enter"); return true })
    }
    try? await Task.sleep(for: .milliseconds(20))
    task.cancel()
    let response = await task.value
    XCTAssertEqual(response.ok, false)
  }
}
