import ClawDadRemoteAssistProtocol
import Foundation
import XCTest
@testable import ClawDad

final class MacTerminalResponseReaderTests: XCTestCase {
  func testLiveRunningConversationVersionReadOnly() throws {
    let env = ProcessInfo.processInfo.environment
    guard let tty = env["CLAWDAD_TEST_RUNNING_TTY"], let output = env["CLAWDAD_TEST_VERSION_EVIDENCE"] else {
      throw XCTSkip("Opt-in read-only inspection of an existing agent process")
    }
    let reader = MacTerminalResponseReader()
    let conversation = try reader.resolve(tty: tty)
    let version = try reader.queueCLIVersion(tty: tty, conversation: conversation)
    XCTAssertEqual(version, "0.153.4")
    let proof: [String: Any] = ["tty": tty, "sessionId": conversation.sessionId,
      "conversationPath": conversation.path.path, "runningVersion": version ?? "unknown",
      "sessionHeaderVersion": conversation.cliVersion ?? "unknown", "readOnly": true]
    try JSONSerialization.data(withJSONObject: proof, options: [.prettyPrinted, .sortedKeys])
      .write(to: URL(fileURLWithPath: output), options: .atomic)
  }
  func testQueueVersionIgnoresTTYHelpersAndUsesTheExactConversationOwner() throws {
    let conversation = MacCodexConversation(sessionId: "11111111-1111-4111-8111-111111111111",
      path: URL(fileURLWithPath: "/tmp/owned-rollout.jsonl"), cliVersion: "0.100.0")
    let reader = MacTerminalResponseReader(run: { executable, args in
      if executable == "/bin/ps" { return "10 /opt/running/codex\n11 /Applications/Helper/codex\n" }
      if executable == "/usr/sbin/lsof" {
        if args.contains("txt") { return "p10\nftxt\nn/opt/running/codex\nn/usr/lib/dyld\n" }
        return "p11\nn/tmp/helper.log\np10\nn/tmp/owned-rollout.jsonl\n"
      }
      XCTAssertEqual(executable, "/opt/running/codex"); XCTAssertEqual(args, ["--version"])
      return "codex-cli 0.153.4\n"
    })
    XCTAssertEqual(try reader.queueCLIVersion(tty: "/dev/ttys001", conversation: conversation), "0.153.4")
    let ambiguous = MacTerminalResponseReader(run: { executable, _ in
      if executable == "/bin/ps" { return "10 /opt/one/codex\n11 /opt/two/codex\n" }
      XCTAssertEqual(executable, "/usr/sbin/lsof")
      return "p10\nn/tmp/owned-rollout.jsonl\np11\nn/tmp/owned-rollout.jsonl\n"
    })
    XCTAssertNil(try ambiguous.queueCLIVersion(tty: "/dev/ttys001", conversation: conversation))
  }
  func testQueueVersionUsesTheExactRunningExecutableAndRejectsAmbiguousOwners() throws {
    let reader = MacTerminalResponseReader(run: { executable, args in
      if executable == "/bin/ps" { return "10 /opt/codex-verified/codex\n11 /bin/zsh\n" }
      XCTAssertEqual(executable, "/opt/codex-verified/codex"); XCTAssertEqual(args, ["--version"])
      return "codex-cli 0.153.4\n"
    })
    XCTAssertEqual(try reader.queueCLIVersion(tty: "/dev/ttys001"), "0.153.4")
    XCTAssertNil(try reader.queueCLIVersion(tty: "/dev/ttys001; echo"))
    let ambiguous = MacTerminalResponseReader(run: { executable, _ in
      XCTAssertEqual(executable, "/bin/ps"); return "10 /opt/one/codex\n11 /opt/two/codex\n"
    })
    XCTAssertNil(try ambiguous.queueCLIVersion(tty: "/dev/ttys001"))
  }
  private let sessionId = "11111111-1111-4111-8111-111111111111"

  func testLatestCompletedTurnPreservesExactTextAndIgnoresCommentary() throws {
    let text = "Latest answer 🦞\n\n  indented text\n"
    let conversation = try fixture(records: [
      completed("older", text: "Old answer"),
      completed("latest", text: text),
      ["type": "response_item", "payload": ["type": "message", "role": "assistant", "phase": "commentary", "content": [["text": "Progress update"]]]]
    ], suffix: "{\"incomplete\":")
    let result = try MacCodexResponseParser.read(conversation: conversation)
    XCTAssertEqual(result.text, text)
    XCTAssertEqual(result.turnId, "latest")
    XCTAssertFalse(result.inProgress)
  }

  func testUnfinishedFinalCannotReplaceCompletedAnswer() throws {
    let conversation = try fixture(records: [
      completed("previous", text: "Finished answer"),
      ["type": "event_msg", "payload": ["type": "task_started"]],
      ["type": "event_msg", "payload": ["type": "user_message", "message": "New question"]],
      ["type": "response_item", "payload": ["type": "message", "role": "assistant", "phase": "final_answer", "content": [["text": "Still finishing"]]]]
    ])
    let result = try MacCodexResponseParser.read(conversation: conversation)
    XCTAssertEqual(result.text, "Finished answer")
    XCTAssertTrue(result.inProgress)
  }

  func testLegacyCompletionReadsFinalMessageAndAbortedTurnIsNotWorking() throws {
    let conversation = try fixture(records: [
      ["type": "response_item", "payload": ["type": "message", "role": "assistant", "phase": "final_answer", "content": [["text": "Completed legacy answer"]]]],
      completed("legacy", text: ""),
      ["type": "event_msg", "payload": ["type": "task_started"]],
      ["type": "event_msg", "payload": ["type": "turn_aborted"]]
    ])
    let result = try MacCodexResponseParser.read(conversation: conversation)
    XCTAssertEqual(result.text, "Completed legacy answer")
    XCTAssertFalse(result.inProgress)
  }

