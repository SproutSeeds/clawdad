import Foundation

public struct RemoteSessionStateMessage: Codable, Equatable, Sendable {
  public static let messageType = "session.state"
  public static let maximumEnvelopeBytes = 1024

  public let type: String
  public let screenLocked: Bool
  public var supportsDictation: Bool? = nil
  public var supportsTerminalReadAloud: Bool? = nil
  public var supportsInlineSpeech: Bool? = nil
  public var supportsImageAttachments: Bool? = nil
  public var supportsQuickChat: Bool? = nil
  public var requestId: String? = nil

  public static func state(screenLocked: Bool, supportsDictation: Bool? = nil, supportsTerminalReadAloud: Bool? = nil, supportsInlineSpeech: Bool? = nil, supportsImageAttachments: Bool? = nil, supportsQuickChat: Bool? = nil, requestId: String? = nil) -> RemoteSessionStateMessage {
    RemoteSessionStateMessage(
      type: messageType,
      screenLocked: screenLocked,
      supportsDictation: supportsDictation,
      supportsTerminalReadAloud: supportsTerminalReadAloud,
      supportsInlineSpeech: supportsInlineSpeech,
      supportsImageAttachments: supportsImageAttachments,
      supportsQuickChat: supportsQuickChat,
      requestId: requestId
    )
  }

  fileprivate func validate() throws {
    guard type == Self.messageType else {
      throw RemoteSessionStateProtocolError.invalidType
    }
    if let requestId, requestId.isEmpty || requestId.utf8.count > 128 {
      throw RemoteSessionStateProtocolError.invalidType
    }
  }
}

/// The receiver requests state only after installing its data-channel delegate.
/// Retrying the same request is read-only and repairs a lost initial advertisement.
public struct RemoteSessionStateRequest: Codable, Equatable, Sendable {
  public let type: String
  public let requestId: String

  public init(requestId: String) {
    type = "session.state.request"
    self.requestId = requestId
  }

  public func encode() throws -> Data {
    guard type == "session.state.request", !requestId.isEmpty, requestId.utf8.count <= 128 else {
      throw RemoteSessionStateProtocolError.invalidType
    }
    return try JSONEncoder().encode(self)
  }

  public static func decode(_ data: Data) throws -> Self {
    guard data.count <= 1024 else { throw RemoteSessionStateProtocolError.envelopeTooLarge }
    let request = try JSONDecoder().decode(Self.self, from: data)
    _ = try request.encode()
    return request
  }
}

public struct RemoteSessionCapabilities: Equatable, Sendable {
  public private(set) var requestId = ""
  public private(set) var received = false
  public private(set) var timedOut = false
  public private(set) var dictation: Bool?
  public private(set) var terminalReadAloud: Bool?
  public private(set) var inlineSpeech: Bool?
  public private(set) var imageAttachments: Bool?
  public private(set) var quickChat: Bool?

  public init() {}

  public mutating func begin(requestId: String) {
    self = Self()
    self.requestId = requestId
  }

  @discardableResult
  public mutating func receive(_ state: RemoteSessionStateMessage) -> Bool {
    if let replyId = state.requestId, replyId != requestId { return false }
    // A lock-only update is not a declaration that optional features disappeared.
    if let value = state.supportsDictation { dictation = value }
    if let value = state.supportsTerminalReadAloud { terminalReadAloud = value }
    if let value = state.supportsInlineSpeech { inlineSpeech = value }
    if let value = state.supportsImageAttachments { imageAttachments = value }
    if let value = state.supportsQuickChat { quickChat = value }
    received = received || state.supportsDictation != nil || state.supportsTerminalReadAloud != nil || state.supportsInlineSpeech != nil || state.supportsImageAttachments != nil || state.supportsQuickChat != nil
    if received { timedOut = false }
    return true
  }

  public mutating func expire(requestId: String) {
    if self.requestId == requestId, !received { timedOut = true }
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
