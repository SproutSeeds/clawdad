import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDadMobile

@MainActor
final class AssistantDurabilityTests: XCTestCase {
  let conversation = "11111111-1111-4111-8111-111111111111"
  let request = "22222222-2222-4222-8222-222222222222"
  var replyID: String { "assistant:\(request):final" }
  func target() throws -> AssistantReplyNotification {
    try XCTUnwrap(AssistantReplyNotification.parse(["clawdad": ["version": 1, "kind": "assistant_reply",
      "eventId": String(repeating: "a", count: 64), "conversationId": conversation, "requestId": request,
      "replyId": replyID, "completedAt": "2026-09-11T20:52:00.000Z",
      "accountId": "account", "workspaceId": "workspace", "hostId": "mac"]]))
  }
  func defaults() -> UserDefaults {
    let name = "AssistantDurability.\(UUID())", defaults = UserDefaults(suiteName: name)!
    addTeardownBlock { defaults.removePersistentDomain(forName: name) }
    return defaults
  }
  func store() -> (URL, AssistantChatDraftStore) {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("assistant-durable-\(UUID())")
    addTeardownBlock { try? FileManager.default.removeItem(at: root) }
    let store = AssistantChatDraftStore(root: root); store.bind("")
    return (root, store)
  }
  func reply(text: String = "Exact saved reply Ω\nSecond line.", id: String? = nil) throws -> Data {
    try JSONSerialization.data(withJSONObject: ["assistantReply": ["conversationId": conversation, "requestId": request,
      "message": ["id": id ?? replyID, "role": "assistant", "text": text, "createdAt": "2026-09-11T20:52:00Z"],
      "userMessage": ["id": request, "role": "user", "text": "Original question", "createdAt": "2026-09-11T20:49:00Z"]]])
  }
  func bind(_ controller: MobileAssistantController, _ transport: AssistantTestTransport) -> CloudSession {
    let values = defaults()
    PairedComputerRegistry.save([PairedComputerProfile(displayName: "Studio", platform: "macos", cloudUrl: "https://relay.example",
      accountId: "account", workspaceId: "workspace", hostId: "mac", hostPublicKeyPem: "", pairedAt: "2026-09-11T00:00:00Z")], to: values)
    let session = CloudSession(defaults: values) { _, _, _ in }
    controller.bind(session); transport.connected = true; transport.onChange?()
    return session
  }
  func until(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
    for _ in 0..<300 {
      if condition() { return }
      try? await Task.sleep(for: .milliseconds(10))
    }
    XCTAssertTrue(condition(), file: file, line: line)
  }

