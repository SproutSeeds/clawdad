import XCTest
@testable import ClawDadMobile

final class MobileCrashDiagnosticsTests: XCTestCase {
  func testSystemEvidenceKeepsSymbolicationAndDropsPrivateStrings() throws {
    let uuid = UUID().uuidString
    let fixture: [String: Any] = ["transcript": "PRIVATE WORDS", "crashDiagnostics": [[
      "diagnosticMetaData": ["signal": 6, "exceptionCode": 0, "appBuildVersion": "92", "exceptionReason": "PRIVATE WORDS", "appVersion": "0.7.0"],
      "callStackTree": ["callStacks": [["threadAttributed": true, "callStackRootFrames": [[
        "binaryUUID": uuid, "offsetIntoBinaryTextSegment": 1234, "sampleCount": 1,
        "binaryName": "/PRIVATE/PATH", "subFrames": [["binaryUUID": uuid, "address": 5678]]]]]]]]]]
    let safe = try XCTUnwrap(MobileCrashDiagnostics.sanitized(fixture))
    let data = try JSONSerialization.data(withJSONObject: safe)
    let text = String(decoding: data, as: UTF8.self)
    XCTAssertFalse(text.contains("PRIVATE")); XCTAssertFalse(text.contains("exceptionReason"))
    XCTAssertTrue(text.contains(uuid)); XCTAssertTrue(text.contains("1234")); XCTAssertTrue(text.contains("5678"))
    XCTAssertTrue(text.contains("appBuildVersion")); XCTAssertTrue(text.contains("92"))
    let oversized = MobileCrashDiagnostics.sanitized(Array(repeating: ["signal": 6], count: 1000)) as? [Any]
    XCTAssertEqual(oversized?.count, 256)
  }
  func testLifecycleEvidenceIsLocalBoundedAndSurvivesNewCollector() async throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: folder) }
    let collector = MobileCrashDiagnostics(folder: folder)
    for _ in 0..<180 { collector.event(.playbackPart) }
    collector.event(.playbackStop)
    let file = folder.appendingPathComponent("lifecycle-events.json")
    var entries: [[String: Any]] = []
    for _ in 0..<200 {
      if let data = try? Data(contentsOf: file), let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] { entries = rows }
      if entries.last?["event"] as? String == "playbackStop" { break }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    XCTAssertEqual(entries.count, 160); XCTAssertEqual(entries.last?["event"] as? String, "playbackStop")
    XCTAssertEqual(Set(entries.flatMap { $0.keys }), Set(["event", "at", "os", "build"]))
    let next = MobileCrashDiagnostics(folder: folder); next.event(.launch)
    for _ in 0..<100 {
      if let data = try? Data(contentsOf: file), let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]], rows.last?["event"] as? String == "launch" { entries = rows; break }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    XCTAssertEqual(entries.count, 160); XCTAssertEqual(entries.last?["event"] as? String, "launch")
  }
}
