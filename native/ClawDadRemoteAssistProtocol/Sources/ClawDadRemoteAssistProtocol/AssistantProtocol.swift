import Foundation

public enum AssistantValue: Codable, Equatable, Sendable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: Self])
  case array([Self])
  case null
  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode([String: Self].self) {
      self = .object(v)
    } else {
      self = .array(try c.decode([Self].self))
    }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .object(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .null: try c.encodeNil()
    }
  }
  public var string: String? {
    if case .string(let v) = self { return v }
    return nil
  }
  public var object: [String: Self]? {
    if case .object(let v) = self { return v }
    return nil
  }
  public var array: [Self]? {
    if case .array(let v) = self { return v }
    return nil
  }
  public var bool: Bool? {
    if case .bool(let v) = self { return v }
    return nil
  }
  public var number: Double? {
    if case .number(let v) = self { return v }
    return nil
  }
  public static func encode<T: Encodable>(_ value: T) throws -> Self {
    try JSONDecoder().decode(Self.self, from: JSONEncoder().encode(value))
  }
}

/// Only these operations may cross the paired Assistant data connection.
/// Native worker and MCP tool endpoints are deliberately absent.
public struct AssistantWireRequest: Codable, Sendable {
  public enum Action: String, Codable, Sendable {
    case state, command, transcribe, synthesize, audio, imageUpload
  }
  public let id: String
  public let action: Action
  public let payload: Data
  public init(id: String = UUID().uuidString.lowercased(), action: Action, payload: Data = Data()) {
    self.id = id
    self.action = action
    self.payload = payload
  }
  public func validate() throws {
    guard UUID(uuidString: id) != nil, payload.count <= 1024 * 1024 else {
      throw AssistantProtocolError.invalid
    }
  }
}

public struct AssistantWireResponse: Codable, Sendable {
  public let id: String
  public let payload: Data
  public let more: Bool
  public let error: String?
  public init(id: String, payload: Data = Data(), more: Bool = false, error: String? = nil) {
    self.id = id
    self.payload = payload
    self.more = more
    self.error = error
  }
}

public enum AssistantProtocolError: LocalizedError {
  case invalid, disconnected, timedOut
  public var errorDescription: String? {
    switch self {
    case .invalid: return "The Assistant request could not be verified."
    case .disconnected: return "The Assistant is reconnecting to your Mac."
    case .timedOut: return "The Mac is taking longer to respond. Your conversation is saved."
    }
  }
}

public struct AssistantMessage: Codable, Identifiable, Equatable, Sendable {
  public let id: String
  public let role: String
  public let text: String
  public let createdAt: String
  public var images: [RemoteImageUpload]? = nil
}

public enum AssistantChatLimits {
  public static let textBytes = 128 * 1024
  public static let legacyTextBytes = 16 * 1024
  public static func problem(_ text: String, maximum: Int = textBytes) -> String? {
    if text.contains("\0") { return "This message contains an invalid text character. Your draft is kept; remove that character before sending." }
    let size = text.utf8.count
    guard size > maximum else { return nil }
    if maximum < textBytes {
      return "This Mac supports messages up to \(maximum.formatted()) UTF-8 bytes. Update ClawDad on your Mac for longer messages. Your complete draft and images are kept."
    }
    return "This message is \(size.formatted()) UTF-8 bytes. Assistant supports up to 131,072 bytes (128 KiB) per message. Your text and images are kept; shorten the message before sending."
  }
}

public struct AssistantChatCapacity: Codable, Sendable {
  public let textBytes: Int
  public let unit: String
}

public struct AssistantMessageReceipt: Codable, Sendable {
  public let id: String
  public let status: String
  public let error: String?
}

public struct AssistantTaskRecord: Codable, Identifiable, Equatable, Sendable {
  public let id: String
  public let action: String
  public let status: String
  public let args: [String: AssistantValue]
  public let tabTitle: String?
  public let error: String?
  public let response: String?
  public var displayName: String? = nil
  public var requestText: String? = nil
  public var createdAt: String? = nil
  public var displayStatus: String {
    switch status {
    case "queued": "Waiting for delivery"
    case "running": "Delivering"
    case "inserted": "Draft inserted"
    case "cleared": "Draft cleared"
    case "replaced": "Draft replaced"
    case "agent_queued": "Queued in agent"
    case "sending": "Waiting for delivery"
    case "submitted": "Submitted"
    case "working": "Working"
    case "completed": "Completed"
    case "attention": "Needs attention"
    case "interrupted": "Interrupted"
    case "cancelled": "Cancelled"
    default: status
    }
  }
}

public struct AssistantSnapshot: Codable, Sendable {
  public let version: Int
  public let conversationMode: String?
  public var imageAttachments: Bool? = nil
  public var supportsBackgroundCalls: Bool { conversationMode == "background" }
  public let enabled: Bool
  public let paused: Bool
  public let nativeOnline: Bool
  public let coordinator: [String: AssistantValue]?
  public let catalog: RemoteTerminalTabState?
  public var messages: [AssistantMessage]
  public var tasks: [AssistantTaskRecord]
  public var operations: [AssistantTaskRecord]? = nil
  public var taskUpdates: [AssistantMessage]? = nil
  public var research: [String: AssistantValue]? = nil
  public var destination: [String: AssistantValue]? = nil
  public var chatCapacity: AssistantChatCapacity? = nil
  public var historyRevision: String? = nil
  public var historyUnchanged: Bool? = nil
  public var messageReceipts: [AssistantMessageReceipt]? = nil

  /// A revision acknowledges the exact history already on this connection.
  /// Catalog/connection updates can arrive without retransmitting large text.
  public mutating func retainUnchangedHistory(from previous: Self?) throws {
    guard historyUnchanged == true else { return }
    guard let previous, previous.historyRevision == historyRevision,
      previous.destination?["conversationId"] == destination?["conversationId"] else { throw AssistantProtocolError.invalid }
    messages = previous.messages; tasks = previous.tasks
    operations = previous.operations; taskUpdates = previous.taskUpdates
  }
}
