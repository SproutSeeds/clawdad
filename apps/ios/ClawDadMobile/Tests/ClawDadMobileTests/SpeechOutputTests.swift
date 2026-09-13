import AVFoundation
import ClawDadRemoteAssistProtocol
import Foundation
import XCTest
@testable import ClawDadMobile

@MainActor
final class SpeechOutputTests: XCTestCase {
  func testPreferenceDefaultsPersistenceRevisionAndStableRemoteReceipts() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("output.json")
    let preference = SpeechOutputPreference(url: url)
    XCTAssertEqual(preference.boostDB, 0)
    XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    let voiceKey = "speech-fixture-voice-\(UUID().uuidString)"
    UserDefaults.standard.set("af_heart", forKey: voiceKey)
    defer { UserDefaults.standard.removeObject(forKey: voiceKey) }
    for db in [2.0, 3, 4, 10, 20, 0] { try preference.set(db) }
    let reopened = SpeechOutputPreference(url: url)
    XCTAssertEqual(reopened.boostDB, 0); XCTAssertEqual(reopened.revision, 6)
    let pending: [String: AssistantValue] = ["requestId": .string("set-six"), "boostDB": .number(6), "expectedRevision": .number(6)]
    XCTAssertEqual(reopened.applyRemote(pending)["status"], .string("applied"))
    XCTAssertEqual(reopened.boostDB, 6); XCTAssertEqual(reopened.revision, 7)
    XCTAssertEqual(reopened.applyRemote(pending)["status"], .string("applied"))
    XCTAssertEqual(reopened.revision, 7)
    XCTAssertThrowsError(try reopened.set(8, requestID: "set-six", expectedRevision: 6))
    XCTAssertThrowsError(try reopened.set(2, expectedRevision: 6))
    for value in [Double.nan, .infinity, -1, 21, 1.5] { XCTAssertThrowsError(try reopened.set(value)) }
    XCTAssertEqual(UserDefaults.standard.string(forKey: voiceKey), "af_heart")
  }
  func testPersistenceFailureAndCorruptRecordStayHonest() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    try Data("not a directory".utf8).write(to: root)
    let preference = SpeechOutputPreference(url: root.appendingPathComponent("output.json"))
    XCTAssertThrowsError(try preference.set(6))
    XCTAssertEqual(preference.boostDB, 0); XCTAssertEqual(preference.revision, 0)
    XCTAssertFalse(preference.error.isEmpty)
    let corrupt = SpeechOutputPreference(url: root)
    XCTAssertEqual(corrupt.boostDB, 0); XCTAssertFalse(corrupt.error.isEmpty)
  }
  func testDSPZeroGainNoiseSilenceAndSmoothChanges() {
    let rate = 24000.0, dsp = SpeechOutputDSP(rate: rate)
    let input = (0..<24000).map { 0.01 * sin(Double($0) * 0.031) }
    var output: [Double] = []
    for i in 0..<(input.count + dsp.latencyFrames) {
      let x = i < input.count ? input[i] : 0
      output.append(dsp.process(x, x, boostDB: 0).0)
    }
    XCTAssertEqual(Array(output.dropFirst(dsp.latencyFrames)), input)
    let noise = SpeechOutputDSP(rate: rate, boostDB: 20)
    for _ in 0..<24000 { XCTAssertLessThanOrEqual(abs(noise.process(1e-5, 0, boostDB: 20).0), 1e-5 + 1e-12) }
    let changing = SpeechOutputDSP(rate: rate)
    var previous = 0.0, jump = 0.0, peak = 0.0
    for i in 0..<48000 {
      let x = 0.9 * sin(Double(i) * 0.031)
      let y = changing.process(x, x * 0.5, boostDB: i > 12000 ? 20 : 0)
      XCTAssertEqual(y.1, y.0 * 0.5, accuracy: 1e-12)
      jump = max(jump, abs(y.0 - previous)); peak = max(peak, abs(y.0)); previous = y.0
    }
    XCTAssertLessThanOrEqual(peak, SpeechOutputDSP.ceiling + 1e-10)
    XCTAssertLessThan(jump, 0.1); XCTAssertGreaterThan(changing.maximumReductionDB, 15)
  }
  func testNativePlayerPauseResumeAndLivePreferenceDoesNotRestartOrChangeOtherPreferences() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let preference = SpeechOutputPreference(url: root.appendingPathComponent("output.json"))
    let data = assistantWAV(Array(repeating: Float(0), count: 16000), sampleRate: 16000)
    let player = try SpeechOutputPlayer(data: data, preference: preference)
    player.volume = 0
    defer { player.stop() }
    XCTAssertTrue(player.play())
    try await Task.sleep(for: .milliseconds(200))
    player.pause()
    try await Task.sleep(for: .milliseconds(30)) // Let the 5 ms output fade settle.
    let held = player.currentTime
    try preference.set(20)
    try await Task.sleep(for: .milliseconds(80))
    XCTAssertEqual(player.currentTime, held)
    XCTAssertTrue(player.play())
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertGreaterThan(player.currentTime, held)
    XCTAssertEqual(preference.boostDB, 20)
  }
  func testOptionalCompleteFixtureRenderUsesProductionSwiftDSP() throws {
    guard let inputPath = ProcessInfo.processInfo.environment["CLAWDAD_SPEECH_FIXTURE_INPUT"],
      let outputPath = ProcessInfo.processInfo.environment["CLAWDAD_SPEECH_FIXTURE_OUTPUT"] else {
      throw XCTSkip("Opt in with disposable raw PCM fixture paths; never changes the real preference.")
    }
    let data = try Data(contentsOf: URL(fileURLWithPath: inputPath))
    let input = data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    var records: [[String: Double]] = []
    for db in [0.0, 2, 3, 4, 6, 10, 20] {
      let dsp = SpeechOutputDSP(rate: 24000, boostDB: db)
      var output = [Float](repeating: 0, count: input.count + dsp.latencyFrames)
      let began = ProcessInfo.processInfo.systemUptime
      for i in output.indices {
        let x = i < input.count ? Double(input[i]) : 0
        output[i] = Float(dsp.process(x, x, boostDB: db).0)
      }
      let elapsed = ProcessInfo.processInfo.systemUptime - began
      try output.withUnsafeBytes { try Data($0).write(to: URL(fileURLWithPath: outputPath + "-\(Int(db)).f32")) }
      records.append(["requestedDB": db, "processingSeconds": elapsed, "maximumReductionDB": dsp.maximumReductionDB, "latencyMs": Double(dsp.latencyFrames) / 24])
    }
    try JSONSerialization.data(withJSONObject: records, options: .prettyPrinted).write(to: URL(fileURLWithPath: outputPath + "-timing.json"))
  }

  func testReplacementSpeechResolvesOldCompletionAcrossSameAndDifferentRates() async throws {
    for rate in [16000, 24000] {
      let first = try SpeechOutputPlayer(data: assistantWAV(Array(repeating: Float(0), count: 32000), sampleRate: 16000))
      let second = try SpeechOutputPlayer(data: assistantWAV(Array(repeating: Float(0), count: rate), sampleRate: Double(rate)))
      first.volume = 0; second.volume = 0
      defer { first.stop(); second.stop() }
      var outcome: Bool?
      first.onCompletion = { outcome = $0 }
      XCTAssertTrue(first.play())
      try await Task.sleep(for: .milliseconds(150))
      XCTAssertTrue(second.play())
      try await Task.sleep(for: .milliseconds(150))
      XCTAssertEqual(outcome, false, "Replaced speech must release its waiting controller")
      XCTAssertGreaterThan(second.currentTime, 0)
    }
  }

  func testOptionalCompleteLocalEngineChunksUseNativeOutputAndLeaveSourcesUntouched() async throws {
    guard let path = ProcessInfo.processInfo.environment["CLAWDAD_SPEECH_ENGINE_FIXTURES"] else {
      throw XCTSkip("Opt in with the retained local-engine audio fixture directory. Output stays muted.")
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let preference = SpeechOutputPreference(url: root.appendingPathComponent("output.json"))
    for engine in ["current-heart", "pocket", "kitten"] {
      for chunk in 0...1 {
        let url = URL(fileURLWithPath: path).appendingPathComponent("\(engine)-\(chunk).wav")
        let original = try Data(contentsOf: url)
        let player = try SpeechOutputPlayer(data: original, preference: preference)
        player.volume = 0
        let complete = expectation(description: "\(engine) chunk \(chunk) completes")
        player.onCompletion = { success in XCTAssertTrue(success); complete.fulfill() }
        XCTAssertTrue(player.play())
        try await Task.sleep(for: .milliseconds(300))
        try preference.set(chunk == 0 ? 6 : 20)
        await fulfillment(of: [complete], timeout: player.duration + 5)
        XCTAssertEqual(player.currentTime, player.duration, accuracy: 0.02)
        player.stop()
        XCTAssertEqual(try Data(contentsOf: url), original)
      }
    }
  }

  func testCompletedChunkCannotLeaveAFadeBlockingTheNextChunk() async throws {
    for chunk in 0..<3 {
      let player = try SpeechOutputPlayer(data: assistantWAV(Array(repeating: Float(0), count: 3200), sampleRate: 16000))
      player.volume = 0
      let complete = expectation(description: "short chunk \(chunk) completes")
      player.onCompletion = { success in XCTAssertTrue(success); complete.fulfill() }
      XCTAssertTrue(player.play())
      await fulfillment(of: [complete], timeout: 2)
      XCTAssertEqual(player.currentTime, player.duration, accuracy: 0.02)
      player.stop()
    }
  }
}
