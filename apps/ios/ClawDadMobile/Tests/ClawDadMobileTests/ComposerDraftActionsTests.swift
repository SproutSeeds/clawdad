import XCTest
@testable import ClawDadMobile

final class ComposerDraftActionsTests: XCTestCase {
  func testCutCopiesExactDraftBeforeClearing() {
    var draft = "  Keep every character.\n"
    var clipboardText = ""

    let cut = performComposerDraftCut(&draft) { text in
      clipboardText = text
      return true
    }

    XCTAssertTrue(cut)
    XCTAssertEqual(clipboardText, "  Keep every character.\n")
    XCTAssertEqual(draft, "")
  }

  func testCutPreservesDraftWhenClipboardWriteFails() {
    var draft = "Do not lose this draft"

    let cut = performComposerDraftCut(&draft) { _ in false }

    XCTAssertFalse(cut)
    XCTAssertEqual(draft, "Do not lose this draft")
  }

  func testCutIgnoresWhitespaceOnlyDraft() {
    var draft = "  \n"
    var clipboardCalled = false

    let cut = performComposerDraftCut(&draft) { _ in
      clipboardCalled = true
      return true
    }

    XCTAssertFalse(cut)
    XCTAssertFalse(clipboardCalled)
    XCTAssertEqual(draft, "  \n")
  }
}
