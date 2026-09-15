import XCTest
@testable import ClawDad

final class MacCodexAccountAdmissionTests: XCTestCase {
  func testLegacySignInRespectsDurableTransitionAndRecovery() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appendingPathComponent("switch-state.json")
    XCTAssertNoThrow(try MacCodexAccountAdmission.requireNoTransition(at: file))
    func save(_ text: String) throws { try Data(text.utf8).write(to: file, options: .atomic) }
    try save(#"{"version":1,"revision":1,"epoch":0,"activeOperationId":"test","operations":{"test":{"fenced":true}}}"#)
    XCTAssertThrowsError(try MacCodexAccountAdmission.requireNoTransition(at: file))
    try save(#"{"version":1,"revision":2,"epoch":0,"activeOperationId":"test","operations":{"test":{"fenced":false}}}"#)
    XCTAssertNoThrow(try MacCodexAccountAdmission.requireNoTransition(at: file))
    try save(#"{"version":1,"revision":2,"epoch":0,"activeOperationId":"missing","operations":{}}"#)
    XCTAssertThrowsError(try MacCodexAccountAdmission.requireNoTransition(at: file))
    try save("partial write")
    XCTAssertThrowsError(try MacCodexAccountAdmission.requireNoTransition(at: file))
  }
}
