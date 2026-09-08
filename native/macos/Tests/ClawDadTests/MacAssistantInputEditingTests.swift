import ApplicationServices
import XCTest
@testable import ClawDad

final class MacAssistantInputEditingTests: XCTestCase {
  func testBusyDraftReadbackAndCollapsedPasteReceiptsAreDistinct() {
    let busy = "• Working (3s • esc to interrupt)\n› Review this draft\n tab to queue message\n"
    XCTAssertEqual(assistantEditableDraft(busy, allowQueueFooter: true), "Review this draft")
    XCTAssertTrue(assistantDraftMatches(busy, expected: "Review this draft"))
    let long = String(repeating: "e\u{301} 🦞 exact text ", count: 130)
    let collapsed = "• Working (3s • esc to interrupt)\n› [Pasted Content \(long.unicodeScalars.count) chars]\n tab to queue message\n"
    XCTAssertNil(assistantEditableDraft(collapsed), "Unknown existing collapsed drafts must be preserved")
    XCTAssertFalse(assistantDraftMatches(collapsed, expected: long), "A placeholder is not full text readback")
    XCTAssertTrue(assistantCollapsedPasteMatches(collapsed, payload: long))
    XCTAssertFalse(assistantCollapsedPasteMatches(collapsed, payload: long + "x"))
    XCTAssertFalse(assistantCollapsedPasteMatches(collapsed.replacingOccurrences(of: "› ", with: "› unrelated "), payload: long))
  }
  func testDraftInspectionPreservesRenderedWhitespaceAndRejectsOpaqueInputs() {
    XCTAssertEqual(assistantEditableDraft("Answer\n\n› First  line\n  Second line\n\n  gpt-6-astra max"), "First  line\nSecond line")
    XCTAssertEqual(assistantEditableDraft("› Ask Codex to do anything\n  gpt-6-astra max"), "")
    XCTAssertEqual(assistantEditableDraft("› \n  ctrl+c again to quit\n"), "")
    for screen in ["› Old draft\n$ shell", "› [Pasted Content 2048 chars]\n gpt-6-astra",
      "[Image #1]\n› keep this\n gpt-6-astra", "› text\n  Allow this command?\n gpt-6-astra\n1. Yes",
      "› " + Array(repeating: "line", count: 10).joined(separator: "\n  ") + "\n gpt-6-astra"] {
      XCTAssertNil(assistantEditableDraft(screen), screen)
    }
  }

  @MainActor func testClearAndReplaceMultilineDraftWithoutSubmission() async throws {
    for replacement in ["", "Updated  draft\nSecond line 🦞"] {
      var draft = "Original draft\nSecond line", actions: [String] = []
      try await assistantEditVerifiedDraft(expected: draft, replacement: replacement,
        read: { draft }, clear: { actions.append("clear"); draft = ""; return true },
        insert: { text in actions.append("insert"); draft = text; return true }, wait: {})
      XCTAssertEqual(draft, replacement)
      XCTAssertEqual(actions, replacement.isEmpty ? ["clear"] : ["clear", "insert"])
    }
  }

  @MainActor func testEmptyInputNeverSendsClearShortcutAndNoOpDoesNothing() async throws {
    for replacement in ["", "New draft"] {
      var draft = ""
      try await assistantEditVerifiedDraft(expected: "", replacement: replacement, read: { draft },
        clear: { XCTFail("Ctrl-C on an empty input can quit Codex"); return false },
        insert: { draft = $0; return true }, wait: {})
      XCTAssertEqual(draft, replacement)
    }
  }

  @MainActor func testChangedDraftIncludingWhitespacePreventsAllEditing() async {
    for actual: String? in ["Unrelated draft", "My  draft", nil] {
      do {
        try await assistantEditVerifiedDraft(expected: "My draft", replacement: "Updated",
          read: { actual }, clear: { XCTFail("Preserve changed draft"); return false },
          insert: { _ in XCTFail("Preserve changed draft"); return false }, wait: {})
        XCTFail("Expected text must match exactly")
      } catch { XCTAssertTrue(error.localizedDescription.contains("preserved")) }
    }
  }

  @MainActor func testUnconfirmedClearDoesNotRepeatOrPasteOverTheDraft() async {
    var clears = 0
    do {
      try await assistantEditVerifiedDraft(expected: "Draft", replacement: "Replacement",
        read: { "Draft" }, clear: { clears += 1; return true },
        insert: { _ in XCTFail("Clear was not verified"); return false }, wait: {})
      XCTFail("Unconfirmed clear must fail")
    } catch { XCTAssertTrue(error.localizedDescription.contains("Enter was not sent")) }
    XCTAssertEqual(clears, 1)
  }

