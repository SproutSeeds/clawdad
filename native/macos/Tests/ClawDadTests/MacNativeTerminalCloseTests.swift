import AppKit
import ApplicationServices
import XCTest
@testable import ClawDad

final class MacNativeTerminalCloseTests: XCTestCase {
  func testInertTabCloseProxyUsesTheSingleTabMenuCommand() throws {
    let graph = CloseGraph()
    graph.ignoreTabProxy = true
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    guard case .confirmation(let token, _, _) = try reader.close(rows[1].nativeTabID!, application: graph.app) else {
      return XCTFail("Terminal's tab proxy can acknowledge AXPress without acting")
    }
    XCTAssertEqual(graph.menuPressed, 1)
    XCTAssertEqual(graph.proxyPressed, 0)
    XCTAssertEqual(graph.otherMenuPressed, 0)
    guard case .closed = try reader.resolveClose(token: token, confirm: true) else { return XCTFail() }
    XCTAssertEqual(graph.live, [0])
  }

  func testLocalizedMenuWithUppercaseShortcutUsesCommandMetadata() throws {
    let graph = CloseGraph()
    graph.shortcut = "W"
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    guard case .confirmation = try reader.close(rows[0].nativeTabID!, application: graph.app) else { return XCTFail() }
    XCTAssertEqual(graph.menuPressed, 1)
    XCTAssertEqual(graph.otherMenuPressed, 0)
  }

  func testLastStandaloneTabUsesSameMenuCommandAndConfirmsWindowDisappearance() throws {
    let graph = CloseGraph()
    graph.live = [0]
    graph.standalone = true
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    guard case .confirmation(let token, _, _) = try reader.close(rows[0].nativeTabID!, application: graph.app) else { return XCTFail() }
    guard case .closed = try reader.resolveClose(token: token, confirm: true) else { return XCTFail() }
    XCTAssertEqual(graph.menuPressed, 1)
    XCTAssertEqual(graph.proxyPressed, 0)
    XCTAssertTrue(graph.live.isEmpty)
  }

  func testMissingDisabledOrAmbiguousCloseMenuNeverFallsBackToTabOrWindowControls() throws {
    for mode in ["missing", "disabled", "duplicate", "shift", "option", "noCommand"] {
      let graph = CloseGraph()
      graph.menuMode = mode
      let reader = MacNativeTerminalTabs(readAttribute: graph.read)
      reader.performAction = graph.press
      let rows = try reader.snapshots(application: graph.app) { graph.shells }
      XCTAssertThrowsError(try reader.close(rows[0].nativeTabID!, application: graph.app), mode)
      XCTAssertEqual(graph.closePressed, 0, mode)
      XCTAssertEqual(graph.otherMenuPressed, 0, mode)
      XCTAssertEqual(graph.live, [0, 1], mode)
    }
  }

  func testTargetOrFrontmostAppChangingWhileMenuIsReadPreventsClose() throws {
    for mode in ["selection", "reorder", "frontmost"] {
      let graph = CloseGraph()
      graph.changeDuringMenuRead = mode
      let reader = MacNativeTerminalTabs(readAttribute: graph.read)
      reader.performAction = graph.press
      let rows = try reader.snapshots(application: graph.app) { graph.shells }
      XCTAssertThrowsError(try reader.close(rows[0].nativeTabID!, application: graph.app), mode)
      XCTAssertEqual(graph.closePressed, 0, mode)
      XCTAssertEqual(graph.live.count, 2, mode)
    }
  }

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

