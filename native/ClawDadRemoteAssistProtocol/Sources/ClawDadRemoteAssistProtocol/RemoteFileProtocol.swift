import Foundation

public struct RemoteFileRequest: Codable, Sendable {
  public enum Action: String, Codable, Sendable { case list, chunk, update }
  public var requestId: String
  public var action: Action
  public var id: String?
  public var versionId: String?
  public var offset: Int?
  public var cursor: Int?
  public var query: String?
  public var project: String?
  public var format: String?
  public var pinned: Bool?
  public var archived: Bool?

  public init(action: Action, id: String? = nil, versionId: String? = nil,
              offset: Int? = nil, cursor: Int? = nil, query: String? = nil,
              pinned: Bool? = nil, archived: Bool? = nil, project: String? = nil, format: String? = nil) {
    requestId = UUID().uuidString.lowercased()
    self.action = action; self.id = id; self.versionId = versionId
    self.offset = offset; self.cursor = cursor; self.query = query
    self.pinned = pinned; self.archived = archived
    self.project = project; self.format = format
  }

  public func validate() throws {
    guard UUID(uuidString: requestId) != nil, (query?.utf8.count ?? 0) <= 1024,
          (project?.utf8.count ?? 0) <= 8192, (format?.utf8.count ?? 0) <= 128,
          (offset ?? 0) >= 0, (offset ?? 0) <= 100 * 1024 * 1024,
          (cursor ?? 0) >= 0, (cursor ?? 0) <= 5_000 else { throw RemoteFileError.invalidMessage }
    switch action {
    case .list: guard id == nil, versionId == nil, offset == nil else { throw RemoteFileError.invalidMessage }
    case .chunk:
      guard let id, UUID(uuidString: id) != nil, let versionId, UUID(uuidString: versionId) != nil,
            offset != nil, pinned == nil, archived == nil, query == nil, cursor == nil, project == nil, format == nil else { throw RemoteFileError.invalidMessage }
    case .update:
      guard let id, UUID(uuidString: id) != nil, versionId == nil, offset == nil,
            query == nil, cursor == nil, project == nil, format == nil, pinned != nil || archived != nil else { throw RemoteFileError.invalidMessage }
    }
  }
}

public struct RemoteFileResponse: Codable, Sendable {
  public let requestId: String
  public let payload: Data?
  public let error: String?
  public init(requestId: String, payload: Data? = nil, error: String? = nil) {
    self.requestId = requestId; self.payload = payload; self.error = error
  }
}

public struct RemoteFileFrame: Codable, Sendable {
  public static let chunkBytes = 8 * 1024
  public static let maximumMessageBytes = 2 * 1024 * 1024
  public let id: String
  public let index: Int
  public let count: Int
  public let data: Data

  public static func split(_ data: Data, id: String = UUID().uuidString) throws -> [Self] {
    guard !data.isEmpty, data.count <= maximumMessageBytes else { throw RemoteFileError.tooLarge }
    let count = (data.count + chunkBytes - 1) / chunkBytes
    return (0..<count).map { index in
      let start = index * chunkBytes
      return Self(id: id, index: index, count: count, data: data.subdata(in: start..<min(start + chunkBytes, data.count)))
    }
  }
}

public struct RemoteFileAssembler {
  private struct Assembly { var count: Int; var parts: [Int: Data]; var startedAt: Date }
  private var assemblies: [String: Assembly] = [:]
  public init() {}
  public mutating func receive(_ data: Data, now: Date = Date()) throws -> Data? {
    guard data.count <= 12 * 1024 else { throw RemoteFileError.tooLarge }
    let frame = try JSONDecoder().decode(RemoteFileFrame.self, from: data)
    guard UUID(uuidString: frame.id) != nil, frame.count > 0,
          frame.count <= RemoteFileFrame.maximumMessageBytes / RemoteFileFrame.chunkBytes,
          frame.index >= 0, frame.index < frame.count, !frame.data.isEmpty,
          frame.data.count <= RemoteFileFrame.chunkBytes else { throw RemoteFileError.invalidMessage }
    assemblies = assemblies.filter { now.timeIntervalSince($0.value.startedAt) < 20 }
    if assemblies[frame.id] == nil, assemblies.count >= 4 { throw RemoteFileError.tooLarge }
    var assembly = assemblies[frame.id] ?? Assembly(count: frame.count, parts: [:], startedAt: now)
    guard assembly.count == frame.count,
          assembly.parts[frame.index] == nil || assembly.parts[frame.index] == frame.data else { throw RemoteFileError.invalidMessage }
    assembly.parts[frame.index] = frame.data
    if assembly.parts.count == frame.count {
      assemblies.removeValue(forKey: frame.id)
      var result = Data()
      for index in 0..<frame.count { guard let part = assembly.parts[index] else { throw RemoteFileError.invalidMessage }; result.append(part) }
      return result
    }
    assemblies[frame.id] = assembly
    return nil
  }
}

public enum RemoteFileError: LocalizedError {
  case invalidMessage, tooLarge, disconnected, timedOut
  public var errorDescription: String? {
    switch self {
    case .invalidMessage: return "Files received an invalid transfer message."
    case .tooLarge: return "This Files transfer exceeds the supported size."
    case .disconnected: return "The file connection ended. Reconnect to resume your download."
    case .timedOut: return "The Mac took too long to answer. Reconnect to resume your download."
    }
  }
}
