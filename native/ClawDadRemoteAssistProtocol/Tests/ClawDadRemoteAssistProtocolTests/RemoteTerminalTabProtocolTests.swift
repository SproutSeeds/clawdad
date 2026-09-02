import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteTerminalTabProtocolTests: XCTestCase {
  private let state = RemoteTerminalTabState(
    revision: 4,
    selectedTabId: "tab-one",
    tabs: [
      RemoteTerminalTabDescriptor(
        id: "tab-one",
        title: "clawdad",
        detail: "Window 1 • Tab 1",
        isSelected: true,
        isBusy: true
      ),
      RemoteTerminalTabDescriptor(
        id: "tab-two",
        title: "life-ops",
        detail: "Window 2 • Tab 1",
        isSelected: false,
        isBusy: false,
        hasUnreadActivity: true
      ),
    ]
  )

  func testListRequestAndSuccessRoundTrip() throws {
    let request = RemoteTerminalTabMessage.listRequest(requestId: "request-1")
    let response = RemoteTerminalTabMessage.listSuccess(
      requestId: "request-1",
      state: state
    )

    XCTAssertEqual(
      try RemoteTerminalTabCodec.decode(RemoteTerminalTabCodec.encode(request)),
      request
    )
    XCTAssertEqual(
      try RemoteTerminalTabCodec.decode(RemoteTerminalTabCodec.encode(response)),
      response
    )
  }

  func testFocusRequestAndResultRoundTrip() throws {
    let request = RemoteTerminalTabMessage.focusRequest(
      tabId: "tab-two",
      expectedRevision: 4,
      requestId: "request-2"
    )
    let response = RemoteTerminalTabMessage.focusSuccess(
      requestId: "request-2",
      state: state
    )

    XCTAssertEqual(
      try RemoteTerminalTabCodec.decode(RemoteTerminalTabCodec.encode(request)),
      request
    )
    XCTAssertEqual(
      try RemoteTerminalTabCodec.decode(RemoteTerminalTabCodec.encode(response)),
      response
    )
  }

  func testFailureCanCarryFreshState() throws {
    let response = RemoteTerminalTabMessage.focusFailure(
      requestId: "request-3",
      errorCode: "stale_catalog",
      error: "The Terminal tabs changed. Choose a tab again.",
      state: state
    )

    XCTAssertEqual(
      try RemoteTerminalTabCodec.decode(RemoteTerminalTabCodec.encode(response)),
      response
    )
  }

  func testUnreadActivityRoundTrips() throws {
    let response = RemoteTerminalTabMessage.listSuccess(
      requestId: "request-unread",
      state: state
    )

    let decoded = try RemoteTerminalTabCodec.decode(
      RemoteTerminalTabCodec.encode(response)
    )

    XCTAssertEqual(decoded.state?.tabs[1].hasUnreadActivity, true)
  }

  func testLegacyDescriptorWithoutUnreadActivityDefaultsToFalse() throws {
    let legacy = Data(#"{"id":"tab-one","title":"clawdad","detail":"Window 1 • Tab 1","isSelected":true,"isBusy":true}"#.utf8)

    let descriptor = try JSONDecoder().decode(
      RemoteTerminalTabDescriptor.self,
      from: legacy
    )

    XCTAssertFalse(descriptor.hasUnreadActivity)
  }

  func testEmptyCatalogIsValid() throws {
    let emptyState = RemoteTerminalTabState(
      revision: 1,
      selectedTabId: nil,
      tabs: []
    )

    XCTAssertNoThrow(
      try RemoteTerminalTabCodec.encode(
        .listSuccess(requestId: "request-4", state: emptyState)
      )
    )
  }

  func testSelectedIdentifierMustMatchOneSelectedTab() {
    let invalidState = RemoteTerminalTabState(
      revision: 1,
      selectedTabId: "tab-two",
      tabs: state.tabs
    )

    XCTAssertThrowsError(
      try RemoteTerminalTabCodec.encode(
        .listSuccess(requestId: "request-5", state: invalidState)
      )
    ) { error in
      XCTAssertEqual(
        error as? RemoteTerminalTabProtocolError,
        .invalidState
      )
    }
  }

  func testSuccessfulResultRequiresState() {
    let invalid = RemoteTerminalTabMessage(
      type: RemoteTerminalTabMessage.listResultType,
      requestId: "request-6",
      tabId: nil,
      expectedRevision: nil,
      ok: true,
      errorCode: nil,
      error: nil,
      state: nil
    )

    XCTAssertThrowsError(try RemoteTerminalTabCodec.encode(invalid)) { error in
      XCTAssertEqual(
        error as? RemoteTerminalTabProtocolError,
        .invalidMessage
      )
    }
  }
}
