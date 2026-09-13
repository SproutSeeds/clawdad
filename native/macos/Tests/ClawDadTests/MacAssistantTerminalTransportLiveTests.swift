import AppKit
import ApplicationServices
import XCTest
@testable import ClawDad

/// The real worker and MCP/HTTP service with isolated durable state. A separate
/// harness supplies only disposable Terminal targets; this never starts a call.
@MainActor
final class MacAssistantTerminalTransportLiveTests: XCTestCase {
  func testIsolatedNativeWorker() async throws {
    guard let folder = ProcessInfo.processInfo.environment["CLAWDAD_TERMINAL_QA_ROOT"],
      folder.hasPrefix("/private/tmp/clawdad-terminal-coverage-") else { throw XCTSkip("Requires the explicitly enabled disposable Terminal transport harness") }
    let root = URL(fileURLWithPath: folder, isDirectory: true)
    let config = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("connection.json"))) as! [String:String]
    XCTAssertTrue(AXIsProcessTrusted(), "The test worker needs the existing authorized Accessibility path")
    let runtime = MacAssistantRuntime(baseURL: try XCTUnwrap(URL(string: try XCTUnwrap(config["baseURL"]))), token: try String(contentsOf: root.appendingPathComponent("native-server.token")).trimmingCharacters(in: .whitespacesAndNewlines))
    _ = try await runtime.json("/v1/assistant/state")
    let initial = try await MacTerminalTabController.shared.catalog()
    try JSONEncoder().encode(initial).write(to: root.appendingPathComponent("initial-catalog.json"))
    let bridge = MacAssistantBridge(runtime: runtime, root: root.appendingPathComponent("Assistant", isDirectory: true), observeWorkspaces: false)
    bridge.diagnosticStep = { try? Data($0.utf8).write(to: root.appendingPathComponent("worker-step"), options: .atomic) }
    bridge.start(); defer { bridge.stop() }
    try Data("ready".utf8).write(to: root.appendingPathComponent("worker-ready"))
    let end = Date().addingTimeInterval(2400)
    while Date() < end, !FileManager.default.fileExists(atPath: root.appendingPathComponent("stop-worker").path) {
      try await Task.sleep(nanoseconds: 200_000_000)
    }
  }
}
