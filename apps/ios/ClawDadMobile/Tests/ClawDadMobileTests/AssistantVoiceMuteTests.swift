import Foundation
import XCTest
@testable import ClawDadMobile

@MainActor
final class AssistantVoiceMuteTests: XCTestCase {
  func testRecognitionFailureDuringCallStartupLeavesAConnectedFullyMutedCall() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.setVoiceCommands(true, reactivation: true)
    audio.duringStart = { audio.onVoiceControlFailure?(.failed) }
    await controller.startVoice()
    XCTAssertTrue(controller.voiceActive)
    XCTAssertTrue(controller.muted)
    XCTAssertFalse(controller.voiceMuted)
    XCTAssertEqual(audio.captureMode, .off)
    XCTAssertFalse(controller.voiceControlNotice.isEmpty)
    XCTAssertEqual(transport.closes, 0)
    await controller.unmuteMicrophone()
    XCTAssertFalse(controller.muted)
    XCTAssertTrue(controller.voiceControlNotice.contains("Voice commands are unavailable"))
  }
  func testScreenStaysAwakeOnlyForAnExplicitForegroundCallWithVoiceControls() async {
    var awake = false
    let audio = AssistantTestAudio()
    let controller = MobileAssistantController(connection: AssistantTestTransport(), audio: audio, defaults: nil,
      keepScreenAwake: { awake = $0 })
    defer { controller.stop() }
    await controller.setVoiceCommands(true, reactivation: true)
    XCTAssertFalse(awake, "Changing settings must not begin a listening session")
    await controller.startVoice()
    XCTAssertTrue(awake)
    audio.onVoiceCommand?(.mute)
    XCTAssertTrue(awake, "Auto-lock must not silently prevent hands-free reactivation")
    controller.applicationForegroundChanged(false)
    XCTAssertFalse(awake)
    controller.applicationForegroundChanged(true)
    XCTAssertFalse(awake)
    await controller.unmuteMicrophone()
    XCTAssertTrue(awake)
    controller.fullyStopMicrophone()
    XCTAssertFalse(awake)
    await controller.unmuteMicrophone()
    XCTAssertTrue(awake)
    controller.endVoice()
    XCTAssertFalse(awake)
  }
  func testLateNormalFinalSTTCannotSendAControlAsAnAssistantTask() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    transport.transcribe = { _ in "ClawDad, mute" }
    await controller.setVoiceCommands(true, reactivation: true)
    await controller.startVoice()
    audio.onUtterance?(Data("Synthetic pre-mute control audio".utf8), true)
    await until { controller.muted }
    XCTAssertTrue(controller.voiceMuted)
    XCTAssertTrue(transport.sentTexts.isEmpty)
    XCTAssertFalse(controller.canSendVoice)
    XCTAssertTrue(controller.liveTranscript.isEmpty)
    XCTAssertEqual(transport.transcriptions, 1)
  }
  func testStandalonePhrasesAndOptInAlternates() {
    for phrase in ["ClawDad, mute", "Claw dad mute.", "CLAWDAD MUTE!"] {
      XCTAssertEqual(AssistantVoiceCommand.match(phrase, alternates: false), .mute)
    }
    for phrase in ["ClawDad, unmute", "Claw dad un mute."] {
      XCTAssertEqual(AssistantVoiceCommand.match(phrase, alternates: false), .unmute)
    }
    for phrase in ["please mute", "please unmute", "please un mute"] {
      XCTAssertNil(AssistantVoiceCommand.match(phrase, alternates: false))
      XCTAssertNotNil(AssistantVoiceCommand.match(phrase, alternates: true))
    }
    for phrase in ["mute", "unmute", "ClawDad muted", "ClawDad mute is the command", "Say ClawDad mute",
      "When I say ClawDad unmute", "\"ClawDad mute\"", "“ClawDad mute”", "ClawDad mute?", "ClawDad mute and send this",
      "Please don't mute", "please unmuted", "clawdad mute\nplease unmute"] {
      XCTAssertNil(AssistantVoiceCommand.match(phrase, alternates: true), phrase)
    }
  }

  func testPartialStabilityIsPromptSingleAndRequiresQuiet() {
    var intent = AssistantCommandIntent()
    intent.update("ClawDad mute", alternates: false, at: 1)
    for time in [1.1, 1.2, 1.3] { intent.update("ClawDad mute", alternates: false, at: time) }
    XCTAssertNil(intent.take(at: 1.31, lastSpeechAt: 1.2))
    XCTAssertEqual(intent.take(at: 1.6, lastSpeechAt: 1.2), .mute)
    XCTAssertNil(intent.take(at: 2, lastSpeechAt: 1.2))
    var discussion = AssistantCommandIntent()
    discussion.update("ClawDad mute", alternates: false, at: 1)
    discussion.update("ClawDad mute is the phrase", alternates: false, at: 1.2)
    XCTAssertNil(discussion.take(at: 2, lastSpeechAt: 1.2))
  }

  func testCaptureFenceCannotReplayPrivateOrPreMuteBuffers() {
    var boundary = AssistantCaptureBoundary()
    boundary.move(to: .conversation, at: 10)
    XCTAssertEqual(boundary.route(capturedAt: 9.99), .off)
    XCTAssertEqual(boundary.route(capturedAt: 10.1), .conversation)
    boundary.move(to: .commandsOnly, at: 11)
    XCTAssertEqual(boundary.route(capturedAt: 10.9), .off)
    XCTAssertEqual(boundary.route(capturedAt: 11.1), .commandsOnly)
    boundary.move(to: .conversation, at: 12)
    for time in [10.1, 11, 11.9] { XCTAssertEqual(boundary.route(capturedAt: time), .off) }
    XCTAssertEqual(boundary.route(capturedAt: 12.1), .conversation)
    boundary.move(to: .off, at: 13)
    XCTAssertEqual(boundary.route(capturedAt: 13.1), .off)
  }

  func testDefaultsStayOffAndConfigurationNeverStartsCapture() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    XCTAssertFalse(controller.voiceReactivationEnabled)
    XCTAssertFalse(controller.voiceCommandsEnabled)
    XCTAssertFalse(controller.alternateVoiceCommands)
    await controller.setVoiceCommands(true, reactivation: true)
    XCTAssertTrue(controller.voiceReactivationEnabled)
    XCTAssertEqual(audio.starts, 0)
    XCTAssertEqual(audio.captureMode, .off)
    XCTAssertTrue(transport.commands.isEmpty)
  }

  func testVoiceMuteWithoutReactivationStopsCaptureAndVoiceCannotRestartIt() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.setVoiceCommands(true)
    await controller.startVoice()
    audio.onVoiceCommand?(.mute)
    XCTAssertTrue(controller.voiceActive)
    XCTAssertEqual(controller.callStatus, "Muted · microphone off")
    XCTAssertEqual(audio.captureMode, .off)
    audio.onVoiceCommand?(.unmute)
    await Task.yield()
    XCTAssertTrue(controller.muted)
    await controller.unmuteMicrophone()
    XCTAssertFalse(controller.muted)
    XCTAssertEqual(audio.captureMode, .conversation)
    XCTAssertEqual(transport.closes, 0)
  }

  func testManyVoiceCyclesConfirmOnlyAfterTransitionsAndDoNotSubmitControls() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    var confirmations: [AssistantCaptureMode] = []
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil,
      confirmMicrophoneChange: { confirmations.append(audio.captureMode) })
    defer { controller.stop() }
    await controller.setVoiceCommands(true, reactivation: true)
    await controller.startVoice()
    var muteMilliseconds: [Double] = [], unmuteMilliseconds: [Double] = []
    for _ in 0..<20 {
      let muteAt = ProcessInfo.processInfo.systemUptime
      audio.onVoiceCommand?(.mute)
      muteMilliseconds.append((ProcessInfo.processInfo.systemUptime - muteAt) * 1000)
      XCTAssertTrue(controller.voiceMuted)
      XCTAssertEqual(controller.callStatus, "Muted · voice unmute enabled")
      audio.onVoiceCommand?(.mute)
      let unmuteAt = ProcessInfo.processInfo.systemUptime
      audio.onVoiceCommand?(.unmute)
      audio.onVoiceCommand?(.unmute)
      await until { !controller.muted }
      unmuteMilliseconds.append((ProcessInfo.processInfo.systemUptime - unmuteAt) * 1000)
      XCTAssertEqual(audio.captureMode, .conversation)
    }
    XCTAssertEqual(confirmations, Array(repeating: [AssistantCaptureMode.commandsOnly, .conversation], count: 20).flatMap { $0 })
    XCTAssertTrue(transport.sentTexts.isEmpty)
    XCTAssertEqual(transport.transcriptions, 0)
    XCTAssertTrue(transport.timings.isEmpty)
    XCTAssertTrue(controller.connected)
    print("Synthetic recognized-command dispatch to fake audio acknowledgement: mute max \(muteMilliseconds.max()!) ms; unmute max \(unmuteMilliseconds.max()!) ms. Not microphone recognition latency.")
  }

  func testMuteDropsPendingFinalTranscriptionAndPreservesTypedTextAndImage() async throws {
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
    await controller.setVoiceCommands(true, reactivation: true)
    await controller.startVoice()
    audio.onUtterance?(Data("Public before mute".utf8), true)
    await until { final != nil }
    audio.onVoiceCommand?(.mute)
    for _ in 0..<100 {
      audio.onUtterance?(Data("PRIVATE".utf8), true)
      audio.onTranscriptPreview?(Data("PRIVATE".utf8))
      audio.onSpeechStarted?()
    }
    final?.resume(returning: "Stale pre-mute transcript")
    try await Task.sleep(for: .milliseconds(80))
    XCTAssertEqual(transport.transcriptions, 1)
    XCTAssertTrue(transport.sentTexts.isEmpty)
    XCTAssertTrue(transport.timings.isEmpty)
    XCTAssertTrue(controller.liveTranscript.isEmpty)
    XCTAssertFalse(controller.canSendVoice)
    XCTAssertEqual(draft.value, before)
    XCTAssertEqual(try draft.bytes(image.upload, scope: ""), png)
    XCTAssertEqual(audio.finishes, 0, "Muting must discard, never flush a voice turn")
    await controller.unmuteMicrophone()
    transport.transcribe = { String(decoding: $0, as: UTF8.self) }
    audio.onUtterance?(Data("Fresh public turn".utf8), true)
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Fresh public turn"])
    XCTAssertEqual(draft.value, before)
  }

  func testLatePreviewAndReconnectCannotRestoreMutedInput() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    var preview: CheckedContinuation<String, Never>?
    transport.transcribe = { _ in await withCheckedContinuation { preview = $0 } }
    await controller.startVoice()
    audio.onTranscriptPreview?(Data([1]))
    await until { preview != nil }
    controller.toggleMute()
    transport.connected = false; transport.onChange?()
    transport.connected = true; transport.onChange?()
    preview?.resume(returning: "Stale preview")
    try await controller.refresh()
    await Task.yield()
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(audio.captureMode, .off)
    XCTAssertTrue(controller.liveTranscript.isEmpty)
    XCTAssertTrue(transport.sentTexts.isEmpty)
  }

  func testFullOffWinsOverPendingUnmuteAndDisablesReactivation() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.setVoiceCommands(true, reactivation: true)
    await controller.startVoice()
    audio.onVoiceCommand?(.mute)
    var waiting: CheckedContinuation<Void, Never>?
    audio.beforeUnmute = { await withCheckedContinuation { waiting = $0 } }
    audio.onVoiceCommand?(.unmute)
    await until { waiting != nil }
    controller.fullyStopMicrophone()
    waiting?.resume()
    await Task.yield()
    XCTAssertFalse(controller.voiceReactivationEnabled)
    XCTAssertFalse(controller.voiceMuted)
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(audio.captureMode, .off)
  }

  func testRecognitionFailureInterruptionBackgroundAndForegroundStayMuted() async {
    for failure in [AssistantVoiceControlError.failed, .interrupted] {
      let audio = AssistantTestAudio(), transport = AssistantTestTransport()
      let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
      await controller.setVoiceCommands(true, reactivation: true)
      await controller.startVoice()
      audio.onVoiceCommand?(.mute)
      audio.onVoiceControlFailure?(failure)
      XCTAssertTrue(controller.voiceActive)
      XCTAssertTrue(controller.muted)
      XCTAssertFalse(controller.voiceMuted)
      XCTAssertEqual(audio.captureMode, .off)
      XCTAssertFalse(controller.voiceControlNotice.isEmpty)
      controller.applicationForegroundChanged(false)
      controller.applicationForegroundChanged(true)
      XCTAssertEqual(audio.captureMode, .off)
      await controller.unmuteMicrophone()
      XCTAssertFalse(controller.muted)
      controller.applicationForegroundChanged(false)
      XCTAssertTrue(controller.muted)
      controller.applicationForegroundChanged(true)
      XCTAssertTrue(controller.muted)
      controller.stop()
    }
  }

  func testCapabilityAndUnmuteFailuresDoNotAcknowledgeOrStartListening() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    var confirmations = 0
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil,
      confirmMicrophoneChange: { confirmations += 1 })
    defer { controller.stop() }
    await controller.startVoice()
    audio.commandsAvailable = false
    await controller.setVoiceCommands(true, reactivation: true)
    XCTAssertFalse(controller.voiceReactivationEnabled)
    XCTAssertFalse(controller.voiceCommandsEnabled)
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(audio.captureMode, .off)
    audio.unmuteError = true
    await controller.unmuteMicrophone()
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(confirmations, 0)
    audio.unmuteError = false
    await controller.unmuteMicrophone()
    XCTAssertFalse(controller.muted)
    XCTAssertEqual(confirmations, 1)
  }

  func testPlaybackEchoIsIgnoredAndManualMuteDoesNotStopReply() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.setVoiceCommands(true, reactivation: true)
    await controller.startVoice()
    transport.addReply("Discussing ClawDad mute and ClawDad unmute")
    try await controller.refresh()
    await until { audio.played.count == 1 }
    audio.onVoiceCommand?(.mute)
    XCTAssertFalse(controller.muted)
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
    controller.toggleMute()
    await controller.unmuteMicrophone()
    XCTAssertTrue(controller.waitForSend)
    audio.onUtterance?(Data("New thought".utf8), true)
    await until { controller.liveTranscript == "New thought" }
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertTrue(transport.sentTexts.isEmpty)
    controller.sendVoiceNow(); controller.sendVoiceNow()
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["New thought"])
    XCTAssertTrue(controller.voiceActive)
  }

  private func until(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
    let deadline = ContinuousClock.now + .seconds(2)
    while !condition(), ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(2)) }
    XCTAssertTrue(condition(), file: file, line: line)
  }
}
