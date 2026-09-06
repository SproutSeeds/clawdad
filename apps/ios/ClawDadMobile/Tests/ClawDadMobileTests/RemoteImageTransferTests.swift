import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDadMobile

@MainActor
final class RemoteImageTransferTests: XCTestCase {
  private let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!

  private func waitFor(_ condition: () -> Bool) async throws {
    let end = Date().addingTimeInterval(3)
    while !condition(), Date() < end { try await Task.sleep(nanoseconds: 10_000_000) }
    XCTAssertTrue(condition())
  }

  func testLostReceiptRetriesTheSameDeliveryAndReconnectUsesClipboardUntilExplicitPaste() async throws {
    let domain = "RemoteImageTransferTests.\(UUID())"
    defer { UserDefaults.standard.removePersistentDomain(forName: domain) }
    let session = CloudSession(defaults: UserDefaults(suiteName: domain)!) { _, _, _ in }
    session.hostId = "mac-one"
    var uploads = 0
    var sent: [RemoteImageAttachmentMessage] = []
    let transfer = RemoteImageTransfer(upload: { _, progress in uploads += 1; progress(1) })
    defer { transfer.discard() }
    transfer.bind(to: session, canAttach: { true }, send: { data in
      sent.append(try! RemoteImageAttachmentMessage.decode(data)); return true
    })
    let token = UUID().uuidString
    transfer.prepare([(png, nil), (png, nil)], targetToken: token, clipboardChangeCount: 4)
    try await waitFor { sent.count == 1 }
    let original = sent[0]
    XCTAssertEqual(original.targetToken, token)
    transfer.pause(); transfer.retry()
    try await waitFor { sent.count == 2 }
    XCTAssertEqual(sent[1], original)
    XCTAssertEqual(uploads, 1)
    transfer.disconnected(); transfer.retry()
    try await waitFor { sent.count == 3 }
    XCTAssertNotEqual(sent[2].requestId, original.requestId)
    XCTAssertNil(sent[2].targetToken)
    XCTAssertEqual(sent[2].copyOnly, true)
    transfer.receive(try sent[2].result(disposition: "copied", pastedCount: 0).encode())
    XCTAssertTrue(transfer.needsPaste)
    let freshToken = UUID().uuidString
    transfer.pasteSaved(targetToken: freshToken)
    try await waitFor { sent.count == 4 }
    XCTAssertEqual(sent[3].targetToken, freshToken)
    XCTAssertEqual(sent[3].copyOnly, false)
    transfer.receive(try sent[3].result(disposition: "pasteRequested", pastedCount: 2).encode())
    XCTAssertFalse(transfer.needsPaste)
    XCTAssertTrue(transfer.error.isEmpty)
  }

  func testInterruptedBatchOnlyOffersUnpastedImagesAndDoesNotCrossComputers() async throws {
    let domain = "RemoteImageTransferTests.\(UUID())"
    defer { UserDefaults.standard.removePersistentDomain(forName: domain) }
    let session = CloudSession(defaults: UserDefaults(suiteName: domain)!) { _, _, _ in }
    session.hostId = "mac-one"
    var sent: [RemoteImageAttachmentMessage] = []
    let transfer = RemoteImageTransfer(upload: { _, progress in progress(1) })
    defer { transfer.discard() }
    transfer.bind(to: session, canAttach: { true }, send: { data in sent.append(try! RemoteImageAttachmentMessage.decode(data)); return true })
    transfer.prepare([(png, nil), (png, nil)], targetToken: UUID().uuidString, clipboardChangeCount: 0)
    try await waitFor { sent.count == 1 }
    let original = sent[0]
    transfer.receive(try original.result(disposition: "copied", pastedCount: 1).encode())
    XCTAssertEqual(transfer.images.map(\.id), Array(original.uploadIds.dropFirst()))
    transfer.pasteSaved(targetToken: UUID().uuidString)
    try await waitFor { sent.count == 2 }
    XCTAssertEqual(sent[1].uploadIds, Array(original.uploadIds.dropFirst()))
    transfer.pause()
    session.hostId = "mac-two"
    transfer.retry()
    XCTAssertFalse(transfer.error.isEmpty)
    XCTAssertEqual(sent.count, 2)
  }

  func testImmediateResumeDoesNotLetCancelledUploadClearTheNewTransfer() async throws {
    let domain = "RemoteImageTransferTests.\(UUID())"
    defer { UserDefaults.standard.removePersistentDomain(forName: domain) }
    let session = CloudSession(defaults: UserDefaults(suiteName: domain)!) { _, _, _ in }
    session.hostId = "mac-one"
    var starts = 0
    var sent = 0
    let transfer = RemoteImageTransfer(upload: { _, progress in
      starts += 1
      try await Task.sleep(nanoseconds: 100_000_000)
      progress(1)
    })
    defer { transfer.discard() }
    transfer.bind(to: session, canAttach: { true }, send: { _ in sent += 1; return true })
    transfer.prepare([(png, nil)], targetToken: nil, clipboardChangeCount: 0)
    try await waitFor { starts == 1 }
    transfer.pause(); transfer.retry()
    try await waitFor { starts == 2 }
    XCTAssertTrue(transfer.busy)
    try await waitFor { sent == 1 }
    XCTAssertEqual(transfer.progress, 1)
  }
}