  func testNotificationIdentityColdLaunchPersistenceAndRepeatCallbacks() throws {
    let values = defaults(), target = try target()
    let first = AssistantReplyNavigation(defaults: values)
    first.receive(target)
    let cold = AssistantReplyNavigation(defaults: values)
    XCTAssertEqual(cold.pending, target)
    XCTAssertTrue(cold.beginPlayback(target)); XCTAssertFalse(cold.beginPlayback(target))
    let relaunched = AssistantReplyNavigation(defaults: values)
    XCTAssertFalse(relaunched.beginPlayback(target), "A repeated OS callback cannot replay the same reply")
    relaunched.finishOpening(target); XCTAssertNil(AssistantReplyNavigation(defaults: values).pending)
    var invalid = try JSONSerialization.jsonObject(with: JSONEncoder().encode(target)) as! [String: Any]
    invalid["replyId"] = "assistant:wrong:final"
    XCTAssertNil(AssistantReplyNotification.parse(["clawdad": invalid]))
    XCTAssertNil(CompletedTurnNotification.parse(["clawdad": try JSONSerialization.jsonObject(with: JSONEncoder().encode(target))]))
  }
  func testForegroundSilenceOnlyWhenViewingThisConversationAtLatest() throws {
    let nav = AssistantReplyNavigation(defaults: nil), target = try target()
    nav.visibleScope = target.scope; nav.visibleConversationId = target.conversationId; nav.viewingLatest = true
    XCTAssertTrue(nav.suppressInterruption(target))
    nav.viewingLatest = false; XCTAssertFalse(nav.suppressInterruption(target))
    nav.viewingLatest = true; nav.foreground = false; XCTAssertFalse(nav.suppressInterruption(target))
    nav.foreground = true; nav.visibleScope = "another/account/mac"; XCTAssertFalse(nav.suppressInterruption(target))
  }
  func testExactOldReplyOpensAndPlaysWithoutCallOrMicAndSurvivesHistoryRefresh() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio(), nav = AssistantReplyNavigation(defaults: nil)
    let (_, draft) = store()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: draft, replyNavigation: nav)
    let session = bind(controller, transport); _ = session
    defer { controller.stop() }
    transport.replyHandler = { [self] body in
      XCTAssertEqual(body["messageRequestId"]?.string, request); XCTAssertEqual(body["replyId"]?.string, replyID)
      return try reply()
    }
    draft.setText("Unrelated typed draft")
    controller.openReplyNotification(try target())
    await until { audio.played.count == 1 }
    XCTAssertEqual(controller.notificationScrollTarget, replyID)
    XCTAssertEqual(controller.snapshot?.messages.last?.text, "Exact saved reply Ω\nSecond line.")
    XCTAssertEqual(audio.starts, 0); XCTAssertFalse(controller.voiceActive); XCTAssertFalse(controller.callVisible)
    XCTAssertFalse(transport.commands.contains("start")); XCTAssertFalse(transport.commands.contains("message"))
    XCTAssertEqual(draft.value.text, "Unrelated typed draft")
    try await controller.refresh()
    XCTAssertTrue(controller.snapshot?.messages.contains(where: { $0.id == replyID }) == true)
    controller.openReplyNotification(try target())
    await until { nav.pending == nil }
    XCTAssertEqual(audio.played.count, 1); XCTAssertEqual(controller.playingMessageID, replyID)
    audio.playbackPosition = 2.3; controller.pauseMessagePlayback()
    XCTAssertTrue(controller.messagePlaybackPaused)
    controller.resumeMessagePlayback(); await until { audio.played.count == 2 }
    XCTAssertEqual(audio.playbackOffsets.last, 2.3); XCTAssertEqual(audio.starts, 0)
    controller.stopMessagePlayback(); XCTAssertNil(controller.playingMessageID)
  }
  func testBackgroundWhileReplyLoadsKeepsTargetUntilForegroundAndReconnect() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio(), nav = AssistantReplyNavigation(defaults: nil)
    let (_, draft) = store()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: draft, replyNavigation: nav)
    let session = bind(controller, transport); _ = session
    defer { controller.stop() }
    var response: CheckedContinuation<Data, Never>?
    transport.replyHandler = { _ in await withCheckedContinuation { response = $0 } }
    controller.openReplyNotification(try target()); await until { response != nil }
    controller.applicationForegroundChanged(false); response?.resume(returning: try reply())
    await until { controller.notificationScrollTarget != nil }
    XCTAssertTrue(audio.played.isEmpty); XCTAssertNotNil(nav.pending)
    transport.connected = false; transport.onReconnect = { transport.connected = true; transport.onChange?() }
    transport.replyHandler = { [self] _ in try reply() }
    controller.applicationForegroundChanged(true)
    await until { audio.played.count == 1 }
    XCTAssertNil(nav.pending); XCTAssertEqual(audio.starts, 0); XCTAssertTrue(transport.sentTexts.isEmpty)
  }
  func testWrongReplyRemainsPendingWithoutPlaybackOrMicrophone() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio(), nav = AssistantReplyNavigation(defaults: nil)
    let (_, draft) = store()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: draft, replyNavigation: nav)
    let session = bind(controller, transport); _ = session
    defer { controller.stop() }
    transport.replyHandler = { [self] _ in try reply(id: "assistant:wrong:final") }
    controller.openReplyNotification(try target())
    await until { controller.notificationNotice.contains("original Mac") }
    XCTAssertNotNil(nav.pending); XCTAssertTrue(audio.played.isEmpty); XCTAssertEqual(audio.starts, 0)
    controller.cancelReplyNotification(); XCTAssertNil(nav.pending)
  }
  func testHangUpPreservesVisibleVoiceCheckpointAndRejectsLateTranscription() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let (root, draft) = store()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: draft)
    defer { controller.stop() }
    transport.transcribe = { String(decoding: $0, as: UTF8.self) }
    controller.setWaitForSend(true); await controller.startVoice()
    audio.onSpeechStarted?(); audio.onTranscriptPreview?(Data("Keep these visible words".utf8))
    await until { controller.liveTranscript == "Keep these visible words" }
    let restoredBeforeHangup = AssistantChatDraftStore(root: root); restoredBeforeHangup.bind("")
    XCTAssertEqual(restoredBeforeHangup.value.recoveredVoice?.first?.text, "Keep these visible words")
    var final: CheckedContinuation<String, Never>?
    transport.transcribe = { _ in await withCheckedContinuation { final = $0 } }
    audio.onUtterance?(Data([1]), true); await until { final != nil }
    controller.endVoice(); final?.resume(returning: "Late transcription must not send")
    try await Task.sleep(for: .milliseconds(50))
    XCTAssertFalse(controller.voiceActive); XCTAssertEqual(draft.value.recoveredVoice?.first?.text, "Keep these visible words")
    XCTAssertTrue(transport.sentTexts.isEmpty); XCTAssertFalse(transport.commands.contains("cancel"))
    let recovered = AssistantChatDraftStore(root: root); recovered.bind("")
    let id = try XCTUnwrap(recovered.value.recoveredVoice?.first?.id)
    recovered.discardRecoveredVoice(id)
    let cleared = AssistantChatDraftStore(root: root); cleared.bind("")
    XCTAssertTrue(cleared.value.recoveredVoice?.isEmpty == true)
  }
  func testAcceptanceAfterHangupClearsOnlyTheMatchingSavedMessageAndNeverCancelsMacWork() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let (root, draft) = store()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: draft)
    defer { controller.stop() }
    var release: CheckedContinuation<Void, Never>?
    transport.beforeMessage = { await withCheckedContinuation { release = $0 } }
    transport.receiptStatus = "queued"
    draft.setText("Keep working after hang-up"); let original = draft.value
    let sending = Task { await controller.sendDraft() }
    await until { release != nil }
    let relaunched = AssistantChatDraftStore(root: root); relaunched.bind("")
    XCTAssertEqual(relaunched.value, original); XCTAssertEqual(relaunched.unprocessed.first?.id, original.id)
    controller.endVoice(); controller.applicationForegroundChanged(false)
    draft.setText("New unrelated draft")
    release?.resume(); await sending.value
    XCTAssertEqual(transport.sentTexts, [original.text]); XCTAssertEqual(draft.value.text, "New unrelated draft")
    XCTAssertTrue(draft.unprocessed.isEmpty); XCTAssertFalse(transport.commands.contains("cancel"))
    XCTAssertEqual(audio.starts, 0)
  }
  func testPendingImageUploadFailureKeepsExactBytesAndRequestAcrossRestart() async throws {
    let (root, draft) = store(), transport = AssistantTestTransport()
    let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!
    let image = try RemoteImagePreparation.prepare(png); try draft.add([image], to: "")
    let original = draft.value
    transport.uploadHandler = { _ in throw AssistantProtocolError.disconnected }
    let controller = MobileAssistantController(connection: transport, audio: AssistantTestAudio(), defaults: nil, chatDraft: draft)
    await controller.sendDraft(); controller.stop()
    let restored = AssistantChatDraftStore(root: root); restored.bind("")
    XCTAssertEqual(restored.value, original); XCTAssertEqual(restored.unprocessed.first?.draft, original)
    XCTAssertEqual(try restored.bytes(image.upload, scope: ""), png)
    XCTAssertTrue(transport.messageIDs.isEmpty, "Uploading an image is not acceptance of a conversation turn")
  }
}
