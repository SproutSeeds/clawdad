import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDad

@MainActor
final class MacTerminalTabTests: XCTestCase {
  func testBatchedCatalogAndIdentityFocusScriptsCompileWithoutRunningTerminal() {
    for source in [MacTerminalAutomation.catalogScript, MacTerminalAutomation.focusScript(windowID: 10, tabIndex: 2, tty: "/dev/ttys001")] {
      let script = NSAppleScript(source: source)
      var error: NSDictionary?
      XCTAssertTrue(script?.compileAndReturnError(&error) == true, error?.description ?? "No script")
    }
  }
  func testCatalogUsesOpaqueStableIdentifiersAndOneGlobalSelection() async throws {
    let automation = StubTerminalAutomation(snapshots: initialSnapshots)
    let controller = MacTerminalTabController(automation: automation)

    let first = try await controller.catalog()
    let second = try await controller.catalog()

    XCTAssertEqual(first, second)
    XCTAssertEqual(first.revision, 1)
    XCTAssertEqual(first.tabs.map(\.title), ["clawdad", "life-ops"])
    XCTAssertEqual(first.tabs.map(\.detail), [
      "Window 1 • Tab 1",
      "Window 2 • Tab 1",
    ])
    XCTAssertEqual(first.tabs.filter(\.isSelected).count, 1)
    XCTAssertEqual(first.selectedTabId, first.tabs.first?.id)
    XCTAssertFalse(first.tabs[0].hasUnreadActivity)
    XCTAssertTrue(first.tabs[1].hasUnreadActivity)
    XCTAssertFalse(first.tabs[0].id.contains("ttys"))
  }

  func testTopologyRevisionChangesOnlyWhenTabIdentityOrOrderChanges() async throws {
    let automation = StubTerminalAutomation(snapshots: initialSnapshots)
    let controller = MacTerminalTabController(automation: automation)
    let first = try await controller.catalog()

    automation.snapshots[0] = MacTerminalTabSnapshot(
      windowID: 10,
      windowIndex: 1,
      tabIndex: 1,
      customTitle: "renamed",
      tty: "/dev/ttys001",
      isBusy: false,
      isSelectedInWindow: true,
      hasUnreadActivity: true
    )
    let presentationChange = try await controller.catalog()
    XCTAssertEqual(presentationChange.revision, first.revision)
    XCTAssertFalse(presentationChange.tabs[0].hasUnreadActivity)

    automation.snapshots.swapAt(0, 1)
    automation.snapshots[0] = snapshot(
      windowID: 20,
      windowIndex: 1,
      title: "life-ops",
      tty: "/dev/ttys002"
    )
    automation.snapshots[1] = snapshot(
      windowID: 10,
      windowIndex: 2,
      title: "renamed",
      tty: "/dev/ttys001"
    )
    let topologyChange = try await controller.catalog()
    XCTAssertEqual(topologyChange.revision, first.revision)
    XCTAssertEqual(topologyChange.tabs.map(\.id), first.tabs.map(\.id))
    XCTAssertEqual(topologyChange.selectedTabId, first.tabs[1].id)
  }

  func testFocusRejectsAnAlreadyObservedTopologyChangeBeforeAutomation() async throws {
    let automation = StubTerminalAutomation(snapshots: initialSnapshots)
    let controller = MacTerminalTabController(automation: automation)
    let initial = try await controller.catalog()
    automation.snapshots.append(snapshot(
      windowID: 30,
      windowIndex: 3,
      title: "new-tab",
      tty: "/dev/ttys003"
    ))

    _ = try await controller.catalog()
    do {
      _ = try await controller.focus(
        tabID: initial.tabs[1].id,
        expectedRevision: initial.revision
      )
      XCTFail("Expected a stale catalog failure")
    } catch let failure as MacTerminalTabFailure {
      XCTAssertEqual(failure.code, "stale_catalog")
      XCTAssertEqual(failure.state?.tabs.count, 3)
    }
    XCTAssertTrue(automation.focusCalls.isEmpty)
  }

  func testFocusRaisesRequestedWindowAndReturnsFreshSelection() async throws {
    let automation = StubTerminalAutomation(snapshots: initialSnapshots)
    let controller = MacTerminalTabController(automation: automation)
    let initial = try await controller.catalog()
    let targetID = initial.tabs[1].id

    let focused = try await controller.focus(
      tabID: targetID,
      expectedRevision: initial.revision
    )

    XCTAssertEqual(automation.focusCalls, [FocusCall(windowID: 20, tabIndex: 1)])
    XCTAssertEqual(focused.selectedTabId, targetID)
    XCTAssertEqual(focused.tabs.map(\.id), initial.tabs.map(\.id))
    XCTAssertEqual(focused.revision, initial.revision)
  }

