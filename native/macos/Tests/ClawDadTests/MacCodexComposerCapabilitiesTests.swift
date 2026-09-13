import XCTest
@testable import ClawDad

final class MacCodexComposerCapabilitiesTests: XCTestCase {
  func testVisibleTabBindingIsIndependentFromOpaqueDraftReadiness() {
    let screen="• Working (2m 02s • esc to interrupt)\n\n› [Pasted Content 1628 chars]\n\n  tab to queue message                  92% context left\n"
    let observed=MacCodexComposerCapabilities(screen:screen,version:"0.154.0")
    XCTAssertTrue(observed.tabQueueAdvertised)
    XCTAssertFalse(observed.canQueue,"Visible Tab binding cannot establish hidden draft contents")
    XCTAssertEqual(observed.fields["tabBindingObserved"],.bool(true))
  }
  func screen(_ text: String = "Ask Codex to do anything", busy: Bool = false, footer: String = "gpt-6-astra max") -> String {
    (busy ? "• Working (4s • esc to interrupt)\n" : "Completed answer\n") + "› \(text)\n  \(footer)\n"
  }

  func testUpgradeDoesNotDisableObservedPasteContextOrNativeQueue() {
    for version in ["0.153.4", "0.154.0", "0.999.0", "custom-build"] {
      let value = MacCodexComposerCapabilities(screen: screen(busy: true), version: version)
      XCTAssertTrue(value.canInsert, version)
      XCTAssertTrue(value.canQueue, version)
      XCTAssertTrue(value.canClear, "An empty clear is a no-op")
      XCTAssertEqual(value.fields["identify"], .bool(true))
      XCTAssertTrue(MacCodexComposerCapabilities(screen: screen("Next", busy: true, footer: "tab to queue message     50% context left"), version: version).queue?.tabQueues == true)
    }
  }

  func testUnknownShortcutContractHasPartialCapabilitiesAndSpecificRecovery() {
    let value = MacCodexComposerCapabilities(screen: screen("Preserved draft", busy: true, footer: "tab to queue message"), version: "0.999.0")
    XCTAssertFalse(value.canInsert)
    XCTAssertFalse(value.canClear)
    XCTAssertFalse(value.canSubmit)
    XCTAssertTrue(value.canQueue)
    XCTAssertNotNil(value.observation.text)
    XCTAssertTrue(value.fields["clearReason"]?.string?.contains("manually") == true)
  }

  func testCurrentClearAdapterSupportsExpandedAndCollapsedButProtectsAttachments() {
    for version in ["0.153.4", "0.154.0"] {
      for text in ["Short", "First line\n  Second line", "[Pasted Content 5000 chars]"] {
        XCTAssertTrue(MacCodexComposerCapabilities(screen: screen(text), version: version).canClear)
      }
      for text in ["[Image #1]", "[Pasted Content unknown]", "› ambiguous"] {
        XCTAssertFalse(MacCodexComposerCapabilities(screen: screen(text), version: version).canClear)
      }
    }
  }

  func testModalsUnknownRendererAndRemappedQueueStayProtected() {
    for text in ["Password:", screen() + "Allow command?\n1. Yes", "Unknown composer"] {
      let value = MacCodexComposerCapabilities(screen: text, version: "0.154.0")
      XCTAssertFalse(value.canInsert); XCTAssertFalse(value.canClear); XCTAssertFalse(value.canQueue)
    }
    let remapped = MacCodexComposerCapabilities(screen: screen("Next", busy: true, footer: "ctrl+q to queue message"), version: "0.154.0")
    XCTAssertFalse(remapped.queue?.tabQueues == true)
  }
}
