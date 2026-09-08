import AVFoundation
import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

/// Opt-in: sends the explicitly prepared synthetic recording to the existing
/// local Assistant. Exercises the real controller, detector, STT, Codex and TTS.
/// Audio is decoded for a playback-ready measurement; it is not played aloud.
@MainActor
final class AssistantVoiceLiveTests: XCTestCase {
  func testRecordedSpeechAutomaticallyReachesAssistantAndLocalPlayback() async throws {
    let env = ProcessInfo.processInfo.environment
    guard env["CLAWDAD_ASSISTANT_VOICE_LIVE"] == "1", let fixture = env["CLAWDAD_VOICE_FIXTURE"],
      let output = env["CLAWDAD_VOICE_EVIDENCE"] else {
      throw XCTSkip("Requires an explicitly authorized local Assistant voice fixture")
    }
    let transport = try AssistantLiveTransport(), audio = AssistantRecordedAudio()
    let initial = try await transport.json("/v1/assistant/state")
    guard initial["coordinator"]?.object?["status"]?.string != "thinking" else {
      throw XCTSkip("Wait for the existing Assistant response to finish before this live probe")
    }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.startVoice()
    XCTAssertTrue(controller.voiceActive)
    let feed = Task { try await audio.feed(URL(fileURLWithPath: fixture)) }
    defer { feed.cancel() }
    let deadline = Date().addingTimeInterval(180)
    while transport.voiceMetrics["submitToPlaybackMs"] == nil, Date() < deadline {
      try await Task.sleep(for: .milliseconds(200))
      try await controller.refresh()
    }
    _ = try await feed.value
    let submitted = try XCTUnwrap(transport.submittedAt)
    let playback = submitted + (try XCTUnwrap(transport.voiceMetrics["submitToPlaybackMs"]?.number)) / 1000
    let lastWord = try XCTUnwrap(audio.lastRecordedSpeechAt)
    XCTAssertEqual(transport.deliveredIDs.count, 1)
    XCTAssertEqual(transport.sendAttempts, 1)
    // The same final word can already be recognized in a preview before its
    // voiced tail ends. Verify both the exact lexical deadline and Cody's
    // requested 3–5 second audio-pause window, rather than conflating them.
    let wordPause = try XCTUnwrap(transport.voiceMetrics["lastWordToSubmitMs"]?.number)
    XCTAssertGreaterThanOrEqual(wordPause, 4000)
    XCTAssertLessThan(wordPause, 5100)
    XCTAssertGreaterThanOrEqual(submitted - lastWord, 3)
    XCTAssertLessThan(submitted - lastWord, 5.1)
    XCTAssertTrue(controller.voiceActive)
    let id = try XCTUnwrap(transport.deliveredIDs.first)
    let task = try await transport.json("/v1/assistant/job?id=\(id)")["job"]?.object
    let proof: [String: AssistantValue] = [
      "kind": .string("Recorded speech through real controller and local services; playback-ready PCM, not physical iPhone audio"),
      "requestId": .string(id), "lastSpeechToSubmitMs": .number((submitted - lastWord) * 1000),
      "submitToPlaybackReadyMs": .number((playback - submitted) * 1000),
      "submitToResponseObservedMs": .number(((transport.responseAt ?? playback) - submitted) * 1000),
      "responseToPlaybackReadyMs": .number((playback - (transport.responseAt ?? playback)) * 1000),
      "coordinatorFirstResponseMs": task?["firstResponseMs"] ?? .null,
      "coordinatorQueueMs": .number(task.flatMap { value -> Double? in
        guard let start = value["startedAt"]?.string, let created = value["createdAt"]?.string else { return nil }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let a = formatter.date(from: start), let b = formatter.date(from: created) else { return nil }
        return max(0, a.timeIntervalSince(b) * 1000)
      } ?? 0),
      "voiceTiming": task?["voiceTiming"] ?? .null, "singleSubmission": .bool(true),
      "decodedReplyFrames": .number(Double(audio.replyFrames)), "callRemainedOpen": .bool(controller.voiceActive),
    ]
    try JSONEncoder().encode(proof).write(to: URL(fileURLWithPath: output))
    print("VOICE_TIMING lastSpeechToSubmitMs=\((submitted-lastWord)*1000) submitToPlaybackReadyMs=\((playback-submitted)*1000)")
  }
}

