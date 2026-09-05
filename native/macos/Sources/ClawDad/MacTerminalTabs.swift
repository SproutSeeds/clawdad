import AppKit
import ApplicationServices
import ClawDadRemoteAssistProtocol
import CoreServices
import Foundation

struct MacTerminalTabSnapshot: Equatable, Sendable {
  let windowID: Int
  let windowIndex: Int
  let tabIndex: Int
  let customTitle: String
  let tty: String
  let isBusy: Bool
  let isSelectedInWindow: Bool
  let hasUnreadActivity: Bool
  let visibleGroupID: Int?
  let visibleTabIndex: Int?
  var groupID: Int { visibleGroupID ?? windowID }
  var position: Int { visibleTabIndex ?? tabIndex }

  init(
    windowID: Int,
    windowIndex: Int,
    tabIndex: Int,
    customTitle: String,
    tty: String,
    isBusy: Bool,
    isSelectedInWindow: Bool,
    hasUnreadActivity: Bool = false,
    visibleGroupID: Int? = nil,
    visibleTabIndex: Int? = nil
  ) {
    self.windowID = windowID
    self.windowIndex = windowIndex
    self.tabIndex = tabIndex
    self.customTitle = customTitle
    self.tty = tty
    self.isBusy = isBusy
    self.isSelectedInWindow = isSelectedInWindow
    self.hasUnreadActivity = hasUnreadActivity
    self.visibleGroupID = visibleGroupID
    self.visibleTabIndex = visibleTabIndex
  }
}

private struct MacTerminalTabLocation: Hashable {
  let windowIndex: Int
  let tabIndex: Int
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
  @MainActor var supportsReordering: Bool { get }
  @MainActor
  func readTabs() async throws -> [MacTerminalTabSnapshot]
  @MainActor
  func focusTab(windowID: Int, tabIndex: Int) async throws
  @MainActor
  func focusTab(windowID: Int, tabIndex: Int, tty: String) async throws
  @MainActor
  func moveTab(windowID: Int, fromIndex: Int, toIndex: Int, expectedTTYs: [String]) async throws
}

extension MacTerminalAutomating {
  @MainActor var supportsReordering: Bool { false }
  @MainActor
  func moveTab(windowID: Int, fromIndex: Int, toIndex: Int, expectedTTYs: [String]) async throws {
    throw MacTerminalTabFailure(code: "reorder_unavailable", message: "This computer cannot reorder Terminal tabs.", state: nil)
  }
  @MainActor
  func focusTab(windowID: Int, tabIndex: Int, tty: String) async throws {
    try await focusTab(windowID: windowID, tabIndex: tabIndex)
  }
}

@MainActor
protocol MacTerminalAutomationPermissionRouting: AnyObject {
  @discardableResult
  func openAutomationSettings() -> Bool
}

let macTerminalAutomationSettingsURL = URL(
  string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
)

@MainActor
final class MacTerminalAutomationPermissionRouter:
  MacTerminalAutomationPermissionRouting
{
  @discardableResult
  func openAutomationSettings() -> Bool {
    guard let url = macTerminalAutomationSettingsURL else {
      return false
    }
    return NSWorkspace.shared.open(url)
  }
}

@MainActor
final class MacTerminalTabController {
  private let automation: MacTerminalAutomating
  private let permissionRouter: MacTerminalAutomationPermissionRouting
  private let readResponse: @MainActor (String) async throws -> RemoteTerminalResponse
  private var revision = 1
  private var hasCatalog = false
  private var topology: [MacTerminalTabTopologyEntry] = []
  private var identifiers: [MacTerminalTabIdentity: String] = [:]
  private var snapshotsByIdentifier: [String: MacTerminalTabSnapshot] = [:]
  private var windowOrder: [Int] = []
  private var lastState: RemoteTerminalTabState?

