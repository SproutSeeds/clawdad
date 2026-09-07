import AppKit
import ApplicationServices
import XCTest
@testable import ClawDad

final class MacNativeTerminalCloseTests: XCTestCase {
  func testWarningIsDeliveredWhileModalBlocksTheSelectedTabRead() throws {
    let graph = CloseGraph()
    graph.modalBlocksSelection = true
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    guard case .confirmation(let token, _, _) = try reader.close(rows[0].nativeTabID!, application: graph.app) else {
      return XCTFail("A modal must be delivered even while the full catalog cannot be read")
    }
    guard case .closed = try reader.resolveClose(token: token, confirm: true) else { return XCTFail() }
    XCTAssertEqual(graph.live, [1])
    XCTAssertEqual(graph.closePressed, 1)
    XCTAssertEqual(graph.accepted, 1)
  }

  func testNestedWarningWithCancelAsDefaultUsesTheOtherNativeButton() throws {
    let graph = CloseGraph()
    graph.nestedWarning = true
    graph.cancelIsDefault = true
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    guard case .confirmation(let token, _, let button) = try reader.close(rows[0].nativeTabID!, application: graph.app) else {
      return XCTFail("The default button need not be the destructive decision")
    }
    XCTAssertEqual(button, "Terminate")
    guard case .closed = try reader.resolveClose(token: token, confirm: true) else { return XCTFail() }
    XCTAssertEqual(graph.accepted, 1)
    XCTAssertEqual(graph.cancelled, 0)
  }

  func testBackgroundTabIsSelectedBeforeItsCloseProxyIsPressed() throws {
    let graph = CloseGraph()
    graph.closeRequiresSelection = true
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    guard case .confirmation = try reader.close(rows[1].nativeTabID!, application: graph.app) else {
      return XCTFail("The requested tab must own the active native close control")
    }
    XCTAssertEqual(graph.selected, 1)
    XCTAssertEqual(graph.closing, 1)
    XCTAssertEqual(graph.closePressed, 1)
  }

  func testSelectingTabCanReplaceTheVisibleWindowBeforeItsWarningOpens() throws {
    let graph = CloseGraph()
    graph.replaceWindowOnSelection = true
    graph.modalBlocksSelection = true
    let originalWindow = graph.window
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    guard case .confirmation(let token, _, _) = try reader.close(rows[1].nativeTabID!, application: graph.app) else {
      return XCTFail("The warning must be attached to the newly visible target window")
    }
    XCTAssertFalse(CFEqual(originalWindow, graph.window))
    guard case .closed = try reader.resolveClose(token: token, confirm: true) else { return XCTFail() }
    XCTAssertEqual(graph.live, [0])
    XCTAssertEqual(graph.closePressed, 1)
    XCTAssertEqual(graph.accepted, 1)
  }

  func testReorderDuringSelectionPreventsClosingAnyTab() throws {
    let graph = CloseGraph()
    graph.reorderOnSelection = true
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertThrowsError(try reader.close(rows[1].nativeTabID!, application: graph.app))
    XCTAssertEqual(graph.closePressed, 0)
    XCTAssertEqual(graph.live, [1, 0])
  }

  func testSuccessfulAXDeliveryWithNoEffectFailsWithoutAnotherClosePress() throws {
    let graph = CloseGraph()
    graph.ignoreClose = true
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    XCTAssertThrowsError(try reader.close(rows[1].nativeTabID!, application: graph.app)) { error in
      XCTAssertEqual((error as? MacTerminalTabFailure)?.code, "close_unconfirmed")
    }
    XCTAssertEqual(graph.closePressed, 1)
    XCTAssertEqual(graph.live, [0, 1])
    XCTAssertEqual(graph.accepted, 0)
  }

  func testAmbiguousAXReplyAfterOpeningWarningIsNotPressedAgain() throws {
    let graph = CloseGraph()
    graph.closeReply = .cannotComplete
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    guard case .confirmation(let token, _, _) = try reader.close(rows[1].nativeTabID!, application: graph.app) else { return XCTFail() }
    guard case .closed = try reader.resolveClose(token: token, confirm: true) else { return XCTFail() }
    XCTAssertEqual(graph.closePressed, 1)
    XCTAssertEqual(graph.accepted, 1)
    XCTAssertEqual(graph.live, [0])
  }

  func testProcessWarningIsBoundToExactTabAndButtonThenConfirmedOnce() throws {
    let graph = CloseGraph()
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    let token: String
    switch try reader.close(rows[1].nativeTabID!, application: graph.app) {
    case .confirmation(let value, let prompt, let button):
      token = value; XCTAssertEqual(prompt, "Closing this tab will terminate codex."); XCTAssertEqual(button, "Terminate")
    default: return XCTFail("Must relay the native process warning")
    }
    XCTAssertEqual(graph.live, [0, 1])
    guard case .closed = try reader.resolveClose(token: token, confirm: true) else { return XCTFail("Expected confirmed close") }
    XCTAssertEqual(graph.live, [0])
    XCTAssertEqual(graph.accepted, 1)
    XCTAssertThrowsError(try reader.resolveClose(token: token, confirm: true))
    XCTAssertEqual(graph.accepted, 1)
  }
  func testExistingOrReplacedDialogsCannotReceiveCloseDecision() throws {
    let graph = CloseGraph(), reader: MacNativeTerminalTabs
    reader = MacNativeTerminalTabs(readAttribute: graph.read); reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    graph.warning = true
    XCTAssertThrowsError(try reader.close(rows[0].nativeTabID!, application: graph.app))
    XCTAssertEqual(graph.closePressed, 0)
    graph.warning = false
    guard case .confirmation(let token, _, _) = try reader.close(rows[0].nativeTabID!, application: graph.app) else { return XCTFail() }
    graph.sheet = graph.makeElement()
    XCTAssertThrowsError(try reader.resolveClose(token: token, confirm: true))
    reader.cancelClose()
    XCTAssertEqual(graph.accepted, 0)
    XCTAssertEqual(graph.cancelled, 0, "A replacement dialog must remain untouched")
  }
  func testCancelAndDisconnectOnlyDismissOwnedWarning() throws {
    for disconnect in [false, true] {
      let graph = CloseGraph(), reader: MacNativeTerminalTabs
      graph.modalBlocksSelection = true
      graph.nestedWarning = true
      graph.cancelIsDefault = true
      reader = MacNativeTerminalTabs(readAttribute: graph.read); reader.performAction = graph.press
      let rows = try reader.snapshots(application: graph.app) { graph.shells }
      guard case .confirmation(let token, _, _) = try reader.close(rows[0].nativeTabID!, application: graph.app) else { return XCTFail() }
      if disconnect { reader.cancelClose() }
      else { guard case .cancelled = try reader.resolveClose(token: token, confirm: false) else { return XCTFail() } }
      XCTAssertEqual(graph.live, [0, 1])
      XCTAssertEqual(graph.cancelled, 1)
      XCTAssertEqual(graph.accepted, 0)
    }
  }
}

