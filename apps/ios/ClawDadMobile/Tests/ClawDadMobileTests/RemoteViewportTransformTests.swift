import CoreGraphics
import XCTest
@testable import ClawDadMobile

final class RemoteViewportTransformTests: XCTestCase {
  private let squareBounds = CGRect(x: 0, y: 0, width: 400, height: 400)

  func testZoomScaleStaysWithinOneAndFourTimes() {
    var viewport = RemoteViewportTransform()
    let center = CGPoint(x: 200, y: 200)
    let contentVector = viewport.contentVector(at: center, in: squareBounds)

    viewport.zoom(
      to: 9,
      keeping: contentVector,
      at: center,
      in: squareBounds,
      aspectRatio: 1
    )
    XCTAssertEqual(viewport.scale, 4)
    XCTAssertTrue(viewport.isZoomed)

    viewport.zoom(
      to: 0.25,
      keeping: contentVector,
      at: center,
      in: squareBounds,
      aspectRatio: 1
    )
    XCTAssertEqual(viewport.scale, 1)
    XCTAssertEqual(viewport.offset, .zero)
    XCTAssertFalse(viewport.isZoomed)
  }

  func testPinchKeepsRemotePointUnderTheUsersFingers() {
    var viewport = RemoteViewportTransform()
    let pinchLocation = CGPoint(x: 100, y: 125)
    let before = viewport.normalizedPoint(
      pinchLocation,
      in: squareBounds,
      aspectRatio: 1
    )
    let contentVector = viewport.contentVector(
      at: pinchLocation,
      in: squareBounds
    )

    viewport.zoom(
      to: 2.5,
      keeping: contentVector,
      at: pinchLocation,
      in: squareBounds,
      aspectRatio: 1
    )
    let after = viewport.normalizedPoint(
      pinchLocation,
      in: squareBounds,
      aspectRatio: 1
    )

    XCTAssertEqual(after.x, before.x, accuracy: 0.0001)
    XCTAssertEqual(after.y, before.y, accuracy: 0.0001)
  }

  func testPanClampsTheRemoteScreenToTheViewportEdges() {
    var viewport = RemoteViewportTransform()
    let center = CGPoint(x: 200, y: 200)
    viewport.zoom(
      to: 4,
      keeping: viewport.contentVector(at: center, in: squareBounds),
      at: center,
      in: squareBounds,
      aspectRatio: 1
    )

    viewport.pan(
      by: CGSize(width: 2_000, height: -2_000),
      in: squareBounds,
      aspectRatio: 1
    )

    XCTAssertEqual(viewport.offset.width, 600)
    XCTAssertEqual(viewport.offset.height, -600)
  }

  func testTouchCoordinatesReverseZoomAndPan() {
    var viewport = RemoteViewportTransform()
    let center = CGPoint(x: 200, y: 200)
    viewport.zoom(
      to: 2,
      keeping: viewport.contentVector(at: center, in: squareBounds),
      at: center,
      in: squareBounds,
      aspectRatio: 1
    )
    viewport.pan(
      by: CGSize(width: 100, height: 0),
      in: squareBounds,
      aspectRatio: 1
    )

    let mapped = viewport.normalizedPoint(
      center,
      in: squareBounds,
      aspectRatio: 1
    )

    XCTAssertEqual(mapped.x, 0.375, accuracy: 0.0001)
    XCTAssertEqual(mapped.y, 0.5, accuracy: 0.0001)
  }
}
