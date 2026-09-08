import XCTest
@testable import ClawDadMobile

final class AssistantListeningInputTests: XCTestCase {
  func testReplyAudioAndDelayedCallbacksNeverBecomeTranscriptions() {
    var input = AssistantListeningInput(sampleRate: 16000)
    input.setReplyActive(true, at: 1)
    for frame in 0..<300 {
      let event = input.consume([Float](repeating: 0.3, count: 1600), capturedAt: 1 + Double(frame) / 10)
      XCTAssertFalse(event.started)
      XCTAssertNil(event.utterance)
      XCTAssertNil(event.preview)
    }
    XCTAssertNil(input.finish())
    input.setReplyActive(false, at: 31)
    // A queued input callback keeps its capture timestamp after playback ends.
    XCTAssertFalse(input.acceptsInput(capturedAt: 30.9))
    XCTAssertFalse(input.acceptsInput(capturedAt: 31.2))
    var utterances = 0
    for frame in 0..<30 {
      let event = input.consume([Float](repeating: frame < 15 ? 0.04 : 0, count: 1600),
        capturedAt: 31.4 + Double(frame) / 10)
      if event.utterance != nil { utterances += 1 }
    }
    XCTAssertEqual(utterances, 1)
  }

  func testManualMuteAndReplyHoldSurviveCaptureReconfigurationIndependently() {
    var input = AssistantListeningInput(sampleRate: 48000)
    input.muted = true
    input.setReplyActive(true, at: 1)
    input.configure(sampleRate: 16000)
    input.muted = false
    XCTAssertFalse(input.acceptsInput(capturedAt: 3))
    input.muted = true
    input.setReplyActive(false, at: 4)
    XCTAssertFalse(input.acceptsInput(capturedAt: 5))
    input.muted = false
    XCTAssertTrue(input.acceptsInput(capturedAt: 5))
  }

  func testPreviewsAreThrottledAndLeaveFinalSpeechIntact() {
    var input = AssistantListeningInput(sampleRate: 16000)
    var previewSizes: [Int] = []
    var finalSize = 0
    for frame in 0..<90 {
      let event = input.consume([Float](repeating: frame < 80 ? 0.04 : 0, count: 1600),
        capturedAt: 1 + Double(frame) / 10)
      if let preview = event.preview { previewSizes.append(preview.count) }
      if let utterance = event.utterance { finalSize = utterance.count }
    }
    XCTAssertEqual(previewSizes.count, 2)
    XCTAssertGreaterThan(previewSizes[1], previewSizes[0])
    XCTAssertGreaterThan(finalSize, 8 * 16000)
    XCTAssertNil(input.finish())
  }
}
