import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDadMobile

@MainActor
final class AssistantMessagePlaybackTests: XCTestCase {
  private func projectDraft() -> AssistantChatDraftStore {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("project-readback-\(UUID())")
    addTeardownBlock { try? FileManager.default.removeItem(at: root) }
    return AssistantChatDraftStore(root: root)
  }
  private func projectSession(_ controller: MobileAssistantController) -> CloudSession {
    let suite = "project-readback-\(UUID())", values = UserDefaults(suiteName: suite)!
    addTeardownBlock { values.removePersistentDomain(forName: suite) }
    let session = CloudSession(defaults: values) { _, _, _ in }
    controller.bind(session)
    return session
  }
  func testProjectSpeakerDuringCallSharesVoiceBoostAndPreservesMuteHeldWordsAndDraft() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil, chatDraft: projectDraft())
    let session = projectSession(controller)
    defer { controller.stop() }
    connection.connected = true; connection.onChange?()
    await controller.startVoice(); controller.setWaitForSend(true); controller.toggleMute()
    controller.chatDraft.setText("Unrelated typed draft")
    controller.toggleProjectReadAloud(session, key: "exact-project:user", text: "User message")
    try await until { audio.played.count == 1 }
    XCTAssertEqual(controller.projectReadAloudPhase(key: "exact-project:user"), .playing)
    XCTAssertTrue(controller.voiceActive); XCTAssertTrue(controller.muted); XCTAssertTrue(controller.waitForSend)
    let transcriptions = connection.transcriptions
    audio.onUtterance?(Data("Playback echo".utf8), true); audio.onSpeechStarted?()
    try await Task.sleep(nanoseconds: 30_000_000)
    XCTAssertEqual(connection.transcriptions, transcriptions)
    controller.toggleProjectReadAloud(session, key: "exact-project:user", text: "User message")
    XCTAssertEqual(controller.projectReadAloudPhase(key: "exact-project:user"), .paused)
    controller.toggleProjectReadAloud(session, key: "exact-project:agent", text: "Agent response")
    try await until { audio.played.count == 2 }
    XCTAssertEqual(controller.projectReadAloudPhase(key: "exact-project:user"), .idle)
    XCTAssertEqual(controller.projectReadAloudPhase(key: "exact-project:agent"), .playing)
    controller.stopMessagePlayback()
    XCTAssertTrue(connection.sentTexts.isEmpty); XCTAssertEqual(controller.chatDraft.value.text, "Unrelated typed draft")
    XCTAssertTrue(controller.voiceActive); XCTAssertTrue(controller.muted); XCTAssertTrue(controller.waitForSend)
    XCTAssertEqual(audio.starts, 1)
  }
  func testProjectReadbackReconnectAndSecondChunkRecoveryDoNotStartCallOrRepeatFirstChunk() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil, chatDraft: projectDraft())
    let session = projectSession(controller)
    defer { controller.stop() }
    connection.connected = false; connection.onReconnect = { connection.connected = true; connection.onChange?() }
    var fail = true
    connection.download = { data in if data == Data("two".utf8) && fail { throw AssistantProtocolError.disconnected }; return data }
    controller.toggleProjectReadAloud(session, key: "long", text: "Complete multi-paragraph reply")
    try await until { audio.played.count == 1 }; audio.completeClip()
    try await until { controller.messagePlaybackPaused }
    XCTAssertEqual(connection.connects, 1); XCTAssertEqual(audio.played, [Data("one".utf8)])
    fail = false; controller.toggleProjectReadAloud(session, key: "long", text: "Complete multi-paragraph reply")
    try await until { audio.played.count == 2 }; audio.completeClip()
    try await until { controller.playingMessageID == nil }
    XCTAssertEqual(audio.played, [Data("one".utf8), Data("two".utf8)])
    XCTAssertTrue(connection.synthesisPayloads.dropFirst().allSatisfy { $0["voiceSelection"]?.object?["voice"]?.string == "af_heart" })
    XCTAssertEqual(audio.starts, 0); XCTAssertFalse(controller.callVisible); XCTAssertTrue(connection.sentTexts.isEmpty)
  }
  func testSettingsConnectWithoutStartingAssistantOrMicrophone() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    connection.connected = false
    connection.onReconnect = { connection.connected = true; connection.onChange?() }
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil)
    defer { controller.stop() }
    _ = try await controller.settingsRequest("settings.read")
    XCTAssertEqual(connection.connects, 1)
    XCTAssertEqual(connection.commands, ["settings.read"])
    XCTAssertFalse(controller.callVisible); XCTAssertFalse(controller.voiceActive)
    XCTAssertEqual(audio.starts, 0); XCTAssertTrue(connection.sentTexts.isEmpty)
  }
  private func until(_ predicate: () -> Bool) async throws {
    for _ in 0..<300 { if predicate() { return }; try await Task.sleep(for: .milliseconds(10)) }
    XCTFail("Timed out waiting for playback state")
  }
  func testTextOnlyPlaybackSwitchStopAndLateAudioNeverStartMicrophoneOrSubmit() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil)
    defer { controller.stop() }
    var release: CheckedContinuation<Void, Never>?
    connection.beforeSynthesis = { await withCheckedContinuation { release = $0 } }
    controller.chatDraft.setText("Keep my draft")
    controller.playMessage(id: "user-one", text: "# Hello\n**Keep** the wording.")
    try await until { release != nil }
    XCTAssertEqual(controller.playingMessageID, "user-one")
    controller.stopMessagePlayback()
    connection.beforeSynthesis = nil
    release?.resume(); release = nil
    try await Task.sleep(for: .milliseconds(30))
    XCTAssertTrue(audio.played.isEmpty)
    controller.playMessage(id: "assistant-two", text: "Second message")
    try await until { audio.played.count == 1 }
    controller.playMessage(id: "user-three", text: "Third message")
    try await until { audio.played.count == 2 }
    XCTAssertEqual(controller.playingMessageID, "user-three")
    XCTAssertGreaterThanOrEqual(audio.playbackStops, 3)
    controller.playMessage(id: "user-three", text: "Third message")
    XCTAssertNil(controller.playingMessageID)
    XCTAssertFalse(controller.replyAudioActive)
    XCTAssertEqual(audio.starts, 0)
    XCTAssertFalse(controller.voiceActive)
    XCTAssertEqual(connection.sentTexts, [])
    XCTAssertEqual(controller.chatDraft.value.text, "Keep my draft")
  }
  func testMutedCallKeepsMuteAndThinkAloudWhileManualPlaybackSupersedesAutomaticSpeech() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.startVoice(); controller.setWaitForSend(true); controller.toggleMute()
    connection.addReply("Automatic response")
    try await controller.refresh(); try await until { audio.played.count == 1 }
    controller.playMessage(id: "older-message", text: "Read the older message")
    try await until { audio.played.count == 2 }
    XCTAssertTrue(controller.muted); XCTAssertTrue(audio.muted); XCTAssertTrue(controller.waitForSend)
    let count = connection.transcriptions
    audio.onUtterance?(Data("Playback echo".utf8), true)
    audio.onTranscriptPreview?(Data("Playback echo".utf8))
    audio.onSpeechStarted?()
    try await Task.sleep(for: .milliseconds(30))
    XCTAssertEqual(connection.transcriptions, count)
    controller.stopMessagePlayback()
    XCTAssertTrue(controller.voiceActive); XCTAssertTrue(controller.muted); XCTAssertTrue(controller.waitForSend)
    XCTAssertTrue(connection.sentTexts.isEmpty)
  }
  func testPendingFinalWordsFinishWithoutBeingOverwrittenByPlaybackAndResumeNormalTiming() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    connection.transcribe = { data in try? await Task.sleep(for: .milliseconds(30)); return String(decoding: data, as: UTF8.self) }
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil, automaticSendDelay: 100_000_000)
    defer { controller.stop() }
    await controller.startVoice(); audio.onSpeechStarted?(); audio.finishData = Data("Preserve final words".utf8)
    controller.playMessage(id: "history", text: "Reading earlier text")
    try await until { controller.liveTranscript == "Preserve final words" && !audio.played.isEmpty }
    try await Task.sleep(for: .milliseconds(200))
    XCTAssertTrue(connection.sentTexts.isEmpty)
    controller.stopMessagePlayback()
    try await until { connection.sentTexts.count == 1 }
    XCTAssertEqual(connection.sentTexts, ["Preserve final words"])
    XCTAssertFalse(controller.muted); XCTAssertTrue(controller.voiceActive)
  }
  func testFailedDownloadResumesSameVoiceAndOnlyRemainingPartAcrossReconnect() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil)
    defer { controller.stop() }
    var failing = true
    connection.download = { data in if data == Data("two".utf8) && failing { throw AssistantProtocolError.disconnected }; return data }
    controller.playMessage(id: "recovery", text: "First and second part")
    try await until { audio.played.count == 1 }; audio.completeClip()
    try await until { controller.messagePlaybackPaused }
    XCTAssertEqual(audio.played, [Data("one".utf8)])
    XCTAssertTrue(audio.fallbackTexts.isEmpty)
    connection.connected = false; connection.onChange?()
    controller.open()
    XCTAssertTrue(controller.messagePlaybackPaused)
    connection.connected = true; connection.onChange?(); failing = false
    controller.playMessage(id: "recovery", text: "First and second part")
    try await until { audio.played.count == 2 }; audio.completeClip()
    try await until { controller.playingMessageID == nil }
    XCTAssertEqual(audio.played, [Data("one".utf8), Data("two".utf8)])
    XCTAssertTrue(connection.synthesisPayloads.dropFirst().allSatisfy { $0["voiceSelection"]?.object?["voice"]?.string == "af_heart" })
    XCTAssertEqual(audio.starts, 0); XCTAssertTrue(connection.sentTexts.isEmpty)
  }
  func testPlaybackInterruptionResumesIdenticalClipAtSavedPositionThenPlaysNext() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil)
    defer { controller.stop() }
    controller.playMessage(id: "position", text: "First and second part")
    try await until { audio.played.count == 1 }
    audio.failClip(at: 2.25, interrupted: true)
    try await until { controller.messagePlaybackPaused }
    controller.resumeMessagePlayback()
    try await until { audio.played.count == 2 }
    XCTAssertEqual(audio.played[0], audio.played[1]); XCTAssertEqual(audio.playbackOffsets, [0, 2.25])
    audio.completeClip(); try await until { audio.played.count == 3 }; audio.completeClip()
    try await until { controller.playingMessageID == nil }
    XCTAssertEqual(audio.played.last, Data("two".utf8))
  }
  func testVoiceChangeOrCacheRewritePausesBeforePlayingDifferentAudio() async throws {
    for changeVoice in [true, false] {
      let connection = AssistantTestTransport(), audio = AssistantTestAudio()
      let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil)
      defer { controller.stop() }
      connection.synthesis = {
        let changed = connection.syntheses > 1
        var generated: [String: Any] = ["state": "ready", "parts": [["url": changed && !changeVoice ? "rewritten" : "one"], ["url": "two"]]]
        if changed && changeVoice { generated["voiceId"] = "different" }
        return ["audio": generated]
      }
      controller.playMessage(id: "identity", text: "Use the same voice")
      try await until { audio.played.count == 1 }; audio.completeClip()
      try await until { controller.messagePlaybackPaused }
      XCTAssertEqual(audio.played.count, 1); XCTAssertTrue(audio.fallbackTexts.isEmpty)
      XCTAssertEqual(connection.syntheses, 2)
    }
  }
  func testVoicePinnedAcrossLongMessageBatchesAndReplayStartsAtBeginning() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil)
    defer { controller.stop() }
    let text = String(repeating: "A long sentence. ", count: 1600)
    connection.synthesis = { ["audio": ["state": "ready", "parts": [["url": "one"]]]] }
    controller.playMessage(id: "long", text: text)
    try await until { audio.played.count == 1 }; audio.completeClip()
    try await until { audio.played.count == 2 }; audio.completeClip()
    try await until { controller.playingMessageID == nil }
    XCTAssertTrue(connection.synthesisPayloads.dropFirst().allSatisfy { $0["voiceSelection"]?.object?["voice"]?.string == "af_heart" })
    controller.playMessage(id: "long", text: text)
    try await until { audio.played.count == 3 }
    XCTAssertEqual(audio.playbackOffsets, [0, 0, 0])
  }
  func testDelayedStartupRecoversAutomaticallyAndCancellationDuringBackoffStaysStopped() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil)
    defer { controller.stop() }
    connection.synthesis = {
      connection.syntheses <= 2 ? ["audio": ["state": "failed"]]
        : ["audio": ["state": "ready", "parts": [["url": "recovered"]]]]
    }
    controller.playMessage(id: "cold-start", text: "Wait briefly for the chosen model")
    try await until { audio.played.count == 1 }
    XCTAssertEqual(connection.syntheses, 3); XCTAssertFalse(controller.messagePlaybackPaused)
    XCTAssertTrue(audio.fallbackTexts.isEmpty)
    audio.completeClip(); try await until { controller.playingMessageID == nil }
    connection.synthesis = { ["audio": ["state": "failed"]] }
    controller.playMessage(id: "cancel-recovery", text: "Cancel during recovery")
    try await until { connection.syntheses >= 5 }
    controller.stopMessagePlayback()
    try await Task.sleep(for: .milliseconds(800))
    XCTAssertNil(controller.playingMessageID); XCTAssertFalse(controller.replyAudioActive)
    XCTAssertEqual(audio.played.count, 1); XCTAssertEqual(connection.syntheses, 5)
  }
  func testLegacyCacheMetadataSurvivesMacUpgradeButWrongInitialVoiceCannotPlay() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil)
    defer { controller.stop() }
    connection.synthesis = {
      var first: [String: Any] = ["url": "one"]
      if connection.syntheses > 1 { first["textHash"] = NSNull(); first["audioHash"] = NSNull() }
      return ["audio": ["state": "ready", "engine": NSNull(), "parts": [first, ["url": "two"]]]]
    }
    controller.playMessage(id: "legacy-cache", text: "Keep playing through a Mac upgrade")
    try await until { audio.played.count == 1 }; audio.completeClip()
    try await until { audio.played.count == 2 }; audio.completeClip()
    try await until { controller.playingMessageID == nil }
    connection.synthesis = { ["audio": ["state": "ready", "voiceId": "another-voice", "parts": [["url": "wrong"]]]] }
    controller.playMessage(id: "wrong-voice", text: "Use only my chosen voice")
    try await until { controller.messagePlaybackPaused }
    XCTAssertEqual(audio.played.count, 2); XCTAssertTrue(audio.fallbackTexts.isEmpty)
  }
  func testFormattingAndLongUnicodeBatchesPreserveContent() {
    let text = "# Results\n- **Passed** 4 checks.\n[Details](https://example.com)\n```swift\nlet code = \"**literal**\"\n```"
    XCTAssertEqual(AssistantMessagePlaybackText.spoken(text), "Results\nPassed 4 checks.\nDetails (https://example.com)\nlet code = \"**literal**\"")
    let long = String(repeating: "Multiline 🦞 café\n", count: 8000)
    let parts = AssistantMessagePlaybackText.batches(long)
    XCTAssertEqual(parts.joined(), long); XCTAssertTrue(parts.allSatisfy { $0.utf8.count <= 24_000 })
  }
  func testScrollContentGrowthDoesNotChangeReadingIntentAndLatestRestoresFollowing() {
    var state = AssistantHistoryFollowing()
    state.geometry(distanceFromBottom: 500)
    XCTAssertTrue(state.following); XCTAssertFalse(state.showLatest)
    state.interaction(true); state.geometry(distanceFromBottom: 100)
    XCTAssertFalse(state.following); XCTAssertTrue(state.showLatest)
    state.interaction(false); state.geometry(distanceFromBottom: 800)
    XCTAssertFalse(state.following)
    state.latest(); XCTAssertTrue(state.following); XCTAssertFalse(state.showLatest)
    state.interaction(true); state.geometry(distanceFromBottom: 100); state.geometry(distanceFromBottom: 20)
    XCTAssertTrue(state.following); XCTAssertFalse(state.showLatest)
  }
  func testExactReplyOpeningIgnoresTransientBottomGeometryAndYieldsToReading() {
    var state = AssistantHistoryFollowing()
    state.openExactMessage(); state.geometry(distanceFromBottom: 0)
    XCTAssertFalse(state.following); XCTAssertTrue(state.openingExact)
    state.interaction(true); state.geometry(distanceFromBottom: 400)
    XCTAssertFalse(state.openingExact); XCTAssertFalse(state.following)
    state.openExactMessage(); state.cancelExactOpening() // Selecting text owns the reading position.
    XCTAssertFalse(state.openingExact); XCTAssertTrue(state.showLatest)
    state.latest(); XCTAssertTrue(state.following); XCTAssertFalse(state.showLatest)
  }
}
