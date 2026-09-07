import Foundation

/// Codex -c values are TOML. JSON's optional escaped slash (\/) is invalid in
/// TOML strings and makes the entire args array fall back to a plain string.
func macAssistantMCPOverrides(nodePath: String, mcpPath: String) throws -> [String] {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.withoutEscapingSlashes]
  let command = String(decoding: try encoder.encode(nodePath), as: UTF8.self)
  let arguments = String(decoding: try encoder.encode([mcpPath]), as: UTF8.self)
  return [
    "mcp_servers.clawdad_assistant.command=\(command)",
    "mcp_servers.clawdad_assistant.args=\(arguments)",
  ]
}
