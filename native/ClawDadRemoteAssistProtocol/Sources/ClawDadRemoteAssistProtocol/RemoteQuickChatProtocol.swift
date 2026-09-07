import Foundation

/// A preset and its submit keystroke travel together, addressed to the input
/// captured when the phone opened its controls. Receipts never contain the text.
public struct RemoteQuickChatMessage: Codable, Equatable, Sendable {
  public static let maximumTextBytes = 16 * 1024
  public let type: String
  public let requestId: String
  public var targetToken: String?
  public var text: String?
  public var ok: Bool?
  public var error: String?

  public static func request(text: String, targetToken: String, requestId: String) -> Self {
    Self(type: "quick.chat", requestId: requestId, targetToken: targetToken, text: text)
  }

  public func result(error: String? = nil) -> Self {
    Self(type: "quick.chat.result", requestId: requestId, ok: error == nil, error: error)
  }

  public func encode() throws -> Data {
    guard !requestId.isEmpty, requestId.utf8.count <= 128 else { throw RemoteInputProtocolError.invalidRequestId }
    if type == "quick.chat" {
      guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            text.utf8.count <= Self.maximumTextBytes, !text.contains("\0"),
            let targetToken, !targetToken.isEmpty, targetToken.utf8.count <= 128,
            ok == nil, error == nil else { throw RemoteInputProtocolError.invalidCommand }
    } else if type == "quick.chat.result" {
      guard targetToken == nil, text == nil, let ok,
            ok ? error == nil : (error?.isEmpty == false && (error?.utf8.count ?? 0) <= 2048)
      else { throw RemoteInputProtocolError.invalidResult }
    } else { throw RemoteInputProtocolError.invalidType }
    let data = try JSONEncoder().encode(self)
    guard data.count <= Self.maximumTextBytes * 6 + 4096 else { throw RemoteInputProtocolError.envelopeTooLarge }
    return data
  }

  public static func decode(_ data: Data) throws -> Self {
    guard data.count <= Self.maximumTextBytes * 6 + 4096 else { throw RemoteInputProtocolError.envelopeTooLarge }
    let message = try JSONDecoder().decode(Self.self, from: data)
    _ = try message.encode()
    return message
  }
}
