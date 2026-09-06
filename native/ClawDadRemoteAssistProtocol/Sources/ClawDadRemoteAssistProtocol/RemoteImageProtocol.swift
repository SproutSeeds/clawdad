import Foundation

public enum RemoteImageLimits {
  public static let count = 8
  public static let fileBytes = 20 * 1024 * 1024
  public static let batchBytes = 80 * 1024 * 1024
  public static let chunkBytes = 128 * 1024
  public static let connectionBytes = 256 * 1024 * 1024
}

public struct RemoteImageUpload: Codable, Equatable, Sendable {
  public let id: String
  public let fileName: String
  public let mimeType: String
  public let size: Int
  public let sha256: String

  public init(id: String = UUID().uuidString.lowercased(), fileName: String, mimeType: String, size: Int, sha256: String) {
    self.id = id; self.fileName = fileName; self.mimeType = mimeType; self.size = size; self.sha256 = sha256
  }

  public func validate() throws {
    guard UUID(uuidString: id) != nil, id == id.lowercased(), size > 0, size <= RemoteImageLimits.fileBytes,
          !fileName.isEmpty, fileName.utf8.count <= 180,
          fileName.rangeOfCharacter(from: .controlCharacters) == nil,
          !fileName.contains("/"), !fileName.contains("\\"), !fileName.hasPrefix("."),
          sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { throw RemoteFileError.invalidMessage }
    let ext = (fileName as NSString).pathExtension.lowercased()
    guard (mimeType == "image/png" && ext == "png") || (mimeType == "image/jpeg" && ["jpg", "jpeg"].contains(ext)) else { throw RemoteFileError.invalidMessage }
  }
}

public struct RemoteImageUploadReceipt: Codable, Equatable, Sendable {
  public let uploadId: String
  public let offset: Int
  public let complete: Bool
  public let itemId: String?
  public let versionId: String?
}

/// Only identifiers cross the control channel. The host resolves its own files;
/// a phone can never supply an arbitrary Mac path or a shell command.
public struct RemoteImageAttachmentMessage: Codable, Equatable, Sendable {
  public let type: String
  public let requestId: String
  public let uploadIds: [String]
  public let targetToken: String?
  public let copyOnly: Bool?
  public let disposition: String?
  public let error: String?
  public var pastedCount: Int? = nil

  public static func request(uploadIds: [String], targetToken: String?, requestId: String = UUID().uuidString.lowercased(), copyOnly: Bool = false) -> Self {
    Self(type: "images.attach", requestId: requestId, uploadIds: uploadIds, targetToken: targetToken,
         copyOnly: copyOnly, disposition: nil, error: nil)
  }
  public func result(disposition: String? = nil, error: String? = nil, pastedCount: Int? = nil) -> Self {
    Self(type: "images.attach.result", requestId: requestId, uploadIds: uploadIds, targetToken: nil,
         copyOnly: nil, disposition: disposition, error: error,
         pastedCount: pastedCount ?? (disposition == "pasteRequested" ? uploadIds.count : disposition == "copied" ? 0 : nil))
  }
  public func encode() throws -> Data {
    guard ["images.attach", "images.attach.result"].contains(type), UUID(uuidString: requestId) != nil,
          !uploadIds.isEmpty, uploadIds.count <= RemoteImageLimits.count,
          Set(uploadIds).count == uploadIds.count,
          uploadIds.allSatisfy({ UUID(uuidString: $0) != nil && $0 == $0.lowercased() }),
          targetToken == nil || UUID(uuidString: targetToken!) != nil,
          pastedCount == nil || (pastedCount! >= 0 && pastedCount! <= uploadIds.count),
          (error?.utf8.count ?? 0) <= 1024 else { throw RemoteFileError.invalidMessage }
    if type == "images.attach" {
      guard disposition == nil, error == nil, pastedCount == nil else { throw RemoteFileError.invalidMessage }
    } else {
      guard targetToken == nil, copyOnly == nil else { throw RemoteFileError.invalidMessage }
      if error != nil {
        guard disposition == nil, pastedCount == nil else { throw RemoteFileError.invalidMessage }
      } else {
        guard let pastedCount,
              (disposition == "copied" && pastedCount < uploadIds.count) ||
              (disposition == "pasteRequested" && pastedCount == uploadIds.count) else { throw RemoteFileError.invalidMessage }
      }
    }
    return try JSONEncoder().encode(self)
  }
  public static func decode(_ data: Data) throws -> Self {
    guard data.count <= 4096 else { throw RemoteFileError.tooLarge }
    let message = try JSONDecoder().decode(Self.self, from: data)
    _ = try message.encode()
    return message
  }
}
