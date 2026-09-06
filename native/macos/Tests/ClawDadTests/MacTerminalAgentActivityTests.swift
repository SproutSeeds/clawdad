import Foundation
import XCTest
@testable import ClawDad

final class MacTerminalAgentActivityTests: XCTestCase {
  private func fixture(source: Any = "cli", root: URL? = nil) throws -> URL {
    let directory = root ?? FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    if root == nil { addTeardownBlock { try? FileManager.default.removeItem(at: directory) } }
    let id = UUID().uuidString.lowercased()
    let file = directory.appendingPathComponent("rollout-2026-09-06-\(id).jsonl")
    let header: [String: Any] = ["type": "session_meta", "payload": ["id": id, "source": source]]
    var data = try JSONSerialization.data(withJSONObject: header)
    data.append(10); try data.write(to: file)
    return file
  }

  private func append(_ record: [String: Any], to path: URL, newline: Bool = true) throws {
    var data = try JSONSerialization.data(withJSONObject: record)
    if newline { data.append(10) }
    try append(data, to: path)
  }
  private func append(_ data: Data, to path: URL) throws {
    let handle = try FileHandle(forWritingTo: path)
    defer { try? handle.close() }
    try handle.seekToEnd(); try handle.write(contentsOf: data)
  }
  private func event(_ type: String) -> [String: Any] {
    ["type": "event_msg", "timestamp": "2026-09-06T12:00:00.125Z",
     "payload": ["type": type, "turn_id": "request"]]
  }

  func testOnlyAnExplicitRequestStartIsBusyAndCompletionOrAbortClearsIt() throws {
    let path = try fixture()
    var log = MacCodexRequestActivityLog()
    XCTAssertFalse(try log.read(path))
    try append(event("user_message"), to: path)
    XCTAssertFalse(try log.read(path))
    try append(event("task_started"), to: path)
    XCTAssertTrue(try log.read(path))
    try append(["type": "response_item", "payload": ["type": "task_complete"]], to: path)
    try append(["type": "response_item", "payload": ["type": "message", "role": "assistant", "phase": "final_answer"]], to: path)
    XCTAssertTrue(try log.read(path), "Ordinary output and unfinished final text are not lifecycle events.")
    try append(event("task_complete"), to: path)
    XCTAssertFalse(try log.read(path))
    try append(event("token_count"), to: path)
    XCTAssertFalse(try log.read(path))
    try append(event("task_started"), to: path)
    XCTAssertTrue(try log.read(path))
    try append(event("turn_aborted"), to: path)
    XCTAssertFalse(try log.read(path))
  }

  func testInitialScanAndIncrementalReadsIgnoreToolTextAcrossChunkBoundaries() throws {
    let path = try fixture()
    try append(event("task_started"), to: path)
    let noise: [String: Any] = ["type": "response_item", "payload": [
      "type": "function_call_output", "output": String(repeating: "x", count: 900_000) + "task_complete"]]
    try append(noise, to: path)
    var log = MacCodexRequestActivityLog()
    XCTAssertTrue(try log.read(path))
    try append(noise, to: path)
    XCTAssertTrue(try log.read(path))
    try append(event("task_complete"), to: path)
    XCTAssertFalse(try log.read(path))
    var reopened = MacCodexRequestActivityLog()
    XCTAssertFalse(try reopened.read(path))
  }

  func testPartialCompletionCommitsOnlyAfterTheNewlineArrives() throws {
    let path = try fixture()
    try append(event("task_started"), to: path)
    try append(event("task_complete"), to: path, newline: false)
    var log = MacCodexRequestActivityLog()
    XCTAssertTrue(try log.read(path))
    try append(Data([10]), to: path)
    XCTAssertFalse(try log.read(path))
  }

  func testReplacementAndTruncationCannotKeepAnOldBusyState() throws {
    let path = try fixture()
    try append(event("task_started"), to: path)
    var log = MacCodexRequestActivityLog()
    XCTAssertTrue(try log.read(path))
    try Data().write(to: path)
    XCTAssertFalse(try log.read(path))
    try append(event("task_started"), to: path)
    XCTAssertTrue(try log.read(path))
    var completed = try JSONSerialization.data(withJSONObject: event("task_complete"))
    completed.append(10)
    try completed.write(to: path, options: .atomic)
    XCTAssertFalse(try log.read(path))
  }

