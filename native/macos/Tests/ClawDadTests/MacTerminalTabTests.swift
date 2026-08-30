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
      isSelectedInWindow: true
    )
    let presentationChange = try await controller.catalog()
    XCTAssertEqual(presentationChange.revision, first.revision)

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

  private var initialSnapshots: [MacTerminalTabSnapshot] {
    [
      snapshot(
        windowID: 10,
        windowIndex: 1,
        title: "clawdad",
        tty: "/dev/ttys001"
      ),
      snapshot(
        windowID: 20,
        windowIndex: 2,
        title: "life-ops",
        tty: "/dev/ttys002"
      ),
    ]
  }

  private func snapshot(
    windowID: Int,
    windowIndex: Int,
    title: String,
    tty: String
  ) -> MacTerminalTabSnapshot {
    MacTerminalTabSnapshot(
      windowID: windowID,
      windowIndex: windowIndex,
      tabIndex: 1,
      customTitle: title,
      tty: tty,
      isBusy: true,
      isSelectedInWindow: true
    )
  }
}

@MainActor
private final class StubTerminalAutomation: MacTerminalAutomating {
  var snapshots: [MacTerminalTabSnapshot]
  var focusCalls: [FocusCall] = []

  init(snapshots: [MacTerminalTabSnapshot]) {
    self.snapshots = snapshots
  }

  func readTabs() async throws -> [MacTerminalTabSnapshot] {
    snapshots
  }

  func focusTab(windowID: Int, tabIndex: Int) async throws {
    focusCalls.append(FocusCall(windowID: windowID, tabIndex: tabIndex))
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
        isSelectedInWindow: snapshot.isSelectedInWindow
      )
    }
    snapshots.insert(MacTerminalTabSnapshot(
      windowID: target.windowID,
      windowIndex: 1,
      tabIndex: target.tabIndex,
      customTitle: target.customTitle,
      tty: target.tty,
      isBusy: target.isBusy,
      isSelectedInWindow: true
    ), at: 0)
  }
}

private struct FocusCall: Equatable {
  let windowID: Int
  let tabIndex: Int
}
