import AppKit
import ApplicationServices
import Foundation

/// Observe a complete native layout before committing any identity changes.
/// A shell is associated with a control only when both APIs confirm its selection.
final class MacNativeTerminalTabs {
  struct Binding {
    let id: String
    let groupID: Int
    let window: AXUIElement
    let control: AXUIElement
    let position: Int
    let title: String
    let selected: Bool
    let focused: Bool
    let unread: Bool
    let frame: CGRect?
    let canReorder: Bool
  }
  private struct ObservedTab {
    let control: AXUIElement
    let title: String
    let selected: Bool
    let unread: Bool
    let frame: CGRect?
  }
  private struct ObservedWindow {
    let window: AXUIElement
    let focused: Bool
    let tabs: [ObservedTab]
    let canReorder: Bool
  }
  private struct Group {
    let id: Int
    var windows: [AXUIElement]
  }
  private var groups: [Group] = []
  private var nextGroup = 1
  private var knownShells: [String: MacTerminalTabSnapshot] = [:]
  private(set) var bindings: [Binding] = []
  private let readAttribute: ((AXUIElement, String) throws -> CFTypeRef?)?
  private let now: () -> TimeInterval
  private var deadline: TimeInterval = .infinity

  init(readAttribute: ((AXUIElement, String) throws -> CFTypeRef?)? = nil,
       now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
    self.readAttribute = readAttribute
    self.now = now
  }

