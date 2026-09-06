import AppKit
import ApplicationServices
import Foundation

/// Native controls own identity. Resolve a shell only for the selected control,
/// where Terminal answers unambiguously. Catalog reads never activate tabs.
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
  }
  private var controls: [(AXUIElement, String)] = []
  private var groups: [(AXUIElement, Int)] = []
  private var nextGroup = 1
  private var knownShells: [String: MacTerminalTabSnapshot] = [:]
  private(set) var bindings: [Binding] = []
  private let readAttribute: ((AXUIElement, String) -> CFTypeRef?)?

  init(readAttribute: ((AXUIElement, String) -> CFTypeRef?)? = nil) {
    self.readAttribute = readAttribute
  }

  private func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    if let readAttribute { return readAttribute(element, attribute) }
    var result: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success else { return nil }
    return result
  }
  private func elements(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] {
    value(element, attribute) as? [AXUIElement] ?? []
  }
  private func role(_ element: AXUIElement) -> String { value(element, kAXRoleAttribute) as? String ?? "" }
  private func descendant(_ root: AXUIElement, role target: String) -> AXUIElement? {
    var queue = [(root, 0)], visited = 0
    while !queue.isEmpty, visited < 256 {
      let (element, depth) = queue.removeFirst(); visited += 1
      if role(element) == target { return element }
      if depth < 8 { queue += elements(element, kAXChildrenAttribute).prefix(128).map { ($0, depth + 1) } }
    }
    return nil
  }
  private func id(_ element: AXUIElement) -> String {
    if let entry = controls.first(where: { CFEqual($0.0, element) }) { return entry.1 }
    let id = UUID().uuidString.lowercased(); controls.append((element, id)); return id
  }
  private func group(_ element: AXUIElement) -> Int {
    if let entry = groups.first(where: { CFEqual($0.0, element) }) { return entry.1 }
    let id = nextGroup; nextGroup += 1; groups.append((element, id)); return id
  }
  func capture(application: AXUIElement) throws -> [Binding] {
    AXUIElementSetMessagingTimeout(application, 0.25)
    let focused = value(application, kAXFocusedWindowAttribute) ?? value(application, kAXMainWindowAttribute)
    var result: [Binding] = [], activeGroups: [AXUIElement] = []
    for window in elements(application, kAXWindowsAttribute).prefix(128) {
      // Settings also contain tabs; actual Terminal windows have a text area.
      guard descendant(window, role: kAXTextAreaRole) != nil else { continue }
      let strip = descendant(window, role: kAXTabGroupRole)
      let children: [AXUIElement] = strip.map { element in
        let tabs = elements(element, kAXTabsAttribute)
        return (tabs.isEmpty ? elements(element, kAXChildrenAttribute) : tabs).filter { role($0) == kAXRadioButtonRole }
      } ?? []
      let tabControls: [AXUIElement] = children.isEmpty ? [window] : children
      let groupElement = strip ?? window
      if activeGroups.contains(where: { CFEqual($0, groupElement) }) { continue }
      activeGroups.append(groupElement)
      let groupID = group(groupElement)
      for (index, control) in tabControls.enumerated() {
        let title = [kAXTitleAttribute, kAXDescriptionAttribute].compactMap { value(control, $0) as? String }.first { !$0.isEmpty } ?? "Terminal Tab"
        let selected = children.isEmpty || (value(control, kAXValueAttribute) as? NSNumber)?.boolValue == true
        result.append(Binding(id: id(control), groupID: groupID, window: window, control: control,
          position: index + 1, title: title, selected: selected,
          focused: focused.map { CFEqual($0, window) } ?? false,
          unread: elements(control, kAXChildrenAttribute).contains { value($0, kAXDescriptionAttribute) as? String == "TabAlert" }))
      }
    }
    guard result.count <= 128 else { throw failure("Terminal has too many open tabs to show.") }
    controls.removeAll { entry in !result.contains { CFEqual($0.control, entry.0) } }
    groups.removeAll { entry in !activeGroups.contains { CFEqual($0, entry.0) } }
    knownShells = knownShells.filter { identifier, _ in result.contains { $0.id == identifier } }
    bindings = result
    return result
  }

  func snapshots(application: AXUIElement, readShells: () throws -> [MacTerminalTabSnapshot]) throws -> [MacTerminalTabSnapshot] {
    let before = try capture(application: application)
    let shells = try readShells()
    let after = try capture(application: application)
    guard before.map(\.id) == after.map(\.id),
          before.first(where: { $0.focused && $0.selected })?.id == after.first(where: { $0.focused && $0.selected })?.id,
          after.count == shells.count else {
      throw failure("Terminal's window layout is changing or unavailable. Refresh the picker.")
    }
    if let selected = after.first(where: { $0.focused && $0.selected }),
       let shell = shells.first(where: { $0.windowIndex == 1 && $0.isSelectedInWindow }) {
      knownShells[selected.id] = shell
    }
    let liveShells = Dictionary(grouping: shells, by: \.tty)
    return after.map { tab in
      let shell = knownShells[tab.id].flatMap { known in liveShells[known.tty]?.first }
      return MacTerminalTabSnapshot(windowID: shell?.windowID ?? 0,
        windowIndex: tab.focused ? 1 : tab.groupID + 1, tabIndex: shell?.tabIndex ?? tab.position,
        customTitle: tab.title, tty: shell?.tty ?? "", isBusy: shell?.isBusy ?? false,
        isSelectedInWindow: tab.selected, hasUnreadActivity: tab.unread,
        visibleGroupID: tab.groupID, visibleTabIndex: tab.position, nativeTabID: tab.id)
    }
  }

  func focus(_ id: String, application: AXUIElement) throws {
    let current = try capture(application: application)
    guard let target = current.first(where: { $0.id == id }) else { throw failure("That Terminal tab has closed. Refresh the picker.") }
    AXUIElementSetAttributeValue(target.window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
    guard AXUIElementPerformAction(target.window, kAXRaiseAction as CFString) == .success else { throw failure("Terminal could not raise that window.") }
    if !CFEqual(target.control, target.window),
       AXUIElementPerformAction(target.control, kAXPressAction as CFString) != .success {
      throw failure("Terminal could not select that tab.")
    }
    let deadline = Date().addingTimeInterval(0.6)
    repeat {
      if try capture(application: application).contains(where: { $0.id == id && $0.focused && $0.selected }) { return }
      Thread.sleep(forTimeInterval: 0.02)
    } while Date() < deadline
    throw failure("Terminal has not confirmed that selection. Refresh the picker.")
  }
  private func failure(_ message: String) -> MacTerminalTabFailure {
    MacTerminalTabFailure(code: "layout_unavailable", message: message, state: nil)
  }
}
