import XCTest
import AppKit
import ClawDadRemoteAssistProtocol
@testable import ClawDad

final class MacImageAttachmentTests: XCTestCase {
  func testRetryReturnsTheOriginalPasteReceiptAndRejectsPayloadChanges() {
    var receipts = MacImageDeliveryReceipts()
    let request = RemoteImageAttachmentMessage.request(uploadIds: [UUID().uuidString.lowercased()], targetToken: UUID().uuidString)
    let response = request.result(disposition: "pasteRequested")
    XCTAssertNil(receipts.response(for: request))
    receipts.remember(request, response: response)
    XCTAssertEqual(receipts.response(for: request), response)
    let changed = RemoteImageAttachmentMessage.request(uploadIds: [UUID().uuidString.lowercased()], targetToken: nil, requestId: request.requestId)
    XCTAssertNotNil(receipts.response(for: changed)?.error)
  }
  func testTerminalPathsAreQuotedWithoutAnEnterOrShellExpansion() {
    let prepared = MacPreparedImages(urls: [URL(fileURLWithPath: "/tmp/a b.png"), URL(fileURLWithPath: "/tmp/a'$(echo nope).jpg")], firstImage: Data())
    XCTAssertEqual(prepared.terminalText, "'/tmp/a b.png' '/tmp/a'\\''$(echo nope).jpg' ")
    XCTAssertFalse(prepared.terminalText.contains("\n"))
    let clipboard = NSPasteboard.withUniqueName()
    defer { clipboard.releaseGlobally() }
    XCTAssertTrue(prepared.copy(to: clipboard, from: 0, single: true))
    XCTAssertEqual(clipboard.string(forType: .string), "'/tmp/a b.png' ")
    XCTAssertEqual(clipboard.pasteboardItems?.count, 1)
    XCTAssertTrue(prepared.copy(to: clipboard, from: 1))
    XCTAssertEqual(clipboard.string(forType: .string), "'/tmp/a'\\''$(echo nope).jpg' ")
    XCTAssertEqual(clipboard.pasteboardItems?.count, 1)
  }
}
