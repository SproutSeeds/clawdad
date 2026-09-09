import ClawDadRemoteAssistProtocol
import Foundation

struct MacTerminalResponseFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

struct MacCodexConversation: Equatable, Sendable {
  let sessionId: String
  let path: URL
  var cliVersion: String? = nil

  enum Metadata {
    case conversation(MacCodexConversation), auxiliary, unrelated, pending, unsupported
  }

  static func load(path: URL, sessionRoot: URL) throws -> Self? {
    if case .conversation(let value) = try metadata(path: path, sessionRoot: sessionRoot) { return value }
    return nil
  }

  /// A CLI can also own Guardian/subagent rollouts. A complete helper header
  /// is neither a second composer nor a conversation still starting up.
  static func metadata(path: URL, sessionRoot: URL) throws -> Metadata {
    let url = path.resolvingSymlinksInPath()
    let root = sessionRoot.resolvingSymlinksInPath().path + "/"
    guard url.path.hasPrefix(root), url.pathExtension == "jsonl",
          url.lastPathComponent.hasPrefix("rollout-") else { return .unrelated }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    let prefix = try handle.read(upToCount: 256 * 1024) ?? Data()
    guard let end = prefix.firstIndex(of: 10) else {
      return prefix.count < 256 * 1024 ? .pending : .unsupported
    }
    guard let record = try? JSONSerialization.jsonObject(with: prefix[..<end]) as? [String: Any],
          record["type"] as? String == "session_meta",
          let payload = record["payload"] as? [String: Any],
          let id = payload["id"] as? String, UUID(uuidString: id) != nil,
          url.lastPathComponent.hasSuffix("\(id).jsonl") else { return .unsupported }
    if let source = payload["source"] as? [String: Any], source["subagent"] != nil { return .auxiliary }
    guard payload["source"] as? String == "cli" else { return .unsupported }
    return .conversation(Self(sessionId: id, path: url, cliVersion: payload["cli_version"] as? String))
  }
}

/// Reads the selected terminal's owning CLI conversation, never a project-wide latest file.
struct MacTerminalResponseReader: Sendable {
  var run: @Sendable (String, [String]) throws -> String = { try macTerminalResponseCommand($0, $1) }
  var sessionRoot = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex/sessions")

  func read(tty: String) throws -> RemoteTerminalResponse {
    let conversation = try resolve(tty: tty)
    let response = try MacCodexResponseParser.read(conversation: conversation)
    guard try resolve(tty: tty) == conversation else {
      throw MacTerminalResponseFailure(message: "The agent in this tab changed. Tap Read latest response again.")
    }
    return response
  }

  func resolve(tty: String) throws -> MacCodexConversation {
    guard tty.range(of: "^/dev/tty[A-Za-z0-9]+$", options: .regularExpression) != nil else {
      throw MacTerminalResponseFailure(message: "This Terminal tab has no supported terminal identity.")
    }
    let arguments = ["-t", String(tty.dropFirst(5)), "-o", "pid=,pgid=,tpgid=,stat=,lstart=,comm="]
    let owner = try Self.inputOwner(run("/bin/ps", arguments))
    let files = try run("/usr/sbin/lsof", ["-a", "-p", owner.pid, "-Fn"])
    var conversations: [String: MacCodexConversation] = [:]
    for line in Set(files.split(separator: "\n").filter { $0.hasPrefix("n") }) {
      if let conversation = try MacCodexConversation.load(
        path: URL(fileURLWithPath: String(line.dropFirst())), sessionRoot: sessionRoot
      ) { conversations[conversation.sessionId] = conversation }
    }
    guard conversations.count == 1, let conversation = conversations.values.first else {
      throw MacTerminalResponseFailure(message: conversations.isEmpty
        ? "This tab's conversation could not be identified. You can read selected text instead."
        : "This tab has more than one agent conversation. Select text to choose exactly what to read.")
    }
    guard try Self.inputOwner(run("/bin/ps", arguments)) == owner else {
      throw MacCodexInputFailure(code: "process_changed", message: "The agent in this tab changed. Inspect the same tab again.")
    }
    return conversation
  }

  /// A resumed rollout can retain an older cli_version. Verify the executable
  /// actually owning this TTY before relying on a version-specific key binding.
  func queueCLIVersion(tty: String, conversation: MacCodexConversation? = nil) throws -> String? {
    guard tty.range(of: "^/dev/tty[A-Za-z0-9]+$", options: .regularExpression) != nil else { return nil }
    let rows = try run("/bin/ps", ["-t", String(tty.dropFirst(5)), "-o", "pid=,comm="])
    let processes = rows.split(separator: "\n").compactMap { line -> (pid: String, binary: String)? in
      let parts = line.split(maxSplits: 1, whereSeparator: \.isWhitespace)
      guard parts.count == 2, Int(parts[0]) != nil, parts[1].hasPrefix("/"),
        URL(fileURLWithPath: String(parts[1])).lastPathComponent == "codex" else { return nil }
      return (String(parts[0]), String(parts[1]))
    }
    guard !processes.isEmpty else { return nil }
    var owners = processes
    if let conversation {
      let files = try run("/usr/sbin/lsof", ["-a", "-p", processes.map(\.pid).joined(separator: ","), "-Fn"])
      var pid = "", owningPIDs = Set<String>()
      for line in files.split(separator: "\n") {
        if line.hasPrefix("p") { pid = String(line.dropFirst()) }
        if line.hasPrefix("n"), URL(fileURLWithPath: String(line.dropFirst())).resolvingSymlinksInPath() == conversation.path {
          owningPIDs.insert(pid)
        }
      }
      owners = processes.filter { owningPIDs.contains($0.pid) }
    }
    // Helpers may inherit the TTY. Only the process holding this exact rollout
    // owns its input; never pick the first binary or use an old session version.
    guard owners.count == 1, let owner = owners.first else { return nil }
    var binary = owner.binary
    if conversation != nil {
      // A package update can retarget /opt/homebrew/bin/codex while this agent
      // keeps running. Read its mapped executable, rather than the new symlink.
      let mappings = try run("/usr/sbin/lsof", ["-a", "-p", owner.pid, "-d", "txt", "-Fn"])
      let executables = Set(mappings.split(separator: "\n").filter { $0.hasPrefix("n/") }
        .map { URL(fileURLWithPath: String($0.dropFirst())).resolvingSymlinksInPath() }
        .filter { $0.lastPathComponent == "codex" })
      guard executables.count == 1, let executable = executables.first else { return nil }
      binary = executable.path
    }
    let output = try run(binary, ["--version"]).trimmingCharacters(in: .whitespacesAndNewlines)
    guard output.hasPrefix("codex-cli ") else { return nil }
    return String(output.dropFirst("codex-cli ".count))
  }
}

