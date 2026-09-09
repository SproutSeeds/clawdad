import ClawDadRemoteAssistProtocol
import Foundation
import XCTest
@testable import ClawDadMobile

@MainActor
final class MobileAssistantTurnTests: XCTestCase {
  func testAutomaticDefaultSubmitsFourSecondsAfterLastWordsAndKeepsCallConnected() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    transport.transcribe = { String(decoding: $0, as: UTF8.self) }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    XCTAssertFalse(controller.waitForSend)
    await controller.startVoice()
    let lastWord = ProcessInfo.processInfo.systemUptime
    audio.lastSpeechAt = lastWord
    audio.onSpeechStarted?()
    audio.onUtterance?(Data("Please respond now".utf8), true)
    try await Task.sleep(for: .seconds(3.7))
    XCTAssertTrue(transport.sentTexts.isEmpty)
    await until { transport.sentTexts.count == 1 }
    let latency = ProcessInfo.processInfo.systemUptime - lastWord
    XCTAssertGreaterThanOrEqual(latency, 4)
    XCTAssertLessThan(latency, 4.5)
    XCTAssertTrue(controller.voiceActive)
    XCTAssertEqual(transport.closes, 0)
    XCTAssertEqual(transport.sentTexts, ["Please respond now"])
  }

  func testRepeatedPartialsAndNoiseCannotHoldTurnOpenOrSubmitThePreview() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    transport.transcribe = { data in
      if data == Data([3]) { return "" } // Room noise after the recording was flushed.
      return data == Data([1]) ? "Check this project" : "Check this project carefully"
    }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 150_000_000)
    defer { controller.stop() }
    await controller.startVoice()
    audio.onSpeechStarted?()
    audio.onTranscriptPreview?(Data([1]))
    await until { controller.liveTranscript == "Check this project" }
    audio.finishData = Data([2])
    audio.previewData = Data([3])
    for _ in 0..<40 where transport.sentTexts.isEmpty {
      audio.onInputLevel?(0.8)
      audio.onSpeechStarted?()
      audio.onTranscriptPreview?(Data([1]))
      try await Task.sleep(for: .milliseconds(10))
    }
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Check this project carefully"])
    XCTAssertTrue(controller.voiceActive)
  }

  func testStalledPreviewWhileSpeakingKeepsRecordingAndDelayedFinalWordsSubmitOnce() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 40_000_000)
    defer { controller.stop() }
    var preview: CheckedContinuation<String, Never>?
    var final: CheckedContinuation<String, Never>?
    transport.transcribe = { data in
      await withCheckedContinuation { if data == Data([1]) { preview = $0 } else { final = $0 } }
    }
    await controller.startVoice()
    audio.onSpeechStarted?()
    audio.onTranscriptPreview?(Data([1]))
    await until { preview != nil }
    try await Task.sleep(for: .milliseconds(150))
    XCTAssertEqual(audio.finishes, 0, "Active speech with a stalled recognizer must keep recording")
    audio.onUtterance?(Data([2]), true)
    await until { final != nil }
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertTrue(transport.sentTexts.isEmpty)
    final?.resume(returning: "Preserve all of my final words")
    preview?.resume(returning: "Outdated partial")
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Preserve all of my final words"])
    XCTAssertEqual(Set(transport.messageIDs).count, 1)
  }

  func testThinkAloudStartsOffEvenWithTheOldPausePreference() {
    let name = "assistant-mode-\(UUID().uuidString)", defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    defaults.set(true, forKey: "assistant.waitForSend")
    let controller = MobileAssistantController(connection: AssistantTestTransport(), audio: AssistantTestAudio(), defaults: defaults)
    XCTAssertFalse(controller.waitForSend)
  }
  func testFinalTranscriptionSetsTheDeadlineFromTheLastWordsInsteadOfSpeechOnset() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 200_000_000)
    defer { controller.stop() }
    var final: CheckedContinuation<String, Never>?
    transport.transcribe = { _ in await withCheckedContinuation { final = $0 } }
    await controller.startVoice()
    audio.onSpeechStarted?()
    try await Task.sleep(for: .milliseconds(180))
    audio.lastSpeechAt = ProcessInfo.processInfo.systemUptime
    audio.onUtterance?(Data([1]), true)
    await until { final != nil }
    try await Task.sleep(for: .milliseconds(60))
    final?.resume(returning: "These are my last words")
    try await Task.sleep(for: .milliseconds(50))
    XCTAssertTrue(transport.sentTexts.isEmpty, "The old onset deadline has expired, but the last-word pause has not")
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["These are my last words"])
  }
  func testCallRecoversAStaleConnectionBeforeStartingTheMicrophone() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    transport.failNextHealthCheck = true
    transport.onReconnect = { transport.connected = true; transport.onChange?() }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.startVoice()
    XCTAssertTrue(controller.voiceActive)
    XCTAssertEqual(audio.starts, 1)
    XCTAssertEqual(transport.connects, 1)
    XCTAssertGreaterThanOrEqual(transport.stateReads, 2)
    XCTAssertTrue(transport.sentTexts.isEmpty)
  }

  func testTextSendRecoversLostReceiptUsingTheSameIDWithoutStartingACall() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    transport.failAfterAcceptance = true
    transport.disconnectOnFailure = true
    transport.onReconnect = { transport.connected = true; transport.onChange?() }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    let id = UUID().uuidString
    let sent = await controller.send("Keep this exact message once", id: id)
    XCTAssertTrue(sent)
    XCTAssertEqual(transport.messageIDs, [id, id])
    XCTAssertEqual(transport.sentTexts, ["Keep this exact message once"])
    XCTAssertEqual(audio.starts, 0)
    XCTAssertFalse(controller.callVisible)
  }

  func testExplicitRetryReplacesTheConnectionAndPreservesTheDraft() throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("assistant-retry-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let draft = AssistantChatDraftStore(root: root)
    draft.bind("test-retry")
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: draft)
    defer { controller.stop() }
    controller.chatDraft.setText("Unsent text remains here")
    let before = controller.chatDraft.value
    controller.retryConnection()
    XCTAssertEqual(transport.closes, 1)
    XCTAssertEqual(transport.connects, 1)
    XCTAssertEqual(controller.chatDraft.value, before)
    XCTAssertEqual(audio.starts, 0)
  }

  func testShortPauseKeepsBothSegmentsInOneThought() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil,
      automaticSendDelay: 100_000_000)
    defer { controller.stop() }
    transport.transcribe = { String(decoding: $0, as: UTF8.self) }
    await controller.startVoice()
    audio.onSpeechStarted?()
    audio.onUtterance?(Data("Please check".utf8), true)
    await until { controller.liveTranscript == "Please check" }
    audio.onSpeechStarted?()
    try await Task.sleep(for: .milliseconds(150))
    XCTAssertTrue(transport.sentTexts.isEmpty)
    audio.onUtterance?(Data("the second tab.".utf8), true)
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Please check the second tab."])
  }

  func testWaitForSendRetainsLongPausesAndFlushesRecordedAudioOnTap() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil,
      automaticSendDelay: 20_000_000)
    defer { controller.stop() }
    transport.transcribe = { String(decoding: $0, as: UTF8.self) }
    controller.setWaitForSend(true)
    await controller.startVoice()
    audio.onSpeechStarted?()
    audio.onUtterance?(Data("First thought.".utf8), true)
    await until { controller.liveTranscript == "First thought." }
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertTrue(transport.sentTexts.isEmpty)
    XCTAssertTrue(controller.canSendVoice)
    audio.onSpeechStarted?()
    audio.finishData = Data("And the rest.".utf8)
    controller.sendVoiceNow()
    controller.sendVoiceNow()
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["First thought. And the rest."])
    XCTAssertFalse(controller.canSendVoice)
    await until { !transport.timings.isEmpty }
    XCTAssertEqual(transport.timings.first?["segments"]?.number, 2)
    XCTAssertEqual(transport.timings.first?["manualSend"]?.number, 1)
  }

  func testSendDuringDelayedTranscriptionSeparatesTheNextThought() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    controller.setWaitForSend(true)
    var pending: CheckedContinuation<String, Never>?
    transport.transcribe = { data in
      if data == Data([1]) { return await withCheckedContinuation { pending = $0 } }
      return "Second thought"
    }
    await controller.startVoice()
    audio.onSpeechStarted?()
    audio.onUtterance?(Data([1]), true)
    await until { pending != nil }
    controller.sendVoiceNow()
    controller.sendVoiceNow()
    audio.onSpeechStarted?()
    audio.onUtterance?(Data([2]), true)
    controller.sendVoiceNow()
    pending?.resume(returning: "First thought")
    await until { transport.sentTexts.count == 2 }
    XCTAssertEqual(transport.sentTexts, ["First thought", "Second thought"])
    XCTAssertEqual(Set(transport.messageIDs).count, 2)
  }

  func testHangupCancelsThePauseDeadlineAndLateTranscription() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil,
      automaticSendDelay: 30_000_000)
    var pending: CheckedContinuation<String, Never>?
    transport.transcribe = { _ in await withCheckedContinuation { pending = $0 } }
    await controller.startVoice()
    audio.onSpeechStarted?()
    audio.onUtterance?(Data([1]), true)
    await until { pending != nil }
    controller.endVoice()
    pending?.resume(returning: "Already hung up")
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertTrue(transport.sentTexts.isEmpty)
    XCTAssertFalse(controller.canSendVoice)
    controller.stop()
  }

  func testReadyConnectionSkipsStartupRoundTripsAndRechecksAfterDisconnect() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.startVoice()
    let reads = transport.stateReads
    let first = await controller.send("First message")
    let second = await controller.send("Second message")
    XCTAssertTrue(first)
    XCTAssertTrue(second)
    XCTAssertEqual(transport.stateReads, reads)
    XCTAssertFalse(transport.commands.contains("start"))
    transport.connected = false
    transport.onChange?()
    transport.connected = true
    transport.onChange?()
    let reconnected = await controller.send("After reconnect")
    XCTAssertTrue(reconnected)
    XCTAssertEqual(transport.stateReads, reads + 1)
  }

  func testUncertainVoiceDeliveryRetriesTheSameIDOnceWithoutDuplicatingText() async throws {
    let transport = AssistantTestTransport(), audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    controller.setWaitForSend(true)
    transport.failAfterAcceptance = true
    transport.transcribe = { _ in "A single request" }
    await controller.startVoice()
    audio.onSpeechStarted?()
    audio.onUtterance?(Data([1]), true)
    controller.sendVoiceNow()
    await until { transport.messageIDs.count == 2 }
    XCTAssertEqual(Set(transport.messageIDs).count, 1)
    XCTAssertEqual(transport.sentTexts, ["A single request"])
  }

  func testWaitForSendPreferencePersistsBetweenControllers() {
    let name = "assistant-test-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    let first = MobileAssistantController(connection: AssistantTestTransport(), audio: AssistantTestAudio(), defaults: defaults)
    first.setWaitForSend(true)
    let next = MobileAssistantController(connection: AssistantTestTransport(), audio: AssistantTestAudio(), defaults: defaults)
    XCTAssertTrue(next.waitForSend)
  }
  func testNoiseCannotInterruptAnyPartOfAReplyAndListeningResumesAfterward() async throws {
    let transport = AssistantTestTransport()
    let audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio)
    defer { controller.stop() }
    await controller.startVoice()
    transport.addReply("A complete two-part reply")
    try await controller.refresh()
    await until { audio.played.count == 1 }
    XCTAssertTrue(audio.replyActive)
    let stops = audio.playbackStops
    audio.onSpeechStarted?()
    audio.onUtterance?(Data([9]), true)
    audio.onTranscriptPreview?(Data([9]))
    XCTAssertEqual(audio.playbackStops, stops)
    XCTAssertEqual(controller.status, "Speaking…")
    XCTAssertFalse(controller.hearingSpeech)
    XCTAssertEqual(transport.transcriptions, 0)
    audio.completeClip()
    await until { audio.played.count == 2 }
    XCTAssertTrue(audio.replyActive)
    XCTAssertTrue(controller.replyAudioActive)
    audio.completeClip()
    await until { !controller.replyAudioActive }
    XCTAssertFalse(audio.replyActive)
    XCTAssertFalse(controller.muted)
    XCTAssertEqual(controller.status, "Listening…")
    audio.onSpeechStarted?()
    XCTAssertTrue(controller.hearingSpeech)
  }

  func testMutingDuringReplyKeepsPlaybackAndRemainsMutedAfterCompletion() async throws {
    let transport = AssistantTestTransport()
    let audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio)
    defer { controller.stop() }
    await controller.startVoice()
    transport.addReply("Keep reading")
    try await controller.refresh()
    await until { audio.played.count == 1 }
    controller.toggleMute()
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(controller.status, "Speaking…")
    audio.completeClip()
    await until { audio.played.count == 2 }
    audio.completeClip()
    await until { !controller.replyAudioActive }
    XCTAssertTrue(audio.muted)
    XCTAssertEqual(controller.status, "Muted · microphone off")
  }

  func testMicrophoneStaysHeldWhileTheNextAudioPartIsBeingGenerated() async throws {
    let transport = AssistantTestTransport()
    let audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio)
    defer { controller.stop() }
    var ready = false
    transport.synthesis = {
      ["audio": ["state": ready ? "ready" : "generating",
        "parts": ready ? [["url": "one"], ["url": "two"]] : [["url": "one"]]]]
    }
    await controller.startVoice()
    transport.addReply("Reply with a generation gap")
    try await controller.refresh()
    await until { audio.played.count == 1 }
    audio.completeClip()
    await until { transport.syntheses >= 2 }
    XCTAssertTrue(audio.replyActive)
    audio.onSpeechStarted?()
    XCTAssertFalse(controller.hearingSpeech)
    ready = true
    await until { audio.played.count == 2 }
    XCTAssertTrue(audio.replyActive)
    audio.completeClip()
    await until { !controller.replyAudioActive }
  }

  func testSynthesisFailureReleasesTheMicrophoneHold() async throws {
    let transport = AssistantTestTransport()
    let audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio)
    defer { controller.stop() }
    transport.synthesis = { ["audio": ["state": "failed", "error": "Speech test failed"]] }
    await controller.startVoice()
    transport.addReply("A reply that remains readable")
    try await controller.refresh()
    await until { controller.error == "Speech test failed" }
    XCTAssertFalse(controller.replyAudioActive)
    XCTAssertFalse(audio.replyActive)
    XCTAssertEqual(controller.status, "Listening…")
    XCTAssertEqual(controller.snapshot?.messages.last?.text, "A reply that remains readable")
  }

  func testInterjectStopsPlaybackAndSuppressesLaterAudioFromTheSameResponse() async throws {
    let transport = AssistantTestTransport()
    let audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio)
    defer { controller.stop() }
    await controller.startVoice()
    transport.addReply("Keep the complete written reply")
    try await controller.refresh()
    await until { audio.played.count == 1 }
    controller.toggleMute()
    controller.interject()
    await until { !controller.muted }
    XCTAssertFalse(audio.replyActive)
    XCTAssertFalse(audio.muted)
    XCTAssertTrue(controller.voiceActive)
    XCTAssertEqual(controller.status, "Listening…")
    transport.addReply("A later item from that response", item: "later")
    try await controller.refresh()
    XCTAssertFalse(controller.replyAudioActive)
    XCTAssertEqual(audio.played.count, 1)
    XCTAssertEqual(controller.snapshot?.messages.count, 2)
    XCTAssertTrue(transport.commands.allSatisfy { $0 != "cancel" })
  }

  func testInterjectBeforeSynthesisReturnsPreventsLatePlayback() async throws {
    let transport = AssistantTestTransport()
    let audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio)
    defer { controller.stop() }
    await controller.startVoice()
    var pending: CheckedContinuation<Void, Never>?
    transport.beforeSynthesis = { await withCheckedContinuation { pending = $0 } }
    transport.addReply("Delayed audio")
    try await controller.refresh()
    await until { pending != nil }
    XCTAssertTrue(controller.replyAudioActive)
    controller.interject()
    pending?.resume()
    await Task.yield()
    await Task.yield()
    XCTAssertFalse(controller.replyAudioActive)
    XCTAssertTrue(audio.played.isEmpty)
  }

  func testTranscriptPreviewIsVisibleButOnlyFinalTextIsSent() async throws {
    let transport = AssistantTestTransport()
    let audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, automaticSendDelay: 30_000_000)
    defer { controller.stop() }
    await controller.startVoice()
    transport.transcribe = { data in data == Data([1]) ? "Could you check" : "Could you check the working tab?" }
    audio.onSpeechStarted?()
    audio.onTranscriptPreview?(Data([1]))
    await until { controller.liveTranscript == "Could you check" }
    XCTAssertTrue(transport.sentTexts.isEmpty)
    audio.onUtterance?(Data([2]), true)
    await until { transport.sentTexts.count == 1 && !controller.transcribingSpeech }
    XCTAssertEqual(transport.sentTexts, ["Could you check the working tab?"])
    XCTAssertEqual(controller.snapshot?.messages.last?.text, "Could you check the working tab?")
    XCTAssertTrue(controller.liveTranscript.isEmpty)
  }

  func testLatePreviewCannotOverwriteFinalTextOrSubmitADuplicate() async throws {
    let transport = AssistantTestTransport()
    let audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, automaticSendDelay: 30_000_000)
    defer { controller.stop() }
    await controller.startVoice()
    var pending: CheckedContinuation<String, Never>?
    transport.transcribe = { data in
      if data == Data([1]) { return await withCheckedContinuation { pending = $0 } }
      return "The complete request"
    }
    audio.onSpeechStarted?()
    audio.onTranscriptPreview?(Data([1]))
    await until { pending != nil }
    for _ in 0..<10 { audio.onTranscriptPreview?(Data([1])) }
    XCTAssertEqual(transport.transcriptions, 1)
    audio.onUtterance?(Data([2]), true)
    await until { transport.sentTexts.count == 1 && !controller.transcribingSpeech }
    pending?.resume(returning: "Outdated partial text")
    await Task.yield()
    await Task.yield()
    XCTAssertTrue(controller.liveTranscript.isEmpty)
    XCTAssertEqual(transport.sentTexts, ["The complete request"])
  }

  func testReplyWaitsForAnExistingUtteranceToFinish() async throws {
    let transport = AssistantTestTransport()
    let audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: transport, audio: audio, automaticSendDelay: 30_000_000)
    defer { controller.stop() }
    await controller.startVoice()
    audio.onSpeechStarted?()
    transport.addReply("Queued response")
    try await controller.refresh()
    XCTAssertFalse(controller.replyAudioActive)
    audio.onUtterance?(Data(), true)
    await until { audio.played.count == 1 }
    XCTAssertTrue(controller.replyAudioActive)
  }

  private func until(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
    let end = ContinuousClock.now + .seconds(3)
    while !condition(), ContinuousClock.now < end { try? await Task.sleep(for: .milliseconds(10)) }
    XCTAssertTrue(condition(), file: file, line: line)
  }
}

