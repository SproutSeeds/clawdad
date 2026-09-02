import Foundation

public struct RemoteTerminalTabDescriptor: Codable, Equatable, Sendable {
  public static let maximumIDBytes = 128
  public static let maximumTitleBytes = 256
  public static let maximumDetailBytes = 256

  public let id: String
  public let title: String
  public let detail: String
  public let isSelected: Bool
  public let isBusy: Bool
  public let hasUnreadActivity: Bool

  public init(
    id: String,
    title: String,
    detail: String,
    isSelected: Bool,
    isBusy: Bool,
    hasUnreadActivity: Bool = false
  ) {
    self.id = id
    self.title = title
    self.detail = detail
    self.isSelected = isSelected
    self.isBusy = isBusy
    self.hasUnreadActivity = hasUnreadActivity
  }

  private enum CodingKeys: String, CodingKey {
    case id
    case title
    case detail
    case isSelected
    case isBusy
    case hasUnreadActivity
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    title = try container.decode(String.self, forKey: .title)
    detail = try container.decode(String.self, forKey: .detail)
    isSelected = try container.decode(Bool.self, forKey: .isSelected)
    isBusy = try container.decode(Bool.self, forKey: .isBusy)
    hasUnreadActivity = try container.decodeIfPresent(
      Bool.self,
      forKey: .hasUnreadActivity
    ) ?? false
  }

  fileprivate func validate() throws {
    guard !id.isEmpty,
          id.utf8.count <= Self.maximumIDBytes,
          !title.isEmpty,
          title.utf8.count <= Self.maximumTitleBytes,
          !detail.isEmpty,
          detail.utf8.count <= Self.maximumDetailBytes else {
      throw RemoteTerminalTabProtocolError.invalidTab
    }
  }
}

public struct RemoteTerminalTabState: Codable, Equatable, Sendable {
  public static let maximumTabs = 128

  public let revision: Int
  public let selectedTabId: String?
  public let tabs: [RemoteTerminalTabDescriptor]

  public init(
    revision: Int,
    selectedTabId: String?,
    tabs: [RemoteTerminalTabDescriptor]
  ) {
    self.revision = revision
    self.selectedTabId = selectedTabId
    self.tabs = tabs
  }

  fileprivate func validate() throws {
    guard revision >= 1, tabs.count <= Self.maximumTabs else {
      throw RemoteTerminalTabProtocolError.invalidState
    }
    try tabs.forEach { try $0.validate() }
    let ids = tabs.map(\.id)
    guard Set(ids).count == ids.count else {
      throw RemoteTerminalTabProtocolError.invalidState
    }
    let selectedTabs = tabs.filter(\.isSelected)
    if let selectedTabId {
      guard selectedTabs.count == 1,
            selectedTabs.first?.id == selectedTabId else {
        throw RemoteTerminalTabProtocolError.invalidState
      }
    } else {
      guard selectedTabs.isEmpty else {
        throw RemoteTerminalTabProtocolError.invalidState
      }
    }
  }
}

public struct RemoteTerminalTabMessage: Codable, Equatable, Sendable {
  public static let listType = "terminal.tabs.request"
  public static let listResultType = "terminal.tabs.result"
  public static let focusType = "terminal.tab.focus"
  public static let focusResultType = "terminal.tab.focus.result"
  public static let maximumEnvelopeBytes = 64 * 1024
  public static let maximumRequestIDBytes = 128
  public static let maximumErrorCodeBytes = 64
  public static let maximumErrorBytes = 512

  public let type: String
  public let requestId: String
  public let tabId: String?
  public let expectedRevision: Int?
  public let ok: Bool?
  public let errorCode: String?
  public let error: String?
  public let state: RemoteTerminalTabState?

  public static func listRequest(
    requestId: String
  ) -> RemoteTerminalTabMessage {
    RemoteTerminalTabMessage(
      type: listType,
      requestId: requestId,
      tabId: nil,
      expectedRevision: nil,
      ok: nil,
      errorCode: nil,
      error: nil,
      state: nil
    )
  }

  public static func listSuccess(
    requestId: String,
    state: RemoteTerminalTabState
  ) -> RemoteTerminalTabMessage {
    result(
      type: listResultType,
      requestId: requestId,
      ok: true,
      errorCode: nil,
      error: nil,
      state: state
    )
  }

  public static func listFailure(
    requestId: String,
    errorCode: String,
    error: String,
    state: RemoteTerminalTabState? = nil
  ) -> RemoteTerminalTabMessage {
    result(
      type: listResultType,
      requestId: requestId,
      ok: false,
      errorCode: errorCode,
      error: error,
      state: state
    )
  }

