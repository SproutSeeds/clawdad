import AppKit
import ClawDadRemoteAssistProtocol
import Foundation

struct MacTerminalTabSnapshot: Equatable, Sendable {
  let windowID: Int
  let windowIndex: Int
  let tabIndex: Int
  let customTitle: String
  let tty: String
  let isBusy: Bool
  let isSelectedInWindow: Bool
}

private struct MacTerminalTabIdentity: Hashable {
  let windowID: Int
  let tty: String
}

private struct MacTerminalTabTopologyEntry: Equatable {
  let identity: MacTerminalTabIdentity
  let windowIndex: Int
  let tabIndex: Int
}

struct MacTerminalTabFailure: LocalizedError {
  let code: String
  let message: String
  let state: RemoteTerminalTabState?

  var errorDescription: String? {
    message
  }
}

protocol MacTerminalAutomating: AnyObject {
  @MainActor
  func readTabs() async throws -> [MacTerminalTabSnapshot]
  @MainActor
  func focusTab(windowID: Int, tabIndex: Int) async throws
}

@MainActor
final class MacTerminalTabController {
  private let automation: MacTerminalAutomating
  private var revision = 1
  private var hasCatalog = false
  private var topology: [MacTerminalTabTopologyEntry] = []
  private var identifiers: [MacTerminalTabIdentity: String] = [:]
  private var snapshotsByIdentifier: [String: MacTerminalTabSnapshot] = [:]

  init(automation: MacTerminalAutomating = MacTerminalAutomation()) {
    self.automation = automation
  }

  func catalog() async throws -> RemoteTerminalTabState {
    let snapshots: [MacTerminalTabSnapshot]
    do {
      snapshots = try await automation.readTabs()
    } catch let failure as MacTerminalTabFailure {
      throw failure
    } catch {
      throw MacTerminalTabFailure(
        code: "automation_failed",
        message: error.localizedDescription,
        state: nil
      )
    }

    guard snapshots.count <= RemoteTerminalTabState.maximumTabs else {
      throw MacTerminalTabFailure(
        code: "too_many_tabs",
        message: "Terminal has too many open tabs to show safely.",
        state: nil
      )
    }
    return apply(snapshots)
  }

  func focus(
    tabID: String,
    expectedRevision: Int
  ) async throws -> RemoteTerminalTabState {
    let currentState = try await catalog()
    guard currentState.revision == expectedRevision else {
      throw MacTerminalTabFailure(
        code: "stale_catalog",
        message: "The Terminal tabs changed. Choose a tab again.",
        state: currentState
      )
    }
    guard let target = snapshotsByIdentifier[tabID] else {
      throw MacTerminalTabFailure(
        code: "tab_unavailable",
        message: "That Terminal tab is no longer open.",
        state: currentState
      )
    }

    do {
      try await automation.focusTab(
        windowID: target.windowID,
        tabIndex: target.tabIndex
      )
    } catch let failure as MacTerminalTabFailure {
      throw failure
    } catch {
      throw MacTerminalTabFailure(
        code: "focus_failed",
        message: error.localizedDescription,
        state: currentState
      )
    }

    let updatedState = try await catalog()
    guard updatedState.selectedTabId == tabID else {
      throw MacTerminalTabFailure(
        code: "focus_failed",
        message: "Terminal did not focus that tab.",
        state: updatedState
      )
    }
    return updatedState
  }

