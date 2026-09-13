import AppKit
import ApplicationServices
@testable import ClawDad
import XCTest

final class MacNativeTerminalTabTests: XCTestCase {
  func testColdSelectionCannotCompleteIsVerifiedWithoutSecondPress() throws {
    let graph=TerminalGraph()
    let native=MacNativeTerminalTabs(readAttribute:graph.read)
    let rows=try native.snapshots(application:graph.app){graph.shells}
    var count=0
    native.performAction={ element,action in
      XCTAssertEqual(action,kAXPressAction);XCTAssertTrue(CFEqual(element,graph.controls[0]))
      count += 1;graph.selected=0;return .cannotComplete
    }
    try native.focus(try XCTUnwrap(rows[0].nativeTabID),application:graph.app)
    XCTAssertEqual(count,1);XCTAssertEqual(graph.selected,0)
    try native.focus(try XCTUnwrap(rows[0].nativeTabID),application:graph.app)
    XCTAssertEqual(count,1,"An already selected native control needs no press")
  }
  func testColdSelectionCannotCompleteWithoutExactSelectionRemainsUncertain() throws {
    for selectedAfter in [1,2] {
      let graph=TerminalGraph();var clock:Double=0
      let native=MacNativeTerminalTabs(readAttribute:graph.read,now:{clock += 0.0005;return clock})
      let rows=try native.snapshots(application:graph.app){graph.shells};var count=0
      native.performAction={ _,_ in count += 1;graph.selected=selectedAfter;return .cannotComplete }
      XCTAssertThrowsError(try native.focus(try XCTUnwrap(rows[0].nativeTabID),application:graph.app))
      XCTAssertEqual(count,1);XCTAssertEqual(graph.selected,selectedAfter)
    }
  }
  func testColdCatalogFindsActivityForUnvisitedTabsWithoutLearningInputIdentities() throws {
    let graph = TerminalGraph()
    graph.titles = ["/work/duplicate — codex --one", "/work/duplicate — codex --two", "/other/project — -zsh"]
    graph.windowTitles = ["duplicate — codex --one — 180×49", "duplicate — codex --two — 180×49", "project — -zsh — 180×49"]
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(rows.map(\.activityTTYs), [["/dev/ttys0"], ["/dev/ttys1"], ["/dev/ttys2"]])
    XCTAssertEqual(rows.map(\.tty), ["", "/dev/ttys1", ""], "Passive activity metadata cannot authorize input or speech.")
    XCTAssertEqual(graph.selected, 1)
    let again = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(rows, again)
  }

  func testIdenticalTitlesRetainEveryCandidateAndRequireCompleteMetadata() throws {
    let graph = TerminalGraph()
    graph.titles = Array(repeating: "/work/duplicate — codex", count: 3)
    graph.windowTitles = Array(repeating: "duplicate — codex — 180×49", count: 3)
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(rows[0].activityTTYs, ["/dev/ttys0", "/dev/ttys1", "/dev/ttys2"])
    XCTAssertEqual(rows[1].activityTTYs, ["/dev/ttys1"])
    graph.windowTitles?[2] = "unrelated — codex — 180×49"
    let incomplete = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertTrue(incomplete[0].activityTTYs.isEmpty)
    XCTAssertTrue(incomplete[2].activityTTYs.isEmpty)
  }

  func testTitleChangesDuringDiscoveryCannotMisattributeAnUnvisitedTab() throws {
    let graph = TerminalGraph()
    graph.titles = ["/work/first — codex", "/work/second — codex", "/work/third — codex"]
    graph.windowTitles = ["first — codex — 180×49", "second — codex — 180×49", "third — codex — 180×49"]
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let rows = try reader.snapshots(application: graph.app) {
      let shells = graph.shells
      graph.titles.swapAt(0, 2)
      return shells
    }
    XCTAssertTrue(rows[0].activityTTYs.isEmpty)
    XCTAssertTrue(rows[2].activityTTYs.isEmpty)
    XCTAssertEqual(rows[1].activityTTYs, ["/dev/ttys1"])
  }

