import Foundation

public enum RemoteSpeechContextAction: String, Codable, Sendable {
  case captureTarget
  case selection
}

/// Ephemeral context belongs to one Remote Assist connection. A successful empty
/// selection is distinct from a failed read, so errors never trigger unrelated speech.
public struct RemoteSpeechContextMessage: Codable, Equatable, Sendable {
  // JSON can escape one UTF-8 control byte as six ASCII bytes. Preserve the
  // advertised 64 KB text allowance while bounding the serialized envelope.
  public static let maximumEnvelopeBytes = RemoteClipboardMessage.maximumTextBytes * 6 + 4096
  public let type: String
  public let action: RemoteSpeechContextAction
  public let requestId: String
  public var ok: Bool?
  public var token: String?
  public var targetName: String?
  public var text: String?
  public var error: String?

  public static func request(_ action: RemoteSpeechContextAction, requestId: String) -> Self {
    Self(type: "speech.context", action: action, requestId: requestId)
  }

  public func success(token: String? = nil, targetName: String? = nil, text: String? = nil) -> Self {
    Self(type: "speech.context.result", action: action, requestId: requestId,
         ok: true, token: token, targetName: targetName, text: text)
  }

  public func failure(_ error: String) -> Self {
    Self(type: "speech.context.result", action: action, requestId: requestId, ok: false, error: error)
  }

  public func encode() throws -> Data {
    guard !requestId.isEmpty, requestId.utf8.count <= 128,
          (text?.utf8.count ?? 0) <= RemoteClipboardMessage.maximumTextBytes,
          (targetName?.utf8.count ?? 0) <= 1024 else { throw RemoteClipboardProtocolError.invalidCommand }
    if type == "speech.context" {
      guard ok == nil, token == nil, text == nil, error == nil, targetName == nil else {
        throw RemoteClipboardProtocolError.invalidCommand
      }
    } else if type == "speech.context.result", let ok {
      if ok {
        guard error == nil else { throw RemoteClipboardProtocolError.invalidResult }
        if action == .captureTarget {
          guard let token, !token.isEmpty, token.utf8.count <= 128, text == nil else {
            throw RemoteClipboardProtocolError.invalidResult
          }
        } else {
          guard text != nil, token == nil, targetName == nil else { throw RemoteClipboardProtocolError.invalidResult }
        }
      } else {
        guard let error, !error.isEmpty, error.utf8.count <= 2048,
              token == nil, text == nil, targetName == nil else { throw RemoteClipboardProtocolError.invalidResult }
      }
    } else { throw RemoteClipboardProtocolError.invalidType }
    let data = try JSONEncoder().encode(self)
    guard data.count <= Self.maximumEnvelopeBytes else { throw RemoteClipboardProtocolError.envelopeTooLarge }
    return data
  }

  public static func decode(_ data: Data) throws -> Self {
    guard data.count <= Self.maximumEnvelopeBytes else { throw RemoteClipboardProtocolError.envelopeTooLarge }
    let message = try JSONDecoder().decode(Self.self, from: data)
    _ = try message.encode()
    return message
  }
}