  func testEmptyCatalogDoesNotLaunchTerminal() async throws {
    let automation = StubTerminalAutomation(snapshots: [])
    let controller = MacTerminalTabController(automation: automation)

    let state = try await controller.catalog()

    XCTAssertEqual(state.revision, 1)
    XCTAssertNil(state.selectedTabId)
    XCTAssertTrue(state.tabs.isEmpty)
  }

  func testNativeTabStripOrderOverridesFocusOrder() async throws {
    let automation = StubTerminalAutomation(snapshots: [
      MacTerminalTabSnapshot(windowID: 20, windowIndex: 1, tabIndex: 1, customTitle: "second", tty: "/dev/ttys002", isBusy: false, isSelectedInWindow: true, visibleGroupID: 10, visibleTabIndex: 2),
      MacTerminalTabSnapshot(windowID: 10, windowIndex: 2, tabIndex: 1, customTitle: "first", tty: "/dev/ttys001", isBusy: false, isSelectedInWindow: true, visibleGroupID: 10, visibleTabIndex: 1)
    ])
    let controller = MacTerminalTabController(automation: automation)
    let state = try await controller.catalog()
    XCTAssertEqual(state.tabs.map(\.title), ["first", "second"])
    XCTAssertEqual(state.tabs.map(\.windowGroupId), ["terminal-window-10", "terminal-window-10"])
    XCTAssertEqual(state.selectedTabId, state.tabs[1].id)
  }

  func testNativeGroupBindingUsesDistinctTitlesAndRefusesAmbiguousTabs() {
    XCTAssertEqual(macTerminalNativeGroupMembers(titles: ["life-ops", "clawdad"], snapshots: initialSnapshots)?.map(\.windowID), [20, 10])
    XCTAssertNil(macTerminalNativeGroupMembers(titles: ["clawdad", "clawdad"], snapshots: initialSnapshots))
    XCTAssertNil(macTerminalNativeGroupMembers(titles: ["missing", "clawdad"], snapshots: initialSnapshots))
  }

  func testResponseRequiresTheCurrentlySelectedTab() async throws {
    let automation = StubTerminalAutomation(snapshots: initialSnapshots)
    let controller = MacTerminalTabController(automation: automation, readResponse: { _ in
      XCTFail("An unselected tab must not be read")
      throw MacTerminalResponseFailure(message: "Unexpected read")
    })
    let state = try await controller.catalog()
    let request = RemoteTerminalResponseMessage.request(requestId: "read", tabId: state.tabs[1].id, expectedRevision: state.revision)
    do {
      _ = try await controller.latestResponse(request)
      XCTFail("An unselected tab was accepted")
    } catch { XCTAssertTrue(error.localizedDescription.contains("selected Terminal tab changed")) }
  }

  func testResponseIsDiscardedIfTabChangesDuringRead() async throws {
    let automation = StubTerminalAutomation(snapshots: initialSnapshots)
    let controller = MacTerminalTabController(automation: automation, readResponse: { tty in
      XCTAssertEqual(tty, "/dev/ttys001")
      try await automation.focusTab(windowID: 20, tabIndex: 1)
      return RemoteTerminalResponse(sessionId: "session", turnId: "turn", text: "Now stale",
                                    completedAt: "2026-09-05T08:00:00Z", inProgress: false)
    })
    let state = try await controller.catalog()
    let request = RemoteTerminalResponseMessage.request(requestId: "read", tabId: state.tabs[0].id, expectedRevision: state.revision)
    do {
      _ = try await controller.latestResponse(request)
      XCTFail("A response from the old tab escaped")
    } catch { XCTAssertTrue(error.localizedDescription.contains("changed while reading")) }
  }

  func testAutomationDenialOpensExactPrivacyPaneForCatalog() async {
    let automation = StubTerminalAutomation(
      snapshots: initialSnapshots,
      readError: automationDeniedFailure
    )
    let permissionRouter = StubTerminalPermissionRouter()
    let controller = MacTerminalTabController(
      automation: automation,
      permissionRouter: permissionRouter
    )

    do {
      _ = try await controller.catalog()
      XCTFail("Expected an Automation permission failure")
    } catch let failure as MacTerminalTabFailure {
      XCTAssertEqual(failure.code, "automation_denied")
      XCTAssertEqual(permissionRouter.openCallCount, 1)
      XCTAssertTrue(failure.message.contains("System Settings is open"))
      XCTAssertTrue(failure.message.contains("tap Refresh"))
    } catch {
      XCTFail("Unexpected error: \(error)")
    }

    XCTAssertEqual(
      macTerminalAutomationSettingsURL?.absoluteString,
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
    )
  }