  private func prepare(_ element: AXUIElement) throws {
    let remaining = deadline - now()
    guard remaining > 0 else { throw failure("Terminal is taking too long to respond. Try again.") }
    if readAttribute == nil {
      AXUIElementSetMessagingTimeout(element, Float(min(0.2, remaining)))
    }
  }
  private func value(_ element: AXUIElement, _ attribute: String, required: Bool = false) throws -> CFTypeRef? {
    try prepare(element)
    let result: CFTypeRef?
    if let readAttribute {
      result = try readAttribute(element, attribute)
    } else {
      var raw: CFTypeRef?
      let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &raw)
      switch error {
      case .success: result = raw
      case .attributeUnsupported, .noValue: result = nil
      default: throw failure("Terminal's window layout is temporarily unavailable (\(error.rawValue)).")
      }
    }
    guard !required || result != nil else { throw failure("Terminal's window layout is temporarily unavailable.") }
    return result
  }
  private func elements(_ element: AXUIElement, _ attribute: String, required: Bool = false) throws -> [AXUIElement] {
    let raw = try value(element, attribute, required: required)
    if let raw, let result = raw as? [AXUIElement] { return result }
    guard raw == nil && !required else { throw failure("Terminal returned an incomplete window layout.") }
    return []
  }
  private func role(_ element: AXUIElement) throws -> String {
    try value(element, kAXRoleAttribute, required: true) as? String ?? ""
  }
  private func structure(_ window: AXUIElement) throws -> (text: Bool, strip: AXUIElement?) {
    var queue = [(window, 0)], visited = 0, hasText = false
    var strip: AXUIElement?
    while !queue.isEmpty, visited < 256 {
      if hasText && strip != nil { break }
      let (element, depth) = queue.removeFirst(); visited += 1
      let elementRole = try role(element)
      if elementRole == kAXTextAreaRole { hasText = true; continue }
      if elementRole == kAXTabGroupRole { strip = element; continue }
      if depth < 8 {
        queue += try elements(element, kAXChildrenAttribute).prefix(128).map { ($0, depth + 1) }
      }
    }
    return (hasText, strip)
  }
  private func frame(_ element: AXUIElement) throws -> CGRect? {
    guard let pointValue = try value(element, kAXPositionAttribute),
          let sizeValue = try value(element, kAXSizeAttribute),
          CFGetTypeID(pointValue) == AXValueGetTypeID(),
          CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(pointValue, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(sizeValue, to: AXValue.self), .cgSize, &size),
          point.x.isFinite, point.y.isFinite, size.width.isFinite, size.height.isFinite else { return nil }
    return CGRect(origin: point, size: size)
  }
  private func observe(application: AXUIElement) throws -> [ObservedWindow] {
    let focused = try value(application, kAXFocusedWindowAttribute) ?? value(application, kAXMainWindowAttribute)
    let windows = try elements(application, kAXWindowsAttribute, required: true)
    guard windows.count <= 128 else { throw failure("Terminal has too many windows to show.") }
    var result: [ObservedWindow] = []
    for window in windows {
      let layout = try structure(window)
      guard layout.text else { continue }
      var controls: [AXUIElement] = []
      var selected: CFTypeRef?
      if let strip = layout.strip {
        controls = try elements(strip, kAXTabsAttribute, required: true)
        guard !controls.isEmpty, try controls.allSatisfy({ try role($0) == kAXRadioButtonRole }) else {
          throw failure("Show Terminal's tab bar to refresh the picker.")
        }
        // Terminal returns AXFailure for AXValue on some idle tab buttons.
        // The tab group's AXValue directly identifies its selected button.
        selected = try value(strip, kAXValueAttribute, required: true)
        guard let selected, controls.contains(where: { CFEqual($0, selected) }) else {
          throw failure("Terminal has not confirmed its selected tab.")
        }
      } else { controls = [window]; selected = window }
      var tabs = try controls.map { control in
        let title = try value(control, kAXTitleAttribute) as? String ?? "Terminal Tab"
        return ObservedTab(control: control, title: title,
          selected: selected.map { CFEqual($0, control) } ?? false,
          unread: try elements(control, kAXChildrenAttribute).contains {
            try value($0, kAXDescriptionAttribute) as? String == "TabAlert"
          }, frame: try frame(control))
      }
      let visibleFrames = tabs.compactMap(\.frame).filter { $0.width > 8 && $0.height > 8 }
      let completeFrames = visibleFrames.count == tabs.count &&
        Set(visibleFrames.map(\.minX)).count == tabs.count &&
        visibleFrames.allSatisfy { abs($0.midY - (visibleFrames.first?.midY ?? 0)) < 4 }
      if completeFrames { tabs.sort { $0.frame!.minX < $1.frame!.minX } }
      // AXTabs includes overflow controls in model order. AppKit can leave stale
      // overlapping frames on hidden controls after scrolling to the selection;
      // use native enumeration in that case and disable coordinate dragging.
      let stripFrame = try layout.strip.flatMap { try frame($0) }
      let canReorder = controls.count > 1 && completeFrames &&
        stripFrame.map { strip in visibleFrames.allSatisfy { strip.insetBy(dx: -1, dy: -1).contains($0) } } == true
      result.append(ObservedWindow(window: window,
        focused: focused.map { CFEqual($0, window) } ?? false, tabs: tabs, canReorder: canReorder))
    }
    guard result.reduce(0, { $0 + $1.tabs.count }) <= 128 else { throw failure("Terminal has too many open tabs to show.") }
    return result
  }
  private func sameLayout(_ left: [ObservedWindow], _ right: [ObservedWindow]) -> Bool {
    guard left.count == right.count else { return false }
    return zip(left, right).allSatisfy { a, b in
      CFEqual(a.window, b.window) && a.focused == b.focused && a.tabs.count == b.tabs.count &&
        zip(a.tabs, b.tabs).allSatisfy { CFEqual($0.control, $1.control) && $0.selected == $1.selected }
    }
  }

  func snapshots(application: AXUIElement, readShells: () throws -> [MacTerminalTabSnapshot]) throws -> [MacTerminalTabSnapshot] {
    deadline = now() + 2.5
    defer { deadline = .infinity }
    for attempt in 0..<3 {
      do { return try snapshotCandidate(application: application, readShells: readShells) }
      catch let error as MacTerminalTabFailure {
        guard error.code == "layout_unavailable", attempt < 2, deadline - now() > 0.3 else { throw error }
        Thread.sleep(forTimeInterval: 0.025)
      }
    }
    throw failure("Terminal's window layout is temporarily unavailable.")
  }

  private func snapshotCandidate(application: AXUIElement, readShells: () throws -> [MacTerminalTabSnapshot]) throws -> [MacTerminalTabSnapshot] {
    let before = try observe(application: application)
    let shells = try readShells()
    let after = try observe(application: application)
    guard sameLayout(before, after), after.reduce(0, { $0 + $1.tabs.count }) == shells.count,
          Set(shells.map(\.tty)).count == shells.count else {
      throw failure("Terminal's window layout is changing. Try again.")
    }
    let focusedShell = shells.first { $0.windowIndex == 1 && $0.isSelectedInWindow }
    guard shells.isEmpty || (focusedShell != nil && after.filter(\.focused).count == 1) else {
      throw failure("Terminal has not confirmed its active window.")
    }
    // Candidate registries stay local until the entire read is validated.
    var nextGroups = groups, candidateNextGroup = nextGroup, candidateShells = knownShells
    var candidate: [Binding] = [], usedGroups = Set<Int>()
    for window in after {
      let selectedShell = window.focused ? focusedShell : nil
      let selectedID = selectedShell.flatMap { shell in
        knownShells.first { $0.value.tty == shell.tty && $0.value.windowID == shell.windowID }?.key
      }
      let matchingIDs = bindings.filter { old in window.tabs.contains { CFEqual($0.control, old.control) } }.map(\.groupID)
      let selectedGroup = selectedID.flatMap { id in bindings.first { $0.id == id }?.groupID }
      let knownGroup = selectedGroup ?? matchingIDs.first ?? groups.first {
        $0.windows.contains { CFEqual($0, window.window) }
      }?.id
      let groupID: Int
      if let knownGroup, !usedGroups.contains(knownGroup) { groupID = knownGroup }
      else {
        groupID = candidateNextGroup; candidateNextGroup += 1
        nextGroups.append(Group(id: groupID, windows: []))
      }
      usedGroups.insert(groupID)
      if let index = nextGroups.firstIndex(where: { $0.id == groupID }),
         !nextGroups[index].windows.contains(where: { CFEqual($0, window.window) }) {
        nextGroups[index].windows.append(window.window)
      }
      for (index, tab) in window.tabs.enumerated() {
        let existing = bindings.first { CFEqual($0.control, tab.control) }?.id
        let id = existing ?? (tab.selected ? selectedID : nil) ?? UUID().uuidString.lowercased()
        if tab.selected, let selectedShell {
          candidateShells = candidateShells.filter { identifier, shell in
            identifier == id || shell.tty != selectedShell.tty || shell.windowID != selectedShell.windowID
          }
          candidateShells[id] = selectedShell
        }
        candidate.append(Binding(id: id, groupID: groupID, window: window.window,
          control: tab.control, position: index + 1, title: tab.title, selected: tab.selected,
          focused: window.focused, unread: tab.unread, frame: tab.frame, canReorder: window.canReorder))
      }
    }
    guard Set(candidate.map(\.id)).count == candidate.count else { throw failure("Terminal's tab identities are changing. Try again.") }
    let liveShells = Dictionary(uniqueKeysWithValues: shells.map { ($0.tty, $0) })
    candidateShells = candidateShells.filter { _, shell in liveShells[shell.tty]?.windowID == shell.windowID }
    let snapshots = candidate.map { tab in
      let shell = candidateShells[tab.id].flatMap { liveShells[$0.tty] }
      return MacTerminalTabSnapshot(windowID: shell?.windowID ?? 0,
        windowIndex: tab.focused ? 1 : tab.groupID + 1, tabIndex: shell?.tabIndex ?? tab.position,
        customTitle: tab.title, tty: shell?.tty ?? "", isBusy: shell?.isBusy ?? false,
        isSelectedInWindow: tab.selected, hasUnreadActivity: tab.unread,
        visibleGroupID: tab.groupID, visibleTabIndex: tab.position, nativeTabID: tab.id,
        reorderAvailable: tab.canReorder)
    }
    bindings = candidate
    groups = nextGroups.filter { usedGroups.contains($0.id) }
    nextGroup = candidateNextGroup
    knownShells = candidateShells
    return snapshots
  }

  /// A read used for actuation cannot invent or prune identities.
  func capture(application: AXUIElement) throws -> [Binding] {
    let previousDeadline = deadline
    if deadline == .infinity { deadline = now() + 1.5 }
    defer { deadline = previousDeadline }
    let layout = try observe(application: application)
    return try layout.flatMap { window in
      try window.tabs.enumerated().map { index, tab in
        guard let known = bindings.first(where: { CFEqual($0.control, tab.control) }) else {
          throw failure("Terminal's controls changed. Refresh the picker.")
        }
        return Binding(id: known.id, groupID: known.groupID, window: window.window,
          control: tab.control, position: index + 1, title: tab.title, selected: tab.selected,
          focused: window.focused, unread: tab.unread, frame: tab.frame, canReorder: window.canReorder)
      }
    }
  }
  func focus(_ id: String, application: AXUIElement) throws {
    deadline = now() + 1.5
    defer { deadline = .infinity }
    let current = try capture(application: application)
    guard let target = current.first(where: { $0.id == id }) else { throw failure("That Terminal tab has closed. Refresh the picker.") }
    if !target.focused {
      try prepare(target.window)
      AXUIElementSetAttributeValue(target.window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
      try prepare(target.window)
      guard AXUIElementPerformAction(target.window, kAXRaiseAction as CFString) == .success else { throw failure("Terminal could not raise that window.") }
    }
    if !CFEqual(target.control, target.window) {
      try prepare(target.control)
      guard AXUIElementPerformAction(target.control, kAXPressAction as CFString) == .success else { throw failure("Terminal could not select that tab.") }
      let confirmationDeadline = min(deadline, now() + 0.6)
      repeat {
        if let parent = try value(target.control, kAXParentAttribute),
           CFGetTypeID(parent) == AXUIElementGetTypeID(),
           let selected = try value(unsafeBitCast(parent, to: AXUIElement.self), kAXValueAttribute),
           CFEqual(selected, target.control) { return }
        Thread.sleep(forTimeInterval: 0.025)
      } while now() < confirmationDeadline
      throw failure("Terminal has not confirmed the requested tab.")
    }
    // The controller also verifies the selected TTY with a transactional catalog.
  }
  private func failure(_ message: String) -> MacTerminalTabFailure {
    MacTerminalTabFailure(code: "layout_unavailable", message: message, state: nil)
  }
}
