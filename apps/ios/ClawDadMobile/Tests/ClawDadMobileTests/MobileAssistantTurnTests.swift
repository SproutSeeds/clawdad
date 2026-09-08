import ClawDadRemoteAssistProtocol
import Foundation
import XCTest
@testable import ClawDadMobile

@MainActor
final class MobileAssistantTurnTests: XCTestCase {
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
    XCTAssertEqual(controller.status, "Microphone muted")
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
    let controller = MobileAssistantController(connection: transport, audio: audio)
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
    let controller = MobileAssistantController(connection: transport, audio: audio)
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
    let controller = MobileAssistantController(connection: transport, audio: audio)
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
private final class AssistantTestAudio: AssistantAudioIO {
  var onUtterance: ((Data, Bool) -> Void)?
  var onSpeechStarted: (() -> Void)?
  var onTranscriptPreview: ((Data) -> Void)?
  var onReplaced: (() -> Void)?
  var onInputLevel: ((Float) -> Void)?
  var onCaptureRecovery: ((Bool) -> Void)?
  var onCaptureFailure: ((Error) -> Void)?
  var muted = false
  var replyActive = false
  var played: [Data] = []
  var playbackStops = 0
  private var clip: CheckedContinuation<Void, Error>?
  func start() async throws { muted = false }
  func setReplyActive(_ active: Bool) { replyActive = active }
  func play(_ data: Data) async throws {
    try await withCheckedThrowingContinuation { clip = $0; played.append(data) }
  }
  func completeClip() { let done = clip; clip = nil; done?.resume() }
  func stopPlayback() { playbackStops += 1; let done = clip; clip = nil; done?.resume(throwing: CancellationError()) }
  func resetUtterance() {}
  func finishUtterance() {}
  func stop() { stopPlayback() }
}

@MainActor
private final class AssistantTestTransport: AssistantTransport {
  var onChange: (() -> Void)?
  var connected = true
  let requestID = UUID().uuidString.lowercased()
  var messages: [[String: Any]] = []
  var commands: [String] = []
  var sentTexts: [String] = []
  var transcriptions = 0
  var syntheses = 0
  var beforeSynthesis: (() async -> Void)?
  var synthesis: (() -> [String: Any])?
  var transcribe: (Data) async -> String = { _ in "" }
  func bind(_ session: CloudSession) {}
  func connect() {}
  func close() { connected = false }
  func addReply(_ text: String, item: String = "answer") {
    messages.append(["id": "assistant:\(requestID):\(item)", "role": "assistant", "text": text, "createdAt": "2026-09-08T00:00:00Z"])
  }
  func request(_ action: AssistantWireRequest.Action, payload: Data) async throws -> Data {
    switch action {
    case .state: return try snapshot()
    case .command:
      let body = try JSONDecoder().decode([String: AssistantValue].self, from: payload)
      commands.append(body["action"]?.string ?? "")
      if body["action"]?.string == "message", let text = body["text"]?.string {
        sentTexts.append(text)
        messages.append(["id": body["requestId"]!.string!, "role": "user", "text": text, "createdAt": "2026-09-08T00:00:00Z"])
      }
      return try snapshot()
    case .transcribe:
      transcriptions += 1
      return try JSONSerialization.data(withJSONObject: ["text": await transcribe(payload)])
    case .synthesize:
      syntheses += 1
      await beforeSynthesis?()
      if let synthesis { return try JSONSerialization.data(withJSONObject: synthesis()) }
      return try JSONSerialization.data(withJSONObject: ["audio": ["state": "ready", "parts": [["url": "one"], ["url": "two"]]]])
    case .audio: return payload
    }
  }
  private func snapshot() throws -> Data {
    try JSONSerialization.data(withJSONObject: [
      "version": 1, "conversationMode": "background", "enabled": true, "paused": false,
      "nativeOnline": true, "messages": messages, "tasks": [],
      "catalog": ["revision": 1, "tabs": []],
    ])
  }
}
