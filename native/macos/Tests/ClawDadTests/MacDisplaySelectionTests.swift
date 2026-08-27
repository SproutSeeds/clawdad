import ClawDadRemoteAssistProtocol
import CoreGraphics
import XCTest
@testable import ClawDad

final class MacDisplaySelectionTests: XCTestCase {
  func testCaptureDimensionsPreserveSmallerNativeDisplay() {
    XCTAssertEqual(
      macCaptureDimensions(displayWidth: 1512, displayHeight: 982),
      MacCaptureDimensions(width: 1512, height: 982)
    )
  }

  func testCaptureDimensionsCapWidthAndKeepEvenPixels() {
    XCTAssertEqual(
      macCaptureDimensions(displayWidth: 3457, displayHeight: 2235),
      MacCaptureDimensions(width: 1920, height: 1240)
    )
  }

  func testRemotePointUsesSelectedDisplayGlobalBounds() {
    let point = macRemoteScreenPoint(
      x: 0.25,
      y: 0.75,
      bounds: CGRect(x: -1920, y: -120, width: 1920, height: 1080)
    )

    XCTAssertEqual(point.x, -1440, accuracy: 0.001)
    XCTAssertEqual(point.y, 690, accuracy: 0.001)
  }

  func testRemotePointClampsNormalizedCoordinates() {
    let point = macRemoteScreenPoint(
      x: -2,
      y: 4,
      bounds: CGRect(x: 1440, y: 0, width: 2560, height: 1440)
    )

    XCTAssertEqual(point, CGPoint(x: 1440, y: 1440))
  }

  func testSelectionRejectsStaleRevisionBeforeDisplayLookup() {
    XCTAssertEqual(
      macDisplaySelectionDisposition(
        state: state(selectedDisplayId: "main"),
        requestedDisplayId: "missing",
        expectedTopologyRevision: 6
      ),
      .staleTopology
    )
  }

  func testSelectionDistinguishesCurrentAvailableAndMissingDisplays() {
    let state = state(selectedDisplayId: "main")

    XCTAssertEqual(
      macDisplaySelectionDisposition(
        state: state,
        requestedDisplayId: "main",
        expectedTopologyRevision: 7
      ),
      .alreadySelected
    )
    XCTAssertEqual(
      macDisplaySelectionDisposition(
        state: state,
        requestedDisplayId: "studio",
        expectedTopologyRevision: 7
      ),
      .switchDisplay
    )
    XCTAssertEqual(
      macDisplaySelectionDisposition(
        state: state,
        requestedDisplayId: "missing",
        expectedTopologyRevision: 7
      ),
      .unavailable
    )
  }

  func testPreferredDisplayKeepsSelectionThenFallsBackToPrimary() {
    let displays = descriptors()

    XCTAssertEqual(
      macPreferredDisplayId(
        currentDisplayId: "studio",
        displays: displays
      ),
      "studio"
    )
    XCTAssertEqual(
      macPreferredDisplayId(
        currentDisplayId: "disconnected",
        displays: displays
      ),
      "main"
    )
    XCTAssertNil(
      macPreferredDisplayId(currentDisplayId: "main", displays: [])
    )
  }

  private func state(selectedDisplayId: String) -> RemoteDisplayState {
    RemoteDisplayState(
      topologyRevision: 7,
      selectedDisplayId: selectedDisplayId,
      displays: descriptors()
    )
  }

  private func descriptors() -> [RemoteDisplayDescriptor] {
    [
      RemoteDisplayDescriptor(
        id: "main",
        name: "Built-in Display",
        width: 1512,
        height: 982,
        isPrimary: true
      ),
      RemoteDisplayDescriptor(
        id: "studio",
        name: "Studio Display",
        width: 1920,
        height: 1080,
        isPrimary: false
      ),
    ]
  }
}
