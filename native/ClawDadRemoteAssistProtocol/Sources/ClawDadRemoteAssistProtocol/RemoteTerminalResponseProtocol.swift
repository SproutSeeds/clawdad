import Foundation

public struct RemoteTerminalResponse: Codable, Equatable, Sendable {
  public static let maximumTextBytes = 64 * 1024
  public let sessionId: String
  public let turnId: String
  public let text: String
  public let completedAt: String
  public let inProgress: Bool

  public init(sessionId: String, turnId: String, text: String, completedAt: String, inProgress: Bool) {
    self.sessionId = sessionId
    self.turnId = turnId
    self.text = text
    self.completedAt = completedAt
    self.inProgress = inProgress
  }
}

public struct RemoteTerminalResponseMessage: Codable, Equatable, Sendable {
  public static let requestType = "terminal.response.request"
  public static let resultType = "terminal.response.result"
  public static let maximumEnvelopeBytes = 128 * 1024
  public let type: String
  public let requestId: String
  public let tabId: String
  public let expectedRevision: Int
  public let ok: Bool?
  public let tabTitle: String?
  public let response: RemoteTerminalResponse?
  public let error: String?

  public static func request(requestId: String, tabId: String, expectedRevision: Int) -> Self {
    Self(type: requestType, requestId: requestId, tabId: tabId,
         expectedRevision: expectedRevision, ok: nil, tabTitle: nil, response: nil, error: nil)
  }

  public func success(tabTitle: String, response: RemoteTerminalResponse) -> Self {
    Self(type: Self.resultType, requestId: requestId, tabId: tabId,
         expectedRevision: expectedRevision, ok: true, tabTitle: tabTitle, response: response, error: nil)
  }

  public func failure(_ error: String) -> Self {
    Self(type: Self.resultType, requestId: requestId, tabId: tabId,
         expectedRevision: expectedRevision, ok: false, tabTitle: nil, response: nil, error: error)
  }

  fileprivate func validate() throws {
    guard !requestId.isEmpty, requestId.utf8.count <= 128,
          !tabId.isEmpty, tabId.utf8.count <= 128, expectedRevision > 0 else {
      throw RemoteTerminalResponseProtocolError.invalidMessage
    }
    if type == Self.requestType {
      guard ok == nil, tabTitle == nil, response == nil, error == nil else {
        throw RemoteTerminalResponseProtocolError.invalidMessage
      }
    } else if type == Self.resultType, ok == true {
      guard let tabTitle, !tabTitle.isEmpty, tabTitle.utf8.count <= 256,
            let response, !response.sessionId.isEmpty, response.sessionId.utf8.count <= 128,
            !response.turnId.isEmpty, response.turnId.utf8.count <= 256,
            !response.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            response.text.utf8.count <= RemoteTerminalResponse.maximumTextBytes,
            !response.completedAt.isEmpty, response.completedAt.utf8.count <= 64,
            error == nil else { throw RemoteTerminalResponseProtocolError.invalidMessage }
    } else if type == Self.resultType, ok == false {
      guard response == nil, let error, !error.isEmpty, error.utf8.count <= 1024 else {
        throw RemoteTerminalResponseProtocolError.invalidMessage
      }
    } else { throw RemoteTerminalResponseProtocolError.invalidMessage }
  }
}

public enum RemoteTerminalResponseProtocolError: Error { case invalidMessage, envelopeTooLarge }

public enum RemoteTerminalResponseCodec {
  public static func encode(_ message: RemoteTerminalResponseMessage) throws -> Data {
    try message.validate()
    let data = try JSONEncoder().encode(message)
    guard data.count <= RemoteTerminalResponseMessage.maximumEnvelopeBytes else {
      throw RemoteTerminalResponseProtocolError.envelopeTooLarge
    }
    return data
  }

  public static func decode(_ data: Data) throws -> RemoteTerminalResponseMessage {
    guard data.count <= RemoteTerminalResponseMessage.maximumEnvelopeBytes else {
      throw RemoteTerminalResponseProtocolError.envelopeTooLarge
    }
    let message = try JSONDecoder().decode(RemoteTerminalResponseMessage.self, from: data)
    try message.validate()
    return message
  }
}
