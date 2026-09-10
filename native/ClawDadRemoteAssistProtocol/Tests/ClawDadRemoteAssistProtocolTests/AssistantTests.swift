import XCTest

@testable import ClawDadRemoteAssistProtocol

final class AssistantTests: XCTestCase {
  func testMaximumTextIncludingWorstJSONEscapingFitsUnchangedPairedWire() throws {
    for text in [String(repeating: "🧪", count: AssistantChatLimits.textBytes / 4),
      String(repeating: "\u{0001}", count: AssistantChatLimits.textBytes)] {
      XCTAssertNil(AssistantChatLimits.problem(text))
      let data = try JSONEncoder().encode(["action": "message", "requestId": UUID().uuidString, "text": text])
      let request = AssistantWireRequest(action: .command, payload: data)
      try request.validate()
      let wire = try JSONEncoder().encode(request)
      XCTAssertLessThan(wire.count, 2 * 1024 * 1024)
      var assembler = RemoteFileAssembler()
      var assembled: Data?
      for frame in try RemoteFileFrame.split(wire) {
        if let complete = try assembler.receive(JSONEncoder().encode(frame)) { assembled = complete }
      }
      XCTAssertEqual(assembled, wire)
      let received = try JSONDecoder().decode(AssistantWireRequest.self, from: XCTUnwrap(assembled))
      let body = try JSONDecoder().decode([String: String].self, from: received.payload)
      XCTAssertEqual(body["text"], text)
      XCTAssertNotNil(AssistantChatLimits.problem(text + "x"))
    }
  }
  func testHistoryDeltaRetainsExactTextAndRejectsWrongRevision() throws {
    var body: [String: Any] = ["version": 1, "enabled": true, "paused": false, "nativeOnline": true,
      "messages": [["id": "one", "role": "user", "text": String(repeating: "X", count: 131_072), "createdAt": "now"]],
      "tasks": [], "historyRevision": "first", "historyUnchanged": false]
    let previous = try JSONDecoder().decode(AssistantSnapshot.self, from: JSONSerialization.data(withJSONObject: body))
    body["messages"] = []; body["historyUnchanged"] = true
    var next = try JSONDecoder().decode(AssistantSnapshot.self, from: JSONSerialization.data(withJSONObject: body))
    try next.retainUnchangedHistory(from: previous)
    XCTAssertEqual(next.messages, previous.messages)
    XCTAssertThrowsError(try next.retainUnchangedHistory(from: nil))
    body["historyRevision"] = "changed"
    var wrong = try JSONDecoder().decode(AssistantSnapshot.self, from: JSONSerialization.data(withJSONObject: body))
    XCTAssertThrowsError(try wrong.retainUnchangedHistory(from: previous))
  }
  func testQueuedSubmittedWorkingAndCompletedHaveDistinctPhoneLabels() throws {
    for (status, label) in [("queued", "Waiting for delivery"), ("inserted", "Draft inserted"), ("agent_queued", "Queued in agent"),
      ("submitted", "Submitted"), ("working", "Working"), ("completed", "Completed"), ("attention", "Needs attention")] {
      let record = try JSONDecoder().decode(AssistantTaskRecord.self,
        from: JSONSerialization.data(withJSONObject: ["id": "request", "action": "terminal.queue", "args": [:], "status": status]))
      XCTAssertEqual(record.displayStatus, label)
    }
  }
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
  func testQuietProcessedSpeechIsSubmittedAfterTheSpeakerPauses() {
    var detector = AssistantVoiceActivity(sampleRate: 16000)
    var utterances = 0
    for frame in 0..<130 {
      let amplitude: Float = (20..<80).contains(frame) ? 0.004 : 0.0003
      let samples = (0..<320).map { $0.isMultiple(of: 2) ? amplitude : -amplitude }
      let event = detector.consume(samples)
      if let speech = event.utterance {
        XCTAssertTrue(event.final)
        XCTAssertGreaterThan(speech.count, 16000)
        utterances += 1
      }
    }
    XCTAssertEqual(utterances, 1)
  }
  func testNaturalSyllableGapsDoNotDiscardTheWholeSentence() {
    var detector = AssistantVoiceActivity(sampleRate: 16000)
    var utterances = 0
    for frame in 0..<150 {
      // Three voiced frames followed by a brief consonant/syllable gap.
      let amplitude: Float = frame < 100 && frame % 4 != 3 ? 0.03 : 0.0003
      let event = detector.consume((0..<320).map { $0.isMultiple(of: 2) ? amplitude : -amplitude })
      if event.utterance != nil { utterances += 1 }
    }
    XCTAssertEqual(utterances, 1)
  }
  func testFinalShortTailAfterAnUploadSegmentIsPreserved() {
    var detector = AssistantVoiceActivity(sampleRate: 16000)
    var segmented = false
    while !segmented {
      let event = detector.consume([Float](repeating: 0.1, count: 320))
      segmented = event.utterance != nil && !event.final
    }
    _ = detector.consume([Float](repeating: 0.1, count: 1600))
    let tail = detector.finish()
    XCTAssertEqual(tail?.count, 1600)
    XCTAssertNil(detector.finish())
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
