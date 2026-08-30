import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

final class RemoteTerminalTabSelectionStateTests: XCTestCase {
  func testCatalogRequestExposesLoadingUntilMatchingResult() {
    var selection = RemoteTerminalTabSelectionState()
    let attempt = selection.beginCatalog(requestId: "request-1")

    XCTAssertEqual(attempt?.kind, .catalog)
    XCTAssertTrue(selection.catalogLoading)

    let application = selection.applyResult(
      .listSuccess(requestId: "request-1", state: state())
    )

    XCTAssertEqual(application?.matchedPendingRequest, true)
    XCTAssertTrue(application?.acceptedState == true)
    XCTAssertFalse(selection.requestPending)
    XCTAssertEqual(selection.tabs.count, 2)
  }

  func testFocusRequiresKnownUnselectedTab() {
    var selection = RemoteTerminalTabSelectionState()
    _ = selection.applyResult(
      .listSuccess(requestId: "bootstrap", state: state())
    )

    XCTAssertNil(selection.beginFocus(
      tabId: "tab-one",
      requestId: "request-selected"
    ))
    XCTAssertNil(selection.beginFocus(
      tabId: "missing",
      requestId: "request-missing"
    ))

    let attempt = selection.beginFocus(
      tabId: "tab-two",
      requestId: "request-2"
    )
    XCTAssertEqual(attempt?.kind, .focus(tabId: "tab-two"))
    XCTAssertEqual(selection.pendingTabId, "tab-two")
  }

  func testMatchingFocusSuccessUpdatesSelectionAndClearsPending() {
    var selection = RemoteTerminalTabSelectionState()
    _ = selection.applyResult(
      .listSuccess(requestId: "bootstrap", state: state())
    )
    _ = selection.beginFocus(tabId: "tab-two", requestId: "request-3")

    let application = selection.applyResult(
      .focusSuccess(
        requestId: "request-3",
        state: state(revision: 2, selectedTabId: "tab-two")
      )
    )

    XCTAssertEqual(application?.matchedPendingRequest, true)
    XCTAssertEqual(application?.selectedTabChanged, true)
    XCTAssertEqual(selection.selectedTabId, "tab-two")
    XCTAssertFalse(selection.requestPending)
  }

  func testStaleResponseDoesNotClearNewRequestOrRegressState() {
    var selection = RemoteTerminalTabSelectionState()
    _ = selection.applyResult(
      .listSuccess(
        requestId: "bootstrap",
        state: state(revision: 4)
      )
    )
    _ = selection.beginCatalog(requestId: "request-new")

    let application = selection.applyResult(
      .listSuccess(
        requestId: "request-old",
        state: state(revision: 3, selectedTabId: "tab-two")
      )
    )

    XCTAssertEqual(application?.matchedPendingRequest, false)
    XCTAssertEqual(application?.acceptedState, false)
    XCTAssertEqual(selection.pendingAttempt?.requestId, "request-new")
    XCTAssertEqual(selection.selectedTabId, "tab-one")
  }

  func testTimeoutClearsOnlyMatchingRequest() {
    var selection = RemoteTerminalTabSelectionState()
    _ = selection.beginCatalog(requestId: "request-4")

    XCTAssertFalse(selection.timeOut(requestId: "request-old"))
    XCTAssertTrue(selection.requestPending)
    XCTAssertTrue(selection.timeOut(requestId: "request-4"))
    XCTAssertFalse(selection.requestPending)
  }

  private func state(
    revision: Int = 1,
    selectedTabId: String = "tab-one"
  ) -> RemoteTerminalTabState {
    RemoteTerminalTabState(
      revision: revision,
      selectedTabId: selectedTabId,
      tabs: [
        RemoteTerminalTabDescriptor(
          id: "tab-one",
          title: "clawdad",
          detail: "Window 1 • Tab 1",
          isSelected: selectedTabId == "tab-one",
          isBusy: true
        ),
        RemoteTerminalTabDescriptor(
          id: "tab-two",
          title: "life-ops",
          detail: "Window 2 • Tab 1",
          isSelected: selectedTabId == "tab-two",
          isBusy: false
        ),
      ]
    )
  }
}