  public static func focusRequest(
    tabId: String,
    expectedRevision: Int,
    requestId: String
  ) -> RemoteTerminalTabMessage {
    RemoteTerminalTabMessage(
      type: focusType,
      requestId: requestId,
      tabId: tabId,
      expectedRevision: expectedRevision,
      ok: nil,
      errorCode: nil,
      error: nil,
      state: nil
    )
  }

  public static func focusSuccess(
    requestId: String,
    state: RemoteTerminalTabState
  ) -> RemoteTerminalTabMessage {
    result(
      type: focusResultType,
      requestId: requestId,
      ok: true,
      errorCode: nil,
      error: nil,
      state: state
    )
  }

  public static func focusFailure(
    requestId: String,
    errorCode: String,
    error: String,
    state: RemoteTerminalTabState? = nil
  ) -> RemoteTerminalTabMessage {
    result(
      type: focusResultType,
      requestId: requestId,
      ok: false,
      errorCode: errorCode,
      error: error,
      state: state
    )
  }

  private static func result(
    type: String,
    requestId: String,
    ok: Bool,
    errorCode: String?,
    error: String?,
    state: RemoteTerminalTabState?
  ) -> RemoteTerminalTabMessage {
    RemoteTerminalTabMessage(
      type: type,
      requestId: requestId,
      tabId: nil,
      expectedRevision: nil,
      ok: ok,
      errorCode: errorCode,
      error: error,
      state: state
    )
  }

  fileprivate func validate() throws {
    guard !requestId.isEmpty,
          requestId.utf8.count <= Self.maximumRequestIDBytes else {
      throw RemoteTerminalTabProtocolError.invalidMessage
    }

    switch type {
    case Self.listType:
      guard tabId == nil,
            expectedRevision == nil,
            ok == nil,
            errorCode == nil,
            error == nil,
            state == nil else {
        throw RemoteTerminalTabProtocolError.invalidMessage
      }
    case Self.focusType:
      guard let tabId,
            !tabId.isEmpty,
            tabId.utf8.count <= RemoteTerminalTabDescriptor.maximumIDBytes,
            let expectedRevision,
            expectedRevision >= 1,
            ok == nil,
            errorCode == nil,
            error == nil,
            state == nil else {
        throw RemoteTerminalTabProtocolError.invalidMessage
      }
    case Self.listResultType, Self.focusResultType:
      guard tabId == nil,
            expectedRevision == nil,
            let ok else {
        throw RemoteTerminalTabProtocolError.invalidMessage
      }
      if let state {
        try state.validate()
      }
      if ok {
        guard state != nil, errorCode == nil, error == nil else {
          throw RemoteTerminalTabProtocolError.invalidMessage
        }
      } else {
        guard let errorCode,
              !errorCode.isEmpty,
              errorCode.utf8.count <= Self.maximumErrorCodeBytes,
              let error,
              !error.isEmpty,
              error.utf8.count <= Self.maximumErrorBytes else {
          throw RemoteTerminalTabProtocolError.invalidMessage
        }
      }
    default:
      throw RemoteTerminalTabProtocolError.invalidType
    }
  }
}

public enum RemoteTerminalTabCodec {
  public static func encode(_ message: RemoteTerminalTabMessage) throws -> Data {
    try message.validate()
    let data = try JSONEncoder().encode(message)
    guard data.count <= RemoteTerminalTabMessage.maximumEnvelopeBytes else {
      throw RemoteTerminalTabProtocolError.envelopeTooLarge
    }
    return data
  }

  public static func decode(_ data: Data) throws -> RemoteTerminalTabMessage {
    guard data.count <= RemoteTerminalTabMessage.maximumEnvelopeBytes else {
      throw RemoteTerminalTabProtocolError.envelopeTooLarge
    }
    let message = try JSONDecoder().decode(RemoteTerminalTabMessage.self, from: data)
    try message.validate()
    return message
  }
}

public enum RemoteTerminalTabProtocolError: LocalizedError, Equatable {
  case envelopeTooLarge
  case invalidMessage
  case invalidState
  case invalidTab
  case invalidType

  public var errorDescription: String? {
    switch self {
    case .envelopeTooLarge:
      return "The Remote Assist Terminal tab message is too large."
    case .invalidMessage:
      return "The Remote Assist Terminal tab command is invalid."
    case .invalidState:
      return "The Remote Assist Terminal tab state is invalid."
    case .invalidTab:
      return "The Remote Assist Terminal tab description is invalid."
    case .invalidType:
      return "The Remote Assist Terminal tab message type is invalid."
    }
  }
}
