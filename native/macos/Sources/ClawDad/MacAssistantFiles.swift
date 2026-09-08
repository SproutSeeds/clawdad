import ClawDadRemoteAssistProtocol
import Foundation

func assistantFilesQueryValue(_ value: AssistantValue) throws -> String? {
  if let text = value.string { return text }
  if let number = value.number {
    guard let integer = Int(exactly: number) else { throw AssistantProtocolError.invalid }
    return String(integer)
  }
  return value.bool.map(String.init)
}

/// Use the same local library endpoints as paired Remote Assist Files. No cloud
/// object storage or automatic publication of unrelated source files is added.
func assistantFiles(_ action: String, args: [String: AssistantValue], runtime: MacAssistantRuntime) async throws -> [String: AssistantValue] {
  switch action {
  case "files.list", "files.read":
    let fields = action == "files.list" ? ["query", "project", "category", "format", "archived", "pinned", "cursor", "limit"] : ["id", "versionId", "offset"]
    var components = URLComponents()
    components.path = action == "files.list" ? "/v1/files/library" : "/v1/files/chunk"
    components.queryItems = try fields.compactMap { name in
      guard let value = args[name] else { return nil }
      let text = try assistantFilesQueryValue(value)
      return text.map { URLQueryItem(name: name, value: $0) }
    }
    return try await runtime.json(components.string!)
  case "files.publish":
    return try await runtime.json("/v1/files/add", args.filter { ["sourcePath", "title", "project", "thread", "itemId"].contains($0.key) })
  case "files.update":
    return try await runtime.json("/v1/files/update", args.filter { ["id", "title", "pinned", "archived"].contains($0.key) })
  default: throw AssistantProtocolError.invalid
  }
}
