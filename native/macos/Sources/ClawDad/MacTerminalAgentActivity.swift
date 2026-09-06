import Foundation

/// Only lifecycle events from the owning CLI request establish working state.
/// Terminal focus, output, an open Codex process, and unread markers never do.
struct MacCodexRequestActivityLog {
  private struct Activity {
    let startedAt: Date?
    init(startedAt: Date? = nil) { self.startedAt = startedAt }
  }
  private var state = Activity()
  var isBusy: Bool { state.startedAt != nil }
  var startedAt: Date? { state.startedAt }
  private var offset: UInt64 = 0
  private var fileIdentity = ""
  private var modifiedAt: Date?
  private var partial = Data()
  private var droppingLine = false
  private static let maximumScan = 64 * 1024 * 1024
  private static let maximumLine = 2 * 1024 * 1024

  private static func activity(_ line: Data) -> Activity? {
    // Avoid decoding tool output and response bodies on the polling path.
    guard ["task_started", "task_complete", "turn_aborted"].contains(where: {
      line.range(of: Data("\"\($0)\"".utf8)) != nil
    }) else { return nil }
    guard let record = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
          record["type"] as? String == "event_msg",
          let payload = record["payload"] as? [String: Any] else { return nil }
    switch payload["type"] as? String {
    case "task_started":
      guard let timestamp = record["timestamp"] as? String else { return Activity() }
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      let fractional = formatter.date(from: timestamp)
      formatter.formatOptions = [.withInternetDateTime]
      return Activity(startedAt: fractional ?? formatter.date(from: timestamp))
    case "task_complete", "turn_aborted": return Activity()
    default: return nil
    }
  }

  mutating func read(_ path: URL) throws -> Bool {
    let attributes = try FileManager.default.attributesOfItem(atPath: path.path)
    let identity = "\(attributes[.systemNumber] ?? "")/\(attributes[.systemFileNumber] ?? "")"
    let modified = attributes[.modificationDate] as? Date
    let handle = try FileHandle(forReadingFrom: path)
    defer { try? handle.close() }
    let end = try handle.seekToEnd()
    if fileIdentity != identity || end < offset || (end == offset && modified != modifiedAt) || end - offset > UInt64(Self.maximumScan) {
      state = try latestActivity(handle, end: end)
      fileIdentity = identity
      offset = end
    } else if end > offset {
      try handle.seek(toOffset: offset)
      while offset < end {
        let data = try handle.read(upToCount: Int(min(256 * 1024, end - offset))) ?? Data()
        guard !data.isEmpty else { break }
        offset += UInt64(data.count)
        consume(data)
      }
    }
    modifiedAt = modified
    return isBusy
  }

  private mutating func consume(_ data: Data) {
    var combined = partial
    combined.append(data)
    let lines = combined.split(separator: 10, omittingEmptySubsequences: false)
    for line in lines.dropLast() {
      if droppingLine { droppingLine = false; continue }
      if let value = Self.activity(Data(line)) { state = value }
    }
    partial = lines.last.map { Data($0) } ?? Data()
    if partial.count > Self.maximumLine {
      // An unreadable record cannot preserve a stale positive badge.
      partial.removeAll(); droppingLine = true; state = Activity()
    }
  }

  private mutating func latestActivity(_ handle: FileHandle, end: UInt64) throws -> Activity {
    var position = end, carry = Data()
    let lower = end > UInt64(Self.maximumScan) ? end - UInt64(Self.maximumScan) : 0
    partial.removeAll(); droppingLine = false
    while position > lower {
      let count = Int(min(256 * 1024, position - lower))
      position -= UInt64(count)
      try handle.seek(toOffset: position)
      var data = try handle.read(upToCount: count) ?? Data()
      data.append(carry)
      var lines = data.split(separator: 10, omittingEmptySubsequences: false)
      if position + UInt64(count) == end {
        // Only newline-terminated records have been committed by the writer.
        partial = lines.last.map { Data($0) } ?? Data()
        if partial.count > Self.maximumLine { partial.removeAll(); droppingLine = true }
        if lines.count == 1 && position > 0 {
          partial.removeAll(); droppingLine = true
          return Activity()
        }
        lines.removeLast()
      }
      for line in lines.dropFirst().reversed() {
        if let value = Self.activity(Data(line)) { return value }
      }
      carry = lines.first.map { Data($0) } ?? Data()
      if carry.count > Self.maximumLine {
        // Stop at an oversized/unknown event instead of reaching an older start.
        return Activity()
      }
    }
    if position == 0, let value = Self.activity(carry) { return value }
    return Activity()
  }
}