  private func apply(
    _ snapshots: [MacTerminalTabSnapshot]
  ) -> RemoteTerminalTabState {
    let nextTopology = snapshots.map { snapshot in
      MacTerminalTabTopologyEntry(
        identity: identity(for: snapshot),
        windowIndex: snapshot.windowIndex,
        tabIndex: snapshot.tabIndex
      )
    }
    if hasCatalog, nextTopology != topology, revision < Int.max {
      revision += 1
    }
    hasCatalog = true
    topology = nextTopology

    let activeIdentities = Set(nextTopology.map(\.identity))
    identifiers = identifiers.filter { activeIdentities.contains($0.key) }
    snapshotsByIdentifier.removeAll(keepingCapacity: true)

    var selectedTabID: String?
    let descriptors = snapshots.map { snapshot in
      let identity = identity(for: snapshot)
      let identifier = identifiers[identity] ?? UUID().uuidString.lowercased()
      identifiers[identity] = identifier
      snapshotsByIdentifier[identifier] = snapshot
      let isSelected = snapshot.windowIndex == 1 && snapshot.isSelectedInWindow
      if isSelected {
        selectedTabID = identifier
      }
      return RemoteTerminalTabDescriptor(
        id: identifier,
        title: macTerminalTabTitle(snapshot.customTitle),
        detail: "Window \(snapshot.windowIndex) • Tab \(snapshot.tabIndex)",
        isSelected: isSelected,
        isBusy: snapshot.isBusy
      )
    }
    return RemoteTerminalTabState(
      revision: revision,
      selectedTabId: selectedTabID,
      tabs: descriptors
    )
  }

  private func identity(
    for snapshot: MacTerminalTabSnapshot
  ) -> MacTerminalTabIdentity {
    MacTerminalTabIdentity(
      windowID: snapshot.windowID,
      tty: snapshot.tty
    )
  }
}

func macTerminalTabTitle(_ value: String) -> String {
  let printable = value.unicodeScalars.map { scalar in
    CharacterSet.controlCharacters.contains(scalar) ? " " : String(scalar)
  }.joined()
  let collapsed = printable
    .split(whereSeparator: \.isWhitespace)
    .joined(separator: " ")
  let source = collapsed.isEmpty ? "Terminal Tab" : collapsed
  var result = ""
  for character in source {
    let next = result + String(character)
    guard next.utf8.count <= RemoteTerminalTabDescriptor.maximumTitleBytes else {
      break
    }
    result = next
  }
  return result.isEmpty ? "Terminal Tab" : result
}

final class MacTerminalAutomation: MacTerminalAutomating, @unchecked Sendable {
  private let queue = DispatchQueue(
    label: "earth.frg.ClawDad.remote-assist.terminal",
    qos: .userInitiated
  )

  @MainActor
  func readTabs() async throws -> [MacTerminalTabSnapshot] {
    guard !NSRunningApplication.runningApplications(
      withBundleIdentifier: "com.apple.Terminal"
    ).isEmpty else {
      return []
    }
    return try await withCheckedThrowingContinuation { continuation in
      queue.async {
        continuation.resume(with: Result {
          let descriptor = try Self.execute(Self.catalogScript)
          return try Self.parseCatalog(descriptor)
        })
      }
    }
  }