@MainActor
private final class AssistantLiveTransport: AssistantTransport {
  var onChange: (() -> Void)?
  var connected = true
  let base: URL
  let token: String
  var submittedAt: TimeInterval?
  var responseAt: TimeInterval?
  var deliveredIDs = Set<String>()
  var sendAttempts = 0
  var voiceMetrics: [String: AssistantValue] = [:]
  init() throws {
    let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ClawDad")
    let config = try JSONDecoder().decode([String: AssistantValue].self, from: Data(contentsOf: root.appendingPathComponent("Assistant/connection.json")))
    base = try XCTUnwrap(URL(string: config["baseURL"]?.string ?? ""))
    guard base.scheme == "http", base.host == "127.0.0.1" else { throw AssistantProtocolError.invalid }
    token = try String(contentsOf: root.appendingPathComponent("native-server.token"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
  }
  func bind(_ session: CloudSession) {}
  func connect() { connected = true; onChange?() }
  func close() { connected = false; onChange?() }
  func http(_ path: String, body: Data? = nil, contentType: String = "application/json") async throws -> Data {
    let url = try XCTUnwrap(URL(string: path, relativeTo: base))
    guard url.host == base.host, url.port == base.port else { throw AssistantProtocolError.invalid }
    var req = URLRequest(url: url)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue(contentType, forHTTPHeaderField: "Content-Type")
    req.httpMethod = body == nil ? "GET" : "POST"; req.httpBody = body; req.timeoutInterval = 120
    let (data, response) = try await URLSession.shared.data(for: req)
    guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw AssistantProtocolError.invalid }
    return data
  }
  func json(_ path: String) async throws -> [String: AssistantValue] {
    try JSONDecoder().decode([String: AssistantValue].self, from: await http(path))
  }
  func request(_ action: AssistantWireRequest.Action, payload: Data) async throws -> Data {
    switch action {
    case .state:
      var value = try await json("/v1/assistant/state")
      // The live probe observes only its own diagnostic replies. They stay out of Cody's chat.
      let diagnostics = try await json("/v1/assistant/diagnostics")
      let ownMessages = (diagnostics["messages"]?.array ?? []).filter { message in
        guard let id = message.object?["id"]?.string else { return false }
        return deliveredIDs.contains(id) || deliveredIDs.contains(where: { id.hasPrefix("assistant:\($0):") })
      }
      value["messages"] = .array((value["messages"]?.array ?? []) + ownMessages)
      let data = try JSONEncoder().encode(value)
      let state = try JSONDecoder().decode(AssistantSnapshot.self, from: data)
      if responseAt == nil, state.messages.contains(where: { message in deliveredIDs.contains(where: { message.id.hasPrefix("assistant:\($0):") }) }) {
        responseAt = ProcessInfo.processInfo.systemUptime
      }
      return data
    case .command:
      var body = try JSONDecoder().decode([String: AssistantValue].self, from: payload)
      if body["action"]?.string == "message", let id = body["requestId"]?.string {
        body["diagnostic"] = .bool(true)
        sendAttempts += 1
        submittedAt = submittedAt ?? ProcessInfo.processInfo.systemUptime
        deliveredIDs.insert(id)
      }
      if body["action"]?.string == "voice.timing", let id = body["requestId"]?.string,
        deliveredIDs.contains(id), let metrics = body["metrics"]?.object { voiceMetrics.merge(metrics) { _, new in new } }
      return try await http("/v1/assistant/request", body: JSONEncoder().encode(body))
    case .transcribe:
      let boundary = UUID().uuidString
      var data = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"assistant.wav\"\r\nContent-Type: audio/wav\r\n\r\n".utf8)
      data.append(payload); data.append(Data("\r\n--\(boundary)--\r\n".utf8))
      return try await http("/v1/stt/transcribe", body: data, contentType: "multipart/form-data; boundary=\(boundary)")
    case .synthesize:
      var body = try JSONDecoder().decode([String: AssistantValue].self, from: payload)
      body["source"] = .string("remote-assist"); body["project"] = .string(""); body["kind"] = .string("response")
      body["prepare"] = .bool(true); body["executionPreference"] = .string("paired-mac-first"); body["allowRemoteFallback"] = .bool(false)
      if body["voiceSelection"] == nil { body["voiceSelection"] = try await json("/v1/tts/voices")["selection"] }
      return try await http("/v1/tts/message", body: JSONEncoder().encode(body))
    case .audio: return try await http(String(decoding: payload, as: UTF8.self))
    case .imageUpload: throw AssistantProtocolError.invalid
    }
  }
}

