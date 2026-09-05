import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteFileProtocolTests: XCTestCase {
  func testFragmentedDataReassemblesOutOfOrderWithDuplicateFrames() throws {
    let bytes = Data((0..<123_456).map { UInt8($0 % 255) })
    let frames = try RemoteFileFrame.split(bytes)
    var assembler = RemoteFileAssembler()
    let first = try JSONEncoder().encode(frames.last!)
    XCTAssertNil(try assembler.receive(first))
    XCTAssertNil(try assembler.receive(first))
    var result: Data?
    for frame in frames.dropLast().reversed() { result = try assembler.receive(JSONEncoder().encode(frame)) }
    XCTAssertEqual(result, bytes)
  }
  func testOversizedFramesAndInvalidFileRangesAreRejected() throws {
    var assembler = RemoteFileAssembler()
    XCTAssertThrowsError(try assembler.receive(Data(repeating: 1, count: 13 * 1024)))
    XCTAssertThrowsError(try RemoteFileFrame.split(Data(repeating: 1, count: RemoteFileFrame.maximumMessageBytes + 1)))
    XCTAssertThrowsError(try RemoteFileRequest(action: .chunk, id: "../../secret", versionId: UUID().uuidString, offset: 0).validate())
    XCTAssertThrowsError(try RemoteFileRequest(action: .chunk, id: UUID().uuidString, versionId: UUID().uuidString, offset: -1).validate())
    XCTAssertThrowsError(try RemoteFileRequest(action: .list, id: UUID().uuidString).validate())
    XCTAssertThrowsError(try RemoteFileRequest(action: .update, id: UUID().uuidString).validate())
  }
  func testTabMoveRequiresDistinctNeighborAndValidRevision() throws {
    let request = RemoteTerminalTabMessage.moveRequest(tabId: "source", neighborTabId: "neighbor", placeBefore: true, expectedRevision: 2, requestId: "move")
    XCTAssertEqual(try RemoteTerminalTabCodec.decode(RemoteTerminalTabCodec.encode(request)), request)
    XCTAssertThrowsError(try RemoteTerminalTabCodec.encode(.moveRequest(tabId: "source", neighborTabId: "source", placeBefore: false, expectedRevision: 2, requestId: "move")))
    XCTAssertThrowsError(try RemoteTerminalTabCodec.encode(.moveRequest(tabId: "source", neighborTabId: "neighbor", placeBefore: false, expectedRevision: 0, requestId: "move")))
  }
}
