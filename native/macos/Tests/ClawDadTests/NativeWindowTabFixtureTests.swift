import AppKit
import ApplicationServices
@testable import ClawDad
import XCTest

/// Real AppKit windows, isolated from the user's Terminal and shell sessions.
@MainActor
final class NativeWindowTabFixtureTests: XCTestCase {
  // Native tab containers tear down asynchronously on current macOS. Let the
  // isolated XCTest process own their lifetime, instead of closing 21 tabs during
  // an in-flight AppKit layout transition.
  private static var fixtureWindows: [NSWindow] = []
  private func children(_ element: AnyObject) -> [AnyObject] {
    NSAccessibility.unignoredChildren(from: (element as? NSAccessibilityProtocol)?.accessibilityChildren() ?? []).map { $0 as AnyObject }
  }
  private func role(_ element: AnyObject) -> NSAccessibility.Role? {
    (element as? NSAccessibilityProtocol)?.accessibilityRole()
  }
  private func strip(_ window: NSWindow) throws -> AnyObject {
    try XCTUnwrap(children(window).first { role($0) == .tabGroup })
  }
  private func tabs(_ strip: AnyObject) -> [AnyObject] { children(strip).filter { role($0) == .radioButton } }

  func testPhysicalGroupsAndTwentyDuplicateNativeTabsKeepIdentityAcrossFocus() throws {
    _ = NSApplication.shared
    var windows: [NSWindow] = []
    for index in 0..<21 {
      let window = NSWindow(contentRect: NSRect(x: 180, y: 180, width: 480, height: 250),
        styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
      window.isReleasedWhenClosed = false
      window.animationBehavior = .none
      window.title = "same-directory"
      window.tabbingIdentifier = index == 20 ? "clawdad-fixture-second" : "clawdad-fixture-first"
      window.contentView = NSTextView(frame: window.contentLayoutRect)
      windows.append(window)
    }
    Self.fixtureWindows = windows
    for window in windows.dropFirst().prefix(19) { windows[0].addTabbedWindow(window, ordered: .above) }
    windows[0].orderBack(nil); windows[20].orderBack(nil)
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    let firstStrip = try strip(windows[0])
    let original = tabs(firstStrip)
    XCTAssertEqual(original.count, 20, "Accessibility must include tabs beyond the visible strip")
    XCTAssertEqual(Set(original.map(ObjectIdentifier.init)).count, 20)
    let frames = original.compactMap { ($0 as? NSAccessibilityProtocol)?.accessibilityFrame() }.filter { $0.width > 0 }
    XCTAssertEqual(frames.map(\.minX), frames.map(\.minX).sorted(), "Native accessibility tabs must follow physical left-to-right order")
    let group = try XCTUnwrap(windows[0].tabGroup)
    group.selectedWindow = windows[12]
    let focusedStrip = try strip(windows[12])
    XCTAssertTrue(firstStrip === focusedStrip)
    XCTAssertEqual(tabs(focusedStrip).map(ObjectIdentifier.init), original.map(ObjectIdentifier.init))
    XCTAssertEqual(windows[20].tabGroup?.windows.count, 1)
    // Adapt real NSAccessibility objects to RPC handles so the production reader
    // is exercised without requesting Accessibility access to another application.
    var objects: [(AnyObject, AXUIElement)] = []
    func handle(_ object: AnyObject) -> AXUIElement {
      if let existing = objects.first(where: { $0.0 === object }) { return existing.1 }
      let element = AXUIElementCreateApplication(pid_t(100_000 + objects.count))
      objects.append((object, element)); return element
    }
    let application = handle(NSApplication.shared)
    var focused = windows[12]
    let reader = MacNativeTerminalTabs { element, attribute in
      guard let object = objects.first(where: { CFEqual($0.1, element) })?.0 else { return nil }
      if CFEqual(element, application) {
        if attribute == kAXWindowsAttribute { return [handle(focused), handle(windows[20])] as CFArray }
        if attribute == kAXFocusedWindowAttribute { return handle(focused) }
      }
      guard let accessible = object as? NSAccessibilityProtocol else {
        // AppKit's tab-close proxies still expose the public legacy AX protocol.
        guard let legacy = object as? NSObject,
              legacy.responds(to: NSSelectorFromString("accessibilityAttributeValue:")) else { return nil }
        let raw = legacy.perform(NSSelectorFromString("accessibilityAttributeValue:"), with: attribute)?.takeUnretainedValue()
        if attribute == kAXChildrenAttribute || attribute == kAXTabsAttribute {
          return ((raw as? [AnyObject]) ?? []).map(handle) as CFArray
        }
        return raw as CFTypeRef?
      }
      switch attribute {
      case kAXChildrenAttribute: return self.children(object).map(handle) as CFArray
      case kAXTabsAttribute: return (accessible.accessibilityTabs() ?? []).map { handle($0 as AnyObject) } as CFArray
      case kAXRoleAttribute: return (accessible.accessibilityRole()?.rawValue ?? kAXUnknownRole) as NSString
      case kAXTitleAttribute: return accessible.accessibilityTitle() as NSString?
      case kAXDescriptionAttribute: return accessible.accessibilityLabel() as NSString?
      case kAXValueAttribute:
        if self.role(object) == .tabGroup,
           let value = accessible.accessibilityValue() as AnyObject?,
           self.role(value) == .radioButton { return handle(value) }
        if self.role(object) == .tabGroup,
           let selected = self.tabs(object).first(where: {
             (($0 as? NSAccessibilityProtocol)?.accessibilityValue() as? NSNumber)?.boolValue == true
           }) { return handle(selected) }
        return accessible.accessibilityValue() as CFTypeRef?
      case kAXPositionAttribute:
        var point = accessible.accessibilityFrame().origin
        return AXValueCreate(.cgPoint, &point)
      case kAXSizeAttribute:
        var size = accessible.accessibilityFrame().size
        return AXValueCreate(.cgSize, &size)
      default: return nil
      }
    }
    func shells(selected: Int) -> [MacTerminalTabSnapshot] {
      (0..<21).map { index in
        MacTerminalTabSnapshot(windowID: index + 100, windowIndex: index == selected ? 1 : index + 2,
          tabIndex: 1, customTitle: "same-directory", tty: "/dev/ttys\(index)", isBusy: false, isSelectedInWindow: true)
      }
    }
    let initial = try reader.snapshots(application: application) { shells(selected: 12) }
    XCTAssertEqual(initial.count, 21)
    XCTAssertEqual(Set(initial.map(\.groupID)).count, 2)
    XCTAssertEqual(initial.filter { $0.groupID == initial[0].groupID }.map(\.position), Array(1...20))
    XCTAssertEqual(initial.first { $0.windowIndex == 1 && $0.isSelectedInWindow }?.tty, "/dev/ttys12")
    group.selectedWindow = windows[5]; focused = windows[5]
    let changed = try reader.snapshots(application: application) { shells(selected: 5) }
    XCTAssertEqual(changed.map(\.nativeTabID), initial.map(\.nativeTabID))
    XCTAssertEqual(changed.map(\.groupID), initial.map(\.groupID))
    XCTAssertEqual(changed.first { $0.windowIndex == 1 && $0.isSelectedInWindow }?.tty, "/dev/ttys5")
  }
}
