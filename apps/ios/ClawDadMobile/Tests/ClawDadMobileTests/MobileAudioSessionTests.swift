import AVFoundation
import XCTest
@testable import ClawDadMobile

@MainActor
final class MobileAudioSessionTests: XCTestCase {
  private func silentAudio() -> Data {
    let count: UInt32 = 16_000 * 2 * 5
    var wav = Data()
    func tag(_ text: String) { wav.append(contentsOf: text.utf8) }
    func u32(_ value: UInt32) { var value = value.littleEndian; withUnsafeBytes(of: &value) { wav.append(contentsOf: $0) } }
    func u16(_ value: UInt16) { var value = value.littleEndian; withUnsafeBytes(of: &value) { wav.append(contentsOf: $0) } }
    tag("RIFF"); u32(count + 36); tag("WAVEfmt "); u32(16); u16(1); u16(1)
    u32(16_000); u32(32_000); u16(2); u16(16); tag("data"); u32(count)
    wav.append(Data(repeating: 0, count: Int(count)))
    return wav
  }

  func testFirstAudioPartAutomaticallyRetriesTemporaryActivationFailure() async throws {
    var activations = 0
    let audio = MobileAudioSession(activate: { _ in
      activations += 1
      if activations == 1 { throw URLError(.cannotOpenFile) }
    }, deactivate: {})
    let reader = MobileReadAloudController(audioSession: audio)
    defer { reader.stop() }
    let wav = silentAudio()
    reader.begin(key: "first-tap", requestId: "request", envelopeId: "envelope")
    reader.receiveChunk(requestId: "request", partIndex: 0, partCount: 1, chunkIndex: 0, chunkCount: 1,
      fileName: "response.wav", mimeType: "audio/wav", declaredBytes: wav.count, dataBase64: wav.base64EncodedString())
    reader.complete(requestId: "request", partCount: 1)
    XCTAssertEqual(reader.phase, .preparing)
    let deadline = Date().addingTimeInterval(3)
    while reader.phase == .preparing, Date() < deadline { try await Task.sleep(for: .milliseconds(20)) }
    XCTAssertEqual(reader.phase, .playing, reader.errorMessage)
    XCTAssertEqual(activations, 2)
  }

  func testStopDuringAudioStartupRetryRejectsLatePlayback() async throws {
    var activations = 0
    let reader = MobileReadAloudController(audioSession: MobileAudioSession(activate: { _ in
      activations += 1; throw URLError(.cannotOpenFile)
    }, deactivate: {}))
    let wav = silentAudio()
    reader.begin(key: "first-tap", requestId: "request", envelopeId: "envelope")
    reader.receiveChunk(requestId: "request", partIndex: 0, partCount: 1, chunkIndex: 0, chunkCount: 1,
      fileName: "response.wav", mimeType: "audio/wav", declaredBytes: wav.count, dataBase64: wav.base64EncodedString())
    reader.stop()
    try await Task.sleep(for: .milliseconds(350))
    XCTAssertEqual(reader.phase, .idle)
    XCTAssertEqual(activations, 1)
  }
  func testRecordingCancelsPreparingPlaybackAndRejectsLateAudio() throws {
    var uses: [MobileAudioSession.Use] = []
    var deactivations = 0
    let audio = MobileAudioSession(activate: { uses.append($0) }, deactivate: { deactivations += 1 })
    let reader = MobileReadAloudController(audioSession: audio)
    reader.begin(key: "old-reading", requestId: "old-request", envelopeId: "old-envelope")
    XCTAssertEqual(reader.phase, .preparing)
    let recording = try audio.beginRecording()
    XCTAssertEqual(reader.phase, .idle)
    XCTAssertEqual(reader.activeKey, "")
    reader.receiveChunk(requestId: "old-request", partIndex: 0, partCount: 1,
      chunkIndex: 0, chunkCount: 1, fileName: "late.wav", mimeType: "audio/wav",
      declaredBytes: 3, dataBase64: Data([1, 2, 3]).base64EncodedString())
    reader.complete(requestId: "old-request", partCount: 1)
    reader.stop()
    XCTAssertEqual(reader.phase, .idle)
    XCTAssertEqual(uses, [.recording])
    XCTAssertEqual(deactivations, 0, "Idle playback cleanup must leave the microphone active.")
    audio.release(recording)
    XCTAssertEqual(deactivations, 1)
  }