  func testAutomationDenialOpensPrivacyPaneForFocus() async throws {
    let automation = StubTerminalAutomation(
      snapshots: initialSnapshots,
      focusError: automationDeniedFailure
    )
    let permissionRouter = StubTerminalPermissionRouter()
    let controller = MacTerminalTabController(
      automation: automation,
      permissionRouter: permissionRouter
    )
    let initial = try await controller.catalog()

    do {
      _ = try await controller.focus(
        tabID: initial.tabs[1].id,
        expectedRevision: initial.revision
      )
      XCTFail("Expected an Automation permission failure")
    } catch let failure as MacTerminalTabFailure {
      XCTAssertEqual(failure.code, "automation_denied")
      XCTAssertEqual(permissionRouter.openCallCount, 1)
    }
  }

  func testOtherAutomationFailuresDoNotOpenPrivacyPane() async {
    let automation = StubTerminalAutomation(
      snapshots: initialSnapshots,
      readError: MacTerminalTabFailure(
        code: "automation_failed",
        message: "Terminal did not respond.",
        state: nil
      )
    )
    let permissionRouter = StubTerminalPermissionRouter()
    let controller = MacTerminalTabController(
      automation: automation,
      permissionRouter: permissionRouter
    )

    do {
      _ = try await controller.catalog()
      XCTFail("Expected an Automation failure")
    } catch let failure as MacTerminalTabFailure {
      XCTAssertEqual(failure.code, "automation_failed")
      XCTAssertEqual(permissionRouter.openCallCount, 0)
    } catch {
      XCTFail("Unexpected error: \(error)")
    }
  }

  func testTitlesRemoveControlCharactersAndStayBounded() {
    let longTitle = " clawdad\n\t" + String(repeating: "🦞", count: 200)
    let title = macTerminalTabTitle(longTitle)

    XCTAssertTrue(title.hasPrefix("clawdad "))
    XCTAssertLessThanOrEqual(
      title.utf8.count,
      RemoteTerminalTabDescriptor.maximumTitleBytes
    )
    XCTAssertEqual(macTerminalTabTitle("\n\t"), "Terminal Tab")
  }

  func testAutomationConsentStatusesMapToActionableFailures() {
    XCTAssertNil(macTerminalAutomationFailure(for: noErr))
    XCTAssertEqual(
      macTerminalAutomationFailure(
        for: OSStatus(errAEEventWouldRequireUserConsent)
      )?.code,
      "automation_denied"
    )
    XCTAssertEqual(
      macTerminalAutomationFailure(
        for: OSStatus(errAEEventNotPermitted)
      )?.code,
      "automation_denied"
    )
    XCTAssertEqual(
      macTerminalAutomationFailure(for: OSStatus(procNotFound))?.code,
      "terminal_not_running"
    )
    XCTAssertEqual(
      macTerminalAutomationFailure(for: -12345)?.code,
      "automation_failed"
    )
  }

  func testMoveUsesLiveTabIdentityPreservesSelectionAndConfirmsActualOrder() async throws {
    let automation = StubTerminalAutomation(snapshots: (1...3).map { position in
      MacTerminalTabSnapshot(windowID: 10, windowIndex: 1, tabIndex: position, customTitle: "Tab \(position)",
        tty: "/dev/ttys00\(position)", isBusy: true, isSelectedInWindow: position == 2)
    })
    let controller = MacTerminalTabController(automation: automation)
    let state = try await controller.catalog()
    let move = RemoteTerminalTabMessage.moveRequest(tabId: state.tabs[0].id, neighborTabId: state.tabs[2].id,
      placeBefore: false, expectedRevision: state.revision, requestId: "move")
    let moved = try await controller.move(move)
    XCTAssertEqual(moved.tabs.map(\.id), [state.tabs[1].id, state.tabs[2].id, state.tabs[0].id])
    XCTAssertEqual(moved.selectedTabId, state.selectedTabId)
    XCTAssertEqual(moved.revision, state.revision + 1)
    XCTAssertTrue(moved.tabs.allSatisfy(\.isBusy))
    do { _ = try await controller.move(move); XCTFail("Old moves must not replay") }
    catch let failure as MacTerminalTabFailure { XCTAssertEqual(failure.code, "stale_catalog") }
    automation.ignoreMove = true
    do {
      _ = try await controller.move(.moveRequest(tabId: moved.tabs[0].id, neighborTabId: moved.tabs[2].id,
        placeBefore: false, expectedRevision: moved.revision, requestId: "unconfirmed"))
      XCTFail("A failed native move must not be reported as success")
    } catch let failure as MacTerminalTabFailure { XCTAssertEqual(failure.code, "reorder_unconfirmed") }
  }

  private var initialSnapshots: [MacTerminalTabSnapshot] {
    [
      snapshot(
        windowID: 10,
        windowIndex: 1,
        title: "clawdad",
        tty: "/dev/ttys001",
        hasUnreadActivity: true
      ),
      snapshot(
        windowID: 20,
        windowIndex: 2,
        title: "life-ops",
        tty: "/dev/ttys002",
        hasUnreadActivity: true
      ),
    ]
  }

