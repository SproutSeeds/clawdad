import XCTest
@testable import ClawDad

final class MacDictationTargetRegistryTests: XCTestCase {
  private let now = Date(timeIntervalSince1970: 1000)

  func testCapturePreservesOriginalInputAndNoInputRemainsClipboardOnly() {
    var targets = MacDictationTargetRegistry<String>()
    targets.remember(.init(value: "field-a", generation: 3, expiresAt: now.addingTimeInterval(60), requiresTerminalIdentity: false, terminalIdentity: nil), token: "a")
    targets.remember(.init(value: "field-b", generation: 3, expiresAt: now.addingTimeInterval(60), requiresTerminalIdentity: false, terminalIdentity: nil), token: "a")
    targets.remember(.init(value: nil, generation: 3, expiresAt: now.addingTimeInterval(60), requiresTerminalIdentity: false, terminalIdentity: nil), token: "none")
    XCTAssertEqual(targets.resolve(token: "a", generation: 3, terminalIdentity: nil, now: now) { $0 == "field-a" }, "field-a")
    XCTAssertNil(targets.resolve(token: "a", generation: 3, terminalIdentity: nil, now: now) { $0 == "field-b" })
    XCTAssertNil(targets.resolve(token: "none", generation: 3, terminalIdentity: nil, now: now) { _ in XCTFail("Never search for a new input"); return true })
  }

  func testClosedChangedExpiredAndReconnectedTargetsCannotReceiveDictation() {
    var targets = MacDictationTargetRegistry<String>()
    targets.remember(.init(value: "field", generation: 1, expiresAt: now.addingTimeInterval(60), requiresTerminalIdentity: false, terminalIdentity: nil), token: "a")
    XCTAssertNil(targets.resolve(token: "a", generation: 1, terminalIdentity: nil, now: now) { _ in false })
    XCTAssertNil(targets.resolve(token: "a", generation: 2, terminalIdentity: nil, now: now) { _ in true })
    XCTAssertNil(targets.resolve(token: "a", generation: 1, terminalIdentity: nil, now: now.addingTimeInterval(61)) { _ in true })
    let reconnected = MacDictationTargetRegistry<String>()
    XCTAssertNil(reconnected.resolve(token: "a", generation: 1, terminalIdentity: nil, now: now) { _ in true })
  }

  func testTerminalNeedsTheSameTabEvenWhenAccessibilityElementIsShared() {
    var targets = MacDictationTargetRegistry<String>()
    targets.remember(.init(value: "terminal-text-area", generation: 1, expiresAt: now.addingTimeInterval(60), requiresTerminalIdentity: true, terminalIdentity: "tty-a"), token: "a")
    XCTAssertEqual(targets.resolve(token: "a", generation: 1, terminalIdentity: "tty-a", now: now) { _ in true }, "terminal-text-area")
    XCTAssertNil(targets.resolve(token: "a", generation: 1, terminalIdentity: "tty-b", now: now) { _ in true })
    XCTAssertNil(targets.resolve(token: "a", generation: 1, terminalIdentity: nil, now: now) { _ in true })
    targets.remember(.init(value: "unidentified-terminal", generation: 1, expiresAt: now.addingTimeInterval(60), requiresTerminalIdentity: true, terminalIdentity: nil), token: "unknown")
    XCTAssertNil(targets.resolve(token: "unknown", generation: 1, terminalIdentity: nil, now: now) { _ in true })
  }

  func testFailedCaptureIsDistinctFromAnIntentionalClipboardCapture() {
    var targets = MacDictationTargetRegistry<String>()
    targets.remember(.init(value: "field", generation: 1, expiresAt: now.addingTimeInterval(60),
      requiresTerminalIdentity: true, terminalIdentity: "tab", failure: "Capture failed"), token: "failed")
    targets.remember(.init(value: nil, generation: 1, expiresAt: now.addingTimeInterval(60),
      requiresTerminalIdentity: false, terminalIdentity: nil), token: "clipboard")
    XCTAssertEqual(targets.capture(for: "failed")?.failure, "Capture failed")
    XCTAssertNil(targets.capture(for: "clipboard")?.failure)
    XCTAssertNil(targets.resolve(token: "failed", generation: 1, terminalIdentity: "tab", now: now) { _ in true })
  }

  @MainActor func testTemporaryReadFailureRecoversOnlyTheOriginalInput() async {
    var reads = 0, pauses = 0
    let result = await macRecoverTerminalInputIdentity(expected: "original", isCurrent: { true }, read: {
      reads += 1
      if reads < 3 { throw MacTerminalTabFailure(code: "layout_unavailable", message: "Updating", state: nil) }
      return "original"
    }, pause: { _ in pauses += 1 })
    XCTAssertEqual(result, "original")
    XCTAssertEqual(reads, 3)
    XCTAssertEqual(pauses, 2)
  }

  @MainActor func testRecoveryNeverAdoptsAMissingOrDifferentTarget() async {
    let missing = await macRecoverTerminalInputIdentity(expected: nil, isCurrent: { true }, read: {
      XCTFail("Never learn a later focus for an unidentified capture")
      return "later"
    })
    XCTAssertNil(missing)
    var reads = 0
    let changed = await macRecoverTerminalInputIdentity(expected: "original", isCurrent: { true }, read: {
      reads += 1
      return "different-tab"
    }, pause: { _ in XCTFail("A changed target is not a transient read failure") })
    XCTAssertNil(changed)
    XCTAssertEqual(reads, 1)
  }

  @MainActor func testInputChangeAndPermissionDenialStopRecovery() async {
    var current = true, reads = 0
    let changed = await macRecoverTerminalInputIdentity(expected: "original", isCurrent: { current }, read: {
      reads += 1
      throw MacTerminalTabFailure(code: "layout_unavailable", message: "Updating", state: nil)
    }, pause: { _ in current = false })
    XCTAssertNil(changed)
    XCTAssertEqual(reads, 1)
    let denied = await macRecoverTerminalInputIdentity(expected: "original", isCurrent: { true }, read: {
      throw MacTerminalTabFailure(code: "automation_denied", message: "Denied", state: nil)
    }, pause: { _ in XCTFail("Do not retry a permission failure") })
    XCTAssertNil(denied)
  }
}