@MainActor
final class AssistantTestAudio: AssistantAudioIO {
  var onUtterance: ((Data, Bool) -> Void)?
  var onSpeechStarted: (() -> Void)?
  var onTranscriptPreview: ((Data) -> Void)?
  var onReplaced: (() -> Void)?
  var onInputLevel: ((Float) -> Void)?
  var onCaptureRecovery: ((Bool) -> Void)?
  var onCaptureFailure: ((Error) -> Void)?
  var onPlaybackStarted: (() -> Void)?
  var onVoiceCommand: ((AssistantVoiceCommand) -> Void)?
  var onVoiceControlFailure: ((AssistantVoiceControlError) -> Void)?
  var captureMode: AssistantCaptureMode = .off
  var commandsAvailable = true
  var unmuteError = false
  var beforeUnmute: (() async -> Void)?
  var duringStart: (() -> Void)?
  var muteCalls = 0
  var resets = 0
  var lastSpeechAt: TimeInterval?
  var muted = false
  var replyActive = false
  var played: [Data] = []
  var playbackStops = 0
  var finishData: Data?
  var previewData: Data?
  var starts = 0
  var finishes = 0
  private var clip: CheckedContinuation<Void, Error>?
  func start() async throws { starts += 1; muted = false; captureMode = .conversation; duringStart?() }
  func configureVoiceCommands(enabled: Bool, alternates: Bool, requestPermission: Bool) async throws {
    if enabled && !commandsAvailable { throw AssistantVoiceControlError.unavailable }
  }
  func muteCapture(voiceReactivation: Bool) throws {
    muteCalls += 1; muted = true; captureMode = .off; resetUtterance()
    if voiceReactivation {
      guard commandsAvailable else { throw AssistantVoiceControlError.unavailable }
      captureMode = .commandsOnly
    }
  }
  func unmuteCapture() async throws {
    let attempt = muteCalls
    await beforeUnmute?()
    guard attempt == muteCalls else { throw CancellationError() }
    if unmuteError { throw AssistantVoiceControlError.failed }
    muted = false; captureMode = .conversation; resetUtterance()
  }
  func setReplyActive(_ active: Bool) { replyActive = active }
  func play(_ data: Data) async throws {
    try await withCheckedThrowingContinuation { clip = $0; played.append(data); onPlaybackStarted?() }
  }
  func completeClip() { let done = clip; clip = nil; done?.resume() }
  func stopPlayback() { playbackStops += 1; let done = clip; clip = nil; done?.resume(throwing: CancellationError()) }
  func resetUtterance() { resets += 1 }
  func previewUtterance() { if let previewData { onTranscriptPreview?(previewData) } }
  func finishUtterance() {
    finishes += 1
    if let data = finishData { finishData = nil; onUtterance?(data, true) }
  }
  func stop() { stopPlayback() }
}

