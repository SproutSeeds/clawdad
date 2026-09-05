import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDad

@MainActor
final class MacDictationDeliveryTests: XCTestCase {
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