  func testBatchedOwnershipSeparatesTabsAndIgnoresSubagentsAndExitedProcesses() async throws {
    let first = try fixture()
    let root = first.deletingLastPathComponent()
    let second = try fixture(root: root)
    let child = try fixture(source: ["subagent": "review"], root: root)
    try append(event("task_started"), to: first)
    try append(event("task_complete"), to: second)
    try append(event("task_started"), to: child)
    let commands = ActivityCommandFixture(
      processes: "10 ttys001 Sat Sep 5 10:00:00 2026 /opt/codex\n11 ttys001 Sat Sep 5 10:00:00 2026 /usr/bin/codex\n20 ttys002 Sat Sep 5 10:00:00 2026 /opt/codex\n21 ttys002 Sat Sep 5 10:00:00 2026 /bin/zsh\n",
      files: "p10\nn\(first.path)\nn\(child.path)\np11\nn\(first.path)\np20\nn\(second.path)\n")
    let reader = MacTerminalAgentActivityReader(reader: MacTerminalResponseReader(run: { try commands.run($0, $1) }, sessionRoot: root))
    let ttys: Set<String> = ["/dev/ttys001", "/dev/ttys002"]
    let initial = await reader.busyTTYs(in: ttys)
    XCTAssertEqual(initial, ["/dev/ttys001"])
    XCTAssertEqual(commands.callCount, 2, "One process list and one file list cover all tabs.")
    try append(event("task_complete"), to: first)
    try append(event("task_started"), to: second)
    let changed = await reader.busyTTYs(in: ttys)
    XCTAssertEqual(changed, ["/dev/ttys002"])
    commands.processes = ""
    let exited = await reader.busyTTYs(in: ttys)
    XCTAssertTrue(exited.isEmpty, "A stale start in an exited process cannot keep the tab busy.")
  }

  func testAmbiguousAndUnavailableAgentBindingsHaveNoBusyBadge() async throws {
    let first = try fixture()
    let root = first.deletingLastPathComponent()
    let second = try fixture(root: root)
    try append(event("task_started"), to: first)
    try append(event("task_started"), to: second)
    let commands = ActivityCommandFixture(processes: "10 ttys001 Sat Sep 5 10:00:00 2026 /opt/codex\n",
      files: "p10\nn\(first.path)\nn\(second.path)\n")
    let reader = MacTerminalAgentActivityReader(reader: MacTerminalResponseReader(run: { try commands.run($0, $1) }, sessionRoot: root))
    let ambiguous = await reader.busyTTYs(in: ["/dev/ttys001"])
    XCTAssertTrue(ambiguous.isEmpty)
    let failed = MacTerminalAgentActivityReader(reader: MacTerminalResponseReader(run: { _, _ in
      throw MacTerminalResponseFailure(message: "Unavailable")
    }, sessionRoot: root))
    let unavailable = await failed.busyTTYs(in: ["/dev/ttys001"])
    XCTAssertTrue(unavailable.isEmpty)
  }

  func testReopeningAnOldUnfinishedConversationDoesNotMakeItBusy() async throws {
    let path = try fixture()
    try append(event("task_started"), to: path)
    let commands = ActivityCommandFixture(processes: "10 ttys001 Mon Sep 7 10:00:00 2026 /opt/codex\n",
      files: "p10\nn\(path.path)\n")
    let reader = MacTerminalAgentActivityReader(reader: MacTerminalResponseReader(
      run: { try commands.run($0, $1) }, sessionRoot: path.deletingLastPathComponent()))
    let reopened = await reader.busyTTYs(in: ["/dev/ttys001"])
    XCTAssertTrue(reopened.isEmpty)
    try append(["type": "event_msg", "timestamp": "2026-09-08T12:00:00Z",
                "payload": ["type": "task_started"]], to: path)
    let current = await reader.busyTTYs(in: ["/dev/ttys001"])
    XCTAssertEqual(current, ["/dev/ttys001"])
  }

