import Foundation
import ClawDadRemoteAssistProtocol

enum AssistantImageUpload {
  @MainActor
  static func send(_ image: RemoteImageUpload, data: Data,
    request: ([String: AssistantValue]) async throws -> Data) async throws {
    try image.validate()
    guard data.count == image.size else { throw AssistantProtocolError.invalid }
    func perform(_ action: String, offset: Int? = nil) async throws -> RemoteImageUploadReceipt {
      var body: [String: AssistantValue] = ["action": .string(action), "upload": try .encode(image)]
      if let offset {
        let end = min(data.count, offset + RemoteImageLimits.chunkBytes)
        body["offset"] = .number(Double(offset))
        body["bytes"] = .string(data.subdata(in: offset..<end).base64EncodedString())
      }
      let receipt = try JSONDecoder().decode(RemoteImageUploadReceipt.self, from: await request(body))
      guard receipt.uploadId == image.id, receipt.offset >= 0, receipt.offset <= data.count,
        !receipt.complete || receipt.offset == data.count else { throw AssistantProtocolError.invalid }
      return receipt
    }
    var receipt = try await perform("uploadBegin")
    if receipt.complete { return }
    while receipt.offset < data.count {
      try Task.checkCancellation()
      let offset = receipt.offset
      receipt = try await perform("uploadChunk", offset: offset)
      guard receipt.offset == min(data.count, offset + RemoteImageLimits.chunkBytes) else { throw AssistantProtocolError.invalid }
    }
    receipt = try await perform("uploadFinish")
    guard receipt.complete else { throw AssistantProtocolError.invalid }
  }
}
