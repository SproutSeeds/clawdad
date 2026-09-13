import AppKit
import ApplicationServices
import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDad

/// Opt-in migration/QA runner. A manifest records exact live owners before any
/// mutation. Ordinary test runs skip this; installation never starts it.
@MainActor final class MacTerminalDisplayLiveTests: XCTestCase {
  func testDisposablePhysicalWindowKeepsItsFrameAcrossNativeTabSwitches() async throws {
    guard let file = ProcessInfo.processInfo.environment["CLAWDAD_DISPLAY_SWITCH_FIXTURE"] else { throw XCTSkip("Requires the exact disposable two-tab window manifest") }
    let records = try JSONDecoder().decode([[String:String]].self,from:Data(contentsOf:URL(fileURLWithPath:file)))
    guard records.count == 2, records.contains(where:{$0["directory"]?.hasSuffix("terminal-display-repair-2026-09-13/FixtureProject") == true}) else { throw AssistantProtocolError.invalid }
    let ttys = Set(records.compactMap{$0["tty"]})
    for expected in records {
      let current = try MacTerminalTitleMetadata.read(try XCTUnwrap(expected["tty"]))
      guard current.lifetime == expected["lifetime"], current.foreground == expected["foreground"] else { throw MacAssistantError("The disposable window changed; no tab was selected") }
    }
    let anchor = try XCTUnwrap(records.first(where:{$0["kind"] == "codex"})), automation = MacTerminalAutomation()
    try await automation.focusTab(windowID:try XCTUnwrap(anchor["windowID"].flatMap(Int.init)),tabIndex:1,tty:try XCTUnwrap(anchor["tty"]))
    let rows = try await automation.readTabs(), selected = try XCTUnwrap(rows.first(where:{$0.tty == anchor["tty"]}))
    let group = rows.filter{$0.groupID == selected.groupID}
    guard group.count == 2, group.allSatisfy({$0.tty.isEmpty || ttys.contains($0.tty)}) else { throw MacAssistantError("The disposable native group is not exact") }
    let app = AXUIElementCreateApplication(try XCTUnwrap(NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Terminal").first).processIdentifier)
    func frame() throws -> CGRect {
      var raw:CFTypeRef?, position:CFTypeRef?, size:CFTypeRef?
      guard AXUIElementCopyAttributeValue(app,kAXFocusedWindowAttribute as CFString,&raw) == .success,let raw else { throw AssistantProtocolError.invalid }
      let window=unsafeBitCast(raw,to:AXUIElement.self)
      guard AXUIElementCopyAttributeValue(window,kAXPositionAttribute as CFString,&position) == .success,
        AXUIElementCopyAttributeValue(window,kAXSizeAttribute as CFString,&size) == .success,let position,let size else { throw AssistantProtocolError.invalid }
      var p=CGPoint.zero,s=CGSize.zero
      guard AXValueGetValue(unsafeBitCast(position,to:AXValue.self),.cgPoint,&p),AXValueGetValue(unsafeBitCast(size,to:AXValue.self),.cgSize,&s) else { throw AssistantProtocolError.invalid }
      return CGRect(origin:p,size:s)
    }
    let before=try frame()
    for i in 0..<12 {
      let target=group[i%2]
      try await automation.focusTab(target)
      let current=try await automation.readTabs()
      XCTAssertTrue(current.contains{$0.nativeTabID == target.nativeTabID && $0.isSelectedInWindow})
      let identity = try await automation.inputIdentity(); XCTAssertNotNil(identity)
      XCTAssertEqual(try frame(),before)
    }
    print("NATIVE_DISPLAY_SWITCHES 12 exact selections, unchanged frame \(before)")
  }
  func testCaptureReadOnlyDisplayOwners() throws {
    let env = ProcessInfo.processInfo.environment
    guard let values = env["CLAWDAD_DISPLAY_CAPTURE_TTYS"], let output = env["CLAWDAD_DISPLAY_CAPTURE_OUTPUT"] else { throw XCTSkip("Read-only capture requires exact TTYs") }
    var scriptError:NSDictionary?
    let value = try XCTUnwrap(NSAppleScript(source:MacTerminalAutomation.catalogScript)).executeAndReturnError(&scriptError)
    guard scriptError == nil else { throw MacAssistantError("Read-only native catalog failed") }
    let rows = try MacTerminalAutomation.parseCatalog(value)
    let selectedTTYs = values == "all" ? Array(Set(rows.map(\.tty).filter{!$0.isEmpty})).sorted() : values.split(separator:",").map(String.init)
    let records = try selectedTTYs.map { value -> [String:String] in
      let tty = String(value), owner = try MacTerminalTitleMetadata.read(tty)
      return ["tty":tty,"lifetime":owner.lifetime,"foreground":owner.foreground,"directory":owner.directory ?? "", "kind":owner.kind,
        "windowID":String(rows.first(where:{$0.tty == tty})?.windowID ?? 0)]
    }
    try JSONEncoder().encode(records).write(to:URL(fileURLWithPath:output),options:.atomic)
  }
  func testApplyExplicitDisplayRepairManifest() async throws {
    let env = ProcessInfo.processInfo.environment
    guard let manifest = env["CLAWDAD_DISPLAY_REPAIR_MANIFEST"], let output = env["CLAWDAD_DISPLAY_REPAIR_OUTPUT"] else {
      throw XCTSkip("Requires an explicitly authorized exact-owner display repair manifest")
    }
    let records = try JSONDecoder().decode([[String:String]].self, from: Data(contentsOf: URL(fileURLWithPath: manifest)))
    var events = (try? JSONDecoder().decode([[String:String]].self,from:Data(contentsOf:URL(fileURLWithPath:output)))) ?? []
    func record(_ tty: String, _ event: String) throws {
      events.append(["tty":tty,"event":event,"at":ISO8601DateFormatter().string(from:Date())])
      try JSONEncoder().encode(events).write(to: URL(fileURLWithPath:output), options:.atomic)
    }
    let tabs = MacTerminalTabController.shared, input = try XCTUnwrap(MacInputController())
    let gate = MacAssistantInteractionGate.shared
    let terminal = try XCTUnwrap(NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Terminal").first)
    for expected in records {
      let tty = try XCTUnwrap(expected["tty"]), owner = try MacTerminalTitleMetadata.read(tty)
      guard owner.kind == "codex", owner.lifetime == expected["lifetime"], owner.foreground == expected["foreground"], owner.directory == expected["directory"] else {
        throw MacAssistantError("The authorized display-repair owner changed. No input was sent.")
      }
      try record(tty,"owner-verified")
      let ticket = try gate.ticket(), automation = MacTerminalAutomation()
      let rows = try await automation.readTabs()
      if let target = rows.first(where: { $0.tty == tty }) {
        try await automation.focusTab(target)
      } else {
        // Bootstrap only the exact TTY/window from the current native receipt.
        try await automation.focusTab(windowID: try XCTUnwrap(expected["windowID"].flatMap(Int.init)),tabIndex:1,tty:tty)
      }
      let catalog = try await tabs.catalog()
      let id = try XCTUnwrap(catalog.tabs.first { tabs.assistantSnapshot(tabID:$0.id)?.tty == tty }?.id)
      let controls = MacAssistantTerminalInput()
      let initial = try await controls.inspect(tabId:id,input:input,ticket:ticket)
      let identity = try await tabs.inputIdentity()
      func verifyOwner() async throws {
        let currentIdentity = try await tabs.inputIdentity(), currentOwner = try MacTerminalTitleMetadata.read(tty)
        if !gate.isCurrent(ticket) { try record(tty,"blocked:manual-input") }
        if currentIdentity != identity { try record(tty,"blocked:input-identity:\(identity ?? "nil")->\(currentIdentity ?? "nil")") }
        if currentOwner != owner { try record(tty,"blocked:process-or-directory-changed") }
        guard gate.isCurrent(ticket), !MacConsoleSessionState.isLocked(), !Task.isCancelled,
          currentIdentity == identity, currentOwner == owner else {
          throw MacAssistantError("The display repair paused for manual input or an owner change. Its local editor was preserved.")
        }
      }
      func screen() async throws -> String {
        try await verifyOwner()
        let app = AXUIElementCreateApplication(terminal.processIdentifier)
        var focused:CFTypeRef?, value:CFTypeRef?
        guard AXUIElementCopyAttributeValue(app,kAXFocusedUIElementAttribute as CFString,&focused) == .success,
          let focused, CFGetTypeID(focused) == AXUIElementGetTypeID(),
          AXUIElementCopyAttributeValue(unsafeBitCast(focused,to:AXUIElement.self),kAXValueAttribute as CFString,&value) == .success,
          let text = value as? String else { throw MacAssistantError("The native Terminal text is unavailable.") }
        return String(text.suffix(24_000))
      }
      func key(_ key: String) async throws {
        try await verifyOwner()
        guard input.sendAssistantKey(key,modifiers:[],targetPID:terminal.processIdentifier) else { throw MacAssistantError("The display-editor key was not sent.") }
        try await Task.sleep(nanoseconds:180_000_000)
      }
      let opened = MacCodexTitleSetup.focusedRow(try await screen()) != nil
      if opened { guard expected["resumeEditor"] == "true" else { throw MacAssistantError("Preserve a pre-existing display editor unless explicitly authorized to reconcile it.") } }
      else {
        let offered = MacCodexTitleSetup.offered(try await screen())
        if offered { guard expected["resumeEditor"] == "true" else { throw MacAssistantError("Preserve an existing slash-command draft.") } }
        else {
          guard initial["kind"]?.string == "agent", initial["draftText"]?.string == "" else {
            throw MacAssistantError("Preserve this tab's draft. Display repair needs an empty supported composer.")
          }
          try await verifyOwner(); try record(tty,"prepare-local-title-command")
          guard await input.sendAssistantText("/title",isAllowed:{gate.isCurrent(ticket)}) else { throw MacAssistantError("The title command needs inspection; no Enter was sent.") }
          try await Task.sleep(nanoseconds:180_000_000)
        }
        guard MacCodexTitleSetup.offered(try await screen()) else { throw MacAssistantError("Codex did not offer its exact local title command. No Enter was sent.") }
        try record(tty,"open-local-title-editor"); try await key("enter")
      }
      try await MacCodexTitleSetup.disable(read:screen,key:key,journal:{try record(tty,$0)})
      let final = try await controls.inspect(tabId:id,input:input,ticket:ticket)
      guard final["draftText"]?.string == "", final["inputSessionId"] == initial["inputSessionId"] else {
        throw MacAssistantError("Inspect the local display editor; its return to the same empty composer is not verified.")
      }
      try record(tty,"same-owner-empty-composer-verified-no-agent-turn")
    }
  }
}
