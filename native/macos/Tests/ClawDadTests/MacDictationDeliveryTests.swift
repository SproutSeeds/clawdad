import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDad

@MainActor
final class MacDictationDeliveryTests: XCTestCase {
  func testUnreadableCopyCannotTriggerTerminalSpeechOrReuseOldClipboardText() {
    let request = RemoteSpeechContextMessage.request(.selection, requestId: "read")
    XCTAssertEqual(MacInputController.copiedSpeechSelection(request, clipboardChanged: false, text: "Previous clipboard").ok, false)
    XCTAssertEqual(MacInputController.copiedSpeechSelection(request, clipboardChanged: true, text: nil).ok, false)
    XCTAssertEqual(MacInputController.copiedSpeechSelection(request, clipboardChanged: true, text: "").ok, false)
    XCTAssertEqual(MacInputController.copiedSpeechSelection(request, clipboardChanged: true, text: "Selected text").text, "Selected text")
  }

  func testMissingCaptureNeverUsesTheFieldThatHappenedToGainFocusLater() {
    let delivery = MacDictationDelivery()
    let request = RemoteClipboardMessage.dictationRequest(text: "For my clipboard", requestId: "capture-failed", copyOnly: true)
    var copies = 0
    for _ in 0..<2 {
      let result = delivery.deliver(request, copy: { _ in copies += 1; return true },
        insert: { _ in XCTFail("A missing capture must never use the current field"); return true })
      XCTAssertEqual(result.disposition, .copied)
    }
    XCTAssertEqual(copies, 1)
    let changedTarget = RemoteClipboardMessage.dictationRequest(text: request.text!, requestId: request.requestId, targetToken: "different-field")
    XCTAssertEqual(delivery.deliver(changedTarget, copy: { _ in XCTFail(); return true }, insert: { _ in XCTFail(); return true }).ok, false)
  }

  func testNoFocusedInputCopiesWithoutInsertingAndRetainsFullText() {
    let delivery = MacDictationDelivery()
    var clipboard = "previous"
    let text = "A thought for later.\nCafé 🎙️"
    let result = delivery.deliver(.dictationRequest(text: text, requestId: "1"), copy: {
      clipboard = $0
      return true
    }, insert: { _ in false })
    XCTAssertEqual(clipboard, text)
    XCTAssertEqual(result.disposition, .copied)
    XCTAssertEqual(result.ok, true)
  }

  func testEditableFocusInsertsAfterSavingClipboardAndDuplicateDoesNotReplay() {
    let delivery = MacDictationDelivery()
    var actions: [String] = []
    let request = RemoteClipboardMessage.dictationRequest(text: "Continue this prompt", requestId: "2")
    for _ in 0..<2 {
      let result = delivery.deliver(request, copy: { _ in actions.append("copy"); return true },
                                    insert: { _ in actions.append("insert"); return true })
      XCTAssertEqual(result.disposition, .inserted)
    }
    XCTAssertEqual(actions, ["copy", "insert"])
    let conflict = delivery.deliver(.dictationRequest(text: "different", requestId: "2"),
                                    copy: { _ in XCTFail("Must not mutate clipboard"); return true },
                                    insert: { _ in XCTFail("Must not insert"); return true })
    XCTAssertEqual(conflict.ok, false)
  }

  func testClipboardFailureNeverAttemptsInputAndCanBeRetried() {
    let delivery = MacDictationDelivery()
    let request = RemoteClipboardMessage.dictationRequest(text: "Keep this", requestId: "3")
    XCTAssertEqual(delivery.deliver(request, copy: { _ in false },
                                   insert: { _ in XCTFail("Must first save clipboard"); return true }).ok, false)
    XCTAssertEqual(delivery.deliver(request, copy: { _ in true }, insert: { _ in false }).disposition, .copied)
  }

  func testUncertainReadOnlyDisabledAndUnfocusedElementsFallBackToClipboard() {
    func accepts(_ role: String = "AXTextArea", editable: Bool? = nil,
                 enabled: Bool? = nil, focused: Bool? = nil, subrole: String? = nil) -> Bool {
      MacEditableTargetPolicy.acceptsDictation(role: role, subrole: subrole,
        explicitlyEditable: editable, selectedTextSettable: false, enabled: enabled, focused: focused)
    }
    XCTAssertFalse(accepts("AXWebArea"))
    XCTAssertFalse(accepts("AXButton"))
    XCTAssertFalse(accepts(editable: false))
    XCTAssertFalse(accepts(enabled: false))
    XCTAssertFalse(accepts(focused: false))
    XCTAssertFalse(accepts(subrole: "AXSecureTextField"))
    XCTAssertTrue(accepts("AXTextField", enabled: true, focused: true))
    XCTAssertTrue(accepts("AXGroup", editable: true))
    XCTAssertTrue(accepts()) // Terminal advertises a focused text area.
    XCTAssertTrue(MacEditableTargetPolicy.acceptsDictation(
      role: "AXTextArea", subrole: nil, explicitlyEditable: false,
      selectedTextSettable: false, enabled: true, focused: true,
      bundleIdentifier: "com.apple.Terminal"
    ))
    XCTAssertFalse(MacEditableTargetPolicy.acceptsDictation(
      role: "AXTextArea", subrole: nil, explicitlyEditable: false,
      selectedTextSettable: false, enabled: true, focused: true,
      bundleIdentifier: "com.apple.TextEdit"
    ))
  }
}
