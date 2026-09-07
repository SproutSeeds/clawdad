import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

final class RemoteTerminalCloseIntentTests: XCTestCase {
  func testConfirmationIdentifiesDuplicateDirectoryPositionBusyAgentAndLastWindow() {
    let tab = RemoteTerminalTabDescriptor(id: "unique", title: "same-directory", detail: "Tab 7", isSelected: false,
      isBusy: true, windowTitle: "Terminal Window 2", windowGroupId: "window-2", tabPosition: 7)
    let intent = RemoteTerminalCloseIntent(tab: tab, revision: 12, isLastTab: true)
    XCTAssertEqual(intent.title, "Close same-directory?")
    XCTAssertEqual(intent.button, "Close Window")
    XCTAssertTrue(intent.message.contains("Terminal Window 2 · Tab 7"))
    XCTAssertTrue(intent.message.contains("An agent is working"))
    XCTAssertTrue(intent.message.contains("last tab"))
  }
  func testCloseCatalogSupersedesPollAndRejectsLateOlderState() {
    var selection = RemoteTerminalTabSelectionState()
    let original = RemoteTerminalTabState(revision: 1, selectedTabId: "a", tabs: [
      .init(id: "a", title: "same", detail: "Tab 1", isSelected: true, isBusy: false)])
    _ = selection.beginCatalog(requestId: "first")
    _ = selection.applyResult(.listSuccess(requestId: "first", state: original))
    _ = selection.beginCatalog(requestId: "poll")
    selection.applyCloseState(.init(revision: 2, selectedTabId: nil, tabs: []))
    _ = selection.applyResult(.listSuccess(requestId: "poll", state: original))
    XCTAssertTrue(selection.tabs.isEmpty)
    XCTAssertEqual(selection.canonicalState?.revision, 2)
  }
}
