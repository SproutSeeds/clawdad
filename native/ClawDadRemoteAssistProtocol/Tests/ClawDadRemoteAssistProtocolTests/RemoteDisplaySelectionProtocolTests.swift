import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteDisplaySelectionProtocolTests: XCTestCase {
  private let state = RemoteDisplayState(
    topologyRevision: 4,
    selectedDisplayId: "display-main",
    displays: [
      RemoteDisplayDescriptor(
        id: "display-main",
        name: "Built-in Display",
        width: 1920,
        height: 1200,
        isPrimary: true
      ),
      RemoteDisplayDescriptor(
        id: "display-side",
        name: "Studio Display",
        width: 1920,
        height: 1080,
        isPrimary: false
      ),
    ]
  )

  func testStateRoundTrips() throws {
    let message = RemoteDisplayMessage.state(state)

    let decoded = try RemoteDisplayCodec.decode(
      RemoteDisplayCodec.encode(message)
    )

    XCTAssertEqual(decoded, message)
  }

  func testSelectRequestRoundTripsWithExpectedRevision() throws {
    let message = RemoteDisplayMessage.selectRequest(
      displayId: "display-side",
      expectedTopologyRevision: 4,
      requestId: "select-1"
    )

    let decoded = try RemoteDisplayCodec.decode(
      RemoteDisplayCodec.encode(message)
    )

    XCTAssertEqual(decoded, message)
  }

  func testSuccessAndFailureAlwaysCarryCanonicalState() throws {
    for message in [
      RemoteDisplayMessage.selectSuccess(
        requestId: "select-success",
        state: state
      ),
      RemoteDisplayMessage.selectFailure(
        requestId: "select-failure",
        errorCode: "stale_topology",
        error: "The available screens changed. Choose a screen again.",
        state: state
      ),
    ] {
      XCTAssertEqual(
        try RemoteDisplayCodec.decode(RemoteDisplayCodec.encode(message)),
        message
      )
    }
  }

  func testStateRejectsDuplicateDisplayIDs() {
    let duplicateState = RemoteDisplayState(
      topologyRevision: 1,
      selectedDisplayId: "duplicate",
      displays: [
        RemoteDisplayDescriptor(
          id: "duplicate",
          name: "First",
          width: 100,
          height: 100,
          isPrimary: true
        ),
        RemoteDisplayDescriptor(
          id: "duplicate",
          name: "Second",
          width: 100,
          height: 100,
          isPrimary: false
        ),
      ]
    )

    XCTAssertThrowsError(
      try RemoteDisplayCodec.encode(.state(duplicateState))
    ) { error in
      XCTAssertEqual(error as? RemoteDisplayProtocolError, .invalidState)
    }
  }

  func testStateRequiresSelectedDisplayInCatalog() {
    let missingSelection = RemoteDisplayState(
      topologyRevision: 1,
      selectedDisplayId: "missing",
      displays: state.displays
    )

    XCTAssertThrowsError(
      try RemoteDisplayCodec.encode(.state(missingSelection))
    ) { error in
      XCTAssertEqual(error as? RemoteDisplayProtocolError, .invalidState)
    }
  }

  func testFailureRequiresBoundedCodeAndMessage() {
    let invalid = RemoteDisplayMessage(
      type: RemoteDisplayMessage.selectResultType,
      requestId: "select-2",
      displayId: nil,
      expectedTopologyRevision: nil,
      ok: false,
      errorCode: "",
      error: "",
      state: state
    )

    XCTAssertThrowsError(try RemoteDisplayCodec.encode(invalid)) { error in
      XCTAssertEqual(error as? RemoteDisplayProtocolError, .invalidMessage)
    }
  }

  func testSelectRequestRejectsMissingRevision() {
    let invalid = RemoteDisplayMessage(
      type: RemoteDisplayMessage.selectType,
      requestId: "select-3",
      displayId: "display-side",
      expectedTopologyRevision: nil,
      ok: nil,
      errorCode: nil,
      error: nil,
      state: nil
    )

    XCTAssertThrowsError(try RemoteDisplayCodec.encode(invalid)) { error in
      XCTAssertEqual(error as? RemoteDisplayProtocolError, .invalidMessage)
    }
  }
}
