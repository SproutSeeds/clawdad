import XCTest
@testable import ClawDad

final class RemoteAnswerApplicationGateTests: XCTestCase {
  func testFirstAnswerAppliesAndDuplicatesAreIgnored() {
    var gate = RemoteAnswerApplicationGate()

    let generation = gate.begin()

    XCTAssertNotNil(generation)
    XCTAssertEqual(gate.phase, .applying)
    XCTAssertNil(gate.begin())
    XCTAssertTrue(gate.markApplied(generation: generation!))
    XCTAssertEqual(gate.phase, .applied)
    XCTAssertNil(gate.begin())
  }

  func testCurrentFailureAllowsOneFreshAttempt() {
    var gate = RemoteAnswerApplicationGate()
    let failedGeneration = gate.begin()

    XCTAssertNotNil(failedGeneration)
    XCTAssertTrue(
      gate.resetAfterFailure(generation: failedGeneration!)
    )
    XCTAssertEqual(gate.phase, .ready)

    let retryGeneration = gate.begin()
    XCTAssertNotNil(retryGeneration)
    XCTAssertNotEqual(retryGeneration, failedGeneration)
    XCTAssertFalse(
      gate.markApplied(generation: failedGeneration!)
    )
    XCTAssertEqual(gate.phase, .applying)
    XCTAssertTrue(gate.markApplied(generation: retryGeneration!))
  }

  func testInvalidationPreventsStaleCompletionOrFailureReset() {
    var gate = RemoteAnswerApplicationGate()
    let staleGeneration = gate.begin()

    XCTAssertNotNil(staleGeneration)
    gate.invalidate()

    XCTAssertEqual(gate.phase, .invalidated)
    XCTAssertFalse(
      gate.markApplied(generation: staleGeneration!)
    )
    XCTAssertFalse(
      gate.resetAfterFailure(generation: staleGeneration!)
    )
    XCTAssertEqual(gate.phase, .invalidated)
    XCTAssertNil(gate.begin())
  }
}
