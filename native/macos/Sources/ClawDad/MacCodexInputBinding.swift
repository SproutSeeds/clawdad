import ClawDadRemoteAssistProtocol
import CryptoKit
import Foundation
import Darwin

/// Read only argc/argv from the owning process. Environment bytes returned by
/// KERN_PROCARGS2 are neither decoded nor retained, logged or exposed.
func macCodexProcessArguments(_ pid: String) -> [String]? {
  guard let pid = Int32(pid), pid > 0 else { return nil }
  var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
  var size = 0
  guard sysctl(&mib, UInt32(mib.count), nil, &size, nil, 0) == 0, size > 4, size <= 2 * 1024 * 1024 else { return nil }
  var bytes = Data(count: size)
  let result = bytes.withUnsafeMutableBytes { sysctl(&mib, UInt32(mib.count), $0.baseAddress, &size, nil, 0) }
  guard result == 0 else { return nil }
  return macCodexArgumentsFromProcessData(bytes.prefix(size))
}

func macCodexArgumentsFromProcessData(_ data: Data) -> [String]? {
  guard data.count > 4 else { return nil }
  let count = data.prefix(4).withUnsafeBytes { $0.loadUnaligned(as: Int32.self) }
  guard count > 0, count <= 4096, let executableEnd = data[4...].firstIndex(of: 0) else { return nil }
  var cursor = executableEnd + 1
  while cursor < data.count, data[cursor] == 0 { cursor += 1 }
  var arguments: [String] = []
  for _ in 0..<count {
    guard cursor < data.count, let end = data[cursor...].firstIndex(of: 0),
      let argument = String(data: data[cursor..<end], encoding: .utf8) else { return nil }
    arguments.append(argument); cursor = end + 1
  }
  return arguments
}

func macCodexInputDirectory(processDirectory: String, arguments: [String]?) throws -> String {
  guard let arguments else { return processDirectory }
  var paths: [String] = [], index = 1
  let values: Set<String> = ["-c", "--config", "-m", "--model", "-p", "--profile", "-s", "--sandbox", "-a", "--ask-for-approval", "--enable", "--disable", "-i", "--image", "--add-dir"]
  while index < arguments.count {
    let argument = arguments[index]
    if argument == "--" { break }
    if argument == "-C" || argument == "--cd" {
      guard index + 1 < arguments.count else { throw MacCodexInputFailure(code: "directory_unverified", message: "The running Codex directory option is incomplete. Inspect this process before restoring it.") }
      index += 1; paths.append(arguments[index])
    } else if argument.hasPrefix("--cd=") { paths.append(String(argument.dropFirst(5))) }
    else if argument.hasPrefix("-C"), argument.count > 2 { paths.append(String(argument.dropFirst(2))) }
    else if values.contains(argument) { index += 1 }
    index += 1
  }
  guard paths.count <= 1 else { throw MacCodexInputFailure(code: "directory_unverified", message: "This process has multiple directory overrides. Its exact workspace needs review; no input was sent.") }
  guard let path = paths.first else { return processDirectory }
  guard !path.isEmpty, !path.contains("\0") else {
    throw MacCodexInputFailure(code: "directory_unverified", message: "The running Codex directory override is invalid. Inspect its exact workspace before restoring it.")
  }
  return URL(fileURLWithPath: path, relativeTo: URL(fileURLWithPath: processDirectory, isDirectory: true)).resolvingSymlinksInPath().path
}

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
     "processId": .string(pid), "executable": .string(executable), "directory": .string(directory), "cliVersion": .string(version),
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
    guard directories.count == 1, let processDirectory = directories.first,
      executables.count == 1, let executable = executables.first else {
      throw MacCodexInputFailure(code: "executable_unavailable", message: "The running Codex executable is not yet identifiable. Wait for startup and inspect again; input was preserved.")
    }
    let versionOutput = try run(executable, ["--version"]).trimmingCharacters(in: .whitespacesAndNewlines)
    guard versionOutput.hasPrefix("codex-cli ") else {
      throw MacCodexInputFailure(code: "unsupported_executable", message: "This foreground program is not a verified Codex CLI. Its input was preserved.")
    }
    let directory = try macCodexInputDirectory(processDirectory: processDirectory, arguments: inputArguments(owner.pid))
    let files = try run("/usr/sbin/lsof", ["-a", "-p", owner.pid, "-Fn"])
    var conversations: [String: MacCodexConversation] = [:]
    var pendingRollout = false
    var unsupportedRollout = false
    for line in Set(files.split(separator: "\n").filter { $0.hasPrefix("n/") }) {
      let url = URL(fileURLWithPath: String(line.dropFirst()))
      switch try MacCodexConversation.metadata(path: url, sessionRoot: sessionRoot) {
      case .conversation(let conversation):
        conversations[conversation.sessionId] = conversation
      case .pending: pendingRollout = true
      case .unsupported: unsupportedRollout = true
      case .auxiliary, .unrelated: break
      }
    }
    guard !unsupportedRollout else {
      throw MacCodexInputFailure(code: "unsupported_session_metadata", message: "This Codex process has conversation metadata ClawDad cannot safely identify. Input was preserved. Inspect again after Codex finishes loading; if this persists, update ClawDad.")
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