  func testPlayingAudioStopsBeforeCaptureActivatesAndOldReleaseIsHarmless() throws {
    var events: [String] = []
    let audio = MobileAudioSession(activate: { events.append("activate-\($0)") },
                                  deactivate: { events.append("deactivate") })
    let playback = try audio.reservePlayback { events.append("stop-player") }
    try audio.activatePlayback(playback)
    let recording = try audio.beginRecording()
    XCTAssertEqual(events, ["activate-playback", "stop-player", "deactivate", "activate-recording"])
    audio.release(playback)
    XCTAssertThrowsError(try audio.activatePlayback(playback))
    XCTAssertEqual(events.count, 4)
    audio.release(recording)
    XCTAssertEqual(events.last, "deactivate")
  }

  func testVoicePreviewCannotTakeOverAnActiveRecording() throws {
    var uses: [MobileAudioSession.Use] = []
    var deactivations = 0
    let audio = MobileAudioSession(activate: { uses.append($0) }, deactivate: { deactivations += 1 })
    let recording = try audio.beginRecording()
    let reader = MobileReadAloudController(audioSession: audio)
    reader.begin(key: "voice-preview", requestId: "preview", envelopeId: "preview-envelope")
    XCTAssertEqual(reader.phase, .failed)
    XCTAssertTrue(reader.errorMessage.contains("Finish dictation"))
    XCTAssertThrowsError(try audio.beginRecording())
    reader.stop()
    XCTAssertEqual(uses, [.recording])
    XCTAssertEqual(deactivations, 0)
    audio.release(recording)
    reader.begin(key: "voice-preview", requestId: "retry", envelopeId: "retry-envelope")
    XCTAssertEqual(reader.phase, .preparing)
    reader.stop()
  }

  func testFailedRecordingActivationLeavesSessionAvailableForRetry() throws {
    var attempts = 0
    let audio = MobileAudioSession(activate: { _ in
      attempts += 1
      if attempts == 1 { throw URLError(.unknown) }
    }, deactivate: {})
    XCTAssertThrowsError(try audio.beginRecording())
    let recording = try audio.beginRecording()
    audio.release(recording)
    let playback = try audio.reservePlayback {}
    try audio.activatePlayback(playback)
    audio.release(playback)
  }

  func testStalePlayerCallbacksCannotFailTheNewRequest() async throws {
    let reader = MobileReadAloudController(audioSession: MobileAudioSession(activate: { _ in }, deactivate: {}))
    defer { reader.stop() }
    var wav = Data()
    func tag(_ text: String) { wav.append(contentsOf: text.utf8) }
    func u32(_ value: UInt32) { var value = value.littleEndian; withUnsafeBytes(of: &value) { wav.append(contentsOf: $0) } }
    func u16(_ value: UInt16) { var value = value.littleEndian; withUnsafeBytes(of: &value) { wav.append(contentsOf: $0) } }
    tag("RIFF"); u32(3236); tag("WAVEfmt "); u32(16); u16(1); u16(1)
    u32(16_000); u32(32_000); u16(2); u16(16); tag("data"); u32(3200)
    wav.append(Data(repeating: 0, count: 3200))
    let stalePlayer = try AVAudioPlayer(data: wav)
    reader.begin(key: "new-reading", requestId: "new", envelopeId: "new-envelope")
    XCTAssertEqual(reader.phase, .preparing, reader.errorMessage)
    reader.audioPlayerDecodeErrorDidOccur(stalePlayer, error: URLError(.cannotDecodeContentData))
    reader.audioPlayerDidFinishPlaying(stalePlayer, successfully: false)
    for _ in 0..<20 { await Task.yield() }
    XCTAssertEqual(reader.phase, .preparing, reader.errorMessage)
    XCTAssertTrue(reader.errorMessage.isEmpty)
  }
}
