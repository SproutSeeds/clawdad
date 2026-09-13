import AppKit
import ApplicationServices
import XCTest
@testable import ClawDad

/// The real worker and MCP/HTTP service with isolated durable state. A separate
/// harness supplies only disposable Terminal targets; this never starts a call.
@MainActor
final class MacAssistantTerminalTransportLiveTests: XCTestCase {
  func testDisposableNativeSelectionCapabilities() async throws {
    guard let folder = ProcessInfo.processInfo.environment["CLAWDAD_TERMINAL_QA_ROOT"], folder.hasPrefix("/private/tmp/clawdad-terminal-coverage-") else { throw XCTSkip("Opt-in read-only fixture inspection") }
    let app = try XCTUnwrap(NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Terminal").first)
    let ax = AXUIElementCreateApplication(app.processIdentifier)
    let native = MacNativeTerminalTabs()
    _ = try native.snapshots(application: ax, readShells: { [] })
    let bindings = try native.capture(application: ax)
    var output: [[String:Any]] = []
    for target in bindings where target.title.contains("accept-Ox8wea") || target.title.contains("decline-mTTyBH") {
      var actions: CFArray?; let actionResult = AXUIElementCopyActionNames(target.control, &actions)
      var attributes: CFArray?; _ = AXUIElementCopyAttributeNames(target.control, &attributes)
      var settable: [String:Bool] = [:]
      for name in (attributes as? [String]) ?? [] { var value: DarwinBoolean = false; _ = AXUIElementIsAttributeSettable(target.control,name as CFString,&value); settable[name] = value.boolValue }
      var parent: CFTypeRef?; _ = AXUIElementCopyAttributeValue(target.control,kAXParentAttribute as CFString,&parent)
      var parentValueSettable: DarwinBoolean = false
      if let parent { _ = AXUIElementIsAttributeSettable(unsafeBitCast(parent,to:AXUIElement.self),kAXValueAttribute as CFString,&parentValueSettable) }
      output.append(["title":target.title,"position":target.position,"selected":target.selected,"actions":actions as? [String] ?? [],"actionsResult":actionResult.rawValue,"settable":settable,"parentValueSettable":parentValueSettable.boolValue])
    }
    try JSONSerialization.data(withJSONObject:output,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:folder).appendingPathComponent("selection-capabilities.json"))
    XCTAssertEqual(output.count,2)
    if let target = bindings.first(where: { !$0.selected && ($0.title.contains("accept-Ox8wea") || $0.title.contains("decline-mTTyBH")) }) {
      var calls: [[String:Any]] = []
      native.performAction = { element, action in
        let result = AXUIElementPerformAction(element,action as CFString)
        calls.append(["action":action,"result":result.rawValue]);return result
      }
      var failure: String?
      do { try native.focus(target.id,application:ax) } catch { failure=error.localizedDescription }
      var selected=false, observationError: String?
      for _ in 0..<12 {
        do { selected=try native.capture(application:ax).contains(where: { $0.id==target.id && $0.selected });observationError=nil;if selected { break } }
        catch { observationError=error.localizedDescription }
        try await Task.sleep(for:.milliseconds(100))
      }
      let result: [String:Any] = ["target":target.title,"calls":calls,"failure":failure as Any? ?? NSNull(),"observedSelected":selected,"observationError":observationError as Any? ?? NSNull()]
      try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:folder).appendingPathComponent("selection-action.json"))
    }
  }
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
