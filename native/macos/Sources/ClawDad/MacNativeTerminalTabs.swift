import AppKit
import ApplicationServices
import Foundation
import OSLog

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
  // Input belongs to a native control, independently of shell discovery. A
  // finished shell in another window must not disable an otherwise valid caret.
  private var inputBindings: [(window: AXUIElement, control: AXUIElement, id: String)] = []
  private let readAttribute: ((AXUIElement, String) throws -> CFTypeRef?)?
  private let now: () -> TimeInterval
  private var deadline: TimeInterval = .infinity
  // Inject actions alongside the AX graph for deterministic native-operation tests.
  var performAction: ((AXUIElement, String) -> AXError)?
  private struct ClosePrompt {
    let token: String
    let application: AXUIElement
    let target: Binding
    let sheet: AXUIElement
    let cancel: AXUIElement
    let accept: AXUIElement
    let text: String
    let label: String
  }
  private var closePrompt: ClosePrompt?

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
  private func sameFocusedSelection(_ left: [ObservedWindow], _ right: [ObservedWindow]) -> Bool {
    let before = left.filter(\.focused), after = right.filter(\.focused)
    if before.isEmpty && after.isEmpty { return true }
    guard before.count == 1, after.count == 1,
          CFEqual(before[0].window, after[0].window),
          let a = before[0].tabs.first(where: \.selected),
          let b = after[0].tabs.first(where: \.selected) else { return false }
    return CFEqual(a.control, b.control)
  }

  /// Capture only the focused window. This identity never depends on scripting
  /// window counts, TTY uniqueness, tab titles, or an unrelated window's health.
  func inputIdentity(application: AXUIElement) throws -> String {
    let previousDeadline = deadline
    deadline = min(deadline, now() + 1)
    defer { deadline = previousDeadline }
    func selection() throws -> (window: AXUIElement, control: AXUIElement) {
      guard let raw = try value(application, kAXFocusedWindowAttribute) ?? value(application, kAXMainWindowAttribute),
            CFGetTypeID(raw) == AXUIElementGetTypeID() else {
        throw failure("Terminal has not confirmed its focused input.")
      }
      let window = unsafeBitCast(raw, to: AXUIElement.self)
      let layout = try structure(window)
      guard layout.text else { throw failure("Choose an input in Terminal.") }
      guard let strip = layout.strip else { return (window, window) }
      let controls = try elements(strip, kAXTabsAttribute, required: true)
      guard let selected = try value(strip, kAXValueAttribute, required: true),
            let control = controls.first(where: { CFEqual($0, selected) }) else {
        throw failure("Terminal has not confirmed its selected input.")
      }
      return (window, control)
    }
    let original = try selection()
    let confirmed = try selection()
    guard CFEqual(original.window, confirmed.window), CFEqual(original.control, confirmed.control) else {
      throw MacTerminalTabFailure(code: "selection_changed", message: "The Terminal input changed during capture.", state: nil)
    }
    if let known = inputBindings.first(where: {
      CFEqual($0.window, original.window) && CFEqual($0.control, original.control)
    }) { return known.id }
    let id = UUID().uuidString.lowercased()
    inputBindings.append((original.window, original.control, id))
    if inputBindings.count > 128 { inputBindings.removeFirst() }
    return id
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
    guard sameFocusedSelection(before, after) else {
      Logger(subsystem: "earth.frg.ClawDad", category: "Terminal").info("catalog_rejected=focused_selection_changed")
      throw failure("The selected Terminal tab changed during discovery.")
    }
    // Native controls are the inventory. Scripting rows only enrich identities
    // that can be proven. Closed tabs can lack a TTY or retain a reused TTY;
    // neither case may invalidate every other window or identify a different agent.
    let shellGroups = Dictionary(grouping: shells.filter { !$0.tty.isEmpty }, by: \.tty)
    let liveShells = shellGroups.compactMapValues { $0.count == 1 ? $0.first : nil }
    let nativeCount = after.reduce(0) { $0 + $1.tabs.count }
    if nativeCount != shells.count || liveShells.count != shells.count {
      Logger(subsystem: "earth.frg.ClawDad", category: "Terminal").info(
        "catalog_metadata_partial native_tabs=\(nativeCount) shell_rows=\(shells.count) unique_shells=\(liveShells.count)"
      )
    }
    let selectedShells = shells.filter { $0.windowIndex == 1 && $0.isSelectedInWindow }
    let focusedShell = selectedShells.count == 1 ? selectedShells.first.flatMap { liveShells[$0.tty] } : nil
    // Candidate registries stay local until the entire read is validated.
    var nextGroups = groups, candidateNextGroup = nextGroup, candidateShells = knownShells
    var candidate: [Binding] = [], usedGroups = Set<Int>()
    for window in after {
      let selectedShell = window.focused ? focusedShell : nil
      let selectedID = selectedShell.flatMap { shell in
        knownShells.first { $0.value.tty == shell.tty && $0.value.windowID == shell.windowID && $0.value.tabIndex == shell.tabIndex }?.key
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
        if tab.selected && window.focused { candidateShells.removeValue(forKey: id) }
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
    candidateShells = candidateShells.filter { _, shell in
      liveShells[shell.tty]?.windowID == shell.windowID && liveShells[shell.tty]?.tabIndex == shell.tabIndex
    }
    let activity = MacTerminalActivityCandidates(nativeTitles: after.flatMap { $0.tabs.map(\.title) }, shells: Array(liveShells.values))
    let previousTabs = before.flatMap(\.tabs)
    let snapshots = candidate.map { tab in
      let shell = candidateShells[tab.id].flatMap { liveShells[$0.tty] }
      let previousTitle = previousTabs.first { CFEqual($0.control, tab.control) }?.title ?? ""
      let activityTTYs: Set<String> = shell.map { [$0.tty] } ?? activity.ttys(for: tab.title, previously: previousTitle)
      return MacTerminalTabSnapshot(windowID: shell?.windowID ?? 0,
        windowIndex: tab.focused ? 1 : tab.groupID + 1, tabIndex: shell?.tabIndex ?? tab.position,
        customTitle: tab.title, tty: shell?.tty ?? "",
        isSelectedInWindow: tab.selected, hasUnreadActivity: tab.unread,
        visibleGroupID: tab.groupID, visibleTabIndex: tab.position, nativeTabID: tab.id,
        reorderAvailable: tab.canReorder, activityTTYs: activityTTYs)
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
    let previousDeadline = deadline
    deadline = min(deadline, now() + 1.5)
    defer { deadline = previousDeadline }
    let current = try capture(application: application)
    guard let target = current.first(where: { $0.id == id }) else { throw failure("That Terminal tab has closed. Refresh the picker.") }
    if !target.focused {
      try prepare(target.window)
      AXUIElementSetAttributeValue(target.window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
      try prepare(target.window)
      let raised = performAction?(target.window, kAXRaiseAction) ?? AXUIElementPerformAction(target.window, kAXRaiseAction as CFString)
      guard raised == .success else { throw failure("Terminal could not raise that window.") }
    }
    if !CFEqual(target.control, target.window) {
      try prepare(target.control)
      let selected = performAction?(target.control, kAXPressAction) ?? AXUIElementPerformAction(target.control, kAXPressAction as CFString)
      guard selected == .success else { throw failure("Terminal could not select that tab.") }
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

  func close(_ id: String, application: AXUIElement) throws -> MacTerminalNativeCloseOutcome {
    deadline = now() + 5
    defer { deadline = .infinity }
    guard closePrompt == nil else { throw failure("Finish the current close confirmation first.") }
    let before = try capture(application: application)
    guard before.count == bindings.count,
          before.allSatisfy({ item in bindings.contains { $0.id == item.id && $0.groupID == item.groupID && $0.position == item.position } }),
          let originalTarget = before.first(where: { $0.id == id }) else {
      throw failure("The tabs changed. Refresh the picker before closing this tab.")
    }
    guard try sheets(originalTarget.window).isEmpty else { throw failure("Finish the existing Terminal dialog before closing this tab.") }
    // Require the requested tab to own the active close command. AXPress delivery
    // alone cannot establish closure. Resolve the window again after selection:
    // selecting a native tab can replace the visible AXWindow.
    if !originalTarget.focused || !originalTarget.selected { try focus(id, application: application) }
    let current = try capture(application: application)
    guard current.count == before.count,
          current.allSatisfy({ item in before.contains { $0.id == item.id && $0.groupID == item.groupID && $0.position == item.position } }),
          let target = current.first(where: { $0.id == id }), target.focused, target.selected else {
      throw failure("The selected tab changed before closing. Check the refreshed picker.")
    }
    guard try sheets(target.window).isEmpty else { throw failure("Finish the existing Terminal dialog before closing this tab.") }
    // Terminal's tab-close AX proxy can acknowledge AXPress without doing
    // anything, even on the selected tab. Use its native Command-W menu action
    // directly. Modifier checks exclude Close Window, Close Others, and Close All;
    // no keyboard event or second close action is sent as a fallback.
    let command = try closeTabCommand(application: application)
    let final = try capture(application: application)
    guard final.count == current.count,
          final.allSatisfy({ item in current.contains { $0.id == item.id && $0.groupID == item.groupID && $0.position == item.position } }),
          let verifiedTarget = final.first(where: { $0.id == id }),
          verifiedTarget.selected, verifiedTarget.focused,
          CFEqual(verifiedTarget.window, target.window),
          try sheets(verifiedTarget.window).isEmpty,
          try value(application, kAXFrontmostAttribute, required: true) as? Bool == true else {
      throw failure("The selected tab changed before closing. Check the refreshed picker.")
    }
    try pressCloseButton(command, source: "tab_menu")
    return try waitForClose(verifiedTarget, application: application, allowPrompt: true)
  }

  private func closeTabCommand(application: AXUIElement) throws -> AXUIElement {
    guard let bar = try element(application, kAXMenuBarAttribute) else {
      throw failure("Terminal’s Close Tab command is unavailable.")
    }
    var queue = [(bar, 0)], matches: [AXUIElement] = [], visited = 0
    while !queue.isEmpty {
      let (item, depth) = queue.removeFirst(); visited += 1
      guard visited <= 512 else { throw failure("Terminal’s menu is temporarily unavailable.") }
      let itemRole = try role(item)
      if itemRole == kAXMenuItemRole,
         (try value(item, kAXMenuItemCmdCharAttribute) as? String)?.lowercased() == "w",
         let modifiers = try value(item, kAXMenuItemCmdModifiersAttribute) as? NSNumber,
         modifiers.uint32Value == 0 {
        // AX uses Command by default; zero excludes Shift, Option, Control, and
        // the NoCommand bit. Matching the shortcut also supports localized titles.
        matches.append(item)
      }
      // The close command is a direct item in Terminal's main menu. Avoid
      // traversing Services, profile lists, and other unrelated nested menus.
      if [kAXMenuBarRole, kAXMenuBarItemRole, kAXMenuRole].contains(itemRole) {
        let children = try elements(item, kAXChildrenAttribute)
        guard children.isEmpty || depth < 3 else { throw failure("Terminal’s menu is temporarily unavailable.") }
        queue += children.map { ($0, depth + 1) }
      }
    }
    guard matches.count == 1, let command = matches.first,
          try value(command, kAXEnabledAttribute, required: true) as? Bool == true else {
      throw failure("Terminal did not expose an enabled, unique Close Tab command. The tab was kept open.")
    }
    return command
  }

  func resolveClose(token: String, confirm: Bool) throws -> MacTerminalNativeCloseOutcome {
    deadline = now() + 5
    defer { deadline = .infinity }
    guard let pending = closePrompt, pending.token == token else { throw failure("This close confirmation expired.") }
    let current = try sheets(pending.target.window)
    guard current.count == 1, CFEqual(current[0], pending.sheet),
          let fresh = try prompt(in: pending.sheet, target: pending.target, application: pending.application),
          CFEqual(fresh.accept, pending.accept), CFEqual(fresh.cancel, pending.cancel),
          fresh.text == pending.text, fresh.label == pending.label else {
      throw failure("The Terminal dialog changed. Close was cancelled.")
    }
    if confirm {
      // Modal sheets may block the tab group's selected-value read. Verify the
      // exact tab's membership without reading selection, titles, or other windows.
      guard try contains(pending.target) else { throw failure("The tab changed while its close confirmation was open.") }
    }
    // Consume before pressing: an ambiguous AX response must never repeat a close.
    closePrompt = nil
    try pressCloseButton(confirm ? pending.accept : pending.cancel)
    if confirm { return try waitForClose(pending.target, application: pending.application, allowPrompt: false) }
    repeat {
      if try sheets(pending.target.window).allSatisfy({ !CFEqual($0, pending.sheet) }) { return .cancelled }
      Thread.sleep(forTimeInterval: 0.04)
    } while now() < deadline - 0.25
    throw failure("Terminal has not confirmed cancellation yet.")
  }

  func cancelClose() {
    guard let pending = closePrompt else { return }
    deadline = now() + 1.5
    defer { closePrompt = nil; deadline = .infinity }
    // A disconnect/timeout can cancel only the exact sheet this operation opened.
    if let current = try? sheets(pending.target.window), current.contains(where: { CFEqual($0, pending.sheet) }),
       let button = try? element(pending.sheet, kAXCancelButtonAttribute), CFEqual(button, pending.cancel) {
      try? pressCloseButton(pending.cancel)
    }
  }

  private func waitForClose(_ target: Binding, application: AXUIElement, allowPrompt: Bool) throws -> MacTerminalNativeCloseOutcome {
    var layoutFailures = 0
    var sheetFailures = 0
    repeat {
      // Read the warning independently and first. A modal can make a full layout
      // read fail, or temporarily leave only the sheet in the visible AX windows.
      let attached: [AXUIElement]?
      do { attached = try sheets(target.window) }
      catch { attached = nil; sheetFailures += 1 }
      if let attached, !attached.isEmpty {
        guard allowPrompt, attached.count == 1,
              let warning = try prompt(in: attached[0], target: target, application: application) else {
          throw failure("Terminal opened a dialog that could not be confirmed safely.")
        }
        closePrompt = warning
        return .confirmation(token: warning.token, prompt: warning.text, button: warning.label)
      }
      do {
        let layout = try observe(application: application)
        if layout.reduce(0, { $0 + $1.tabs.count }) < bindings.count,
           !layout.contains(where: { $0.tabs.contains { CFEqual($0.control, target.control) } }) { return .closed }
      } catch {
        // AppKit can briefly invalidate the strip while it selects the next tab.
        // Retry observation only; never repeat the close action.
        layoutFailures += 1
      }
      Thread.sleep(forTimeInterval: 0.04)
    } while now() < deadline - 0.25
    Logger(subsystem: "earth.frg.ClawDad", category: "Terminal").error(
      "close_verification=timeout layout_read_failures=\(layoutFailures) sheet_read_failures=\(sheetFailures)"
    )
    throw MacTerminalTabFailure(code: "close_unconfirmed", message: "Terminal has not confirmed that the tab closed yet.", state: nil)
  }

  private func element(_ parent: AXUIElement, _ attribute: String) throws -> AXUIElement? {
    guard let raw = try value(parent, attribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(raw, to: AXUIElement.self)
  }
  private func descendants(_ root: AXUIElement, depth: Int) throws -> [AXUIElement] {
    guard depth > 0 else { return [] }
    let children = try elements(root, kAXChildrenAttribute)
    guard children.count <= 32 else { throw failure("Terminal’s close control is unavailable.") }
    return try children + children.flatMap { try descendants($0, depth: depth - 1) }
  }
  private func sheets(_ window: AXUIElement) throws -> [AXUIElement] {
    var queue = [(window, 0)], found: [AXUIElement] = [], visited = 0
    while !queue.isEmpty {
      let (element, depth) = queue.removeFirst(); visited += 1
      guard visited <= 128 else { throw failure("Terminal’s dialog layout is temporarily unavailable.") }
      let elementRole = try role(element)
      if elementRole == kAXSheetRole { found.append(element); continue }
      // Read only window containers, keeping terminal contents and the tab strip
      // out of the modal probe. Sheets may sit below an accessibility container.
      if depth < 4, [kAXWindowRole, kAXGroupRole, kAXSplitGroupRole, kAXScrollAreaRole, kAXUnknownRole].contains(elementRole) {
        queue += try elements(element, kAXChildrenAttribute).map { ($0, depth + 1) }
      }
    }
    return found
  }
  private func contains(_ target: Binding) throws -> Bool {
    if CFEqual(target.control, target.window) { return try role(target.window) == kAXWindowRole }
    guard let strip = try structure(target.window).strip else { return false }
    return try elements(strip, kAXTabsAttribute, required: true).contains { CFEqual($0, target.control) }
  }
  private func prompt(in sheet: AXUIElement, target: Binding, application: AXUIElement) throws -> ClosePrompt? {
    guard let cancel = try element(sheet, kAXCancelButtonAttribute) else { return nil }
    let children = try descendants(sheet, depth: 4)
    let buttons = try children.filter { try role($0) == kAXButtonRole }
    // A destructive alert can make Cancel its default. The decision is the sole
    // other native button, never whichever button would receive Return.
    guard buttons.count == 2, buttons.contains(where: { CFEqual($0, cancel) }),
          let accept = buttons.first(where: { !CFEqual($0, cancel) }),
          let label = try value(accept, kAXTitleAttribute) as? String, !label.isEmpty, label.utf8.count <= 128 else { return nil }
    let texts = try children.filter { try role($0) == kAXStaticTextRole }.compactMap { child in
      try (value(child, kAXValueAttribute) as? String) ?? (value(child, kAXTitleAttribute) as? String)
    }.filter { !$0.isEmpty }
    let text = texts.joined(separator: "\n\n")
    guard !text.isEmpty, text.utf8.count <= 2048 else { return nil }
    return ClosePrompt(token: UUID().uuidString.lowercased(), application: application, target: target,
      sheet: sheet, cancel: cancel, accept: accept, text: text, label: label)
  }
  private func pressCloseButton(_ button: AXUIElement, source: String = "confirmation_button") throws {
    try prepare(button)
    guard try value(button, kAXEnabledAttribute) as? Bool != false else { throw failure("Terminal’s close button is disabled.") }
    let result = performAction?(button, kAXPressAction) ?? AXUIElementPerformAction(button, kAXPressAction as CFString)
    Logger(subsystem: "earth.frg.ClawDad", category: "Terminal").info("native_close_action source=\(source, privacy: .public) ax_result=\(result.rawValue)")
    // cannotComplete may mean the action succeeded but opened a modal sheet.
    guard result == .success || result == .cannotComplete else { throw failure("Terminal could not complete the close action.") }
  }
  private func failure(_ message: String) -> MacTerminalTabFailure {
    MacTerminalTabFailure(code: "layout_unavailable", message: message, state: nil)
  }
}