  func testBackgroundTabIsSelectedBeforeItsCloseCommandIsPressed() throws {
    let graph = CloseGraph()
    graph.closeRequiresSelection = true
    let reader = MacNativeTerminalTabs(readAttribute: graph.read)
    reader.performAction = graph.press
    let rows = try reader.snapshots(application: graph.app) { graph.shells }
    guard case .confirmation = try reader.close(rows[1].nativeTabID!, application: graph.app) else {
      return XCTFail("The requested tab must own the active native close command")
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
  lazy var menuBar = makeElement()
  lazy var fileItem = makeElement()
  lazy var fileMenu = makeElement()
  lazy var closeItem = makeElement()
  lazy var closeWindowItem = makeElement()
  lazy var closeOthersItem = makeElement()
  lazy var closeAllItem = makeElement()
  lazy var duplicateCloseItem = makeElement()
  var live = [0, 1], selected = 0, closing = 0
  var warning = false
  var modalBlocksSelection = false
  var nestedWarning = false
  var cancelIsDefault = false
  var closeRequiresSelection = false
  var replaceWindowOnSelection = false
  var reorderOnSelection = false
  var ignoreClose = false
  var ignoreTabProxy = false
  var frontmost = true
  var standalone = false
  var shortcut = "w"
  var menuMode = "normal"
  var changeDuringMenuRead = ""
  var closeReply = AXError.success
  var accepted = 0, cancelled = 0, closePressed = 0
  var menuPressed = 0, proxyPressed = 0, otherMenuPressed = 0
  var shells: [MacTerminalTabSnapshot] {
    live.map { .init(windowID: 100 + $0, windowIndex: $0 == selected ? 1 : 2, tabIndex: 1,
      customTitle: "same", tty: "/dev/ttys\($0)", isSelectedInWindow: true) }
  }
  func press(_ element: AXUIElement, _ action: String) -> AXError {
    if let tab = buttons.firstIndex(where: { CFEqual($0, element) }) {
      proxyPressed += 1
      if ignoreTabProxy { closePressed += 1; return .success }
      if closeRequiresSelection && selected != tab { return .success }
      if ignoreClose { closePressed += 1; return .success }
      closing = tab; warning = true; closePressed += 1
      return closeReply
    } else if CFEqual(element, closeItem) {
      menuPressed += 1; closePressed += 1
      if !ignoreClose { closing = selected; warning = true }
      return closeReply
    } else if [closeWindowItem, closeOthersItem, closeAllItem, duplicateCloseItem].contains(where: { CFEqual($0, element) }) {
      otherMenuPressed += 1
      return .success
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
    let menuItems = [closeItem, closeWindowItem, closeOthersItem, closeAllItem, duplicateCloseItem]
    switch attribute {
    case kAXFrontmostAttribute where isElement(app): return frontmost ? kCFBooleanTrue : kCFBooleanFalse
    case kAXMenuBarAttribute where isElement(app):
      switch changeDuringMenuRead {
      case "selection": selected = 1 - selected
      case "reorder": live.reverse()
      case "frontmost": frontmost = false
      default: break
      }
      changeDuringMenuRead = ""
      return menuBar
    case kAXWindowsAttribute where isElement(app): return (live.isEmpty ? [] : [window]) as CFArray
    case kAXFocusedWindowAttribute where isElement(app): return live.isEmpty ? nil : window
    case kAXRoleAttribute:
      if isElement(menuBar) { return kAXMenuBarRole as CFString }
      if isElement(fileItem) { return kAXMenuBarItemRole as CFString }
      if isElement(fileMenu) { return kAXMenuRole as CFString }
      if menuItems.contains(where: isElement) { return kAXMenuItemRole as CFString }
      let role = isElement(window) ? kAXWindowRole : isElement(strip) ? kAXTabGroupRole : isElement(area) ? kAXTextAreaRole :
        isElement(sheet) ? kAXSheetRole : isElement(sheetContainer) ? kAXGroupRole : isElement(text) ? kAXStaticTextRole : tab != nil ? kAXRadioButtonRole : kAXButtonRole
      return role as CFString
    case kAXChildrenAttribute:
      if isElement(menuBar) { return [fileItem] as CFArray }
      if isElement(fileItem) { return [fileMenu] as CFArray }
      if isElement(fileMenu) {
        return ([closeWindowItem, closeOthersItem, closeAllItem] +
          (menuMode == "missing" ? [] : [closeItem]) +
          (menuMode == "duplicate" ? [duplicateCloseItem] : [])) as CFArray
      }
      if isElement(window) { return ([area] + (standalone ? [] : [strip]) + (warning ? [nestedWarning ? sheetContainer : sheet] : [])) as CFArray }
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
    case kAXTitleAttribute: return (isElement(accept) ? "Terminate" : isElement(cancel) ? "Cancel" : isElement(closeItem) ? "Fermer l’onglet" : "same") as CFString
    case kAXDefaultButtonAttribute where isElement(sheet): return cancelIsDefault ? cancel : accept
    case kAXCancelButtonAttribute where isElement(sheet): return cancel
    case kAXMenuItemCmdCharAttribute where menuItems.contains(where: isElement): return shortcut as CFString
    case kAXMenuItemCmdModifiersAttribute where menuItems.contains(where: isElement):
      let modifier = isElement(closeWindowItem) ? 1 : isElement(closeOthersItem) ? 2 : isElement(closeAllItem) ? 3 :
        menuMode == "shift" ? 1 : menuMode == "option" ? 2 : menuMode == "noCommand" ? 8 : 0
      return NSNumber(value: modifier)
    case kAXEnabledAttribute: return isElement(closeItem) && menuMode == "disabled" ? kCFBooleanFalse : kCFBooleanTrue
    default: return nil
    }
  }
}
