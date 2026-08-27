import Foundation

public struct RemoteDisplayDescriptor: Codable, Equatable, Sendable {
  public static let maximumIDBytes = 128
  public static let maximumNameBytes = 256

  public let id: String
  public let name: String
  public let width: Int
  public let height: Int
  public let isPrimary: Bool

  public init(
    id: String,
    name: String,
    width: Int,
    height: Int,
    isPrimary: Bool
  ) {
    self.id = id
    self.name = name
    self.width = width
    self.height = height
    self.isPrimary = isPrimary
  }

  fileprivate func validate() throws {
    guard !id.isEmpty,
          id.utf8.count <= Self.maximumIDBytes else {
      throw RemoteDisplayProtocolError.invalidDisplay
    }
    guard !name.isEmpty,
          name.utf8.count <= Self.maximumNameBytes,
          (1...32_768).contains(width),
          (1...32_768).contains(height) else {
      throw RemoteDisplayProtocolError.invalidDisplay
    }
  }
}

public struct RemoteDisplayState: Codable, Equatable, Sendable {
  public static let maximumDisplays = 32

  public let topologyRevision: Int
  public let selectedDisplayId: String
  public let displays: [RemoteDisplayDescriptor]

  public init(
    topologyRevision: Int,
    selectedDisplayId: String,
    displays: [RemoteDisplayDescriptor]
  ) {
    self.topologyRevision = topologyRevision
    self.selectedDisplayId = selectedDisplayId
    self.displays = displays
  }

  fileprivate func validate() throws {
    guard topologyRevision >= 1,
          !displays.isEmpty,
          displays.count <= Self.maximumDisplays else {
      throw RemoteDisplayProtocolError.invalidState
    }
    try displays.forEach { try $0.validate() }
    let ids = displays.map(\.id)
    guard Set(ids).count == ids.count,
          ids.contains(selectedDisplayId) else {
      throw RemoteDisplayProtocolError.invalidState
    }
  }
}

public struct RemoteDisplayMessage: Codable, Equatable, Sendable {
  public static let stateType = "display.state"
  public static let selectType = "display.select"
  public static let selectResultType = "display.select.result"
  public static let maximumEnvelopeBytes = 32 * 1024
  public static let maximumRequestIDBytes = 128
  public static let maximumErrorCodeBytes = 64
  public static let maximumErrorBytes = 512

  public let type: String
  public let requestId: String?
  public let displayId: String?
  public let expectedTopologyRevision: Int?
  public let ok: Bool?
  public let errorCode: String?
  public let error: String?
  public let state: RemoteDisplayState?

  public static func state(_ state: RemoteDisplayState) -> RemoteDisplayMessage {
    RemoteDisplayMessage(
      type: stateType,
      requestId: nil,
      displayId: nil,
      expectedTopologyRevision: nil,
      ok: nil,
      errorCode: nil,
      error: nil,
      state: state
    )
  }

  public static func selectRequest(
    displayId: String,
    expectedTopologyRevision: Int,
    requestId: String
  ) -> RemoteDisplayMessage {
    RemoteDisplayMessage(
      type: selectType,
      requestId: requestId,
      displayId: displayId,
      expectedTopologyRevision: expectedTopologyRevision,
      ok: nil,
      errorCode: nil,
      error: nil,
      state: nil
    )
  }

  public static func selectSuccess(
    requestId: String,
    state: RemoteDisplayState
  ) -> RemoteDisplayMessage {
    RemoteDisplayMessage(
      type: selectResultType,
      requestId: requestId,
      displayId: nil,
      expectedTopologyRevision: nil,
      ok: true,
      errorCode: nil,
      error: nil,
      state: state
    )
  }

  public static func selectFailure(
    requestId: String,
    errorCode: String,
    error: String,
    state: RemoteDisplayState
  ) -> RemoteDisplayMessage {
    RemoteDisplayMessage(
      type: selectResultType,
      requestId: requestId,
      displayId: nil,
      expectedTopologyRevision: nil,
      ok: false,
      errorCode: errorCode,
      error: error,
      state: state
    )
  }

  fileprivate func validate() throws {
    switch type {
    case Self.stateType:
      guard requestId == nil,
            displayId == nil,
            expectedTopologyRevision == nil,
            ok == nil,
            errorCode == nil,
            error == nil,
            let state else {
        throw RemoteDisplayProtocolError.invalidMessage
      }
      try state.validate()
    case Self.selectType:
      guard let requestId,
            validRequestId(requestId),
            let displayId,
            !displayId.isEmpty,
            displayId.utf8.count <= RemoteDisplayDescriptor.maximumIDBytes,
            let expectedTopologyRevision,
            expectedTopologyRevision >= 1,
            ok == nil,
            errorCode == nil,
            error == nil,
            state == nil else {
        throw RemoteDisplayProtocolError.invalidMessage
      }
    case Self.selectResultType:
      guard let requestId,
            validRequestId(requestId),
            displayId == nil,
            expectedTopologyRevision == nil,
            let ok,
            let state else {
        throw RemoteDisplayProtocolError.invalidMessage
      }
      try state.validate()
      if ok {
        guard errorCode == nil, error == nil else {
          throw RemoteDisplayProtocolError.invalidMessage
        }
      } else {
        guard let errorCode,
              !errorCode.isEmpty,
              errorCode.utf8.count <= Self.maximumErrorCodeBytes,
              let error,
              !error.isEmpty,
              error.utf8.count <= Self.maximumErrorBytes else {
          throw RemoteDisplayProtocolError.invalidMessage
        }
      }
    default:
      throw RemoteDisplayProtocolError.invalidType
    }
  }

  private func validRequestId(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= Self.maximumRequestIDBytes
  }
}

public enum RemoteDisplayCodec {
  public static func encode(_ message: RemoteDisplayMessage) throws -> Data {
    try message.validate()
    let data = try JSONEncoder().encode(message)
    guard data.count <= RemoteDisplayMessage.maximumEnvelopeBytes else {
      throw RemoteDisplayProtocolError.envelopeTooLarge
    }
    return data
  }

  public static func decode(_ data: Data) throws -> RemoteDisplayMessage {
    guard data.count <= RemoteDisplayMessage.maximumEnvelopeBytes else {
      throw RemoteDisplayProtocolError.envelopeTooLarge
    }
    let message = try JSONDecoder().decode(RemoteDisplayMessage.self, from: data)
    try message.validate()
    return message
  }
}

public enum RemoteDisplayProtocolError: LocalizedError, Equatable {
  case envelopeTooLarge
  case invalidDisplay
  case invalidMessage
  case invalidState
  case invalidType

  public var errorDescription: String? {
    switch self {
    case .envelopeTooLarge:
      return "The Remote Assist display message is too large."
    case .invalidDisplay:
      return "The Remote Assist display description is invalid."
    case .invalidMessage:
      return "The Remote Assist display command is invalid."
    case .invalidState:
      return "The Remote Assist display state is invalid."
    case .invalidType:
      return "The Remote Assist display message type is invalid."
    }
  }
}