  func latestResponse(_ request: RemoteTerminalResponseMessage) async throws -> RemoteTerminalResponseMessage {
    let state = try await catalog()
    guard state.revision == request.expectedRevision,
          state.selectedTabId == request.tabId,
          let target = snapshotsByIdentifier[request.tabId] else {
      throw MacTerminalResponseFailure(message: "The selected Terminal tab changed. Tap Read latest response again.")
    }
    let response = try await readResponse(target.tty)
    try Task.checkCancellation()
    let refreshed = try await catalog()
    guard refreshed.revision == request.expectedRevision,
          refreshed.selectedTabId == request.tabId,
          snapshotsByIdentifier[request.tabId]?.tty == target.tty else {
      throw MacTerminalResponseFailure(message: "The selected Terminal tab changed while reading. Try again.")
    }
    return request.success(tabTitle: macTerminalTabTitle(target.customTitle), response: response)
  }

  init(
    automation: MacTerminalAutomating = MacTerminalAutomation(),
    permissionRouter: MacTerminalAutomationPermissionRouting? = nil,
    readResponse: @escaping @MainActor (String) async throws -> RemoteTerminalResponse = { tty in
      try await Task.detached(priority: .userInitiated) { try MacTerminalResponseReader().read(tty: tty) }.value
    }
  ) {
    self.automation = automation
    self.readResponse = readResponse
    self.permissionRouter = permissionRouter ??
      MacTerminalAutomationPermissionRouter()
  }

