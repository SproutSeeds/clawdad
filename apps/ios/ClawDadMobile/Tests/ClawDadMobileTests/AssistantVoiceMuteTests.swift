import Foundation
import XCTest
@testable import ClawDadMobile

@MainActor
final class AssistantVoiceMuteTests: XCTestCase {
  func testDefaultAutomaticallySubmitsTwoSecondsAfterNewWordsRegisterWhileMuted() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    var registeredAt: TimeInterval = 0
    transport.transcribe = { _ in
      registeredAt = ProcessInfo.processInfo.systemUptime
      return "Send these words after two seconds"
    }
    await controller.startVoice()
    audio.lastSpeechAt = ProcessInfo.processInfo.systemUptime - 10
    audio.finishData = Data([1])
    audio.onSpeechStarted?()
    controller.toggleMute()
    await until { !controller.liveTranscript.isEmpty }
    try await Task.sleep(for: .milliseconds(1700))
    XCTAssertTrue(transport.sentTexts.isEmpty, "Use registration time, not the older audio timestamp")
    await until { transport.sentTexts.count == 1 && !transport.timings.isEmpty }
    let elapsed = ProcessInfo.processInfo.systemUptime - registeredAt
    XCTAssertGreaterThanOrEqual(elapsed, 2)
    XCTAssertLessThan(elapsed, 2.5)
    XCTAssertEqual(transport.sentTexts, ["Send these words after two seconds"])
    XCTAssertTrue(controller.muted)
    XCTAssertTrue(controller.voiceActive)
    let timing = try XCTUnwrap(transport.timings.last?["lastNewTranscriptToSubmitMs"]?.number)
    XCTAssertGreaterThanOrEqual(timing, 2000)
    XCTAssertLessThan(timing, 2500)
    print("MUTE_TIMING lastNewTranscriptToSubmitMs=\(timing)")
  }

  func testRetiredEnabledPreferencesCannotStartARecognizerOrMuteCalls() async {
    let name = "retired-voice-\(UUID())"
    let defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    for key in ["assistant.voiceCommands", "assistant.voiceReactivation", "assistant.alternateVoiceCommands"] { defaults.set(true, forKey: key) }
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: defaults)
    defer { controller.stop() }
    XCTAssertEqual(audio.starts, 0)
    await controller.startVoice()
    controller.applicationForegroundChanged(false)
    controller.applicationForegroundChanged(true)
    XCTAssertTrue(controller.voiceActive)
    XCTAssertFalse(controller.muted)
    XCTAssertEqual(audio.muteCalls, 0)
    XCTAssertTrue(controller.microphoneNotice.isEmpty)
    XCTAssertTrue(defaults.bool(forKey: "assistant.voiceCommands"), "No live preference mutation is needed: retired flags are ignored")
  }

  func testRepeatedManualCyclesStayConnectedAndConfirmAfterCaptureStateChanges() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    var confirmed: [AssistantCaptureMode] = []
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil,
      confirmMicrophoneChange: { confirmed.append(audio.captureMode) })
    defer { controller.stop() }
    await controller.startVoice()
    for _ in 0..<20 {
      controller.toggleMute()
      XCTAssertEqual(audio.captureMode, .off)
      controller.applicationForegroundChanged(false)
      controller.applicationForegroundChanged(true)
      transport.connected = false; transport.onChange?()
      transport.connected = true; transport.onChange?()
      XCTAssertTrue(controller.muted)
      await controller.unmuteMicrophone()
      XCTAssertFalse(controller.muted)
    }
    XCTAssertEqual(confirmed, Array(repeating: [AssistantCaptureMode.off, .conversation], count: 20).flatMap { $0 })
    XCTAssertEqual(transport.closes, 0)
    XCTAssertTrue(transport.sentTexts.isEmpty)
  }

  func testFullOffWinsOverInFlightUnmuteAndFailuresNeedManualRetry() async {
    let audio = AssistantTestAudio()
    let actual = MobileAssistantController(connection: AssistantTestTransport(), audio: audio, defaults: nil)
    defer { actual.stop() }
    await actual.startVoice(); actual.toggleMute()
    var waiting: CheckedContinuation<Void, Never>?
    audio.beforeUnmute = { await withCheckedContinuation { waiting = $0 } }
    let attempt = Task { await actual.unmuteMicrophone() }
    await until { waiting != nil }
    actual.muteMicrophone(); waiting?.resume(); await attempt.value
    XCTAssertTrue(actual.muted)
    XCTAssertEqual(audio.captureMode, .off)
    audio.beforeUnmute = nil; audio.unmuteError = true
    await actual.unmuteMicrophone()
    XCTAssertTrue(actual.muted); XCTAssertFalse(actual.microphoneNotice.isEmpty)
    audio.unmuteError = false; await actual.unmuteMicrophone()
    XCTAssertFalse(actual.muted); XCTAssertTrue(actual.microphoneNotice.isEmpty)
  }

  func testLiveWordsRemainVisibleDuringDelayedFinalizationAndSubmitOnce() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 30_000_000)
    defer { controller.stop() }
    var final: CheckedContinuation<String, Never>?
    transport.transcribe = { data in
      if data == Data([1]) { return "Already visible words" }
      return await withCheckedContinuation { final = $0 }
    }
    await controller.startVoice()
    audio.onTranscriptPreview?(Data([1]))
    await until { controller.liveTranscript == "Already visible words" }
    audio.onUtterance?(Data([2]), true)
    await until { final != nil }
    XCTAssertEqual(controller.liveTranscript, "Already visible words")
    controller.sendVoiceNow(); controller.sendVoiceNow()
    XCTAssertEqual(controller.liveTranscript, "Already visible words")
    final?.resume(returning: "Already visible words and the final words")
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Already visible words and the final words"])
    XCTAssertTrue(controller.voiceActive)
  }

  func testUnexpectedCaptureFailureKeepsVisibleWordsForReviewWithoutTouchingTypedDraft() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("voice-recovery-\(UUID())")
    defer { try? FileManager.default.removeItem(at: folder) }
    let draft = AssistantChatDraftStore(root: folder); draft.bind(""); draft.setText("Existing typed text")
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: draft)
    defer { controller.stop() }
    transport.transcribe = { _ in "Visible words before interruption" }
    await controller.startVoice(); audio.onTranscriptPreview?(Data([1]))
    await until { !controller.liveTranscript.isEmpty }
    audio.onCaptureFailure?(AssistantMicrophoneError.interrupted)
    XCTAssertTrue(controller.voiceActive); XCTAssertTrue(controller.muted)
    XCTAssertEqual(transport.closes, 0)
    XCTAssertTrue(transport.sentTexts.isEmpty)
    XCTAssertEqual(draft.value.text, "Existing typed text")
    XCTAssertEqual(draft.value.recoveredVoice?.map(\.text), ["Visible words before interruption"])
    for _ in 0..<10 { audio.onUtterance?(Data("PRIVATE".utf8), true); audio.onTranscriptPreview?(Data("PRIVATE".utf8)) }
    XCTAssertEqual(transport.transcriptions, 1)
    let reopened = AssistantChatDraftStore(root: folder); reopened.bind("")
    XCTAssertEqual(reopened.value, draft.value)
    let id = try XCTUnwrap(reopened.value.recoveredVoice?.first?.id)
    reopened.useRecoveredVoice(id)
    XCTAssertEqual(reopened.value.text, "Existing typed text\n\nVisible words before interruption")
    XCTAssertTrue(reopened.value.recoveredVoice?.isEmpty == true)
    await controller.unmuteMicrophone(); XCTAssertFalse(controller.muted)
  }

  func testCaptureFenceDropsAllMutedAndStaleBuffers() {
    var boundary = AssistantCaptureBoundary()
    boundary.move(to: .conversation, at: 10)
    XCTAssertEqual(boundary.route(capturedAt: 10.1), .conversation)
    boundary.move(to: .off, at: 11)
    for time in [10.9, 11.1, 20] { XCTAssertEqual(boundary.route(capturedAt: time), .off) }
    boundary.move(to: .conversation, at: 21)
    XCTAssertEqual(boundary.route(capturedAt: 20.999), .off)
    XCTAssertEqual(boundary.route(capturedAt: 21.1), .conversation)
  }

  func testEmptyFinalTranscriptSavesVisibleWordsWithoutSubmittingOrMuting() async throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("empty-final-\(UUID())")
    defer { try? FileManager.default.removeItem(at: folder) }
    let audio = AssistantTestAudio(), transport = AssistantTestTransport(), draft = AssistantChatDraftStore(root: folder)
    draft.bind("")
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil,
      automaticSendDelay: 30_000_000, chatDraft: draft)
    defer { controller.stop() }
    transport.transcribe = { $0 == Data([1]) ? "Words shown while speaking" : "" }
    await controller.startVoice(); audio.onTranscriptPreview?(Data([1]))
    await until { !controller.liveTranscript.isEmpty }
    audio.onUtterance?(Data([2]), true)
    await until { draft.value.recoveredVoice?.count == 1 }
    XCTAssertTrue(transport.sentTexts.isEmpty)
    XCTAssertFalse(controller.muted); XCTAssertTrue(controller.voiceActive)
    XCTAssertEqual(draft.value.recoveredVoice?.first?.text, "Words shown while speaking")
    XCTAssertEqual(transport.transcriptions, 3, "One preview and two bounded final attempts")
  }

  func testRecoveryLimitAppliesToConsecutiveFailuresAndDiagnosticsHaveNoContentFields() throws {
    var recovery = AssistantCaptureRecovery()
    for cycle in 0..<20 {
      XCTAssertTrue(recovery.begin())
      recovery.healthy(at: Double(cycle * 20))
      recovery.healthy(at: Double(cycle * 20 + 10))
      XCTAssertEqual(recovery.attempts, 0)
    }
    XCTAssertTrue(recovery.begin()); XCTAssertTrue(recovery.begin()); XCTAssertFalse(recovery.begin())
    let diagnostics = AssistantAudioDiagnostics()
    for _ in 0..<100 { diagnostics.record(.muted) }
    XCTAssertEqual(diagnostics.entries.count, 40)
    let data = try JSONEncoder().encode(diagnostics.entries)
    let entries = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
    XCTAssertEqual(Set(entries[0].keys), ["at", "event", "inputs", "outputs", "microphonePermission", "sampleRate"])
  }
  func testMuteKeepsPendingFinalTranscriptionAndPreservesTypedTextAndImage() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("mute-draft-\(UUID())")
    defer { try? FileManager.default.removeItem(at: root) }
    let draft = AssistantChatDraftStore(root: root)
    draft.bind("")
    draft.setText("My unsent typed message")
    let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!
    let image = try RemoteImagePreparation.prepare(png)
    try draft.add([image], to: "")
    let before = draft.value
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil,
      automaticSendDelay: 30_000_000, chatDraft: draft)
    defer { controller.stop() }
    var final: CheckedContinuation<String, Never>?
    transport.transcribe = { _ in await withCheckedContinuation { final = $0 } }
    await controller.startVoice()
    audio.onUtterance?(Data("Public before mute".utf8), true)
    await until { final != nil }
    controller.toggleMute()
    for _ in 0..<100 {
      audio.onUtterance?(Data("PRIVATE".utf8), true)
      audio.onTranscriptPreview?(Data("PRIVATE".utf8))
      audio.onSpeechStarted?()
    }
    final?.resume(returning: "The complete pre-mute transcript")
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.transcriptions, 1)
    XCTAssertEqual(transport.sentTexts, ["The complete pre-mute transcript"])
    XCTAssertTrue(controller.muted)
    XCTAssertTrue(controller.voiceActive)
    XCTAssertEqual(audio.captureMode, .off)
    XCTAssertEqual(transport.closes, 0)
    XCTAssertTrue(controller.liveTranscript.isEmpty)
    XCTAssertFalse(controller.canSendVoice)
    XCTAssertEqual(draft.value, before)
    XCTAssertEqual(try draft.bytes(image.upload, scope: ""), png)
    XCTAssertGreaterThanOrEqual(audio.finishes, 1, "Muting finishes pre-tap audio")
    await controller.unmuteMicrophone()
    transport.transcribe = { String(decoding: $0, as: UTF8.self) }
    audio.onUtterance?(Data("Fresh public turn".utf8), true)
    await until { transport.sentTexts.count == 2 }
    XCTAssertEqual(transport.sentTexts, ["The complete pre-mute transcript", "Fresh public turn"])
    XCTAssertEqual(draft.value, before)
  }

  func testMuteFlushesLastWordsAndReconnectDeliversOnceWithoutRestoringCapture() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 30_000_000)
    defer { controller.stop() }
    var preview: CheckedContinuation<String, Never>?
    transport.transcribe = { data in
      if data == Data([1]) { return await withCheckedContinuation { preview = $0 } }
      return "All my words including the last phrase"
    }
    await controller.startVoice()
    audio.onTranscriptPreview?(Data([1]))
    await until { preview != nil }
    audio.finishData = Data([2])
    transport.failAfterAcceptance = true
    transport.disconnectOnFailure = true
    transport.onReconnect = { transport.connected = true; transport.onChange?() }
    controller.toggleMute()
    preview?.resume(returning: "Stale preview")
    await until { transport.sentTexts.count == 1 && transport.messageIDs.count == 2 }
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(audio.captureMode, .off)
    XCTAssertTrue(controller.liveTranscript.isEmpty)
    XCTAssertEqual(transport.sentTexts, ["All my words including the last phrase"])
    XCTAssertEqual(Set(transport.messageIDs).count, 1)
    XCTAssertEqual(transport.transcriptions, 2)
  }

  func testPlaybackEchoIsIgnoredAndManualMuteDoesNotStopReply() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.startVoice()
    transport.addReply("Discussing ClawDad mute and ClawDad unmute")
    try await controller.refresh()
    await until { audio.played.count == 1 }
    audio.onUtterance?(Data("Playback echo".utf8), true)
    XCTAssertFalse(controller.muted)
    XCTAssertEqual(transport.transcriptions, 0)
    let stops = audio.playbackStops
    controller.toggleMute()
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(audio.captureMode, .off)
    XCTAssertTrue(controller.replyAudioActive)
    XCTAssertEqual(audio.playbackStops, stops)
    XCTAssertEqual(controller.callStatus, "Muted · microphone off")
    audio.completeClip()
    await until { audio.played.count == 2 }
    audio.completeClip()
    await until { !controller.replyAudioActive }
    XCTAssertTrue(controller.muted)
  }

  func testThinkAloudSurvivesMuteAndManualSendStillSubmitsOnce() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.transcribe = { String(decoding: $0, as: UTF8.self) }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 30_000_000)
    defer { controller.stop() }
    await controller.startVoice()
    controller.setWaitForSend(true)
    audio.onUtterance?(Data("New thought".utf8), true)
    await until { controller.liveTranscript == "New thought" }
    controller.toggleMute()
    XCTAssertTrue(controller.waitForSend)
    XCTAssertTrue(controller.canSendVoice)
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertTrue(transport.sentTexts.isEmpty)
    controller.sendVoiceNow(); controller.sendVoiceNow()
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["New thought"])
    XCTAssertTrue(controller.voiceActive)
    XCTAssertTrue(controller.muted)
    await controller.unmuteMicrophone()
    XCTAssertFalse(controller.muted)
    XCTAssertTrue(controller.waitForSend)
    XCTAssertEqual(transport.sentTexts.count, 1)
  }

  func testRapidMuteUnmuteRetainsThePendingThoughtAndFreshWordsInOrder() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 60_000_000)
    defer { controller.stop() }
    var first: CheckedContinuation<String, Never>?
    var received: [Data] = []
    transport.transcribe = { data in
      received.append(data)
      if data == Data([1]) { return await withCheckedContinuation { first = $0 } }
      return "and the rest of my thought"
    }
    await controller.startVoice()
    audio.finishData = Data([1])
    audio.onSpeechStarted?()
    controller.toggleMute()
    await until { first != nil }
    audio.onUtterance?(Data("PRIVATE".utf8), true)
    await controller.unmuteMicrophone()
    audio.onSpeechStarted?()
    audio.onUtterance?(Data([2]), true)
    first?.resume(returning: "The beginning")
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["The beginning and the rest of my thought"])
    XCTAssertEqual(received, [Data([1]), Data([2])])
    XCTAssertTrue(controller.voiceActive)
    XCTAssertFalse(controller.muted)
  }

  func testFailedUnmuteKeepsTheAcceptedTurnAndEndingCallStillCancelsLateDelivery() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 30_000_000)
    defer { controller.stop() }
    var final: CheckedContinuation<String, Never>?
    transport.transcribe = { _ in await withCheckedContinuation { final = $0 } }
    await controller.startVoice()
    audio.onUtterance?(Data([1]), true)
    await until { final != nil }
    controller.toggleMute()
    audio.unmuteError = true
    await controller.unmuteMicrophone()
    final?.resume(returning: "Keep my completed thought")
    await until { transport.sentTexts.count == 1 }
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(transport.sentTexts, ["Keep my completed thought"])
    audio.unmuteError = false
    await controller.unmuteMicrophone()
    final = nil
    audio.onUtterance?(Data([2]), true)
    await until { final != nil }
    controller.endVoice()
    final?.resume(returning: "Ended call result")
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertEqual(transport.sentTexts.count, 1)
    XCTAssertFalse(controller.voiceActive)
  }

  private func until(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
    let deadline = ContinuousClock.now + .seconds(4)
    while !condition(), ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(2)) }
    XCTAssertTrue(condition(), file: file, line: line)
  }
}
