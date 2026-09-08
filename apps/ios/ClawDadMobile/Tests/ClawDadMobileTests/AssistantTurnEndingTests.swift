import XCTest
@testable import ClawDadMobile

final class AssistantTurnEndingTests: XCTestCase {
  func testFourSecondsFromNewWordsAndRepeatedPartialsDoNotExtendIt() {
    var turn = AssistantTurnEnding()
    turn.speechStarted(at: 0)
    XCTAssertTrue(turn.transcript("Check this project", capturedAt: 1, receivedAt: 1.4))
    for time in stride(from: 2.0, through: 20, by: 0.5) {
      XCTAssertFalse(turn.transcript("CHECK this project...", capturedAt: time, receivedAt: time))
      XCTAssertFalse(turn.transcript("Check this", capturedAt: time, receivedAt: time))
    }
    XCTAssertFalse(turn.shouldFinish(at: 4.99, pause: 4, thinkAloud: false, activeSpeech: false, transcriptionPending: false))
    XCTAssertTrue(turn.shouldFinish(at: 5, pause: 4, thinkAloud: false, activeSpeech: false, transcriptionPending: false))
  }
  func testResumedSpeechAndNewWordsRestartThePauseButRepeatedNoiseOnsetsAreBounded() {
    var turn = AssistantTurnEnding()
    turn.speechStarted(at: 0)
    turn.transcript("First thought", capturedAt: 1, receivedAt: 1)
    turn.speechStarted(at: 3)
    XCTAssertEqual(turn.deadline(pause: 4), 5)
    turn.transcript("First thought and the rest", capturedAt: 4, receivedAt: 4.4)
    XCTAssertEqual(turn.deadline(pause: 4), 8)
    for time in 5...30 { turn.speechStarted(at: Double(time)) }
    XCTAssertEqual(turn.deadline(pause: 4), 8, "Unconfirmed noise cannot extend every callback")
  }
  func testOngoingSpeechNeedsAFreshWordCheckpointBeforeNoiseCanBeIgnored() {
    var turn = AssistantTurnEnding()
    turn.speechStarted(at: 0)
    turn.transcript("Check the project", capturedAt: 1, receivedAt: 1.5)
    XCTAssertFalse(turn.shouldFinish(at: 5, pause: 4, thinkAloud: false, activeSpeech: true, transcriptionPending: false))
    turn.transcript("Check the project", capturedAt: 5, receivedAt: 5.3)
    XCTAssertTrue(turn.shouldFinish(at: 5.3, pause: 4, thinkAloud: false, activeSpeech: true, transcriptionPending: false))
    turn.transcript("Check the project and continue", capturedAt: 5.5, receivedAt: 6)
    XCTAssertFalse(turn.shouldFinish(at: 6, pause: 4, thinkAloud: false, activeSpeech: true, transcriptionPending: false))
  }
  func testThinkAloudOnlyEndsOnSendAndStalledActiveSpeechIsNeverSilence() {
    var turn = AssistantTurnEnding()
    turn.speechStarted(at: 1)
    turn.transcript("Keep this thought", capturedAt: 2, receivedAt: 2)
    XCTAssertFalse(turn.shouldFinish(at: 3600, pause: 4, thinkAloud: true, activeSpeech: false, transcriptionPending: false))
    XCTAssertFalse(turn.shouldFinish(at: 100, pause: 4, thinkAloud: false, activeSpeech: true, transcriptionPending: true))
    XCTAssertFalse(turn.shouldFinish(at: 100, pause: 4, thinkAloud: false, activeSpeech: false, transcriptionPending: true), "Final words supply the correct captured-time deadline")
  }
  func testLateFinalWordsUseCaptureTimeWithoutAddingAnotherPause() {
    var turn = AssistantTurnEnding()
    turn.speechStarted(at: 0)
    turn.transcript("Preserve the", capturedAt: 1, receivedAt: 1.4)
    turn.transcript("Preserve the final words", capturedAt: 2, receivedAt: 10)
    XCTAssertEqual(turn.deadline(pause: 4), 6)
    XCTAssertTrue(turn.shouldFinish(at: 10, pause: 4, thinkAloud: false, activeSpeech: false, transcriptionPending: false))
  }
}
