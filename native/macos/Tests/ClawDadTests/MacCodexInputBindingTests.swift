import Foundation
import XCTest
@testable import ClawDad

final class MacCodexInputBindingTests: XCTestCase {
  private let tty = "/dev/ttys012"
  private let ps = "42 42 42 S+ Wed Sep 9 09:53:57 2026 /opt/bin/codex\n43 43 42 S Wed Sep 9 09:53:58 2026 /opt/bin/node\n"
  private func reader(rows: String? = nil, files: String = "p42\nn/tmp/irrelevant.log\n", root: URL = URL(fileURLWithPath: "/tmp/codex-test-sessions")) -> MacTerminalResponseReader {
    let rows = rows ?? ps
    return MacTerminalResponseReader(run: { executable, args in
      if executable == "/bin/ps" { return rows }
      if executable == "/usr/sbin/lsof" {
        XCTAssertEqual(args.prefix(3), ["-a", "-p", "42"])
        if args.contains("cwd,txt") { return "p42\nfcwd\nn/tmp/same-directory\nftxt\nn/opt/pinned/0.153.4/codex\nftxt\nn/usr/lib/dyld\n" }
        return files
      }
      XCTAssertEqual(executable, "/opt/pinned/0.153.4/codex")
      XCTAssertEqual(args, ["--version"])
      return "codex-cli 0.153.4\n"
    }, sessionRoot: root)
  }

  func testFreshComposerNeedsNoRolloutOrDirectoryIndex() throws {
    let value = try reader().inputBinding(tty: tty)
    XCTAssertNil(value.conversation)
    XCTAssertEqual(value.version, "0.153.4")
    XCTAssertEqual(value.directory, "/tmp/same-directory")
    XCTAssertTrue(value.instanceId.hasPrefix("codex-process-"))
    XCTAssertEqual(value.fields["historyState"]?.string, "awaiting_first_turn")
    XCTAssertTrue(value.accepts(sessionId: nil, instanceId: value.instanceId))
    XCTAssertFalse(value.accepts(sessionId: "borrowed", instanceId: value.instanceId))
    XCTAssertFalse(value.accepts(sessionId: nil, instanceId: nil))
    XCTAssertEqual(assistantEditableDraft("Codex v0.153.4\n› Ask Codex to do anything\n  gpt-6-astra max · /tmp/same-directory\n"), "")
  }

  func testWrappersAndInheritedTTYHelpersDoNotOwnCodexInput() throws {
    let wrapper = "41 42 42 S+ Wed Sep 9 09:53:56 2026 /opt/bin/node\n"
    XCTAssertEqual(try reader(rows: wrapper + ps).inputBinding(tty: tty).instanceId,
      try reader().inputBinding(tty: tty).instanceId)
    for rows in [ps + ps.replacingOccurrences(of: "42 42 42", with: "44 42 42"),
                 ps.replacingOccurrences(of: "42 42 42", with: "42 42 99"),
                 ps.replacingOccurrences(of: "S+", with: "T+")] {
      XCTAssertThrowsError(try reader(rows: rows).inputBinding(tty: tty))
    }
    XCTAssertThrowsError(try reader(rows: wrapper).inputBinding(tty: tty))
    XCTAssertThrowsError(try reader().inputBinding(tty: "/dev/ttys012; echo"))
  }

  func testSameDirectoryTabsRestartAndTTYReuseHaveDifferentBindings() throws {
    let original = try reader().inputBinding(tty: tty)
    let otherTTY = try reader().inputBinding(tty: "/dev/ttys013")
    let restart = try reader(rows: ps.replacingOccurrences(of: "09:53:57", with: "10:00:00")).inputBinding(tty: tty)
    XCTAssertFalse(otherTTY.continues(original))
    XCTAssertFalse(restart.continues(original))
    XCTAssertFalse(restart.accepts(sessionId: nil, instanceId: original.instanceId))
  }

  func testFirstRolloutAdoptionIsBoundToThisProcessAndRejectsPartialOrMultipleFiles() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    func rollout(_ id: String) throws -> URL {
      let url = root.appendingPathComponent("rollout-test-\(id).jsonl")
      let record: [String: Any] = ["type":"session_meta", "payload":["id":id, "source":"cli", "cli_version":"0.153.4", "cwd":"/tmp/same-directory"]]
      var data = try JSONSerialization.data(withJSONObject: record); data.append(10)
      try data.write(to: url); return url
    }
    let one = try rollout(UUID().uuidString), two = try rollout(UUID().uuidString)
    let fresh = try reader(root: root).inputBinding(tty: tty)
    // An existing same-directory file on disk cannot supply this new input's ID.
    XCTAssertNil(fresh.conversation)
    let adopted = try reader(files: "p42\nn\(one.path)\n", root: root).inputBinding(tty: tty)
    XCTAssertTrue(adopted.continues(fresh))
    XCTAssertFalse(fresh.continues(adopted))
    XCTAssertNotNil(adopted.conversation)
    XCTAssertFalse(try reader(files: "p42\nn\(two.path)\n", root: root).inputBinding(tty: tty).continues(adopted))
    XCTAssertThrowsError(try reader(files: "p42\nn\(one.path)\nn\(two.path)\n", root: root).inputBinding(tty: tty))
    try Data("{\"type\":\"session_meta\"".utf8).write(to: one)
    XCTAssertThrowsError(try reader(files: "p42\nn\(one.path)\n", root: root).inputBinding(tty: tty)) { error in
      XCTAssertEqual((error as? MacCodexInputFailure)?.code, "session_starting")
    }
  }

  func testProcessChangeDuringReadRejectsBinding() throws {
    let counter = Counter()
    let original = reader()
    let changing = MacTerminalResponseReader(run: { executable, args in
      if executable == "/bin/ps" {
        counter.value += 1
        return counter.value == 1 ? "42 42 42 S Wed Sep 9 09:53:57 2026 /opt/bin/codex" : "42 42 42 S Wed Sep 9 10:00:00 2026 /opt/bin/codex"
      }
      return try original.run(executable, args)
    })
    XCTAssertThrowsError(try changing.inputBinding(tty: tty)) { error in
      XCTAssertEqual((error as? MacCodexInputFailure)?.code, "process_changed")
    }
  }

  func testStartupAndAttachmentInputsRemainProtected() {
    for screen in ["Do you trust this directory?\n1. Yes\n2. No", "Loading Codex…", "Sign in", "› hello\nConfirm?", "› [Image #1]\n  gpt-6-astra max"] {
      XCTAssertNil(assistantObserveDraft(screen).text)
    }
    for draft in ["short", "first\n  second", "[Pasted Content 2400 chars]"] {
      XCTAssertNotNil(assistantObserveDraft("› \(draft)\n  gpt-6-astra max\n").text)
    }
  }

  func testLiveResearchProcessReadOnly() throws {
    guard let tty = ProcessInfo.processInfo.environment["CLAWDAD_TEST_FRESH_TTY"],
      let output = ProcessInfo.processInfo.environment["CLAWDAD_TEST_FRESH_EVIDENCE"] else {
      throw XCTSkip("Opt-in process-only inspection; no input or submission")
    }
    let binding = try MacTerminalResponseReader().inputBinding(tty: tty)
    XCTAssertEqual(binding.version, "0.153.4")
    XCTAssertNil(binding.conversation)
    try JSONEncoder().encode(binding.fields).write(to: URL(fileURLWithPath: output))
  }
}

private final class Counter: @unchecked Sendable { var value = 0 }