  @MainActor func testChangedTabAfterClearPreventsReplacement() async {
    var changed = false
    do {
      try await assistantEditVerifiedDraft(expected: "Draft", replacement: "Replacement", read: {
        if changed { throw MacAssistantError("Different tab") }
        return "Draft"
      }, clear: { changed = true; return true },
        insert: { _ in XCTFail("Do not paste in the other tab"); return false }, wait: {})
      XCTFail("Changed tab must fail")
    } catch { XCTAssertEqual(error.localizedDescription, "Different tab") }
  }

  @MainActor func testHumanDraftAppearingAfterClearIsPreserved() async {
    var reads = 0
    do {
      try await assistantEditVerifiedDraft(expected: "Draft", replacement: "Replacement", read: {
        reads += 1
        return reads == 1 ? "Draft" : reads == 2 ? "" : "Human draft"
      }, clear: { true }, insert: { _ in XCTFail("Preserve human input"); return false }, wait: {})
      XCTFail("Changed draft must fail")
    } catch { XCTAssertTrue(error.localizedDescription.contains("changed before replacement")) }
  }

  @MainActor func testDelayedRenderingVerifiesWithoutRepeatingReplacement() async throws {
    var reads = 0, inserts = 0, cleared = false
    try await assistantEditVerifiedDraft(expected: "Draft", replacement: "New draft", read: {
      reads += 1
      if !cleared { return "Draft" }
      return reads > 5 ? "New draft" : ""
    }, clear: { cleared = true; return true }, insert: { _ in inserts += 1; return true }, wait: {})
    XCTAssertEqual(inserts, 1)
  }

  func testOtherAppsRequireWritableNonSecureInputAndNeverUseTerminalGenericEditing() {
    func permits(bundle: String = "com.apple.TextEdit", role: String = kAXTextAreaRole as String,
      subrole: String? = nil, editable: Bool? = true, enabled: Bool? = true, focused: Bool? = true,
      settable: Bool = true, text: String? = "Draft") -> Bool {
      MacAssistantInputEditPolicy.permits(bundleIdentifier: bundle, role: role, subrole: subrole,
        editable: editable, enabled: enabled, focused: focused, valueSettable: settable, text: text)
    }
    XCTAssertTrue(permits())
    XCTAssertTrue(permits(role: kAXTextFieldRole as String, text: ""))
    XCTAssertFalse(permits(bundle: "com.apple.Terminal"))
    XCTAssertFalse(permits(subrole: kAXSecureTextFieldSubrole as String))
    XCTAssertFalse(permits(editable: false))
    XCTAssertFalse(permits(enabled: false))
    XCTAssertFalse(permits(focused: false))
    XCTAssertFalse(permits(settable: false))
    XCTAssertFalse(permits(role: kAXStaticTextRole as String, editable: nil))
    XCTAssertFalse(permits(text: nil))
    XCTAssertFalse(permits(text: String(repeating: "x", count: 17_000)))
  }

  @MainActor func testOtherInputVerificationIsExactAndWritesOnlyOnce() async throws {
    var value = "Original", writes = 0
    try await assistantReplaceVerifiedInput(expected: value, replacement: "New  text\n🦞",
      read: { value }, write: { value = $0; writes += 1; return true }, wait: {})
    XCTAssertEqual(value, "New  text\n🦞")
    XCTAssertEqual(writes, 1)
    do {
      try await assistantReplaceVerifiedInput(expected: "New text\n🦞", replacement: "",
        read: { value }, write: { _ in XCTFail("Preserve whitespace change"); return false }, wait: {})
      XCTFail("Changed text must fail")
    } catch { XCTAssertTrue(error.localizedDescription.contains("preserved")) }
  }

  @MainActor func testUnverifiedOtherInputWriteDoesNotRepeat() async {
    var writes = 0
    do {
      try await assistantReplaceVerifiedInput(expected: "Draft", replacement: "Replacement",
        read: { "Draft" }, write: { _ in writes += 1; return true }, wait: {})
      XCTFail("Unverified text must fail")
    } catch { XCTAssertTrue(error.localizedDescription.contains("Enter was not sent")) }
    XCTAssertEqual(writes, 1)
  }
}
