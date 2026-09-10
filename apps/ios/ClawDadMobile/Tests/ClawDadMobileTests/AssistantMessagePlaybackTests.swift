import XCTest
@testable import ClawDadMobile

@MainActor
final class AssistantMessagePlaybackTests: XCTestCase {
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
  func testFailedPrimaryUsesOnlyRemainingFallbackAndAStoppedMessageNeverReplays() async throws {
    let connection = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: connection, audio: audio, defaults: nil)
    defer { controller.stop() }
    connection.synthesis = { ["audio": ["state": "failed"]] }
    controller.playMessage(id: "fallback", text: "**Exact** fallback text.")
    try await until { !audio.fallbackTexts.isEmpty }
    XCTAssertEqual(audio.fallbackTexts, ["Exact fallback text."])
    controller.stopMessagePlayback()
    connection.synthesis = nil
    controller.playMessage(id: "recovered", text: "Use primary again")
    try await until { !audio.played.isEmpty }
    XCTAssertEqual(controller.playingMessageID, "recovered")
    XCTAssertEqual(audio.fallbackTexts.count, 1)
    XCTAssertEqual(audio.starts, 0)
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
}