/// Batch the process inventory across tabs, then incrementally read their logs.
/// The actor keeps process/file work off the main actor and serializes the cache.
actor MacTerminalAgentActivityReader {
  private let reader: MacTerminalResponseReader
  private var logs: [URL: MacCodexRequestActivityLog] = [:]

  init(reader: MacTerminalResponseReader = MacTerminalResponseReader()) { self.reader = reader }

  func busyTTYs(in ttys: Set<String>) -> Set<String> {
    do { return try sample(ttys) }
    catch { logs.removeAll(); return [] }
  }

  private func sample(_ ttys: Set<String>) throws -> Set<String> {
    let rows = try reader.run("/bin/ps", ["-axo", "pid=,tty=,lstart=,comm="])
    let launchTime = DateFormatter()
    launchTime.locale = Locale(identifier: "en_US_POSIX")
    launchTime.dateFormat = "EEE MMM d HH:mm:ss yyyy"
    var owners: [String: (tty: String, startedAt: Date)] = [:]
    for row in rows.split(separator: "\n") {
      let parts = row.split(maxSplits: 7, whereSeparator: { $0.isWhitespace })
      guard parts.count == 8, let pid = Int(parts[0]), pid > 0,
            URL(fileURLWithPath: String(parts[7])).lastPathComponent == "codex",
            let started = launchTime.date(from: parts[2...6].joined(separator: " ")) else { continue }
      let tty = "/dev/\(parts[1])"
      if ttys.contains(tty) { owners[String(pid)] = (tty, started) }
    }
    guard !owners.isEmpty else { logs.removeAll(); return [] }
    let pids = owners.map(\.key).sorted().joined(separator: ",")
    let files = try reader.run("/usr/sbin/lsof", ["-a", "-p", pids, "-Fn"])
    var owner: (tty: String, startedAt: Date)?
    var conversations: [String: [String: MacCodexConversation]] = [:]
    var launched: [String: [String: Date]] = [:]
    var checked: [String: MacCodexConversation] = [:]
    for line in files.split(separator: "\n") {
      if line.hasPrefix("p") { owner = owners[String(line.dropFirst())] }
      guard let owner, line.hasPrefix("n") else { continue }
      let name = String(line.dropFirst())
      guard name.hasSuffix(".jsonl") else { continue }
      let conversation = try checked[name] ?? MacCodexConversation.load(
        path: URL(fileURLWithPath: name), sessionRoot: reader.sessionRoot)
      if let conversation {
        checked[name] = conversation
        conversations[owner.tty, default: [:]][conversation.sessionId] = conversation
        let previous = launched[owner.tty]?[conversation.sessionId] ?? owner.startedAt
        launched[owner.tty, default: [:]][conversation.sessionId] = min(previous, owner.startedAt)
      }
    }
    // Multiple owning CLI conversations on one TTY are ambiguous. Never guess.
    let bound = conversations.compactMapValues { $0.count == 1 ? $0.values.first : nil }
    let paths = Set(bound.values.map(\.path))
    logs = logs.filter { paths.contains($0.key) }
    var busy = Set<String>()
    for (tty, conversation) in bound {
      if (try? logs[conversation.path, default: MacCodexRequestActivityLog()].read(conversation.path)) == true,
         let started = logs[conversation.path]?.startedAt,
         let processStarted = launched[tty]?[conversation.sessionId], started >= processStarted {
        busy.insert(tty)
      }
    }
    return busy
  }
}

@MainActor
protocol MacTerminalAgentActivityMonitoring: AnyObject {
  func busyTTYs(in ttys: Set<String>) -> Set<String>
}

/// Catalog/focus calls use a short-lived snapshot and never wait on a process probe.
@MainActor
final class MacTerminalAgentActivityMonitor: MacTerminalAgentActivityMonitoring {
  private let sample: @Sendable (Set<String>) async -> Set<String>
  private let now: () -> TimeInterval
  private var requestedAt: TimeInterval = -.infinity
  private var sampledAt: TimeInterval = -.infinity
  private var busy = Set<String>()
  private var requestedTTYs = Set<String>()
  private var generation = 0
  private(set) var refreshTask: Task<Void, Never>?

  init(sample: (@Sendable (Set<String>) async -> Set<String>)? = nil,
       now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
    let reader = MacTerminalAgentActivityReader()
    self.sample = sample ?? { await reader.busyTTYs(in: $0) }
    self.now = now
  }

  func busyTTYs(in ttys: Set<String>) -> Set<String> {
    let valid = Set(ttys.filter { $0.range(of: "^/dev/tty[A-Za-z0-9]+$", options: .regularExpression) != nil })
    guard !valid.isEmpty else {
      generation += 1; refreshTask?.cancel(); refreshTask = nil
      busy.removeAll(); requestedTTYs.removeAll(); sampledAt = -.infinity
      return []
    }
    let time = now()
    if refreshTask == nil && (valid != requestedTTYs || time - requestedAt >= 1) {
      requestedAt = time; requestedTTYs = valid
      let current = generation, sample = sample
      refreshTask = Task { [weak self] in
        let result = await sample(valid)
        guard !Task.isCancelled, let self, self.generation == current else { return }
        self.busy = result.intersection(valid)
        self.sampledAt = self.now()
        self.refreshTask = nil
      }
    }
    return time - sampledAt < 6 ? busy.intersection(valid) : []
  }
}
