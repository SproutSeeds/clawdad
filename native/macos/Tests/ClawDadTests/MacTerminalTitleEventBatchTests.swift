import XCTest
@testable import ClawDad

final class MacTerminalTitleEventBatchTests: XCTestCase {
  func testAnimationStormCoalescesAndYieldsSmallFairBatches() {
    var batch = MacTerminalTitleEventBatch()
    for _ in 0..<10_000 { for i in 0..<12 { batch.enqueue("tty-\(i)") } }
    XCTAssertEqual(batch.take(4), (0..<4).map { "tty-\($0)" })
    batch.enqueue("tty-0")
    XCTAssertEqual(batch.take(4), (4..<8).map { "tty-\($0)" })
    XCTAssertEqual(batch.take(4), (8..<12).map { "tty-\($0)" })
    XCTAssertEqual(batch.take(4), ["tty-0"])
    XCTAssertFalse(batch.hasPending)
  }
  func testColdCatalogAndRepeatedNotificationsRemainBounded() {
    var batch = MacTerminalTitleEventBatch()
    for i in 0..<1000 { batch.enqueue("tty-\(i)") }
    XCTAssertEqual(batch.take(1000).count,128)
    XCTAssertFalse(batch.hasPending)
  }
}
