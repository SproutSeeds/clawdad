import XCTest
@testable import ClawDad

final class NativeManagedServiceTests: XCTestCase {
  private func child() throws -> Process {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/sleep")
    process.arguments = ["60"]
    try process.run()
    return process
  }

  func testExitedOwnedChildRecoversOnceAndHealthyChildIsPreserved() throws {
    var time: TimeInterval = 0
    var children: [Process] = []
    let service = NativeManagedService(label: #function, interval: 3600, clock: { time })
    defer { service.stop() }
    let unrelated = try child()
    defer { NativeManagedProcessTerminator.stop(unrelated) }
    try service.start { let p = try self.child(); children.append(p); return p }
    try service.start { XCTFail("Starting twice must not create another child"); return try self.child() }
    service.check(); XCTAssertEqual(children.count, 1)
    NativeManagedProcessTerminator.stop(children[0])
    service.check(); XCTAssertEqual(children.count, 1, "Restart must respect its backoff")
    time = 1; service.check()
    XCTAssertEqual(children.count, 2)
    XCTAssertTrue(children[1].isRunning)
    XCTAssertTrue(unrelated.isRunning)
    time = 500; service.check(); XCTAssertEqual(children.count, 2)
    service.stop(); XCTAssertFalse(children[1].isRunning)
    time = 1000; service.check(); XCTAssertEqual(children.count, 2, "Quit disables recovery")
  }

  func testRepeatedCrashesAndFailedLaunchBackOffAndStopCancelsPendingRetry() throws {
    var time: TimeInterval = 0
    var attempts = 0
    var children: [Process] = []
    let service = NativeManagedService(label: #function, interval: 3600, clock: { time })
    defer { service.stop() }
    try service.start {
      attempts += 1
      if attempts == 2 { throw CocoaError(.fileReadNoPermission) }
      let p = try self.child(); children.append(p); return p
    }
    NativeManagedProcessTerminator.stop(children[0]); service.check()
    time = 1; service.check(); XCTAssertEqual(attempts, 2)
    time = 2; service.check(); XCTAssertEqual(attempts, 2)
    time = 3; service.check(); XCTAssertEqual(attempts, 3)
    NativeManagedProcessTerminator.stop(children[1]); service.check()
    time = 6; service.check(); XCTAssertEqual(attempts, 3)
    service.stop()
    time = 100; service.check(); XCTAssertEqual(attempts, 3)
  }

  func testRealTimerRecoversDisposableChildAndRemainsStoppedAfterQuit() throws {
    let recovered = expectation(description: "Owned fixture recovered automatically")
    let lock = NSLock()
    var children: [Process] = []
    let service = NativeManagedService(label: #function, interval: 0.05)
    defer { service.stop() }
    let started = Date()
    try service.start {
      let p = try self.child()
      lock.lock(); children.append(p); let count = children.count; lock.unlock()
      if count == 2 { recovered.fulfill() }
      return p
    }
    lock.lock(); let original = children[0]; lock.unlock()
    NativeManagedProcessTerminator.stop(original)
    wait(for: [recovered], timeout: 5)
    print("Disposable managed-service crash-to-recovery: \(Date().timeIntervalSince(started)) seconds")
    service.stop()
    service.check()
    lock.lock(); let after = children; lock.unlock()
    XCTAssertEqual(after.count, 2)
    XCTAssertTrue(after.allSatisfy { !$0.isRunning })
  }
}
