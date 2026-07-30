import Foundation

public enum RemoteInputAction: String, Codable, Equatable, Sendable {
  case key
  case text
}

public struct RemoteInputTarget: Codable, Equatable, Sendable {
  public let applicationName: String
  public let bundleIdentifier: String?
  public let role: String

  public init(
    applicationName: String,
    bundleIdentifier: String?,
    role: String
  ) {
    self.applicationName = applicationName
    self.bundleIdentifier = bundleIdentifier
    self.role = role
  }
}

public struct RemoteInputMessage: Codable, Equatable, Sendable {
  public static let commandType = "input"
  public static let resultType = "input.result"
  public static let maximumTextBytes = 64 * 1024
  public static let maximumEnvelopeBytes = maximumTextBytes + 4 * 1024

  public let type: String
  public let action: RemoteInputAction
  public let requestId: String
  public let text: String?
  public let key: String?
  public let ok: Bool?
  public let error: String?
  public let target: RemoteInputTarget?

  public static func textRequest(
    text: String,
    requestId: String
  ) -> RemoteInputMessage {
    RemoteInputMessage(
      type: commandType,
      action: .text,
      requestId: requestId,
      text: text,
      key: nil,
      ok: nil,
      error: nil,
      target: nil
    )
  }

  public static func keyRequest(
    key: String,
    requestId: String
  ) -> RemoteInputMessage {
    RemoteInputMessage(
      type: commandType,
      action: .key,
      requestId: requestId,
      text: nil,
      key: key,
      ok: nil,
      error: nil,
      target: nil
    )
  }

  public static func success(
    action: RemoteInputAction,
    requestId: String,
    target: RemoteInputTarget
  ) -> RemoteInputMessage {
    RemoteInputMessage(
      type: resultType,
      action: action,
      requestId: requestId,
      text: nil,
      key: nil,
      ok: true,
      error: nil,
      target: target
    )
  }

  public static func failure(
    action: RemoteInputAction,
    requestId: String,
    error: String,
    target: RemoteInputTarget? = nil
  ) -> RemoteInputMessage {
    RemoteInputMessage(
      type: resultType,
      action: action,
      requestId: requestId,
      text: nil,
      key: nil,
      ok: false,
      error: error,
      target: target
    )
  }

  fileprivate func validate() throws {
    guard type == Self.commandType || type == Self.resultType else {
      throw RemoteInputProtocolError.invalidType
    }
    guard !requestId.isEmpty,
          requestId.utf8.count <= 128 else {
      throw RemoteInputProtocolError.invalidRequestId
    }
    if let text, text.utf8.count > Self.maximumTextBytes {
      throw RemoteInputProtocolError.textTooLarge
    }

    switch type {
    case Self.commandType:
      guard ok == nil,
            error == nil,
            target == nil else {
        throw RemoteInputProtocolError.invalidCommand
      }
      switch action {
      case .text:
        guard let text,
              !text.isEmpty,
              key == nil else {
          throw RemoteInputProtocolError.invalidCommand
        }
      case .key:
        guard text == nil,
              let key,
              !key.isEmpty,
              key.utf8.count <= 32 else {
          throw RemoteInputProtocolError.invalidCommand
        }
      }
    case Self.resultType:
      guard text == nil,
            key == nil,
            let ok else {
        throw RemoteInputProtocolError.invalidResult
      }
      if ok {
        guard error == nil, target != nil else {
          throw RemoteInputProtocolError.invalidResult
        }
      } else {
        guard let error,
              !error.isEmpty else {
          throw RemoteInputProtocolError.invalidResult
        }
      }
    default:
      throw RemoteInputProtocolError.invalidType
    }
  }
}

public enum RemoteInputCodec {
  public static func encode(_ message: RemoteInputMessage) throws -> Data {
    try message.validate()
    let data = try JSONEncoder().encode(message)
    guard data.count <= RemoteInputMessage.maximumEnvelopeBytes else {
      throw RemoteInputProtocolError.envelopeTooLarge
    }
    return data
  }

  public static func decode(_ data: Data) throws -> RemoteInputMessage {
    guard data.count <= RemoteInputMessage.maximumEnvelopeBytes else {
      throw RemoteInputProtocolError.envelopeTooLarge
    }
    let message = try JSONDecoder().decode(RemoteInputMessage.self, from: data)
    try message.validate()
    return message
  }
}

public enum RemoteInputProtocolError: LocalizedError, Equatable {
  case envelopeTooLarge
  case invalidCommand
  case invalidRequestId
  case invalidResult
  case invalidType
  case textTooLarge

  public var errorDescription: String? {
    switch self {
    case .envelopeTooLarge, .textTooLarge:
      return "Remote text must be 64 KB or smaller."
    case .invalidCommand:
      return "The Remote Assist input command is invalid."
    case .invalidRequestId:
      return "The Remote Assist input request ID is invalid."
    case .invalidResult:
      return "The Remote Assist input response is invalid."
    case .invalidType:
      return "The Remote Assist input message type is invalid."
    }
  }
}