  func testSpinnerAnimationDoesNotLoseTheActivityMatchOrInventAnInputIdentity() throws {
    let graph = TerminalGraph()
    graph.titles = ["/work/first — ⠋ first — codex ▸ swift", "/work/second — second — codex", "/work/third — ⠸ third — codex"]
    graph.windowTitles = ["first — ⠹ first — codex ▸ ps — 180×49", "second — second — codex — 180×49", "third — ⠹ third — codex — 180×49"]
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let rows = try reader.snapshots(application: graph.app) {
      graph.titles[0] = "/work/first — ⠸ first — codex ▸ lsof"
      return graph.shells
    }
    XCTAssertEqual(rows.map(\.activityTTYs), [["/dev/ttys0"], ["/dev/ttys1"], ["/dev/ttys2"]])
    XCTAssertEqual(rows.map(\.tty), ["", "/dev/ttys1", ""])
  }

  @MainActor
  func testLiveColdActivitySweepWithoutSelectingTabsWhenExplicitlyEnabled() async throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_TERMINAL_READ_ONLY_CHECK"] == "1" else {
      throw XCTSkip("Opt-in cold-start metadata/activity check; never selects or reads Terminal contents.")
    }
    let automation = MacTerminalAutomation()
    let monitor = MacTerminalAgentActivityMonitor()
    let controller = MacTerminalTabController(automation: automation, activity: monitor)
    let start = ProcessInfo.processInfo.systemUptime
    try await controller.prewarmActivity()
    await monitor.refreshTask?.value
    let initial = try await controller.catalog()
    let rows = try await automation.readTabs()
    let passive = rows.filter { $0.tty.isEmpty && !$0.activityTTYs.isEmpty }
    XCTAssertFalse(passive.isEmpty, "The cold sweep must include tabs that were never selected.")
    XCTAssertTrue(rows.allSatisfy { !$0.activityTTYs.isEmpty }, "Every tab on this Mac must be covered by its cold activity sweep.")
    XCTAssertFalse(initial.tabs.isEmpty)
    XCTAssertTrue(initial.tabs.contains(where: \.isBusy))
    let selected = initial.selectedTabId
    for _ in 0..<2 {
      let next = try await controller.catalog()
      XCTAssertEqual(next.tabs.map(\.id), initial.tabs.map(\.id))
      XCTAssertEqual(next.selectedTabId, selected)
      XCTAssertEqual(next.revision, initial.revision)
    }
    print("COLD_ACTIVITY_SWEEP tabs=\(rows.count) unvisited_mapped=\(passive.count) busy=\(initial.tabs.filter(\.isBusy).count) elapsed=\(ProcessInfo.processInfo.systemUptime - start)s; no focus or contents read")
  }

  func testFailedReadAndRejectedAfterReadKeepAllIdentitiesAndWindowNumbers() throws {
    let graph = TerminalGraph()
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let initial = try reader.snapshots(application: graph.app) { graph.shells }
    for _ in 0..<3 {
      graph.failWindows = true
      XCTAssertThrowsError(try reader.snapshots(application: graph.app) { graph.shells })
      graph.failWindows = false
      XCTAssertEqual(try reader.snapshots(application: graph.app) { graph.shells }, initial)
    }
    let withoutShells = try reader.snapshots(application: graph.app) { [] }
    XCTAssertEqual(withoutShells.map(\.nativeTabID), initial.map(\.nativeTabID))
    XCTAssertTrue(withoutShells.allSatisfy { $0.tty.isEmpty })
    XCTAssertEqual(try reader.snapshots(application: graph.app) { graph.shells }, initial)
    XCTAssertThrowsError(try reader.snapshots(application: graph.app) {
      graph.failWindows = true
      return graph.shells
    })
    graph.failWindows = false
    XCTAssertEqual(try reader.snapshots(application: graph.app) { graph.shells }, initial)
  }

  func testFinishedAssistantWindowCannotDisableOtherTabsOrChangeTheirIdentities() throws {
    let graph = TerminalGraph()
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let before = try reader.snapshots(application: graph.app) { graph.shells }
    graph.includeOtherWindow = true
    let after = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(after.count, 4) // The finished window has no scripting shell.
    XCTAssertEqual(Array(after.prefix(3)).map(\.nativeTabID), before.map(\.nativeTabID))
    XCTAssertEqual(after.first { $0.windowIndex == 1 && $0.isSelectedInWindow }?.tty, "/dev/ttys1")
    XCTAssertEqual(after.last?.tty, "")
    graph.otherTTY = ""
    XCTAssertEqual(try reader.snapshots(application: graph.app) { graph.shells }, after)
  }

  func testReusedTTYIsQuarantinedWithoutDisablingTheUnambiguousSelectedTab() throws {
    let graph = TerminalGraph()
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    graph.selected = 0
    _ = try reader.snapshots(application: graph.app) { graph.shells }
    graph.selected = 1
    graph.includeOtherWindow = true
    graph.otherTTY = "/dev/ttys0"
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(rows.count, 4)
    XCTAssertEqual(rows[1].tty, "/dev/ttys1")
    XCTAssertTrue(rows.filter { $0.position != 2 }.allSatisfy { $0.tty.isEmpty })
    graph.selected = 0
    let ambiguous = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(ambiguous[0].tty, "", "Never reuse a formerly verified TTY after it becomes ambiguous")
  }

  func testBackgroundWindowOrderAndArrivalDoNotInvalidateTheFocusedShell() throws {
    let graph = TerminalGraph()
    graph.includeOtherWindow = true
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let before = try reader.snapshots(application: graph.app) { graph.shells }
    let after = try reader.snapshots(application: graph.app) {
      graph.reverseWindows.toggle()
      return graph.shells
    }
    XCTAssertEqual(Set(after.compactMap(\.nativeTabID)), Set(before.compactMap(\.nativeTabID)))
    XCTAssertEqual(after.first { $0.windowIndex == 1 && $0.isSelectedInWindow }?.tty, "/dev/ttys1")
    graph.includeOtherWindow = false
    let removed = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(removed.count, 3)
    XCTAssertEqual(removed.map(\.nativeTabID), Array(before.prefix(3)).map(\.nativeTabID))
  }

  func testFocusedSelectionChangingDuringDiscoveryIsRetriedWithoutCrossBinding() throws {
    let graph = TerminalGraph()
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let before = try reader.snapshots(application: graph.app) { graph.shells }
    var attempts = 0
    let after = try reader.snapshots(application: graph.app) {
      attempts += 1
      let shells = graph.shells
      graph.selected = 2
      return shells
    }
    XCTAssertEqual(attempts, 2)
    XCTAssertEqual(after.map(\.nativeTabID), before.map(\.nativeTabID))
    XCTAssertEqual(after[2].tty, "/dev/ttys2")
  }

  func testInputIdentityDoesNotReadTheGlobalCatalogAndStillDistinguishesTabs() throws {
    let graph = TerminalGraph()
    graph.failWindows = true
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let first = try reader.inputIdentity(application: graph.app)
    XCTAssertEqual(try reader.inputIdentity(application: graph.app), first)
    graph.selected = 2
    XCTAssertNotEqual(try reader.inputIdentity(application: graph.app), first)
    graph.selected = 1
    XCTAssertEqual(try reader.inputIdentity(application: graph.app), first)
    graph.window = graph.newElement()
    XCTAssertNotEqual(try reader.inputIdentity(application: graph.app), first)
  }

  func testInputCaptureRejectsSelectionChangingBetweenItsTwoReads() throws {
    let graph = TerminalGraph()
    var selections = 0
    let reader = MacNativeTerminalTabs(readAttribute: { element, attribute in
      if attribute == kAXValueAttribute && CFEqual(element, graph.strip) {
        selections += 1
        if selections == 2 { graph.selected = 2 }
      }
      return try graph.read(element, attribute)
    })
    XCTAssertThrowsError(try reader.inputIdentity(application: graph.app)) { error in
      XCTAssertEqual((error as? MacTerminalTabFailure)?.code, "selection_changed")
    }
  }

  func testStripReplacementAndFocusMRUDoNotRenumberPhysicalWindow() throws {
    let graph = TerminalGraph()
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let initial = try reader.snapshots(application: graph.app) { graph.shells }
    graph.strip = graph.newElement()
    graph.selected = 2
    graph.window = graph.newElement()
    let changed = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(changed.map(\.nativeTabID), initial.map(\.nativeTabID))
    XCTAssertEqual(changed.map(\.groupID), initial.map(\.groupID))
    XCTAssertEqual(changed.first { $0.isSelectedInWindow }?.tty, "/dev/ttys2")
  }

  func testReplacementOfSelectedControlRecoversItsVerifiedShellIdentity() throws {
    let graph = TerminalGraph()
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let initial = try reader.snapshots(application: graph.app) { graph.shells }
    graph.controls[graph.selected] = graph.newElement()
    let repaired = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(repaired.map(\.nativeTabID), initial.map(\.nativeTabID))
    XCTAssertEqual(repaired.map(\.groupID), initial.map(\.groupID))
  }

  func testLearningShellAfterUnselectedControlReplacementDoesNotChangeTheTappedRowAgain() throws {
    let graph = TerminalGraph()
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    graph.selected = 0
    _ = try reader.snapshots(application: graph.app) { graph.shells }
    graph.selected = 1
    _ = try reader.snapshots(application: graph.app) { graph.shells }
    graph.controls[0] = graph.newElement()
    let refreshed = try reader.snapshots(application: graph.app) { graph.shells }
    graph.selected = 0
    let focused = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(focused.map(\.nativeTabID), refreshed.map(\.nativeTabID))
    XCTAssertEqual(focused[0].tty, "/dev/ttys0")
  }

  func testGeometryOrderOverridesAXEnumerationAndIdleSelectionIsNotQueried() throws {
    let graph = TerminalGraph()
    graph.enumeration = [2, 0, 1]
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(rows.map { macTerminalTabTitle($0.customTitle) }, ["duplicate", "duplicate", "duplicate"])
    XCTAssertEqual(reader.bindings.map(\.control), graph.controls)
    XCTAssertEqual(rows.map(\.position), [1, 2, 3])
    XCTAssertEqual(rows.filter(\.isSelectedInWindow).count, 1)
    XCTAssertTrue(rows.allSatisfy(\.reorderAvailable))
  }

  func testOverflowPreservesNativeOrderAndDisablesUnverifiedDragging() throws {
    let graph = TerminalGraph()
    graph.hidden = 2
    let rows = try MacNativeTerminalTabs(readAttribute: graph.read).snapshots(application: graph.app) { graph.shells }
    XCTAssertEqual(rows.count, 3)
    XCTAssertEqual(rows.map(\.position), [1, 2, 3])
    XCTAssertFalse(rows.contains(where: \.reorderAvailable))
  }

  func testOverallDeadlinePreservesPreviouslyAcceptedCatalog() throws {
    let graph = TerminalGraph()
    var time: TimeInterval = 0
    let reader = MacNativeTerminalTabs(readAttribute: graph.read, now: { time })
    let initial = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertThrowsError(try reader.snapshots(application: graph.app) {
      time += 3
      return graph.shells
    })
    XCTAssertEqual(reader.bindings.map(\.id), initial.compactMap(\.nativeTabID))
    XCTAssertEqual(try reader.snapshots(application: graph.app) { graph.shells }, initial)
  }

  @MainActor
  func testLiveTerminalAdjacentMoveAndRestoreWhenExplicitlyEnabled() async throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_TERMINAL_MOVE_CHECK"] == "1" else {
      throw XCTSkip("Opt-in adjacent move of an existing tab, followed by restoration.")
    }
    guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.Terminal" else {
      throw XCTSkip("Leave the current foreground application untouched.")
    }
    let controller = MacTerminalTabController()
    let initial = try await controller.catalog()
    try await Task.sleep(for: .milliseconds(300))
    let settled = try await controller.catalog()
    guard settled.tabs.map(\.id) == initial.tabs.map(\.id), settled.selectedTabId == initial.selectedTabId else {
      throw XCTSkip("Terminal is being changed; leave the user's activity untouched.")
    }
    let offset = try XCTUnwrap(initial.tabs.firstIndex { $0.id == initial.selectedTabId })
    let distance = max(1, min(10, Int(ProcessInfo.processInfo.environment["CLAWDAD_TERMINAL_MOVE_DISTANCE"] ?? "1") ?? 1))
    guard initial.tabs.indices.contains(offset + distance),
          initial.tabs[offset].canReorder,
          initial.tabs[offset].windowGroupId == initial.tabs[offset + distance].windowGroupId else {
      throw XCTSkip("The selected tab needs a visible adjacent tab in its group.")
    }
    let source = initial.tabs[offset].id, neighbor = initial.tabs[offset + distance].id
    let restoreNeighbor = initial.tabs[offset + 1].id
    print("TERMINAL_MOVE_CHECK baseline_tabs=\(initial.tabs.count) selected=\(initial.tabs[offset].title) position=\(offset + 1)")
    print("TERMINAL_MOVE_BASELINE \(initial.tabs.map(\.title).joined(separator: ", "))")
    var expected = initial.tabs.map(\.id)
    expected.remove(at: offset)
    expected.insert(source, at: offset + distance)
    do {
      let moved = try await controller.move(.moveRequest(tabId: source, neighborTabId: neighbor,
        placeBefore: false, expectedRevision: initial.revision, requestId: "live-adjacent-move"))
      XCTAssertEqual(moved.tabs.map(\.id), expected)
      XCTAssertEqual(moved.selectedTabId, initial.selectedTabId)
      let restored = try await controller.move(.moveRequest(tabId: source, neighborTabId: restoreNeighbor,
        placeBefore: true, expectedRevision: moved.revision, requestId: "live-restore"))
      XCTAssertEqual(restored.tabs.map(\.id), initial.tabs.map(\.id))
      XCTAssertEqual(restored.selectedTabId, initial.selectedTabId)
      print("TERMINAL_MOVE_CHECK moved=true restored=true tabs=\(restored.tabs.count) distance=\(distance)")
    } catch {
      let current = try await controller.catalog()
      if current.tabs.map(\.id) == expected, current.selectedTabId == initial.selectedTabId {
        _ = try await controller.move(.moveRequest(tabId: source, neighborTabId: restoreNeighbor,
          placeBefore: true, expectedRevision: current.revision, requestId: "live-error-restore"))
      }
      throw error
    }
  }

  @MainActor
  func testLiveTerminalSelectionAndRestoreWhenExplicitlyEnabled() async throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_TERMINAL_FOCUS_CHECK"] == "1" else {
      throw XCTSkip("Opt-in existing-tab selection check; restores the initial tab and never types into Terminal.")
    }
    let automation = MacTerminalAutomation()
    let baseline = try await automation.readTabs()
    let original = try XCTUnwrap(baseline.first { $0.windowIndex == 1 && $0.isSelectedInWindow })
    let controller = MacTerminalTabController(automation: automation)
    let initial = try await controller.catalog()
    let positions = Array(Set([0, initial.tabs.count / 2, initial.tabs.count - 1])).sorted()
    let start = ProcessInfo.processInfo.systemUptime
    do {
      for position in positions {
        let selected = try await controller.focus(tabID: initial.tabs[position].id, expectedRevision: initial.revision)
        XCTAssertEqual(selected.selectedTabId, initial.tabs[position].id)
        XCTAssertEqual(selected.tabs.map(\.id), initial.tabs.map(\.id))
        XCTAssertEqual(selected.tabs.map(\.windowGroupId), initial.tabs.map(\.windowGroupId))
        let selectedRows = try await automation.readTabs()
        let shell = try XCTUnwrap(selectedRows.first { $0.windowIndex == 1 && $0.isSelectedInWindow })
        XCTAssertFalse(shell.tty.isEmpty)
        print("TERMINAL_FOCUS_CHECK position=\(position + 1) title=\(macTerminalTabTitle(shell.customTitle))")
      }
    } catch {
      try await automation.focusTab(original)
      throw error
    }
    try await automation.focusTab(original)
    let restored = try await controller.catalog()
    XCTAssertEqual(restored.selectedTabId, initial.selectedTabId)
    XCTAssertEqual(restored.tabs.map(\.id), initial.tabs.map(\.id))
    print("TERMINAL_FOCUS_CHECK restored=true selections=\(positions.count) elapsed=\(ProcessInfo.processInfo.systemUptime - start)")
  }

  @MainActor
  func testLiveTerminalCatalogReadOnlyWhenExplicitlyEnabled() async throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_TERMINAL_READ_ONLY_CHECK"] == "1" else {
      throw XCTSkip("Opt-in metadata-only check; does not select, create, move or read Terminal contents.")
    }
    let automation = MacTerminalAutomation()
    let controller = MacTerminalTabController(automation: automation)
    let start = ProcessInfo.processInfo.systemUptime
    let initial = try await controller.catalog()
    XCTAssertFalse(initial.tabs.isEmpty)
    for _ in 0..<4 {
      let next = try await controller.catalog()
      XCTAssertEqual(next.tabs.map(\.id), initial.tabs.map(\.id))
      XCTAssertEqual(next.tabs.map(\.windowGroupId), initial.tabs.map(\.windowGroupId))
      XCTAssertEqual(next.selectedTabId, initial.selectedTabId)
      XCTAssertEqual(next.revision, initial.revision)
    }
    print("TERMINAL_READ_ONLY_CHECK tabs=\(initial.tabs.count) groups=\(Set(initial.tabs.compactMap(\.windowGroupId)).count) reads=5 elapsed=\(ProcessInfo.processInfo.systemUptime - start)")
    print("TERMINAL_LEFT_TO_RIGHT \(initial.tabs.map(\.title).joined(separator: ", "))")
  }
}