  func catalog() async throws -> RemoteTerminalTabState {
    let snapshots: [MacTerminalTabSnapshot]
    do {
      snapshots = try await automation.readTabs()
    } catch let failure as MacTerminalTabFailure {
      throw routePermissionIfNeeded(failure)
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
    guard let currentState = lastState else {
      throw MacTerminalTabFailure(code: "stale_catalog", message: "Refresh the Terminal tabs first.", state: nil)
    }
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
        tabIndex: target.tabIndex,
        tty: target.tty
      )
    } catch let failure as MacTerminalTabFailure {
      throw routePermissionIfNeeded(failure)
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

  private func routePermissionIfNeeded(
    _ failure: MacTerminalTabFailure
  ) -> MacTerminalTabFailure {
    guard failure.code == "automation_denied",
          permissionRouter.openAutomationSettings() else {
      return failure
    }
    return MacTerminalTabFailure(
      code: failure.code,
      message: "Mac System Settings is open. Turn on ClawDad for Terminal under Privacy & Security > Automation, then tap Refresh.",
      state: failure.state
    )
  }

  func move(_ request: RemoteTerminalTabMessage) async throws -> RemoteTerminalTabState {
    let state = try await catalog()
    guard state.revision == request.expectedRevision else {
      throw MacTerminalTabFailure(code: "stale_catalog", message: "The tab order changed on the Mac. The picker has refreshed; drag again.", state: state)
    }
    guard automation.supportsReordering,
          let sourceID = request.tabId, let neighborID = request.neighborTabId,
          let source = snapshotsByIdentifier[sourceID], let neighbor = snapshotsByIdentifier[neighborID],
          source.groupID == neighbor.groupID, sourceID != neighborID else {
      throw MacTerminalTabFailure(code: "reorder_unavailable", message: "Move tabs within the same Terminal window.", state: state)
    }
    let group = state.tabs.filter { snapshotsByIdentifier[$0.id]?.groupID == source.groupID }
    var expectedIDs = group.map(\.id).filter { $0 != sourceID }
    guard let neighborOffset = expectedIDs.firstIndex(of: neighborID) else { return state }
    expectedIDs.insert(sourceID, at: neighborOffset + (request.placeBefore == true ? 0 : 1))
    if expectedIDs == group.map(\.id) { return state }
    let previousSelected = state.selectedTabId.flatMap { snapshotsByIdentifier[$0] }
    do {
      try await automation.moveTab(windowID: source.windowID, fromIndex: source.position,
                                   toIndex: (expectedIDs.firstIndex(of: sourceID) ?? 0) + 1,
                                   expectedTTYs: group.compactMap { snapshotsByIdentifier[$0.id]?.tty })
      if let previousSelected {
        try await automation.focusTab(windowID: previousSelected.windowID,
                                       tabIndex: previousSelected.tabIndex, tty: previousSelected.tty)
      }
    } catch {
      if let previousSelected {
        try? await automation.focusTab(windowID: previousSelected.windowID, tabIndex: previousSelected.tabIndex, tty: previousSelected.tty)
      }
      let refreshed = try? await catalog()
      throw MacTerminalTabFailure(code: "reorder_failed", message: error.localizedDescription, state: refreshed ?? state)
    }
    let refreshed = try await catalog()
    let actualIDs = refreshed.tabs.filter { snapshotsByIdentifier[$0.id]?.groupID == source.groupID }.map(\.id)
    guard actualIDs == expectedIDs, refreshed.selectedTabId == state.selectedTabId else {
      throw MacTerminalTabFailure(code: "reorder_unconfirmed", message: "Terminal did not confirm that order. The picker shows the current Mac order.", state: refreshed)
    }
    return refreshed
  }

  private func apply(
    _ observed: [MacTerminalTabSnapshot]
  ) -> RemoteTerminalTabState {
    // Terminal's window index is front-to-back order, not tab-strip order.
    // Keep independent windows stable while preserving each window's real tabs.
    let activeWindows = Set(observed.map(\.groupID))
    windowOrder.removeAll { !activeWindows.contains($0) }
    for snapshot in observed where !windowOrder.contains(snapshot.groupID) {
      windowOrder.append(snapshot.groupID)
    }
    let snapshots = observed.sorted {
      let left = windowOrder.firstIndex(of: $0.groupID) ?? 0
      let right = windowOrder.firstIndex(of: $1.groupID) ?? 0
      return left == right ? $0.position < $1.position : left < right
    }
    let nextTopology = snapshots.map { snapshot in
      MacTerminalTabTopologyEntry(
        identity: identity(for: snapshot),
        windowIndex: windowOrder.firstIndex(of: snapshot.groupID) ?? 0,
        tabIndex: snapshot.position
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
        detail: "Window \((windowOrder.firstIndex(of: snapshot.groupID) ?? 0) + 1) • Tab \(snapshot.position)",
        isSelected: isSelected,
        isBusy: snapshot.isBusy,
        hasUnreadActivity: snapshot.hasUnreadActivity && !isSelected,
        windowGroupId: "terminal-window-\(snapshot.groupID)",
        tabPosition: snapshot.position,
        canReorder: automation.supportsReordering && snapshots.filter { $0.groupID == snapshot.groupID }.count > 1
      )
    }
    let state = RemoteTerminalTabState(
      revision: revision,
      selectedTabId: selectedTabID,
      tabs: descriptors
    )
    lastState = state
    return state
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

/// Native macOS tab groups can expose each visible tab as a separate scripted
/// window. Bind only unambiguous tab labels; duplicate titles never get guessed.
func macTerminalNativeGroupMembers(titles: [String], snapshots: [MacTerminalTabSnapshot]) -> [MacTerminalTabSnapshot]? {
  guard titles.count > 1 else { return nil }
  let windowCounts = Dictionary(grouping: snapshots, by: \.windowID).mapValues(\.count)
  let candidates = snapshots.filter { windowCounts[$0.windowID] == 1 && !$0.customTitle.isEmpty }
  var members: [MacTerminalTabSnapshot] = []
  for title in titles {
    let title = macTerminalTabTitle(title)
    let exact = candidates.filter { macTerminalTabTitle($0.customTitle) == title }
    let matches = exact.isEmpty ? candidates.filter { title.contains(macTerminalTabTitle($0.customTitle)) } : exact
    guard matches.count == 1, let match = matches.first,
          !members.contains(where: { $0.windowID == match.windowID }) else { return nil }
    members.append(match)
  }
  return members
}

func macTerminalAutomationFailure(
  for status: OSStatus
) -> MacTerminalTabFailure? {
  if status == noErr {
    return nil
  }
  if status == OSStatus(errAEEventNotPermitted) ||
      status == OSStatus(errAEEventWouldRequireUserConsent) {
    return MacTerminalTabFailure(
      code: "automation_denied",
      message: "Allow ClawDad to control Terminal in System Settings > Privacy & Security > Automation.",
      state: nil
    )
  }
  if status == OSStatus(procNotFound) {
    return MacTerminalTabFailure(
      code: "terminal_not_running",
      message: "Terminal is not open on the Mac.",
      state: nil
    )
  }
  return MacTerminalTabFailure(
    code: "automation_failed",
    message: "macOS could not check ClawDad's Terminal Automation permission (\(status)).",
    state: nil
  )
}

final class MacTerminalAutomation: MacTerminalAutomating, @unchecked Sendable {
  @MainActor var supportsReordering: Bool { AXIsProcessTrusted() }
  // Accessed only on queue. Activity badges do not need a full AX tree walk
  // for every focus/read or every two-second catalog poll.
  private var activityCheckedAt = Date.distantPast
  private var unreadTTYs: Set<String> = []
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
          try Self.requestAutomationPermission()
          let descriptor = try Self.execute(Self.catalogScript)
          let snapshots = try Self.parseCatalog(descriptor)
          if Date().timeIntervalSince(self.activityCheckedAt) >= 8 {
            let locations = Self.unreadActivityLocations()
            self.unreadTTYs = Set(snapshots.filter {
              locations.contains(MacTerminalTabLocation(windowIndex: $0.windowIndex, tabIndex: $0.tabIndex))
            }.map(\.tty))
            self.activityCheckedAt = Date()
          }
          return Self.applyVisibleTabGroups(Self.applyUnreadActivity(Set(snapshots.filter { self.unreadTTYs.contains($0.tty) }.map {
            MacTerminalTabLocation(windowIndex: $0.windowIndex, tabIndex: $0.tabIndex)
          }), to: snapshots))
        })
      }
    }
  }

  @MainActor
  func focusTab(windowID: Int, tabIndex: Int) async throws {
    try await focusTab(windowID: windowID, tabIndex: tabIndex, tty: "")
  }

  @MainActor
  func focusTab(windowID: Int, tabIndex: Int, tty: String) async throws {
    guard !NSRunningApplication.runningApplications(
      withBundleIdentifier: "com.apple.Terminal"
    ).isEmpty else {
      throw MacTerminalTabFailure(
        code: "terminal_not_running",
        message: "Terminal is not open on the Mac.",
        state: nil
      )
    }
    guard tty.isEmpty || tty.range(of: "^/dev/tty[A-Za-z0-9]+$", options: .regularExpression) != nil else {
      throw MacTerminalTabFailure(code: "tab_unavailable", message: "That Terminal tab is unavailable.", state: nil)
    }
    let script = Self.focusScript(windowID: windowID, tabIndex: tabIndex, tty: tty)
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, Error>) in
      queue.async {
        continuation.resume(with: Result {
          try Self.requestAutomationPermission()
          _ = try Self.execute(script)
        })
      }
    }
  }

  @MainActor
  func moveTab(windowID: Int, fromIndex: Int, toIndex: Int, expectedTTYs: [String]) async throws {
    guard expectedTTYs.indices.contains(fromIndex - 1), expectedTTYs.indices.contains(toIndex - 1) else {
      throw MacTerminalTabFailure(code: "reorder_failed", message: "The tab order changed. Refresh and try again.", state: nil)
    }
    try await focusTab(windowID: windowID, tabIndex: fromIndex, tty: expectedTTYs[fromIndex - 1])
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      queue.async {
        continuation.resume(with: Result {
          let snapshots = try Self.applyVisibleTabGroups(Self.parseCatalog(Self.execute(Self.catalogScript)))
          let groupID = snapshots.first { $0.windowID == windowID }?.groupID
          let group = snapshots.filter { $0.groupID == groupID }.sorted { $0.position < $1.position }
          guard group.map(\.tty) == expectedTTYs, group.contains(where: { $0.windowIndex == 1 }) else {
            throw MacTerminalTabFailure(code: "stale_catalog", message: "The Terminal tabs changed before the move. Drag again.", state: nil)
          }
          try Self.dragTab(fromIndex: fromIndex, toIndex: toIndex, group: group)
        })
      }
    }
  }

  // Terminal exposes no writable tab position in its scripting dictionary.
  // Move the existing tab in its tab strip; never recreate a shell or a session.
  private static func dragTab(fromIndex: Int, toIndex: Int, group: [MacTerminalTabSnapshot]) throws {
    func unavailable() -> MacTerminalTabFailure {
      MacTerminalTabFailure(code: "reorder_unavailable", message: "ClawDad could not identify the visible Terminal tab handles. Show the tab bar on the Mac and try again.", state: nil)
    }
    guard AXIsProcessTrusted(), !MacConsoleSessionState.isLocked(),
          let terminal = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Terminal").first,
          terminal.isActive else { throw unavailable() }
    let application = AXUIElementCreateApplication(terminal.processIdentifier)
    AXUIElementSetMessagingTimeout(application, 0.5)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute as CFString, &value) == .success,
          let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { throw unavailable() }
    let window = unsafeBitCast(value, to: AXUIElement.self)
    guard let tabGroup = firstAccessibilityElement(withRole: kAXTabGroupRole as String, in: window, maximumDepth: 3) else { throw unavailable() }
    let tabs = accessibilityElements(tabGroup, attribute: kAXChildrenAttribute as CFString).filter {
      accessibilityString($0, attribute: kAXRoleAttribute as CFString) == kAXRadioButtonRole as String
    }
    guard tabs.count == group.count, tabs.indices.contains(fromIndex - 1), tabs.indices.contains(toIndex - 1) else { throw unavailable() }
    // Validate the labels as well as positions, so an unfamiliar AX tab group
    // cannot turn a reorder into a drag of unrelated controls.
    for (tab, snapshot) in zip(tabs, group) where !snapshot.customTitle.isEmpty {
      let label = [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute].compactMap {
        accessibilityString(tab, attribute: $0 as CFString)
      }.joined(separator: " ")
      guard label.contains(snapshot.customTitle) else { throw unavailable() }
    }
    func frame(_ element: AXUIElement) -> CGRect? {
      var pointValue: CFTypeRef?, sizeValue: CFTypeRef?
      guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &pointValue) == .success,
            AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success,
            let pointValue, let sizeValue,
            CFGetTypeID(pointValue) == AXValueGetTypeID(), CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return nil }
      var point = CGPoint.zero, size = CGSize.zero
      guard AXValueGetValue(unsafeBitCast(pointValue, to: AXValue.self), .cgPoint, &point),
            AXValueGetValue(unsafeBitCast(sizeValue, to: AXValue.self), .cgSize, &size),
            size.width > 8, size.height > 8 else { return nil }
      return CGRect(origin: point, size: size)
    }
    guard let source = frame(tabs[fromIndex - 1]), let target = frame(tabs[toIndex - 1]),
          abs(source.midY - target.midY) < 4 else { throw unavailable() }
    let start = CGPoint(x: source.midX, y: source.midY)
    let end = CGPoint(x: toIndex > fromIndex ? target.maxX - 3 : target.minX + 3, y: target.midY)
    var last = start
    guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left) else { throw unavailable() }
    down.post(tap: .cghidEventTap)
    defer { CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: last, mouseButton: .left)?.post(tap: .cghidEventTap) }
    for step in 1...12 {
      guard terminal.isActive, !MacConsoleSessionState.isLocked() else { throw unavailable() }
      let fraction = CGFloat(step) / 12
      last = CGPoint(x: start.x + (end.x - start.x) * fraction, y: start.y)
      CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: last, mouseButton: .left)?.post(tap: .cghidEventTap)
      Thread.sleep(forTimeInterval: 0.02)
    }
  }

  static let catalogScript = #"""
  with timeout of 3 seconds
  tell application "Terminal"
    set tabRows to {}
    repeat with windowIndex from 1 to count of windows
      set terminalWindow to window windowIndex
      set windowId to id of terminalWindow
      set tabTitles to custom title of tabs of terminalWindow
      set tabTTYs to tty of tabs of terminalWindow
      set tabBusy to busy of tabs of terminalWindow
      set tabSelected to selected of tabs of terminalWindow
      repeat with tabIndex from 1 to count of tabTTYs
        set tabTitle to item tabIndex of tabTitles
        if tabTitle is missing value then set tabTitle to ""
        set end of tabRows to {windowId as integer, windowIndex, tabIndex, tabTitle as text, item tabIndex of tabTTYs, item tabIndex of tabBusy, item tabIndex of tabSelected}
      end repeat
    end repeat
    return tabRows
  end tell
  end timeout
  """#

  static func focusScript(
    windowID: Int,
    tabIndex: Int,
    tty: String
  ) -> String {
    #"""
    with timeout of 3 seconds
    tell application "Terminal"
      set matchingWindows to every window whose id is \#(windowID)
      if (count of matchingWindows) is not 1 then error "Terminal window unavailable" number -1728
      set targetWindow to item 1 of matchingWindows
      \#(tty.isEmpty ? "set targetTab to tab \(tabIndex) of targetWindow" : "set targetTabs to every tab of targetWindow whose tty is \"\(tty)\"\n      if (count of targetTabs) is not 1 then error \"Terminal tab unavailable\" number -1728\n      set targetTab to item 1 of targetTabs")
      set selected tab of targetWindow to targetTab
      set miniaturized of targetWindow to false
      set frontmost of targetWindow to true
      set index of targetWindow to 1
      activate
    end tell
    end timeout
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

  private static func requestAutomationPermission() throws {
    let target = NSAppleEventDescriptor(
      bundleIdentifier: "com.apple.Terminal"
    )
    guard let address = target.aeDesc else {
      throw MacTerminalTabFailure(
        code: "automation_failed",
        message: "ClawDad could not identify Terminal for Automation access.",
        state: nil
      )
    }
    let status = AEDeterminePermissionToAutomateTarget(
      address,
      typeWildCard,
      typeWildCard,
      true
    )
    if let failure = macTerminalAutomationFailure(for: status) {
      throw failure
    }
  }

  private static func unreadActivityLocations() -> Set<MacTerminalTabLocation> {
    guard AXIsProcessTrusted(),
          let terminal = NSRunningApplication.runningApplications(
            withBundleIdentifier: "com.apple.Terminal"
          ).first else {
      return []
    }

    let application = AXUIElementCreateApplication(
      terminal.processIdentifier
    )
    let terminalWindows = accessibilityElements(
      application,
      attribute: kAXWindowsAttribute as CFString
    ).compactMap { window -> (AXUIElement, AXUIElement)? in
      guard let tabGroup = firstAccessibilityElement(
        withRole: kAXTabGroupRole as String,
        in: window,
        maximumDepth: 2
      ) else {
        return nil
      }
      return (window, tabGroup)
    }

    var locations: Set<MacTerminalTabLocation> = []
    for (windowOffset, terminalWindow) in terminalWindows.enumerated() {
      let tabGroup = terminalWindow.1
      let tabButtons = accessibilityElements(
        tabGroup,
        attribute: kAXChildrenAttribute as CFString
      ).filter {
        accessibilityString(
          $0,
          attribute: kAXRoleAttribute as CFString
        ) == kAXRadioButtonRole as String
      }
      for (tabOffset, tabButton) in tabButtons.enumerated() {
        let hasTabAlert = accessibilityElements(
          tabButton,
          attribute: kAXChildrenAttribute as CFString
        ).contains {
          accessibilityString(
            $0,
            attribute: kAXDescriptionAttribute as CFString
          ) == "TabAlert"
        }
        if hasTabAlert {
          locations.insert(MacTerminalTabLocation(
            windowIndex: windowOffset + 1,
            tabIndex: tabOffset + 1
          ))
        }
      }
    }
    return locations
  }

  private static func applyUnreadActivity(
    _ locations: Set<MacTerminalTabLocation>,
    to snapshots: [MacTerminalTabSnapshot]
  ) -> [MacTerminalTabSnapshot] {
    snapshots.map { snapshot in
      MacTerminalTabSnapshot(
        windowID: snapshot.windowID,
        windowIndex: snapshot.windowIndex,
        tabIndex: snapshot.tabIndex,
        customTitle: snapshot.customTitle,
        tty: snapshot.tty,
        isBusy: snapshot.isBusy,
        isSelectedInWindow: snapshot.isSelectedInWindow,
        hasUnreadActivity: locations.contains(MacTerminalTabLocation(
          windowIndex: snapshot.windowIndex,
          tabIndex: snapshot.tabIndex
        ))
      )
    }
  }

  private static func applyVisibleTabGroups(_ snapshots: [MacTerminalTabSnapshot]) -> [MacTerminalTabSnapshot] {
    guard AXIsProcessTrusted(),
          let terminal = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Terminal").first else { return snapshots }
    let application = AXUIElementCreateApplication(terminal.processIdentifier)
    AXUIElementSetMessagingTimeout(application, 0.25)
    let windows = accessibilityElements(application, attribute: kAXWindowsAttribute as CFString)
    var groups: [Int: (id: Int, position: Int)] = [:]
    for window in windows {
      guard let tabGroup = firstAccessibilityElement(withRole: kAXTabGroupRole as String, in: window, maximumDepth: 2) else { continue }
      let tabs = accessibilityElements(tabGroup, attribute: kAXChildrenAttribute as CFString).filter {
        accessibilityString($0, attribute: kAXRoleAttribute as CFString) == kAXRadioButtonRole as String
      }
      let titles = tabs.map { tab in
        [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute].compactMap {
          accessibilityString(tab, attribute: $0 as CFString)
        }.first(where: { !$0.isEmpty }) ?? ""
      }
      guard let members = macTerminalNativeGroupMembers(titles: titles, snapshots: snapshots),
            let groupID = members.map(\.windowID).min() else { continue }
      for (position, member) in members.enumerated() { groups[member.windowID] = (groupID, position + 1) }
    }
    return snapshots.map { snapshot in
      guard let group = groups[snapshot.windowID] else { return snapshot }
      return MacTerminalTabSnapshot(windowID: snapshot.windowID, windowIndex: snapshot.windowIndex, tabIndex: snapshot.tabIndex,
        customTitle: snapshot.customTitle, tty: snapshot.tty, isBusy: snapshot.isBusy,
        isSelectedInWindow: snapshot.isSelectedInWindow, hasUnreadActivity: snapshot.hasUnreadActivity,
        visibleGroupID: group.id, visibleTabIndex: group.position)
    }
  }

  private static func firstAccessibilityElement(
    withRole role: String,
    in root: AXUIElement,
    maximumDepth: Int
  ) -> AXUIElement? {
    guard maximumDepth >= 0 else {
      return nil
    }
    let children = accessibilityElements(
      root,
      attribute: kAXChildrenAttribute as CFString
    )
    if let match = children.first(where: {
      accessibilityString(
        $0,
        attribute: kAXRoleAttribute as CFString
      ) == role
    }) {
      return match
    }
    guard maximumDepth > 0 else {
      return nil
    }
    for child in children {
      if let match = firstAccessibilityElement(
        withRole: role,
        in: child,
        maximumDepth: maximumDepth - 1
      ) {
        return match
      }
    }
    return nil
  }

  private static func accessibilityElements(
    _ element: AXUIElement,
    attribute: CFString
  ) -> [AXUIElement] {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
      element,
      attribute,
      &value
    ) == .success,
    let elements = value as? [AXUIElement] else {
      return []
    }
    return elements
  }

  private static func accessibilityString(
    _ element: AXUIElement,
    attribute: CFString
  ) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
      element,
      attribute,
      &value
    ) == .success else {
      return nil
    }
    return value as? String
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
