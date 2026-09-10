import XCTest
import UIKit
@testable import ClawDad

@MainActor
final class AssistantSelectionTests: XCTestCase {
  func testLargeScrollableMessageRetainsCompleteTextAndCopiesItsFinalMultilinePassage() {
    let ending = "Final verification 🧪\nEND_EXACT"
    let source = String(repeating: "Research evidence.\n", count: 8_000) + ending
    let v = view(source)
    v.isScrollEnabled = true
    v.selectedRange = (source as NSString).range(of: ending)
    v.scrollRangeToVisible(v.selectedRange)
    v.copy(nil)
    XCTAssertEqual(UIPasteboard.general.string, ending)
    XCTAssertEqual(v.text, source)
    v.display(NSAttributedString(string: source + "\nA later update"))
    v.copy(nil)
    XCTAssertEqual(UIPasteboard.general.string, ending)
    XCTAssertFalse(v.isEditable)
  }
  private func view(_ source: String) -> AssistantMessageTextView {
    let view = AssistantMessageTextView()
    view.frame = CGRect(x: 0, y: 0, width: 320, height: 400)
    view.display(NSAttributedString(string: source))
    return view
  }
  func testCopyOnlyTheSelectedWordSentenceMultilineAndCodeRanges() {
    let source = "Cody 🦞 asked a question.\nSecond line with a useful answer.\n- First item\n- Second item\n```swift\nlet result = 2 + 2\nprint(result)\n```\nCaption beside an image."
    let v = view(source)
    for passage in ["question", "Cody 🦞 asked a question.", "question.\nSecond line", "- First item\n- Second item", "let result = 2 + 2\nprint(result)", "Caption beside an image."] {
      let range = (source as NSString).range(of: passage)
      XCTAssertNotEqual(range.location, NSNotFound)
      v.selectedRange = range
      v.copy(nil)
      XCTAssertEqual(UIPasteboard.general.string, passage)
      XCTAssertEqual(v.text, source)
      XCTAssertFalse(v.isEditable)
      XCTAssertTrue(v.isSelectable)
    }
  }
  func testIncomingRevisionsAndFormattingDoNotChangeAnActiveSelectionOrItsClipboard() {
    let original = "First line\nA stable selected passage 🦞\nLast line"
    let v = view(original)
    let range = (original as NSString).range(of: "line\nA stable selected passage 🦞")
    v.selectedRange = range
    for update in ["Prepended newer words. " + original, "Incoming response replaces this body"] {
      v.display(NSAttributedString(string: update, attributes: [.font: UIFont.boldSystemFont(ofSize: 25)]))
      XCTAssertEqual(v.selectedRange, range)
      XCTAssertEqual(v.text, original)
      v.copy(nil)
      XCTAssertEqual(UIPasteboard.general.string, "line\nA stable selected passage 🦞")
    }
    v.selectedRange = NSRange(location: 0, length: 0)
    v.textViewDidChangeSelection(v)
    XCTAssertEqual(v.text, "Incoming response replaces this body")
  }
  func testLongMessageRangeSpansVisualLinesWithoutInnerScrollOrTextMutation() {
    let text = (1...80).map { "Line \($0): evidence and verification remain separate." }.joined(separator: "\n")
    let v = view(text)
    let start = (text as NSString).range(of: "Line 20:").location
    let end = NSMaxRange((text as NSString).range(of: "Line 26: evidence"))
    v.selectedRange = NSRange(location: start, length: end - start)
    v.copy(nil)
    XCTAssertEqual(UIPasteboard.general.string, (text as NSString).substring(with: v.selectedRange))
    XCTAssertFalse(v.isScrollEnabled)
    XCTAssertGreaterThan(v.sizeThatFits(CGSize(width: 280, height: CGFloat.greatestFiniteMagnitude)).height, 1000)
    XCTAssertFalse(v.textView(v, shouldChangeTextIn: v.selectedRange, replacementText: "edited"))
    XCTAssertEqual(v.text, text)
  }
  func testLinksKeepOriginalRangesAndSelectionHasNoCallOrComposerCallbacks() {
    let text = "Phone (415) 555-0100\n123 Main Street, San Francisco, CA 94105\nhttps://example.com/path"
    let content = AssistantMessageLinks.text(text)
    XCTAssertEqual(String(content.characters), text)
    XCTAssertEqual(content.runs.compactMap(\.link).count, 3)
    let v = view(text)
    var opens = 0
    v.openLink = { _ in opens += 1 }
    v.selectedRange = (text as NSString).range(of: "555-0100")
    v.copy(nil)
    XCTAssertEqual(opens, 0)
    XCTAssertEqual(UIPasteboard.general.string, "555-0100")
    XCTAssertFalse(v.textView(v, shouldInteractWith: URL(string: "tel:4155550100")!, in: v.selectedRange, interaction: .invokeDefaultAction))
    XCTAssertEqual(opens, 1)
  }
}