struct MacCodexResponseParser {
  private var inProgress = false
  private var sawState = false
  private var completedTurn: (id: String, timestamp: String)?

  /// Records arrive newest first. Only an explicit completed turn makes text eligible.
  mutating func consume(_ data: Data, sessionId: String) throws -> RemoteTerminalResponse? {
    guard let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let payload = record["payload"] as? [String: Any] else { return nil }
    let recordType = record["type"] as? String ?? ""
    let type = payload["type"] as? String ?? ""
    if recordType == "event_msg" {
      if ["task_started", "user_message"].contains(type), !sawState {
        inProgress = true
        sawState = true
      } else if type == "turn_aborted", !sawState {
        sawState = true
      } else if type == "task_complete" {
        sawState = true
        let timestamp = payload["completed_at"] as? String ?? record["timestamp"] as? String ?? ""
        let turnId = payload["turn_id"] as? String ?? timestamp
        completedTurn = (turnId, timestamp)
        if let text = payload["last_agent_message"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          return try response(text: text, sessionId: sessionId)
        }
      }
      if ["task_started", "user_message"].contains(type) { completedTurn = nil }
    }
    if recordType == "response_item", type == "message",
       payload["role"] as? String == "assistant",
       payload["phase"] as? String == "final_answer", completedTurn != nil {
      let blocks = payload["content"] as? [[String: Any]] ?? []
      let text = blocks.compactMap { $0["text"] as? String }.joined(separator: "\n\n")
      if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return try response(text: text, sessionId: sessionId)
      }
    }
    return nil
  }

  private func response(text: String, sessionId: String) throws -> RemoteTerminalResponse {
    guard text.utf8.count <= RemoteTerminalResponse.maximumTextBytes else {
      throw MacTerminalResponseFailure(message: "This response is too large to read in one piece. Select the portion you want to hear.")
    }
    guard let completedTurn, !completedTurn.timestamp.isEmpty else {
      throw MacTerminalResponseFailure(message: "The latest response has no completion time. Select text to read it.")
    }
    return RemoteTerminalResponse(sessionId: sessionId, turnId: completedTurn.id,
                                  text: text, completedAt: completedTurn.timestamp, inProgress: inProgress)
  }

  static func read(conversation: MacCodexConversation) throws -> RemoteTerminalResponse {
    let handle = try FileHandle(forReadingFrom: conversation.path)
    defer { try? handle.close() }
    var offset = try handle.seekToEnd()
    let lowerBound = offset > 64 * 1024 * 1024 ? offset - 64 * 1024 * 1024 : 0
    var carry = Data()
    var parser = Self()
    var skippingOversizedLine = false
    while offset > lowerBound {
      let size = Int(min(offset - lowerBound, 256 * 1024))
      offset -= UInt64(size)
      try handle.seek(toOffset: offset)
      var chunk = try handle.read(upToCount: size) ?? Data()
      chunk.append(carry)
      let lines = chunk.split(separator: 10, omittingEmptySubsequences: false)
      for line in lines.dropFirst().reversed() {
        if skippingOversizedLine { skippingOversizedLine = false; continue }
        // Tool output can be huge; keep this reader focused on turn/message events.
        guard line.count <= 512 * 1024 else { continue }
        if let response = try parser.consume(Data(line), sessionId: conversation.sessionId) { return response }
      }
      carry = lines.first.map { Data($0) } ?? Data()
      if carry.count > 512 * 1024 { carry.removeAll(); skippingOversizedLine = true }
    }
    if offset == 0, !skippingOversizedLine,
       let response = try parser.consume(carry, sessionId: conversation.sessionId) { return response }
    throw MacTerminalResponseFailure(message: parser.inProgress
      ? "Response in progress. Tap Read latest response when the agent finishes."
      : "No completed agent response is available in this tab yet. You can read selected text instead.")
  }
}

/// Bounded background-only process execution. Arguments never pass through a shell.
func macTerminalResponseCommand(_ executable: String, _ arguments: [String]) throws -> String {
  let process = Process()
  let output = Pipe()
  process.executableURL = URL(fileURLWithPath: executable)
  process.arguments = arguments
  process.standardOutput = output
  process.standardError = FileHandle.nullDevice
  let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
  try process.run()
  DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 4, execute: timeout)
  let data = output.fileHandleForReading.readDataToEndOfFile()
  process.waitUntilExit()
  timeout.cancel()
  guard data.count <= 2 * 1024 * 1024, process.terminationStatus == 0 else {
    throw MacTerminalResponseFailure(message: "The agent process changed. Tap Read latest response again.")
  }
  return String(decoding: data, as: UTF8.self)
}
