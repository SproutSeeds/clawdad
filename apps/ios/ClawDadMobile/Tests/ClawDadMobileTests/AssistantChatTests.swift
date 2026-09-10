import Foundation
import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDadMobile

@MainActor
final class AssistantChatTests: XCTestCase {
  func longBrief(_ size: Int) -> String {
    let start = "  BEGIN 🧪 中文 e\u{0301}\r\n```code```\nhttps://example.org\n", end = "\nMIDDLE\nEND\t \r\n"
    return start + String(repeating: "x", count: size - start.utf8.count - end.utf8.count) + end
  }
  func testLargeDraftsAtOldAndNewBoundariesKeepExactBytesAcrossRestartAndOneAcceptedSend() async throws {
    for bytes in [16_384, 16_385, 65_536, AssistantChatLimits.textBytes] {
      let (root, store) = try fixture()
      let text = longBrief(bytes)
      let started = Date()
      store.setText(text)
      XCTAssertLessThan(Date().timeIntervalSince(started), 1, "Atomic save should not stall a paste")
      let saved = store.value
      let restored = AssistantChatDraftStore(root: root); restored.bind("")
      XCTAssertEqual(Data(restored.value.text.utf8), Data(text.utf8))
      XCTAssertEqual(restored.value.id, saved.id)
      let transport = AssistantTestTransport(), audio = AssistantTestAudio()
      transport.failAfterAcceptance = true
      let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: restored)
      await controller.sendDraft()
      XCTAssertEqual(restored.value, saved)
      await controller.sendDraft()
      XCTAssertTrue(restored.value.isEmpty)
      XCTAssertEqual(transport.sentTexts, [text])
      XCTAssertEqual(transport.messageIDs, [saved.id, saved.id])
      XCTAssertEqual(audio.starts, 0)
      controller.stop()
    }
  }
  func testOversizeAndOlderMacKeepCompleteDraftAndImageWithoutUploading() async throws {
    for (size, limit) in [(AssistantChatLimits.textBytes + 1, AssistantChatLimits.textBytes), (65_536, AssistantChatLimits.legacyTextBytes)] {
      let (root, store) = try fixture()
      store.setText(longBrief(size))
      let image = try RemoteImagePreparation.prepare(png); try store.add([image], to: "")
      let saved = store.value, transport = AssistantTestTransport()
      transport.chatTextBytes = limit
      let controller = MobileAssistantController(connection: transport, audio: AssistantTestAudio(), defaults: nil, chatDraft: store)
      await controller.sendDraft()
      XCTAssertTrue(transport.sentTexts.isEmpty)
      XCTAssertEqual(store.value, saved)
      XCTAssertTrue(controller.error.contains("UTF-8 bytes"))
      let restored = AssistantChatDraftStore(root: root); restored.bind("")
      XCTAssertEqual(restored.value, saved)
      XCTAssertEqual(try restored.bytes(image.upload, scope: ""), png)
      controller.stop()
    }
  }
  func testAcceptedThenContextFailedDraftAndImagesRemainRecoverableAfterRestart() throws {
    let (root, store) = try fixture()
    store.setText(longBrief(AssistantChatLimits.textBytes))
    let image = try RemoteImagePreparation.prepare(png); try store.add([image], to: "")
    let sent = store.value
    try store.accept(sent, scope: "")
    XCTAssertTrue(store.value.isEmpty)
    let restored = AssistantChatDraftStore(root: root); restored.bind("")
    let receipt = try JSONDecoder().decode(AssistantMessageReceipt.self, from: JSONSerialization.data(withJSONObject:
      ["id": sent.id, "status": "attention", "error": "The message exceeded model context. Its exact contents are saved."]))
    restored.reconcile([receipt]); restored.reconcile([receipt])
    XCTAssertEqual(restored.unprocessed.count, 1)
    restored.setText("Unrelated typed draft")
    restored.recoverAccepted(sent.id)
    XCTAssertEqual(restored.value.text, "Unrelated typed draft")
    restored.clear(); restored.recoverAccepted(sent.id)
    XCTAssertEqual(restored.value, sent)
    XCTAssertEqual(try restored.bytes(image.upload, scope: ""), png)
    XCTAssertTrue(restored.unprocessed.isEmpty)
    let again = AssistantChatDraftStore(root: root); again.bind("")
    XCTAssertEqual(again.value, sent)
    again.clear()
    XCTAssertThrowsError(try again.bytes(image.upload, scope: ""))
  }
  func testSuccessfulGenerationReleasesLocalRecoveryCopyWithoutChangingNewDraft() throws {
    let (_, store) = try fixture()
    store.setText(longBrief(65_536)); let image = try RemoteImagePreparation.prepare(png)
    try store.add([image], to: ""); let sent = store.value
    try store.accept(sent, scope: ""); store.setText("New draft")
    let receipt = try JSONDecoder().decode(AssistantMessageReceipt.self, from: JSONSerialization.data(withJSONObject:
      ["id": sent.id, "status": "completed"]))
    store.reconcile([receipt]); store.reconcile([receipt])
    XCTAssertEqual(store.value.text, "New draft")
    XCTAssertThrowsError(try store.bytes(image.upload, scope: ""))
  }
  let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!
  func fixture() throws -> (URL, AssistantChatDraftStore) {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("assistant-draft-\(UUID())")
    addTeardownBlock { try? FileManager.default.removeItem(at: root) }
    let store = AssistantChatDraftStore(root: root)
    store.bind("")
    return (root, store)
  }
  func testDraftAndImageBytesSurviveRecreationAndMacSwitches() throws {
    let (root, store) = try fixture()
    store.bind("account/workspace/mac-a")
    store.setText("Please inspect this screenshot.\nKeep my exact wording.")
    let image = try RemoteImagePreparation.prepare(png)
    try store.add([image], to: store.scope)
    let saved = store.value
    store.bind("account/workspace/mac-b")
    XCTAssertTrue(store.value.isEmpty)
    store.setText("Unrelated draft")
    let restored = AssistantChatDraftStore(root: root)
    restored.bind("account/workspace/mac-a")
    XCTAssertEqual(restored.value, saved)
    XCTAssertEqual(try restored.bytes(image.upload, scope: restored.scope), png)
    restored.bind("account/workspace/mac-b")
    XCTAssertEqual(restored.value.text, "Unrelated draft")
  }
  func testRemovingAndExplicitlyDeletingOnlyAffectsTheIntendedDraft() throws {
    let (root, store) = try fixture()
    let image = try RemoteImagePreparation.prepare(png)
    store.setText("Keep this text")
    try store.add([image], to: "")
    store.remove(image.upload)
    XCTAssertEqual(store.value.text, "Keep this text")
    XCTAssertTrue(store.value.images.isEmpty)
    XCTAssertThrowsError(try store.bytes(image.upload, scope: ""))
    try store.add([image], to: "")
    store.clear()
    let restored = AssistantChatDraftStore(root: root)
    restored.bind("")
    XCTAssertTrue(restored.value.isEmpty)
    XCTAssertThrowsError(try store.bytes(image.upload, scope: ""))
  }
  func testLateSendAcknowledgementPreservesNewEditsAndOtherComputer() throws {
    let (_, store) = try fixture()
    store.setText("Sent version")
    let sent = store.value
    store.setText("New unsent version")
    try store.complete(sent, scope: "")
    XCTAssertEqual(store.value.text, "New unsent version")
    let sentNew = store.value
    store.bind("other-host")
    store.setText("Other Mac")
    try store.complete(sentNew, scope: "")
    XCTAssertEqual(store.value.text, "Other Mac")
    store.bind("")
    XCTAssertTrue(store.value.isEmpty)
  }
  func testPhotoImportFinishingAfterNavigationSavesToItsOriginalMac() throws {
    let (_, store) = try fixture()
    store.setText("Original Mac")
    store.bind("other")
    store.setText("Another Mac")
    try store.add([RemoteImagePreparation.prepare(png)], to: "")
    XCTAssertEqual(store.value.text, "Another Mac")
    XCTAssertTrue(store.value.images.isEmpty)
    store.bind("")
    XCTAssertEqual(store.value.text, "Original Mac")
    XCTAssertEqual(store.value.images.count, 1)
  }
  func testFailedSendRetainsDraftAndBytesThenRetriesSameIDWithoutVoice() async throws {
    let (root, store) = try fixture()
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    var received = Data()
    var interrupted = false
    transport.uploadHandler = { body in
      let image = body["upload"]!.object!
      if body["action"]?.string == "uploadChunk" {
        XCTAssertEqual(body["offset"]?.number, Double(received.count))
        received.append(Data(base64Encoded: body["bytes"]!.string!)!)
        if !interrupted { interrupted = true; throw AssistantProtocolError.disconnected }
      }
      return try JSONSerialization.data(withJSONObject: ["uploadId": image["id"]!.string!,
        "offset": received.count, "complete": received.count == Int(image["size"]!.number!)])
    }
    // Cross the chunk boundary to verify resume, not just a metadata receipt.
    let bytes = png + Data(repeating: 0, count: RemoteImageLimits.chunkBytes + 13)
    let image = try RemoteImagePreparation.prepare(bytes)
    try store.add([image], to: "")
    store.setText("What is in this image?")
    let draft = store.value
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: store)
    await controller.sendDraft()
    XCTAssertEqual(store.value, draft)
    XCTAssertTrue(transport.sentTexts.isEmpty)
    let restored = AssistantChatDraftStore(root: root)
    restored.bind("")
    XCTAssertEqual(restored.value, draft)
    transport.failAfterAcceptance = true
    let next = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: restored)
    await next.sendDraft()
    XCTAssertEqual(restored.value, draft)
    await next.sendDraft()
    XCTAssertTrue(restored.value.isEmpty)
    XCTAssertEqual(received, bytes)
    XCTAssertEqual(transport.messageIDs, [draft.id, draft.id])
    XCTAssertEqual(transport.sentTexts, [draft.text])
    XCTAssertEqual(transport.sentImages.first?.object?["sha256"]?.string, image.upload.sha256)
    XCTAssertEqual(audio.starts, 0)
    XCTAssertFalse(next.callVisible)
    next.stop(); controller.stop()
  }
  func testMissingImageNeverSendsTextAloneOrClearsDraft() async throws {
    let (root, store) = try fixture()
    let image = try RemoteImagePreparation.prepare(png)
    try store.add([image], to: "")
    store.setText("Inspect the attached image")
    let draft = store.value
    // Simulate unavailable local storage without changing the in-memory draft.
    try FileManager.default.removeItem(at: root)
    let transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: AssistantTestAudio(), defaults: nil, chatDraft: store)
    await controller.sendDraft()
    XCTAssertEqual(store.value, draft)
    XCTAssertTrue(transport.sentTexts.isEmpty)
    XCTAssertFalse(controller.error.isEmpty)
    controller.stop()
  }
  func testImageOnlyMessagesAreSentAndThenCleared() async throws {
    let (_, store) = try fixture()
    let transport = AssistantTestTransport()
    let image = try RemoteImagePreparation.prepare(png)
    try store.add([image], to: "")
    transport.uploadHandler = { _ in
      try JSONSerialization.data(withJSONObject: ["uploadId": image.id, "offset": image.data.count, "complete": true])
    }
    let controller = MobileAssistantController(connection: transport, audio: AssistantTestAudio(), defaults: nil, chatDraft: store)
    await controller.sendDraft()
    XCTAssertEqual(transport.sentTexts, [""])
    XCTAssertEqual(transport.sentImages.count, 1)
    XCTAssertTrue(store.value.isEmpty)
    controller.stop()
  }
  func testChatSendFinishesHeldVoiceWhileMutedAndCannotSubmitItTwice() async throws {
    let (_, store) = try fixture(), audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: store)
    defer { controller.stop() }
    controller.setWaitForSend(true)
    transport.transcribe = { _ in "A complete held thought" }
    await controller.startVoice()
    audio.onUtterance?(Data([1]), true)
    for _ in 0..<200 where controller.liveTranscript.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
    controller.toggleMute()
    XCTAssertTrue(controller.muted)
    XCTAssertTrue(controller.canSendChatInput)
    XCTAssertTrue(controller.chatSendFinishesVoice)
    XCTAssertTrue(transport.sentTexts.isEmpty)
    await controller.sendDraft(); await controller.sendDraft()
    for _ in 0..<200 where transport.sentTexts.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
    XCTAssertEqual(transport.sentTexts, ["A complete held thought"])
    XCTAssertTrue(controller.voiceActive)
    XCTAssertTrue(controller.muted)
    XCTAssertFalse(controller.canSendChatInput)
    XCTAssertTrue(store.value.isEmpty)
  }
  func testChatSendKeepsTypedImageMessageSeparateFromHeldVoice() async throws {
    let (_, store) = try fixture(), audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let image = try RemoteImagePreparation.prepare(png)
    transport.uploadHandler = { _ in
      try JSONSerialization.data(withJSONObject: ["uploadId": image.id, "offset": image.data.count, "complete": true])
    }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: store)
    defer { controller.stop() }
    controller.setWaitForSend(true)
    transport.transcribe = { _ in "Held spoken words" }
    await controller.startVoice()
    audio.onUtterance?(Data([1]), true)
    for _ in 0..<200 where controller.liveTranscript.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
    controller.toggleMute()
    try store.add([image], to: "")
    XCTAssertFalse(controller.chatSendFinishesVoice, "An image-only draft takes priority over held voice")
    await controller.sendDraft()
    XCTAssertEqual(transport.sentTexts, [""])
    XCTAssertEqual(transport.sentImages.count, 1)
    XCTAssertEqual(controller.liveTranscript, "Held spoken words")
    XCTAssertTrue(controller.chatSendFinishesVoice)
    await controller.sendDraft()
    for _ in 0..<200 where transport.sentTexts.count < 2 { try await Task.sleep(for: .milliseconds(5)) }
    XCTAssertEqual(transport.sentTexts, ["", "Held spoken words"])
  }
  func testDurableReceiptConfirmsMessagesOutsideRecentHistoryAndMissingReceiptsKeepDraft() async throws {
    let (_, store) = try fixture()
    let transport = AssistantTestTransport()
    transport.omitRecentMessages = true
    transport.omitReceipt = true
    store.setText("An earlier accepted message")
    let sent = store.value
    let controller = MobileAssistantController(connection: transport, audio: AssistantTestAudio(), defaults: nil, chatDraft: store)
    await controller.sendDraft()
    XCTAssertEqual(store.value, sent)
    transport.omitReceipt = false
    await controller.sendDraft()
    XCTAssertTrue(store.value.isEmpty)
    XCTAssertEqual(transport.messageIDs, [sent.id, sent.id])
    XCTAssertEqual(transport.sentTexts, [sent.text])
    controller.stop()
  }
}
