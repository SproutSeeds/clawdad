import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDadMobile

final class RemoteImagePreparationTests: XCTestCase {
  func testScreenshotKeepsItsOriginalPNGBytesAndGetsAnImageExtension() throws {
    let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!
    let prepared = try RemoteImagePreparation.prepare(png, fileName: "Screenshot 4.32.png")
    XCTAssertEqual(prepared.data, png)
    XCTAssertEqual(prepared.upload.fileName, "Screenshot 432.png")
    XCTAssertEqual(prepared.upload.mimeType, "image/png")
    try prepared.upload.validate()
  }
  func testUnreadableInputDoesNotBecomeAnAttachment() {
    XCTAssertThrowsError(try RemoteImagePreparation.prepare(Data("not an image".utf8)))
  }
}
