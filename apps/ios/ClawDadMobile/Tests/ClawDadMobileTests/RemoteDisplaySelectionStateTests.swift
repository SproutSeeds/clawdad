import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

final class RemoteDisplaySelectionStateTests: XCTestCase {
  func testOlderHostLeavesDisplaySelectionUnavailable() {
    let selection = RemoteDisplaySelectionState()

    XCTAssertTrue(selection.displays.isEmpty)
    XCTAssertFalse(selection.hasMultipleDisplays)
    XCTAssertFalse(selection.inputSuppressed)
    XCTAssertNil(selection.pendingAttempt)
  }

  func testCanonicalStateCanConfirmSelectionBeforeResultArrives() {
    var selection = RemoteDisplaySelectionState()
    _ = selection.applyState(state(selectedDisplayId: "display-1"))

    let attempt = selection.beginSelection(
      displayId: "display-2",
      requestId: "request-1"
    )

    XCTAssertEqual(attempt?.expectedTopologyRevision, 7)
    XCTAssertTrue(selection.inputSuppressed)

    let application = selection.applyState(
      state(selectedDisplayId: "display-2")
    )

    XCTAssertTrue(application.accepted)
    XCTAssertTrue(application.selectedDisplayChanged)
    XCTAssertTrue(application.pendingResolved)
    XCTAssertFalse(application.pendingInvalidated)
    XCTAssertEqual(selection.selectedDisplayId, "display-2")
    XCTAssertFalse(selection.inputSuppressed)
  }

  func testMatchingFailureClearsPendingAndKeepsCanonicalDisplay() {
    var selection = RemoteDisplaySelectionState()
    let current = state(selectedDisplayId: "display-1")
    _ = selection.applyState(current)
    _ = selection.beginSelection(
      displayId: "display-2",
      requestId: "request-1"
    )

    let application = selection.applyResult(
      .selectFailure(
        requestId: "request-1",
        errorCode: "topology_changed",
        error: "The display topology changed.",
        state: current
      )
    )

    XCTAssertEqual(application?.matchedPendingRequest, true)
    XCTAssertEqual(selection.selectedDisplayId, "display-1")
    XCTAssertFalse(selection.inputSuppressed)
  }

  func testLateSuccessReconcilesAfterRequestTimeout() {
    var selection = RemoteDisplaySelectionState()
    _ = selection.applyState(state(selectedDisplayId: "display-1"))
    _ = selection.beginSelection(
      displayId: "display-2",
      requestId: "request-1"
    )

    XCTAssertTrue(selection.timeOut(requestId: "request-1"))
    XCTAssertFalse(selection.inputSuppressed)

    let application = selection.applyResult(
      .selectSuccess(
        requestId: "request-1",
        state: state(selectedDisplayId: "display-2")
      )
    )

    XCTAssertEqual(application?.matchedPendingRequest, false)
    XCTAssertEqual(
      application?.stateApplication.selectedDisplayChanged,
      true
    )
    XCTAssertEqual(selection.selectedDisplayId, "display-2")
  }

  func testTopologyRefreshInvalidatesMissingPendingDisplay() {
    var selection = RemoteDisplaySelectionState()
    _ = selection.applyState(state(selectedDisplayId: "display-1"))
    _ = selection.beginSelection(
      displayId: "display-2",
      requestId: "request-1"
    )

    let refreshed = RemoteDisplayState(
      topologyRevision: 8,
      selectedDisplayId: "display-1",
      displays: [displayOne]
    )
    let application = selection.applyState(refreshed)

    XCTAssertTrue(application.pendingInvalidated)
    XCTAssertFalse(selection.inputSuppressed)
    XCTAssertFalse(selection.hasMultipleDisplays)
  }

  func testStaleResultDoesNotClearCurrentPendingRequest() {
    var selection = RemoteDisplaySelectionState()
    _ = selection.applyState(state(selectedDisplayId: "display-1"))
    _ = selection.beginSelection(
      displayId: "display-2",
      requestId: "request-2"
    )

    let application = selection.applyResult(
      .selectSuccess(
        requestId: "request-1",
        state: state(selectedDisplayId: "display-1")
      )
    )

    XCTAssertEqual(application?.matchedPendingRequest, false)
    XCTAssertEqual(selection.pendingAttempt?.requestId, "request-2")
    XCTAssertTrue(selection.inputSuppressed)
  }

  func testOlderTopologyRevisionCannotRegressSelection() {
    var selection = RemoteDisplaySelectionState()
    _ = selection.applyState(
      state(topologyRevision: 9, selectedDisplayId: "display-2")
    )

    let application = selection.applyState(
      state(topologyRevision: 8, selectedDisplayId: "display-1")
    )

    XCTAssertFalse(application.accepted)
    XCTAssertEqual(selection.selectedDisplayId, "display-2")
  }

  private var displayOne: RemoteDisplayDescriptor {
    RemoteDisplayDescriptor(
      id: "display-1",
      name: "Studio Display",
      width: 2560,
      height: 1440,
      isPrimary: true
    )
  }

  private var displayTwo: RemoteDisplayDescriptor {
    RemoteDisplayDescriptor(
      id: "display-2",
      name: "Side Display",
      width: 1920,
      height: 1080,
      isPrimary: false
    )
  }

  private func state(
    topologyRevision: Int = 7,
    selectedDisplayId: String
  ) -> RemoteDisplayState {
    RemoteDisplayState(
      topologyRevision: topologyRevision,
      selectedDisplayId: selectedDisplayId,
      displays: [displayOne, displayTwo]
    )
  }
}