private final class TerminalGraph {
  private var next: pid_t = 2_000_000
  func newElement() -> AXUIElement { next += 1; return AXUIElementCreateApplication(next) }
  lazy var app = newElement()
  lazy var window = newElement()
  lazy var strip = newElement()
  lazy var area = newElement()
  lazy var controls = (0..<3).map { _ in newElement() }
  lazy var otherWindow = newElement()
  lazy var otherArea = newElement()
  var includeOtherWindow = false
  var otherTTY: String?
  var reverseWindows = false
  var selected = 1
  var enumeration = [0, 1, 2]
  var failWindows = false
  var hidden: Int?
  var titles = Array(repeating: "/Volumes/Code/duplicate — agent", count: 3)
  var windowTitles: [String]?
  var shells: [MacTerminalTabSnapshot] {
    // Native macOS tabs are three scripting windows with one shell each.
    var rows = ([selected] + (0..<3).filter { $0 != selected }).enumerated().map { offset, tab in
      MacTerminalTabSnapshot(windowID: 100 + tab, windowIndex: offset + 1,
        tabIndex: 1, customTitle: "duplicate", tty: "/dev/ttys\(tab)",
        isSelectedInWindow: true, activityWindowTitle: windowTitles?[tab])
    }
    if let otherTTY {
      rows.append(MacTerminalTabSnapshot(windowID: 200, windowIndex: 4, tabIndex: 1,
        customTitle: "ClawDad Assistant", tty: otherTTY, isSelectedInWindow: true))
    }
    return rows
  }

