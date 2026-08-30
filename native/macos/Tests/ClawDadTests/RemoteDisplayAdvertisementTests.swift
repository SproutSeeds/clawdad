import XCTest
@testable import ClawDad

final class RemoteDisplayAdvertisementTests: XCTestCase {
  func testRetryScheduleIsBoundedAcrossFirstEightSeconds() {
    XCTAssertEqual(
      RemoteDisplayAdvertisementPolicy.retryOffsetsNanoseconds,
      [
        250_000_000,
        1_000_000_000,
        3_000_000_000,
        8_000_000_000,
      ]
    )
    XCTAssertEqual(
      RemoteDisplayAdvertisementPolicy.retryIntervalsNanoseconds.count,
      4
    )
  }

  func testNewAdvertisementInvalidatesEarlierRetryBurst() {
    var gate = RemoteDisplayAdvertisementGate()
    let firstGeneration = gate.begin()
    let secondGeneration = gate.begin()

    XCTAssertFalse(gate.isCurrent(firstGeneration))
    XCTAssertTrue(gate.isCurrent(secondGeneration))
  }

  func testClosedSessionInvalidatesPendingRetries() {
    var gate = RemoteDisplayAdvertisementGate()
    let generation = gate.begin()

    gate.invalidate()

    XCTAssertFalse(gate.isCurrent(generation))
  }
}