  @MainActor
  func focusTab(windowID: Int, tabIndex: Int) async throws {
    guard !NSRunningApplication.runningApplications(
      withBundleIdentifier: "com.apple.Terminal"
    ).isEmpty else {
      throw MacTerminalTabFailure(
        code: "terminal_not_running",
        message: "Terminal is not open on the Mac.",
        state: nil
      )
    }
    let script = Self.focusScript(windowID: windowID, tabIndex: tabIndex)
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, Error>) in
      queue.async {
        continuation.resume(with: Result {
          _ = try Self.execute(script)
        })
      }
    }
  }

  private static let catalogScript = #"""
  tell application "Terminal"
    set tabRows to {}
    repeat with windowIndex from 1 to count of windows
      set terminalWindow to window windowIndex
      set windowId to id of terminalWindow
      repeat with tabIndex from 1 to count of tabs of terminalWindow
        set terminalTab to tab tabIndex of terminalWindow
        set tabTitle to custom title of terminalTab
        if tabTitle is missing value then set tabTitle to ""
        set end of tabRows to {windowId as integer, windowIndex, tabIndex, tabTitle as text, tty of terminalTab as text, busy of terminalTab, selected of terminalTab}
      end repeat
    end repeat
    return tabRows
  end tell
  """#

  private static func focusScript(
    windowID: Int,
    tabIndex: Int
  ) -> String {
    #"""
    tell application "Terminal"
      set matchingWindows to every window whose id is \#(windowID)
      if (count of matchingWindows) is not 1 then error "Terminal window unavailable" number -1728
      set targetWindow to item 1 of matchingWindows
      if (count of tabs of targetWindow) < \#(tabIndex) then error "Terminal tab unavailable" number -1728
      set selected tab of targetWindow to tab \#(tabIndex) of targetWindow
      set miniaturized of targetWindow to false
      set frontmost of targetWindow to true
      set index of targetWindow to 1
      activate
    end tell
    """#
  }

  private static func execute(
    _ source: String
  ) throws -> NSAppleEventDescriptor {
    guard let script = NSAppleScript(source: source) else {
      throw MacTerminalTabFailure(
        code: "automation_failed",
        message: "ClawDad could not prepare the Terminal command.",
        state: nil
      )
    }
    var details: NSDictionary?
    let descriptor = script.executeAndReturnError(&details)
    if let details {
      let number = details["NSAppleScriptErrorNumber"] as? Int ?? 0
      let message = details["NSAppleScriptErrorMessage"] as? String
      if number == -1743 {
        throw MacTerminalTabFailure(
          code: "automation_denied",
          message: "Allow ClawDad to control Terminal in System Settings > Privacy & Security > Automation.",
          state: nil
        )
      }
      if number == -600 {
        throw MacTerminalTabFailure(
          code: "terminal_not_running",
          message: "Terminal is not open on the Mac.",
          state: nil
        )
      }
      if number == -1728 {
        throw MacTerminalTabFailure(
          code: "tab_unavailable",
          message: "That Terminal tab is no longer open.",
          state: nil
        )
      }
      throw MacTerminalTabFailure(
        code: "automation_failed",
        message: message ?? "ClawDad could not communicate with Terminal.",
        state: nil
      )
    }
    return descriptor
  }

  private static func parseCatalog(
    _ descriptor: NSAppleEventDescriptor
  ) throws -> [MacTerminalTabSnapshot] {
    var snapshots: [MacTerminalTabSnapshot] = []
    let rowCount = descriptor.numberOfItems
    guard rowCount <= RemoteTerminalTabState.maximumTabs else {
      throw MacTerminalTabFailure(
        code: "too_many_tabs",
        message: "Terminal has too many open tabs to show safely.",
        state: nil
      )
    }
    guard rowCount > 0 else {
      return []
    }
    for rowIndex in 1...rowCount {
      guard let row = descriptor.atIndex(rowIndex),
            row.numberOfItems == 7,
            let customTitle = row.atIndex(4)?.stringValue,
            let tty = row.atIndex(5)?.stringValue,
            !tty.isEmpty else {
        throw MacTerminalTabFailure(
          code: "invalid_catalog",
          message: "Terminal returned an unreadable tab list.",
          state: nil
        )
      }
      snapshots.append(MacTerminalTabSnapshot(
        windowID: Int(row.atIndex(1)?.int32Value ?? 0),
        windowIndex: Int(row.atIndex(2)?.int32Value ?? 0),
        tabIndex: Int(row.atIndex(3)?.int32Value ?? 0),
        customTitle: customTitle,
        tty: tty,
        isBusy: row.atIndex(6)?.booleanValue ?? false,
        isSelectedInWindow: row.atIndex(7)?.booleanValue ?? false
      ))
    }
    guard snapshots.allSatisfy({
      $0.windowID > 0 && $0.windowIndex > 0 && $0.tabIndex > 0
    }) else {
      throw MacTerminalTabFailure(
        code: "invalid_catalog",
        message: "Terminal returned an unreadable tab list.",
        state: nil
      )
    }
    return snapshots
  }
}
