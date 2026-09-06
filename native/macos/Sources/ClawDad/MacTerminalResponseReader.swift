import ClawDadRemoteAssistProtocol
import Foundation

struct MacTerminalResponseFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

struct MacCodexConversation: Equatable, Sendable {
  let sessionId: String
  let path: URL

  static func load(path: URL, sessionRoot: URL) throws -> Self? {
    let url = path.resolvingSymlinksInPath()
    let root = sessionRoot.resolvingSymlinksInPath().path + "/"
    guard url.path.hasPrefix(root), url.pathExtension == "jsonl",
          url.lastPathComponent.hasPrefix("rollout-") else { return nil }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    let prefix = try handle.read(upToCount: 256 * 1024) ?? Data()
    guard let end = prefix.firstIndex(of: 10),
          let record = try? JSONSerialization.jsonObject(with: prefix[..<end]) as? [String: Any],
          record["type"] as? String == "session_meta",
          let payload = record["payload"] as? [String: Any],
          payload["source"] as? String == "cli",
          let id = payload["id"] as? String, UUID(uuidString: id) != nil,
          url.lastPathComponent.hasSuffix("\(id).jsonl") else { return nil }
    return Self(sessionId: id, path: url)
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
    let rows = try run("/bin/ps", ["-t", String(tty.dropFirst(5)), "-o", "pid=,comm="])
    let pids = rows.split(separator: "\n").compactMap { line -> String? in
      let parts = line.split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
      guard parts.count == 2, Int(parts[0]) != nil,
            URL(fileURLWithPath: String(parts[1])).lastPathComponent == "codex" else { return nil }
      return String(parts[0])
    }
    guard !pids.isEmpty else {
      throw MacTerminalResponseFailure(message: "No supported Codex conversation is running in this tab. You can read selected text instead.")
    }
    let files = try run("/usr/sbin/lsof", ["-a", "-p", pids.joined(separator: ","), "-Fn"])
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
    return conversation
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
private func macTerminalResponseCommand(_ executable: String, _ arguments: [String]) throws -> String {
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