@MainActor
final class AssistantTestTransport: AssistantTransport {
  var onChange: (() -> Void)?
  var connected = true
  let requestID = UUID().uuidString.lowercased()
  var messages: [[String: Any]] = []
  var commands: [String] = []
  var sentTexts: [String] = []
  var sentImages: [AssistantValue] = []
  var uploadHandler: (([String: AssistantValue]) throws -> Data)?
  var messageIDs: [String] = []
  var timings: [[String: AssistantValue]] = []
  var failAfterAcceptance = false
  var disconnectOnFailure = false
  var failNextHealthCheck = false
  var onReconnect: (() -> Void)?
  var connects = 0
  var closes = 0
  var omitRecentMessages = false
  var omitReceipt = false
  var stateReads = 0
  var transcriptions = 0
  var syntheses = 0
  var beforeSynthesis: (() async -> Void)?
  var synthesis: (() -> [String: Any])?
  var transcribe: (Data) async -> String = { _ in "" }
  func bind(_ session: CloudSession) {}
  func connect() { connects += 1; onReconnect?() }
  func close() { closes += 1; connected = false; onChange?() }
  func addReply(_ text: String, item: String = "answer") {
    messages.append(["id": "assistant:\(requestID):\(item)", "role": "assistant", "text": text, "createdAt": "2026-09-08T00:00:00Z"])
  }
  func request(_ action: AssistantWireRequest.Action, payload: Data) async throws -> Data {
    switch action {
    case .state:
      stateReads += 1
      if failNextHealthCheck {
        failNextHealthCheck = false; connected = false; onChange?()
        throw AssistantProtocolError.timedOut
      }
      return try snapshot()
    case .command:
      let body = try JSONDecoder().decode([String: AssistantValue].self, from: payload)
      commands.append(body["action"]?.string ?? "")
      if body["action"]?.string == "message", let text = body["text"]?.string {
        let id = body["requestId"]!.string!
        messageIDs.append(id)
        if !messages.contains(where: { $0["id"] as? String == id }) {
          sentTexts.append(text)
          sentImages.append(contentsOf: body["images"]?.array ?? [])
          messages.append(["id": id, "role": "user", "text": text, "createdAt": "2026-09-08T00:00:00Z"])
        }
        if failAfterAcceptance {
          failAfterAcceptance = false
          if disconnectOnFailure { connected = false; onChange?() }
          throw AssistantProtocolError.disconnected
        }
      }
      if body["action"]?.string == "voice.timing", let value = body["metrics"]?.object { timings.append(value) }
      var response = try JSONSerialization.jsonObject(with: snapshot()) as! [String: Any]
      if body["action"]?.string == "message", !omitReceipt {
        response["job"] = ["id": body["requestId"]!.string!, "action": "message", "status": "completed", "args": [:]] as [String: Any]
      }
      return try JSONSerialization.data(withJSONObject: response)
    case .transcribe:
      transcriptions += 1
      return try JSONSerialization.data(withJSONObject: ["text": await transcribe(payload)])
    case .synthesize:
      syntheses += 1
      await beforeSynthesis?()
      if let synthesis { return try JSONSerialization.data(withJSONObject: synthesis()) }
      return try JSONSerialization.data(withJSONObject: ["audio": ["state": "ready", "parts": [["url": "one"], ["url": "two"]]]])
    case .audio: return payload
    case .imageUpload:
      guard let uploadHandler else { throw AssistantProtocolError.invalid }
      return try uploadHandler(JSONDecoder().decode([String: AssistantValue].self, from: payload))
    }
  }
  private func snapshot() throws -> Data {
    try JSONSerialization.data(withJSONObject: [
      "version": 1, "conversationMode": "background", "imageAttachments": true, "enabled": true, "paused": false,
      "nativeOnline": true, "messages": omitRecentMessages ? [] : messages, "tasks": [],
      "catalog": ["revision": 1, "tabs": []],
    ])
  }
}