  func testLongToolLineAcrossChunksDoesNotHideLatestAnswer() throws {
    let conversation = try fixture(records: [
      completed("latest", text: "The whole answer"),
      ["type": "response_item", "payload": ["type": "function_call_output", "output": String(repeating: "x", count: 900_000)]],
      ["type": "event_msg", "payload": ["type": "task_started"]]
    ])
    let result = try MacCodexResponseParser.read(conversation: conversation)
    XCTAssertEqual(result.text, "The whole answer")
    XCTAssertTrue(result.inProgress)
  }

  func testOversizedResponseFailsWithoutSubstitutingAnOlderAnswer() throws {
    let conversation = try fixture(records: [
      completed("old", text: "Older answer"),
      completed("large", text: String(repeating: "x", count: RemoteTerminalResponse.maximumTextBytes + 1))
    ])
    XCTAssertThrowsError(try MacCodexResponseParser.read(conversation: conversation))
  }

  func testProcessBindingDeduplicatesWrappersAndIgnoresSubagents() throws {
    let main = try fixture(records: [completed("main", text: "Correct main answer")])
    let child = try fixture(records: [], source: ["subagent": "review"], id: "22222222-2222-4222-8222-222222222222", directory: main.path.deletingLastPathComponent())
    let files = "p10\nn\(main.path.path)\nn\(child.path.path)\np11\nn\(main.path.path)\n"
    let reader = MacTerminalResponseReader(run: { executable, arguments in
      if executable == "/bin/ps" {
        XCTAssertEqual(arguments, ["-t", "ttys001", "-o", "pid=,pgid=,tpgid=,stat=,lstart=,comm="])
        return "10 10 10 S Wed Sep 9 09:00:00 2026 /usr/local/bin/codex\n11 11 10 S Wed Sep 9 09:00:00 2026 /opt/codex\n12 12 10 S Wed Sep 9 09:00:00 2026 /bin/zsh\n"
      }
      XCTAssertEqual(arguments, ["-a", "-p", "10", "-Fn"])
      return files
    }, sessionRoot: main.path.deletingLastPathComponent())
    XCTAssertEqual(try reader.resolve(tty: "/dev/ttys001"), main)
    XCTAssertEqual(try reader.read(tty: "/dev/ttys001").text, "Correct main answer")
    XCTAssertThrowsError(try reader.resolve(tty: "/dev/ttys001; anything"))
  }

  func testAmbiguousConversationIsNeverGuessed() throws {
    let first = try fixture(records: [])
    let second = try fixture(records: [], id: "22222222-2222-4222-8222-222222222222", directory: first.path.deletingLastPathComponent())
    let files = "n\(first.path.path)\nn\(second.path.path)\n"
    let reader = MacTerminalResponseReader(run: { executable, _ in
      executable == "/bin/ps" ? "10 10 10 S Wed Sep 9 09:00:00 2026 /opt/codex\n" : files
    }, sessionRoot: first.path.deletingLastPathComponent())
    XCTAssertThrowsError(try reader.resolve(tty: "/dev/ttys001"))
  }

  func testLiveTerminalMappingWhenExplicitlyEnabled() throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_LIVE_TERMINAL_READER"] == "1" else {
      throw XCTSkip("Set CLAWDAD_LIVE_TERMINAL_READER=1 for the read-only local terminal check.")
    }
    let reader = MacTerminalResponseReader()
    let rows = try reader.run("/bin/ps", ["-axo", "tty=,comm="])
    let terminals = Set(rows.split(separator: "\n").compactMap { line -> String? in
      let parts = line.split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
      guard parts.count == 2, parts[0].hasPrefix("ttys"),
            URL(fileURLWithPath: String(parts[1])).lastPathComponent == "codex" else { return nil }
      return "/dev/\(parts[0])"
    })
    var matched = 0
    var completed = 0
    for tty in terminals {
      _ = try reader.resolve(tty: tty)
      matched += 1
      do {
        let response = try reader.read(tty: tty)
        if !response.text.isEmpty { completed += 1 }
      } catch let failure as MacTerminalResponseFailure {
        print("Terminal reader live availability: \(failure.message)")
      }
    }
    print("Terminal reader live check: \(matched) conversations matched; \(completed) completed answers retrieved. Text was not printed.")
    XCTAssertGreaterThan(matched, 0)
    XCTAssertGreaterThan(completed, 0)
  }

  private func completed(_ id: String, text: String) -> [String: Any] {
    ["type": "event_msg", "timestamp": "2026-09-05T08:00:00Z",
     "payload": ["type": "task_complete", "turn_id": id, "last_agent_message": text]]
  }

  private func fixture(records: [[String: Any]], suffix: String = "", source: Any = "cli", id: String? = nil, directory: URL? = nil) throws -> MacCodexConversation {
    let root = directory ?? FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    if directory == nil { addTeardownBlock { try? FileManager.default.removeItem(at: root) } }
    let id = id ?? sessionId
    let path = root.appendingPathComponent("rollout-2026-09-05-\(id).jsonl")
    let header: [String: Any] = ["type": "session_meta", "payload": ["id": id, "source": source]]
    var data = Data()
    for record in [header] + records {
      data.append(try JSONSerialization.data(withJSONObject: record))
      data.append(10)
    }
    data.append(Data(suffix.utf8))
    try data.write(to: path)
    return MacCodexConversation(sessionId: id, path: path.resolvingSymlinksInPath())
  }
}
