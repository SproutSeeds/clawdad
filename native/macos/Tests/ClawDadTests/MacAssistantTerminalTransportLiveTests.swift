import AppKit
import ApplicationServices
import XCTest
@testable import ClawDad

/// The real worker and MCP/HTTP service with isolated durable state. A separate
/// harness supplies only disposable Terminal targets; this never starts a call.
@MainActor
final class MacAssistantTerminalTransportLiveTests: XCTestCase {
  func testDisposableColdInputFocus() async throws {
    guard let folder = ProcessInfo.processInfo.environment["CLAWDAD_TERMINAL_QA_ROOT"], folder.hasPrefix("/private/tmp/clawdad-terminal-coverage-") else { throw XCTSkip("Opt-in disposable tab selection") }
    let automation = MacTerminalAutomation()
    let before = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
    let rows = try await automation.readTabs()
    let matches = rows.filter { $0.customTitle.contains("accept-Ox8wea") }
    let target = try XCTUnwrap(matches.count == 1 ? matches.first : nil)
    // Force the cold native identity path, without using cached scripting/TTY metadata.
    let cold = MacTerminalTabSnapshot(windowID: 0, windowIndex: target.windowIndex,
      tabIndex: target.tabIndex, customTitle: target.customTitle, tty: "",
      isSelectedInWindow: target.isSelectedInWindow, nativeTabID: target.nativeTabID)
    let start = Date()
    try await automation.focusTab(cold)
    let identity = try await automation.inputIdentity()
    let after = try await automation.readTabs()
    let selected = after.filter { $0.isSelectedInWindow && $0.windowIndex == 1 }
    let result: [String:Any] = ["beforeBundle":before,
      "afterBundle":NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "",
      "elapsedMs":Date().timeIntervalSince(start)*1000,
      "inputIdentityVerified":identity != nil,
      "selectedNativeIdMatches":selected.count == 1 && selected[0].nativeTabID == target.nativeTabID,
      "selectedTTY":selected.first?.tty ?? "", "inputSent":false]
    try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:folder).appendingPathComponent("cold-focus-result.json"))
    XCTAssertEqual(result["afterBundle"] as? String,"com.apple.Terminal")
    XCTAssertNotNil(identity)
    XCTAssertEqual(result["selectedNativeIdMatches"] as? Bool,true)
    XCTAssertEqual(result["selectedTTY"] as? String,"/dev/ttys013")
  }
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
      var focusRole:CFTypeRef?, focusValue:CFTypeRef?, focused:CFTypeRef?
      let front=NSWorkspace.shared.frontmostApplication
      if let front { _=AXUIElementCopyAttributeValue(AXUIElementCreateApplication(front.processIdentifier),kAXFocusedUIElementAttribute as CFString,&focused) }
      if let focused { let element=unsafeBitCast(focused,to:AXUIElement.self);_=AXUIElementCopyAttributeValue(element,kAXRoleAttribute as CFString,&focusRole);_=AXUIElementCopyAttributeValue(element,kAXValueAttribute as CFString,&focusValue) }
      let result: [String:Any] = ["target":target.title,"calls":calls,"failure":failure as Any? ?? NSNull(),"observedSelected":selected,"observationError":observationError as Any? ?? NSNull(),"frontmostBundle":front?.bundleIdentifier ?? "", "focusRole":focusRole as? String ?? "", "focusValueIsString":focusValue is String]
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
    bridge.diagnosticStep = { step in
      try? Data(step.utf8).write(to:root.appendingPathComponent("worker-step"),options:.atomic)
      let file=root.appendingPathComponent("worker-stages.jsonl")
      if !FileManager.default.fileExists(atPath:file.path){FileManager.default.createFile(atPath:file.path,contents:Data(),attributes:[.posixPermissions:0o600])}
      if let handle=try? FileHandle(forWritingTo:file) {
        defer{try? handle.close()};try? handle.seekToEnd()
        if let data=try? JSONSerialization.data(withJSONObject:["at":Date().timeIntervalSince1970,"stage":step]){try? handle.write(contentsOf:data+Data([10]))}
      }
    }
    bridge.start(); defer { bridge.stop() }
    try Data("ready".utf8).write(to: root.appendingPathComponent("worker-ready"))
    let end = Date().addingTimeInterval(2400)
    while Date() < end, !FileManager.default.fileExists(atPath: root.appendingPathComponent("stop-worker").path) {
      try await Task.sleep(nanoseconds: 200_000_000)
    }
  }
}
