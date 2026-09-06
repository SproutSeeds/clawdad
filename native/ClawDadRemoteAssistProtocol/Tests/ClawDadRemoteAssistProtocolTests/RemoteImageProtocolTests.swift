import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteImageProtocolTests: XCTestCase {
  private func image(name: String = "screenshot.png", size: Int = 100) -> RemoteImageUpload {
    .init(fileName: name, mimeType: "image/png", size: size, sha256: String(repeating: "a", count: 64))
  }
  func testUploadChunksAndLimits() throws {
    let upload = image()
    let request = RemoteFileRequest(action: .uploadChunk, offset: 0, upload: upload, bytes: Data(repeating: 1, count: 100))
    try JSONDecoder().decode(RemoteFileRequest.self, from: JSONEncoder().encode(request)).validate()
    XCTAssertThrowsError(try RemoteFileRequest(action: .uploadChunk, offset: 1, upload: upload, bytes: Data(repeating: 1, count: 100)).validate())
    XCTAssertThrowsError(try RemoteFileRequest(action: .uploadBegin, upload: upload, bytes: Data([1])).validate())
    XCTAssertThrowsError(try RemoteFileRequest(action: .list, upload: upload).validate())
    XCTAssertThrowsError(try image(name: "../../secret.png").validate())
    XCTAssertThrowsError(try image(size: RemoteImageLimits.fileBytes + 1).validate())
    try RemoteFileRequest(action: .list, category: "receivedImages").validate()
  }
  func testAttachmentCarriesOnlyValidatedIDsAndSeparateReceipt() throws {
    let request = RemoteImageAttachmentMessage.request(uploadIds: [image().id, image().id], targetToken: UUID().uuidString)
    XCTAssertEqual(try RemoteImageAttachmentMessage.decode(request.encode()), request)
    XCTAssertEqual(try RemoteImageAttachmentMessage.decode(request.result(disposition: "copied").encode()).disposition, "copied")
    XCTAssertThrowsError(try RemoteImageAttachmentMessage.request(uploadIds: ["/tmp/screenshot.png"], targetToken: nil).encode())
    XCTAssertThrowsError(try request.result(disposition: "inserted").encode())
    let id = image().id
    XCTAssertThrowsError(try RemoteImageAttachmentMessage.request(uploadIds: [id, id], targetToken: nil).encode())
  }
  func testLockUpdatesPreserveImageCapabilityAndOldHostsDecode() throws {
    var capabilities = RemoteSessionCapabilities()
    capabilities.begin(requestId: "check")
    XCTAssertTrue(capabilities.receive(.state(screenLocked: false, supportsImageAttachments: true, requestId: "check")))
    XCTAssertTrue(capabilities.receive(.state(screenLocked: true)))
    XCTAssertEqual(capabilities.imageAttachments, true)
    let old = try RemoteSessionStateCodec.decode(Data("{\"type\":\"session.state\",\"screenLocked\":false}".utf8))
    XCTAssertNil(old.supportsImageAttachments)
  }
}