  func read(_ element: AXUIElement, _ attribute: String) throws -> CFTypeRef? {
    let isApp = CFEqual(element, app), isWindow = CFEqual(element, window)
    let isStrip = CFEqual(element, strip), isArea = CFEqual(element, area)
    let tab = controls.firstIndex { CFEqual($0, element) }
    switch attribute {
    case kAXWindowsAttribute where isApp:
      if failWindows { throw MacTerminalTabFailure(code: "layout_unavailable", message: "Transient read failure", state: nil) }
      let windows = includeOtherWindow ? [window, otherWindow] : [window]
      return (reverseWindows ? windows.reversed().map { $0 } : windows) as CFArray
    case kAXFocusedWindowAttribute where isApp: return window
    case kAXRoleAttribute:
      if CFEqual(element, otherWindow) { return kAXWindowRole as CFString }
      if CFEqual(element, otherArea) { return kAXTextAreaRole as CFString }
      return (isWindow ? kAXWindowRole : isStrip ? kAXTabGroupRole : isArea ? kAXTextAreaRole : kAXRadioButtonRole) as CFString
    case kAXChildrenAttribute:
      if CFEqual(element, otherWindow) { return [otherArea] as CFArray }
      return (isWindow ? [area, strip] : isStrip ? controls : []) as CFArray
    case kAXTabsAttribute where isStrip: return enumeration.map { controls[$0] } as CFArray
    case kAXValueAttribute where isStrip: return controls[selected]
    case kAXValueAttribute where tab != nil:
      throw MacTerminalTabFailure(code: "layout_unavailable", message: "Terminal idle tab AXValue is unavailable", state: nil)
    case kAXTitleAttribute: return titles[tab ?? selected] as CFString
    case kAXPositionAttribute:
      var point = CGPoint(x: tab.map { CGFloat($0 * 100) } ?? 0, y: 30)
      return AXValueCreate(.cgPoint, &point)
    case kAXSizeAttribute:
      var size = CGSize(width: isStrip ? 300 : tab == hidden && hidden != nil ? 0 : 100, height: 24)
      return AXValueCreate(.cgSize, &size)
    default: return nil
    }
  }
}
