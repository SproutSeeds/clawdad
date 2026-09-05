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
}
