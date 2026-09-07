import XCTest

@testable import ClawDadRemoteAssistProtocol

final class AssistantTests: XCTestCase {
  func testBackgroundCallSupportMustBeExplicitBeforeSendingStartToAnOlderMac() throws {
    var value: [String: Any] = ["version": 1, "enabled": false, "paused": false,
      "nativeOnline": true, "messages": [], "tasks": []]
    func decode() throws -> AssistantSnapshot {
      try JSONDecoder().decode(AssistantSnapshot.self, from: JSONSerialization.data(withJSONObject: value))
    }
    XCTAssertFalse(try decode().supportsBackgroundCalls)
    value["conversationMode"] = "terminal"
    XCTAssertFalse(try decode().supportsBackgroundCalls)
    value["conversationMode"] = "background"
    XCTAssertTrue(try decode().supportsBackgroundCalls)
  }
  func testQuietRoomDoesNotCreateAnUtterance() {
    var detector = AssistantVoiceActivity(sampleRate: 16000)
    for _ in 0..<600 {
      let event = detector.consume([Float](repeating: 0.001, count: 1600))
      XCTAssertFalse(event.started)
      XCTAssertNil(event.utterance)
    }
  }
  func testPreRollSpeechAndSilenceProduceOneCompleteUtterance() {
    var detector = AssistantVoiceActivity(sampleRate: 16000)
    var starts = 0
    var utterances = 0
    for i in 0..<30 {
      let event = detector.consume([Float](repeating: (5..<15).contains(i) ? 0.1 : 0, count: 1600))
      if event.started { starts += 1 }
      if let values = event.utterance {
        utterances += 1
        XCTAssertTrue(event.final)
        XCTAssertGreaterThan(values.count, 16000)
      }
    }
    XCTAssertEqual(starts, 1)
    XCTAssertEqual(utterances, 1)
  }
  func testLongThoughtSegmentsAreNotMarkedFinalUntilTheSpeakerPauses() {
    var detector = AssistantVoiceActivity(sampleRate: 16000)
    var segments = 0
    var finals = 0
    for i in 0..<410 {
      let event = detector.consume([Float](repeating: i < 400 ? 0.1 : 0, count: 1600))
      if let samples = event.utterance {
        segments += 1
        XCTAssertLessThan(assistantWAV(samples, sampleRate: 16000).count, 1024 * 1024)
        if event.final { finals += 1 }
      }
    }
    XCTAssertGreaterThanOrEqual(segments, 3)
    XCTAssertEqual(finals, 1)
  }
  func testWAVFormatAndInvalidSampleRates() {
    let data = assistantWAV([Float](repeating: 0.1, count: 48000), sampleRate: 48000)
    XCTAssertEqual(data.count, 32044)
    XCTAssertEqual(String(data: data.prefix(4), encoding: .utf8), "RIFF")
    XCTAssertTrue(assistantWAV([0.1], sampleRate: 0).isEmpty)
    XCTAssertTrue(assistantWAV([0.1], sampleRate: .nan).isEmpty)
  }
  func testMutingFinishesTheCurrentThoughtExactlyOnce() {
    var detector = AssistantVoiceActivity(sampleRate: 16000)
    for _ in 0..<200 { _ = detector.consume([Float](repeating: 0.1, count: 1600)) }
    XCTAssertNotNil(detector.finish())
    XCTAssertNil(detector.finish())
    XCTAssertFalse(detector.speaking)
  }
  func testPairedProtocolRejectsUnknownActionsAndOversizedUploads() throws {
    XCTAssertThrowsError(
      try JSONDecoder().decode(
        AssistantWireRequest.self,
        from: Data(
          "{\"id\":\"\(UUID().uuidString)\",\"action\":\"native.poll\",\"payload\":\"\"}".utf8)))
    XCTAssertThrowsError(
      try AssistantWireRequest(
        action: .transcribe, payload: Data(repeating: 0, count: 1024 * 1024 + 1)
      ).validate())
  }
}