private final class CloseGraph {
  private var next: pid_t = 3_000_000
  func makeElement() -> AXUIElement { next += 1; return AXUIElementCreateApplication(next) }
  lazy var app = makeElement()
  lazy var window = makeElement()
  lazy var strip = makeElement()
  lazy var area = makeElement()
  lazy var sheet = makeElement()
  lazy var sheetContainer = makeElement()
  lazy var accept = makeElement()
  lazy var cancel = makeElement()
  lazy var text = makeElement()
  lazy var tabs = [makeElement(), makeElement()]
  lazy var buttons = [makeElement(), makeElement()]
  var live = [0, 1], selected = 0, closing = 0
  var warning = false
  var modalBlocksSelection = false
  var nestedWarning = false
  var cancelIsDefault = false
  var closeRequiresSelection = false
  var replaceWindowOnSelection = false
  var reorderOnSelection = false
  var ignoreClose = false
  var closeReply = AXError.success
  var accepted = 0, cancelled = 0, closePressed = 0
  var shells: [MacTerminalTabSnapshot] {
    live.map { .init(windowID: 100 + $0, windowIndex: $0 == selected ? 1 : 2, tabIndex: 1,
      customTitle: "same", tty: "/dev/ttys\($0)", isSelectedInWindow: true) }
  }
  func press(_ element: AXUIElement, _ action: String) -> AXError {
    if let tab = buttons.firstIndex(where: { CFEqual($0, element) }) {
      if closeRequiresSelection && selected != tab { return .success }
      if ignoreClose { closePressed += 1; return .success }
      closing = tab; warning = true; closePressed += 1
      return closeReply
    } else if let tab = tabs.firstIndex(where: { CFEqual($0, element) }) {
      selected = tab
      if replaceWindowOnSelection { window = makeElement() }
      if reorderOnSelection { live.reverse() }
    } else if CFEqual(element, accept), warning {
      live.removeAll { $0 == closing }; selected = live.first ?? 0; warning = false; accepted += 1
    } else if CFEqual(element, cancel), warning { warning = false; cancelled += 1 }
    else { return .invalidUIElement }
    return .success
  }
  func read(_ element: AXUIElement, _ attribute: String) throws -> CFTypeRef? {
    func isElement(_ other: AXUIElement) -> Bool { CFEqual(element, other) }
    let tab = tabs.firstIndex(where: isElement)
    switch attribute {
    case kAXWindowsAttribute where isElement(app): return (live.isEmpty ? [] : [window]) as CFArray
    case kAXFocusedWindowAttribute where isElement(app): return live.isEmpty ? nil : window
    case kAXRoleAttribute:
      let role = isElement(window) ? kAXWindowRole : isElement(strip) ? kAXTabGroupRole : isElement(area) ? kAXTextAreaRole :
        isElement(sheet) ? kAXSheetRole : isElement(sheetContainer) ? kAXGroupRole : isElement(text) ? kAXStaticTextRole : tab != nil ? kAXRadioButtonRole : kAXButtonRole
      return role as CFString
    case kAXChildrenAttribute:
      if isElement(window) { return ([area, strip] + (warning ? [nestedWarning ? sheetContainer : sheet] : [])) as CFArray }
      if isElement(sheetContainer) { return (warning ? [sheet] : []) as CFArray }
      if isElement(strip) { return live.map { tabs[$0] } as CFArray }
      if isElement(sheet) { return [text, accept, cancel] as CFArray }
      if let tab { return [buttons[tab]] as CFArray }
      return [] as CFArray
    case kAXTabsAttribute where isElement(strip): return live.map { tabs[$0] } as CFArray
    case kAXValueAttribute where isElement(strip):
      if warning && modalBlocksSelection {
        throw MacTerminalTabFailure(code: "layout_unavailable", message: "Modal blocks selection reads", state: nil)
      }
      return tabs[selected]
    case kAXParentAttribute where tab != nil: return strip
    case kAXWindowAttribute where tab != nil || isElement(sheet): return window
    case kAXValueAttribute where isElement(text): return "Closing this tab will terminate codex." as CFString
    case kAXTitleAttribute: return (isElement(accept) ? "Terminate" : isElement(cancel) ? "Cancel" : "same") as CFString
    case kAXDefaultButtonAttribute where isElement(sheet): return cancelIsDefault ? cancel : accept
    case kAXCancelButtonAttribute where isElement(sheet): return cancel
    case kAXEnabledAttribute: return kCFBooleanTrue
    default: return nil
    }
  }
}
