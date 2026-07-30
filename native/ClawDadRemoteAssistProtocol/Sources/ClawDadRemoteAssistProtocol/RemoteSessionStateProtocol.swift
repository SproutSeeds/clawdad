import Foundation

public struct RemoteSessionStateMessage: Codable, Equatable, Sendable {
  public static let messageType = "session.state"
  public static let maximumEnvelopeBytes = 1024

  public let type: String
  public let screenLocked: Bool

  public static func state(screenLocked: Bool) -> RemoteSessionStateMessage {
    RemoteSessionStateMessage(
      type: messageType,
      screenLocked: screenLocked
    )
  }

  fileprivate func validate() throws {
    guard type == Self.messageType else {
      throw RemoteSessionStateProtocolError.invalidType
    }
  }
}

public enum RemoteSessionStateCodec {
  public static func encode(_ message: RemoteSessionStateMessage) throws -> Data {
    try message.validate()
    let data = try JSONEncoder().encode(message)
    guard data.count <= RemoteSessionStateMessage.maximumEnvelopeBytes else {
      throw RemoteSessionStateProtocolError.envelopeTooLarge
    }
    return data
  }

  public static func decode(_ data: Data) throws -> RemoteSessionStateMessage {
    guard data.count <= RemoteSessionStateMessage.maximumEnvelopeBytes else {
      throw RemoteSessionStateProtocolError.envelopeTooLarge
    }
    let message = try JSONDecoder().decode(
      RemoteSessionStateMessage.self,
      from: data
    )
    try message.validate()
    return message
  }
}

public enum RemoteSessionStateProtocolError: Error, Equatable {
  case envelopeTooLarge
  case invalidType
}
