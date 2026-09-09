import ClawDadRemoteAssistProtocol
import CryptoKit
import Foundation

struct MacCodexInputFailure: LocalizedError {
  let code: String
  let message: String
  var errorDescription: String? { message }
}

/// An input owner exists before Codex persists its first rollout. This identity
/// is deliberately distinct from a Codex session UUID; directories are metadata.
struct MacCodexInputBinding: Equatable, Sendable {
  let instanceId: String
  let tty: String
  let pid: String
  let directory: String
  let executable: String
  let version: String
  let conversation: MacCodexConversation?

  var fields: [String: AssistantValue] {
    ["agentInstanceId": .string(instanceId), "tty": .string(tty),
     "processId": .string(pid), "directory": .string(directory), "cliVersion": .string(version),
     "sessionId": conversation.map { .string($0.sessionId) } ?? .null,
     "conversationPath": conversation.map { .string($0.path.path) } ?? .null,
     "historyState": .string(conversation == nil ? "awaiting_first_turn" : "identified")]
  }

  func accepts(sessionId: String?, instanceId: String?) -> Bool {
    if let instanceId, instanceId != self.instanceId { return false }
    if let sessionId, sessionId != conversation?.sessionId { return false }
    return sessionId != nil || instanceId != nil
  }

  /// Allow a missing rollout to become a real session, never a known session to
  /// disappear/change within an inspected edit or delivery.
  func continues(_ previous: Self) -> Bool {
    instanceId == previous.instanceId && (previous.conversation == nil || conversation == previous.conversation)
  }
}

extension MacTerminalResponseReader {
  func inputBinding(tty: String) throws -> MacCodexInputBinding {
    guard tty.range(of: "^/dev/tty[A-Za-z0-9]+$", options: .regularExpression) != nil else {
      throw MacCodexInputFailure(code: "invalid_tty", message: "Refresh the Terminal inventory and inspect the exact tab again.")
    }
    let arguments = ["-t", String(tty.dropFirst(5)), "-o", "pid=,pgid=,tpgid=,stat=,lstart=,comm="]
    let owner = try Self.inputOwner(try run("/bin/ps", arguments))
    let mappings = try run("/usr/sbin/lsof", ["-a", "-p", owner.pid, "-d", "cwd,txt", "-Fn"])
    var descriptor = "", directories = Set<String>(), executables = Set<String>()
    for line in mappings.split(separator: "\n") {
      if line.hasPrefix("f") { descriptor = String(line.dropFirst()) }
      if line.hasPrefix("n/") {
        let url = URL(fileURLWithPath: String(line.dropFirst())).resolvingSymlinksInPath()
        if descriptor == "cwd" { directories.insert(url.path) }
        if descriptor == "txt", url.lastPathComponent == "codex" { executables.insert(url.path) }
      }
    }
    guard directories.count == 1, let directory = directories.first,
      executables.count == 1, let executable = executables.first else {
      throw MacCodexInputFailure(code: "executable_unavailable", message: "The running Codex executable is not yet identifiable. Wait for startup and inspect again; input was preserved.")
    }
    let versionOutput = try run(executable, ["--version"]).trimmingCharacters(in: .whitespacesAndNewlines)
    guard versionOutput.hasPrefix("codex-cli ") else {
      throw MacCodexInputFailure(code: "unsupported_executable", message: "This foreground program is not a verified Codex CLI. Its input was preserved.")
    }
    let files = try run("/usr/sbin/lsof", ["-a", "-p", owner.pid, "-Fn"])
    var conversations: [String: MacCodexConversation] = [:]
    var pendingRollout = false
    for line in Set(files.split(separator: "\n").filter { $0.hasPrefix("n/") }) {
      let url = URL(fileURLWithPath: String(line.dropFirst()))
      if let conversation = try MacCodexConversation.load(path: url, sessionRoot: sessionRoot) {
        conversations[conversation.sessionId] = conversation
      } else if url.path.hasPrefix(sessionRoot.path + "/"), url.lastPathComponent.hasPrefix("rollout-") {
        pendingRollout = true
      }
    }
    guard conversations.count <= 1, !pendingRollout else {
      throw MacCodexInputFailure(code: conversations.count > 1 ? "ambiguous_session" : "session_starting",
        message: conversations.count > 1 ? "This process owns multiple conversations. Select an unambiguous agent before typing." : "Codex is creating its conversation. Wait for startup to finish and inspect this same tab again.")
    }
    guard try Self.inputOwner(run("/bin/ps", arguments)) == owner else {
      throw MacCodexInputFailure(code: "process_changed", message: "The foreground Codex process changed during inspection. Inspect the exact tab again.")
    }
    let digest = SHA256.hash(data: Data((tty + "\n" + owner.signature + "\n" + executable).utf8))
      .map { String(format: "%02x", $0) }.joined()
    return MacCodexInputBinding(instanceId: "codex-process-" + digest, tty: tty, pid: owner.pid,
      directory: directory, executable: executable, version: String(versionOutput.dropFirst("codex-cli ".count)),
      conversation: conversations.values.first)
  }

  struct InputOwner: Equatable {
    let pid: String
    let signature: String
  }
  static func inputOwner(_ output: String) throws -> InputOwner {
    let rows = output.split(separator: "\n").map { $0.split(maxSplits: 9, whereSeparator: \.isWhitespace).map(String.init) }
    let codex = rows.filter { $0.count == 10 && Int($0[0]) != nil && URL(fileURLWithPath: $0[9]).lastPathComponent == "codex" }
    let owners = codex.filter { $0[1] == $0[2] && !$0[3].contains("T") && !$0[3].contains("Z") }
    guard owners.count == 1, let row = owners.first else {
      throw MacCodexInputFailure(code: owners.count > 1 ? "ambiguous_process" : codex.isEmpty ? "no_codex_process" : "agent_not_foreground",
        message: owners.count > 1 ? "Multiple foreground Codex processes share this terminal. Input was preserved." : codex.isEmpty ? "No foreground Codex CLI is ready in this tab. Launch Codex, finish trust/sign-in, then inspect again." : "Codex is suspended or does not own this terminal's foreground input. Bring it back to the foreground and inspect again.")
    }
    return InputOwner(pid: row[0], signature: (row.prefix(3) + row.dropFirst(4)).joined(separator: "|"))
  }
}