  private func snapshot(
    windowID: Int,
    windowIndex: Int,
    title: String,
    tty: String,
    hasUnreadActivity: Bool = false
  ) -> MacTerminalTabSnapshot {
    MacTerminalTabSnapshot(
      windowID: windowID,
      windowIndex: windowIndex,
      tabIndex: 1,
      customTitle: title,
      tty: tty,
      isBusy: true,
      isSelectedInWindow: true,
      hasUnreadActivity: hasUnreadActivity
    )
  }

  private var automationDeniedFailure: MacTerminalTabFailure {
    MacTerminalTabFailure(
      code: "automation_denied",
      message: "Allow ClawDad to control Terminal.",
      state: nil
    )
  }
}

@MainActor
private final class StubTerminalAutomation: MacTerminalAutomating {
  var snapshots: [MacTerminalTabSnapshot]
  var focusCalls: [FocusCall] = []
  var supportsReordering = true
  var ignoreMove = false
  var readError: Error?
  var focusError: Error?

  init(
    snapshots: [MacTerminalTabSnapshot],
    readError: Error? = nil,
    focusError: Error? = nil
  ) {
    self.snapshots = snapshots
    self.readError = readError
    self.focusError = focusError
  }

  func readTabs() async throws -> [MacTerminalTabSnapshot] {
    if let readError {
      throw readError
    }
    return snapshots
  }

  func focusTab(windowID: Int, tabIndex: Int) async throws {
    focusCalls.append(FocusCall(windowID: windowID, tabIndex: tabIndex))
    if let focusError {
      throw focusError
    }
    guard let targetIndex = snapshots.firstIndex(where: {
      $0.windowID == windowID && $0.tabIndex == tabIndex
    }) else {
      throw MacTerminalTabFailure(
        code: "tab_unavailable",
        message: "Unavailable",
        state: nil
      )
    }
    let target = snapshots[targetIndex]
    var windows = [windowID]
    for snapshot in snapshots where !windows.contains(snapshot.windowID) { windows.append(snapshot.windowID) }
    snapshots = snapshots.map { snapshot in
      MacTerminalTabSnapshot(windowID: snapshot.windowID, windowIndex: (windows.firstIndex(of: snapshot.windowID) ?? 0) + 1,
        tabIndex: snapshot.tabIndex, customTitle: snapshot.customTitle, tty: snapshot.tty, isBusy: snapshot.isBusy,
        isSelectedInWindow: snapshot.windowID == windowID ? snapshot.tty == target.tty : snapshot.isSelectedInWindow,
        hasUnreadActivity: snapshot.hasUnreadActivity, visibleGroupID: snapshot.visibleGroupID, visibleTabIndex: snapshot.visibleTabIndex)
    }.sorted { $0.windowIndex == $1.windowIndex ? $0.tabIndex < $1.tabIndex : $0.windowIndex < $1.windowIndex }

  }
  func focusTab(windowID: Int, tabIndex: Int, tty: String) async throws {
    guard let actual = snapshots.first(where: { $0.windowID == windowID && $0.tty == tty }) else { throw MacTerminalTabFailure(code: "missing", message: "Missing", state: nil) }
    try await focusTab(windowID: windowID, tabIndex: actual.tabIndex)
  }

  func moveTab(windowID: Int, fromIndex: Int, toIndex: Int, expectedTTYs: [String]) async throws {
    guard !ignoreMove else { return }
    let groupID = snapshots.first { $0.windowID == windowID }!.groupID
    var group = snapshots.filter { $0.groupID == groupID }.sorted { $0.position < $1.position }
    XCTAssertEqual(group.map(\.tty), expectedTTYs)
    let source = group.remove(at: fromIndex - 1); group.insert(source, at: toIndex - 1)
    snapshots.removeAll { $0.groupID == groupID }
    snapshots += group.enumerated().map { offset, value in
      MacTerminalTabSnapshot(windowID: value.windowID, windowIndex: value.windowIndex,
        tabIndex: value.visibleGroupID == nil ? offset + 1 : value.tabIndex, customTitle: value.customTitle,
        tty: value.tty, isBusy: value.isBusy, isSelectedInWindow: value.isSelectedInWindow,
        visibleGroupID: value.visibleGroupID, visibleTabIndex: value.visibleGroupID == nil ? nil : offset + 1)
    }
  }

}

@MainActor
private final class StubTerminalPermissionRouter:
  MacTerminalAutomationPermissionRouting
{
  var openCallCount = 0

  func openAutomationSettings() -> Bool {
    openCallCount += 1
    return true
  }
}

private struct FocusCall: Equatable {
  let windowID: Int
  let tabIndex: Int
}