@MainActor
private final class AssistantRecordedAudio: AssistantAudioIO {
  var onUtterance: ((Data, Bool) -> Void)?
  var onSpeechStarted: (() -> Void)?
  var onTranscriptPreview: ((Data) -> Void)?
  var onReplaced: (() -> Void)?
  var onInputLevel: ((Float) -> Void)?
  var onCaptureRecovery: ((Bool) -> Void)?
  var onCaptureFailure: ((Error) -> Void)?
  var onPlaybackStarted: (() -> Void)?
  var muted = false
  var input = AssistantListeningInput(sampleRate: 24000)
  var lastSpeechAt: TimeInterval? { input.lastSpeechAt }
  var lastRecordedSpeechAt: TimeInterval?
  var playbackReadyAt: TimeInterval?
  var replyFrames: AVAudioFrameCount = 0
  func start() async throws {}
  func stop() {}
  func stopPlayback() {}
  func resetUtterance() { input.reset() }
  func setReplyActive(_ active: Bool) { input.setReplyActive(active, at: ProcessInfo.processInfo.systemUptime) }
  func finishUtterance() { if let samples = input.finish() { onUtterance?(assistantWAV(samples, sampleRate: input.sampleRate), true) } }
  func previewUtterance() { if let samples = input.preview() { onTranscriptPreview?(assistantWAV(samples, sampleRate: input.sampleRate)) } }
  func play(_ data: Data) async throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("assistant-reply-\(UUID()).wav")
    defer { try? FileManager.default.removeItem(at: file) }
    try data.write(to: file)
    let audio = try AVAudioFile(forReading: file)
    let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: audio.processingFormat, frameCapacity: AVAudioFrameCount(audio.length)))
    try audio.read(into: buffer)
    replyFrames += buffer.frameLength
    playbackReadyAt = playbackReadyAt ?? ProcessInfo.processInfo.systemUptime
    onPlaybackStarted?()
  }
  func feed(_ file: URL) async throws {
    let audio = try AVAudioFile(forReading: file), rate = audio.processingFormat.sampleRate
    let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: audio.processingFormat, frameCapacity: AVAudioFrameCount(audio.length)))
    try audio.read(into: buffer)
    let samples = Array(UnsafeBufferPointer(start: try XCTUnwrap(buffer.floatChannelData?[0]), count: Int(buffer.frameLength))) + Array(repeating: Float(0), count: Int(rate * 5))
    input.configure(sampleRate: rate)
    let frameSize = Int(rate / 10)
    for offset in stride(from: 0, to: samples.count, by: frameSize) {
      try Task.checkCancellation()
      let event = input.consume(Array(samples[offset..<min(samples.count, offset + frameSize)]), capturedAt: ProcessInfo.processInfo.systemUptime)
      if let lastSpeechAt { lastRecordedSpeechAt = lastSpeechAt }
      if event.started { onSpeechStarted?() }
      if let utterance = event.utterance { onUtterance?(assistantWAV(utterance, sampleRate: rate), event.final) }
      if let preview = event.preview { onTranscriptPreview?(assistantWAV(preview, sampleRate: rate)) }
      try await Task.sleep(for: .milliseconds(100))
    }
  }
}