  @MainActor
  func testSlowActivityProbeNeverBlocksSelectionAndExpiredBadgesClear() async {
    let gate = ActivitySampleGate()
    var time: TimeInterval = 0
    let monitor = MacTerminalAgentActivityMonitor(sample: { await gate.sample($0) }, now: { time })
    let ttys: Set<String> = ["/dev/ttys001"]
    XCTAssertTrue(monitor.busyTTYs(in: ttys).isEmpty)
    let first = monitor.refreshTask
    for _ in 0..<10 { XCTAssertTrue(monitor.busyTTYs(in: ttys).isEmpty) }
    await gate.finish(ttys)
    await first?.value
    XCTAssertEqual(monitor.busyTTYs(in: ttys), ttys)
    time = 2
    XCTAssertEqual(monitor.busyTTYs(in: ttys), ttys)
    let second = monitor.refreshTask
    time = 7
    XCTAssertTrue(monitor.busyTTYs(in: ttys).isEmpty)
    await gate.finish([])
    await second?.value
    XCTAssertTrue(monitor.busyTTYs(in: ttys).isEmpty)
    await gate.finish([])
    await monitor.refreshTask?.value
  }

  @MainActor
  func testLateActivityReplyCannotRestoreBadgesAfterTabsClose() async {
    let gate = ActivitySampleGate()
    let monitor = MacTerminalAgentActivityMonitor(sample: { await gate.sample($0) })
    let ttys: Set<String> = ["/dev/ttys001"]
    _ = monitor.busyTTYs(in: ttys)
    let pending = monitor.refreshTask
    XCTAssertTrue(monitor.busyTTYs(in: []).isEmpty)
    await gate.finish(ttys)
    await pending?.value
    XCTAssertTrue(monitor.busyTTYs(in: []).isEmpty)
  }

  func testLiveAgentActivityWhenExplicitlyEnabled() async throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_LIVE_TERMINAL_ACTIVITY"] == "1" else {
      throw XCTSkip("Opt-in read-only check of agent request lifecycle; no terminal focus or input.")
    }
    let commands = MacTerminalResponseReader()
    let rows = try commands.run("/bin/ps", ["-axo", "tty=,comm="])
    let ttys = Set(rows.split(separator: "\n").compactMap { row -> String? in
      let parts = row.split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
      guard parts.count == 2, parts[0].hasPrefix("ttys"),
            URL(fileURLWithPath: String(parts[1])).lastPathComponent == "codex" else { return nil }
      return "/dev/\(parts[0])"
    })
    let reader = MacTerminalAgentActivityReader()
    let start = ProcessInfo.processInfo.systemUptime
    let first = await reader.busyTTYs(in: ttys)
    let sampled = ProcessInfo.processInfo.systemUptime
    let second = await reader.busyTTYs(in: ttys)
    print("Live agent activity: \(ttys.count) terminal identities, \(first.count)/\(second.count) working; first \(sampled - start)s, next \(ProcessInfo.processInfo.systemUptime - sampled)s. No conversation text printed.")
    XCTAssertFalse(ttys.isEmpty)
    XCTAssertFalse(first.isEmpty)
    XCTAssertTrue(first.isSubset(of: ttys))
  }
}

private final class ActivityCommandFixture: @unchecked Sendable {
  private let lock = NSLock()
  private var rows: String
  private var count = 0
  private let files: String
  init(processes: String, files: String) { rows = processes; self.files = files }
  var processes: String {
    get { lock.lock(); defer { lock.unlock() }; return rows }
    set { lock.lock(); defer { lock.unlock() }; rows = newValue }
  }
  var callCount: Int { lock.lock(); defer { lock.unlock() }; return count }
  func run(_ executable: String, _ arguments: [String]) throws -> String {
    lock.lock(); defer { lock.unlock() }; count += 1
    if executable == "/bin/ps" {
      XCTAssertEqual(arguments, ["-axo", "pid=,tty=,lstart=,comm="])
      return rows
    }
    XCTAssertEqual(executable, "/usr/sbin/lsof")
    XCTAssertEqual(arguments.prefix(2), ["-a", "-p"])
    XCTAssertEqual(arguments.last, "-Fn")
    return files
  }
}

private actor ActivitySampleGate {
  private var replies: [Set<String>] = []
  private var waiting: [CheckedContinuation<Set<String>, Never>] = []
  func sample(_ ttys: Set<String>) async -> Set<String> {
    if !replies.isEmpty { return replies.removeFirst() }
    return await withCheckedContinuation { waiting.append($0) }
  }
  func finish(_ result: Set<String>) {
    if waiting.isEmpty { replies.append(result) }
    else { waiting.removeFirst().resume(returning: result) }
  }
}
