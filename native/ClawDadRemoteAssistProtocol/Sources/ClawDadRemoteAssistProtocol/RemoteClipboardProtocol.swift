import Foundation

public enum RemoteClipboardAction: String, Codable, Equatable, Sendable {
  case copy
  case paste
}

public struct RemoteClipboardMessage: Codable, Equatable, Sendable {
  public static let commandType = "clipboard"
  public static let resultType = "clipboard.result"
  public static let maximumTextBytes = 64 * 1024
  public static let maximumEnvelopeBytes = maximumTextBytes + 2 * 1024

  public let type: String
  public let action: RemoteClipboardAction
  public let requestId: String
  public let text: String?
  public let ok: Bool?
  public let error: String?

  public static func pasteRequest(
    text: String,
    requestId: String
  ) -> RemoteClipboardMessage {
    RemoteClipboardMessage(
      type: commandType,
      action: .paste,
      requestId: requestId,
      text: text,
      ok: nil,
      error: nil
    )
  }

  public static func copyRequest(requestId: String) -> RemoteClipboardMessage {
    RemoteClipboardMessage(
      type: commandType,
      action: .copy,
      requestId: requestId,
      text: nil,
      ok: nil,
      error: nil
    )
  }

  public static func success(
    action: RemoteClipboardAction,
    requestId: String,
    text: String? = nil
  ) -> RemoteClipboardMessage {
    RemoteClipboardMessage(
      type: resultType,
      action: action,
      requestId: requestId,
      text: text,
      ok: true,
      error: nil
    )
  }

  public static func failure(
    action: RemoteClipboardAction,
    requestId: String,
    error: String
  ) -> RemoteClipboardMessage {
    RemoteClipboardMessage(
      type: resultType,
      action: action,
      requestId: requestId,
      text: nil,
      ok: false,
      error: error
    )
  }

  fileprivate func validate() throws {
    guard type == Self.commandType || type == Self.resultType else {
      throw RemoteClipboardProtocolError.invalidType
    }
    guard !requestId.isEmpty,
          requestId.utf8.count <= 128 else {
      throw RemoteClipboardProtocolError.invalidRequestId
    }

    if let text, text.utf8.count > Self.maximumTextBytes {
      throw RemoteClipboardProtocolError.textTooLarge
    }

    switch type {
    case Self.commandType:
      guard ok == nil, error == nil else {
        throw RemoteClipboardProtocolError.invalidCommand
      }
      switch action {
      case .paste:
        guard let text, !text.isEmpty else {
          throw RemoteClipboardProtocolError.emptyText
        }
      case .copy:
        guard text == nil else {
          throw RemoteClipboardProtocolError.invalidCommand
        }
      }
    case Self.resultType:
      guard let ok else {
        throw RemoteClipboardProtocolError.invalidResult
      }
      if ok {
        guard error == nil else {
          throw RemoteClipboardProtocolError.invalidResult
        }
        if action == .copy {
          guard let text, !text.isEmpty else {
            throw RemoteClipboardProtocolError.emptyText
          }
        }
      } else {
        guard text == nil,
              let error,
              !error.isEmpty else {
          throw RemoteClipboardProtocolError.invalidResult
        }
      }
    default:
      throw RemoteClipboardProtocolError.invalidType
    }
  }
}

public enum RemoteClipboardCodec {
  public static func encode(_ message: RemoteClipboardMessage) throws -> Data {
    try message.validate()
    let data = try JSONEncoder().encode(message)
    guard data.count <= RemoteClipboardMessage.maximumEnvelopeBytes else {
      throw RemoteClipboardProtocolError.envelopeTooLarge
    }
    return data
  }

  public static func decode(_ data: Data) throws -> RemoteClipboardMessage {
    guard data.count <= RemoteClipboardMessage.maximumEnvelopeBytes else {
      throw RemoteClipboardProtocolError.envelopeTooLarge
    }
    let message = try JSONDecoder().decode(RemoteClipboardMessage.self, from: data)
    try message.validate()
    return message
  }
}

public enum RemoteClipboardProtocolError: LocalizedError, Equatable {
  case emptyText
  case envelopeTooLarge
  case invalidCommand
  case invalidRequestId
  case invalidResult
  case invalidType
  case textTooLarge

  public var errorDescription: String? {
    switch self {
    case .emptyText:
      return "The clipboard does not contain any text."
    case .envelopeTooLarge, .textTooLarge:
      return "Clipboard text must be 64 KB or smaller."
    case .invalidCommand:
      return "The clipboard command is invalid."
    case .invalidRequestId:
      return "The clipboard request ID is invalid."
    case .invalidResult:
      return "The clipboard response is invalid."
    case .invalidType:
      return "The Remote Assist control message type is invalid."
    }
  }
}
