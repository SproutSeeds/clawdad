import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDad

@MainActor
final class MacTerminalTabTests: XCTestCase {
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
    XCTAssertEqual(topologyChange.revision, first.revision + 1)
  }

  func testFocusRejectsStaleCatalogBeforeAutomation() async throws {
    let automation = StubTerminalAutomation(snapshots: initialSnapshots)
    let controller = MacTerminalTabController(automation: automation)
    let initial = try await controller.catalog()
    automation.snapshots.append(snapshot(
      windowID: 30,
      windowIndex: 3,
      title: "new-tab",
      tty: "/dev/ttys003"
    ))

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
    XCTAssertEqual(focused.tabs.first?.title, "life-ops")
  }

  func testEmptyCatalogDoesNotLaunchTerminal() async throws {
    let automation = StubTerminalAutomation(snapshots: [])
    let controller = MacTerminalTabController(automation: automation)

    let state = try await controller.catalog()

    XCTAssertEqual(state.revision, 1)
    XCTAssertNil(state.selectedTabId)
    XCTAssertTrue(state.tabs.isEmpty)
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
    let target = snapshots.remove(at: targetIndex)
    snapshots = snapshots.enumerated().map { index, snapshot in
      MacTerminalTabSnapshot(
        windowID: snapshot.windowID,
        windowIndex: index + 2,
        tabIndex: snapshot.tabIndex,
        customTitle: snapshot.customTitle,
        tty: snapshot.tty,
        isBusy: snapshot.isBusy,
        isSelectedInWindow: snapshot.isSelectedInWindow,
        hasUnreadActivity: snapshot.hasUnreadActivity
      )
    }
    snapshots.insert(MacTerminalTabSnapshot(
      windowID: target.windowID,
      windowIndex: 1,
      tabIndex: target.tabIndex,
      customTitle: target.customTitle,
      tty: target.tty,
      isBusy: target.isBusy,
      isSelectedInWindow: true,
      hasUnreadActivity: target.hasUnreadActivity
    ), at: 0)
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
