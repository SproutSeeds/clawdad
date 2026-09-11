import AppKit
import Foundation
import XCTest
@testable import ClawDad

final class MacTerminalTitleIOFixture: @unchecked Sendable {
  private let lock = NSLock()
  var current = MacTerminalTitleMetadata(tty: "/dev/ttys900", lifetime: "login-1", foreground: "agent-1", directory: "/project/beta", kind: "codex")
  private var data: [Data] = []
  func write(_ owner: MacTerminalTitleMetadata, _ bytes: Data) throws {
    lock.lock(); defer { lock.unlock() }
    guard owner.lifetime == current.lifetime else { throw MacAssistantError("Reused TTY") }; data.append(bytes)
  }
  var outputs: [String] { lock.lock(); defer { lock.unlock() }; return data.map { String(decoding: $0, as: UTF8.self) } }
}

@MainActor final class MacTerminalProjectTitleTests: XCTestCase {
  func row(_ title: String = "/project/alpha — thread | beta — codex", generated: Bool = true, tty: String = "/dev/ttys900", window: String? = nil, windowCustom: String? = nil, configured: String? = nil) -> MacTerminalTabSnapshot {
    .init(windowID: 1, windowIndex: 1, tabIndex: 1, customTitle: title, tty: tty, isSelectedInWindow: true, activityWindowTitle: window, generatedTitle: generated, windowCustomTitle: windowCustom, configuredTitle: configured)
  }
  func fixture(_ io: MacTerminalTitleIOFixture, url: URL) -> MacTerminalProjectTitles {
    MacTerminalProjectTitles(url: url, readMetadata: { _ in io.current }, writeOutput: io.write, readWindowTitle: { _ in "alpha — thread | beta — codex — 180×49" })
  }
  func testVerifiedAgentDirectoryWinsInheritedShellMetadataWithoutNeedingHistory() async throws {
    let io = MacTerminalTitleIOFixture(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let titles = fixture(io, url: root.appendingPathComponent("names.json"))
    titles.refresh([row()]); await titles.refreshTask?.value
    XCTAssertEqual(titles.title(for: row()), "beta")
    XCTAssertTrue(io.outputs[0].contains("/project/beta"))
    XCTAssertFalse(io.outputs[0].contains("]0;")); XCTAssertFalse(io.outputs[0].contains("\n"))
  }
  func testCustomPathNamePersistenceTTYReuseAndSameDirectoryThreads() async throws {
    let io = MacTerminalTitleIOFixture(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appendingPathComponent("names.json"), titles = fixture(io, url: file)
    let name = "/looks/like/a/path — deliberate name"
    try await titles.rename(tty: io.current.tty, name: name, expectedLifetime: "login-1")
    XCTAssertEqual(titles.title(for: row()), name)
    let reloaded = fixture(io, url: file)
    reloaded.refresh([row()]); await reloaded.refreshTask?.value
    XCTAssertEqual(reloaded.title(for: row()), name)
    XCTAssertNil(reloaded.explicitName(tty: "/dev/ttys901"))
    io.current = .init(tty: io.current.tty, lifetime: "new-login", foreground: "other", directory: "/project/beta", kind: "shell")
    let restartedTerminal = fixture(io, url: file)
    restartedTerminal.refresh([row()]); await restartedTerminal.refreshTask?.value
    XCTAssertNil(restartedTerminal.explicitName(tty: io.current.tty))
    do { try await restartedTerminal.rename(tty: io.current.tty, name: "wrong", expectedLifetime: "login-1"); XCTFail("Stale name binding accepted") } catch {}
  }
  func testUnknownNativeCustomNamesRemainVerbatimIncludingDirectories() async throws {
    let io = MacTerminalTitleIOFixture(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let titles = fixture(io, url: root.appendingPathComponent("names.json"))
    titles.refresh([row()]); await titles.refreshTask?.value
    XCTAssertEqual(titles.title(for: row("/a/deliberate/name", generated: false)), "/a/deliberate/name")
    XCTAssertNil(titles.explicitName(tty: io.current.tty), "Unclassified metadata alone cannot assign a durable name")
    let custom = row("/a/deliberate/name", generated: false, window: "beta — codex — 180×49")
    let now = Date()
    XCTAssertEqual(titles.title(for: custom, now: now), "/a/deliberate/name")
    XCTAssertEqual(titles.title(for: custom, now: now.addingTimeInterval(1.1)), "/a/deliberate/name")
    XCTAssertEqual(titles.explicitName(tty: io.current.tty), "/a/deliberate/name")
  }
  func testExplicitWindowNamesSurviveAndOldProgramTitlesAreNotAdoptedDuringStartup() {
    XCTAssertTrue(MacTerminalProjectTitles.preserveConfiguredName("life-ops"))
    XCTAssertTrue(MacTerminalProjectTitles.preserveConfiguredName("/work/deliberate/path"))
    XCTAssertFalse(MacTerminalProjectTitles.preserveConfiguredName("Terminal"))
    XCTAssertTrue(MacTerminalProjectTitles.preserveConfiguredName("Custom name | other-project"))
    XCTAssertTrue(MacTerminalProjectTitles.preserveConfiguredName("Codex"))
  }
  func testIntentionalNativeWindowTitleRetainsPrecedenceAcrossCrossProjectLaunch() async throws {
    let io = MacTerminalTitleIOFixture(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let titles = fixture(io, url: root.appendingPathComponent("names.json"))
    titles.refresh([row()]); await titles.refreshTask?.value
    let named = row("/project/alpha — Title Fixture Explicit — codex", window: "alpha — Title Fixture Explicit — codex — 180×49", windowCustom: "Title Fixture Explicit", configured: "Title Fixture Explicit")
    XCTAssertEqual(titles.title(for: named), "Title Fixture Explicit")
    XCTAssertEqual(titles.title(for: row()), "Title Fixture Explicit")
    XCTAssertEqual(titles.explicitName(tty: io.current.tty), "Title Fixture Explicit")
    let live = row("/project/alpha — clawdad — codex", window: "alpha — clawdad — codex — 180×49", windowCustom: "clawdad", configured: "Terminal")
    XCTAssertEqual(titles.title(for: live), "beta", "A program's initial repository name is not a configured user title")
    XCTAssertNil(titles.explicitName(tty: io.current.tty))
  }
  func testGeneratedWindowOnlyTitleAndDirectoryRaceDoNotBecomeCustomNames() async throws {
    XCTAssertTrue(MacTerminalProjectTitles.isGenerated("/project/alpha — -zsh", window: "alpha — clawdad — -zsh — 180×49", windowCustomTitle: "clawdad"))
    XCTAssertFalse(MacTerminalProjectTitles.isGenerated("/project/deliberate/name", window: "alpha — clawdad — -zsh — 180×49", windowCustomTitle: "clawdad"))
    let io = MacTerminalTitleIOFixture(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let titles = fixture(io, url: root.appendingPathComponent("names.json"))
    titles.refresh([row()]); await titles.refreshTask?.value
    let now = Date()
    _ = titles.title(for: row("/project/alpha — -zsh", generated: false, window: "beta — clawdad — -zsh — 180×49"), now: now)
    XCTAssertEqual(titles.title(for: row("/project/beta — -zsh", window: "beta — clawdad — -zsh — 180×49", windowCustom: "clawdad"), now: now.addingTimeInterval(1.1)), "beta")
    XCTAssertNil(titles.explicitName(tty: io.current.tty))
  }
  func testAnimatedActionRequiredTitleCannotReplaceAnApprovedName() async throws {
    let native = "/project/beta — [ ! ] Action Required | Work | beta — codex ▸ node"
    let window = "beta — [ . ] Action Required | Work | beta — codex ▸ codex-code-mode-host — 180×49"
    XCTAssertTrue(MacTerminalProjectTitles.isGenerated(native, window: window, windowCustomTitle: "[ . ] Action Required | Work | beta"))
    let io = MacTerminalTitleIOFixture(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let titles = fixture(io, url: root.appendingPathComponent("names.json"))
    try await titles.rename(tty: io.current.tty, name: "Approved Project", expectedLifetime: io.current.lifetime)
    let now = Date(), uncertain = row(native, generated: false, window: window)
    XCTAssertEqual(titles.title(for: uncertain, now: now), "Approved Project")
    XCTAssertEqual(titles.title(for: uncertain, now: now.addingTimeInterval(2)), "Approved Project")
    XCTAssertEqual(titles.explicitName(tty: io.current.tty), "Approved Project")
    let cold = fixture(io, url: root.appendingPathComponent("names.json"))
    cold.refresh([]); await cold.refreshTask?.value
    XCTAssertEqual(cold.explicitName(tty: io.current.tty), "Approved Project", "Restore exact stored TTY lifetime even before a catalog tab has been visited")
    XCTAssertTrue(io.outputs.last?.contains("]1;Approved Project") == true)
    titles.nativeTitleChanged(tty: io.current.tty, value: "/my/deliberate/name", generated: false, userEdited: true)
    XCTAssertEqual(titles.title(for: row()), "/my/deliberate/name", "An observed native title-editor action can replace a prior approved name")
  }
  func testOutputEscapesDirectoryAndRejectsNameControls() throws {
    XCTAssertThrowsError(try MacTerminalProjectTitles.validateName("name\u{1b}]0;bad"))
    XCTAssertThrowsError(try MacTerminalProjectTitles.validateName(String(repeating: "é", count: 129)))
    let bytes = MacTerminalProjectTitles.output(directory: "/a/space ' #日本\u{7}", name: "My project")
    let value = String(decoding: bytes, as: UTF8.self)
    XCTAssertTrue(value.contains("%20")); XCTAssertTrue(value.contains("%07")); XCTAssertTrue(value.hasSuffix("]1;My project\u{7}"))
    XCTAssertEqual(value.filter { $0 == "\u{1b}" }.count, 2)
  }
  func testProjectLaunchRequiresActualShellDirectoryAndKeepsSubmissionSeparate() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("title ' 日本 " + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true); defer { try? FileManager.default.removeItem(at: root) }
    let old = MacTerminalTitleMetadata(tty: "/dev/ttys900", lifetime: "l", foreground: "s", directory: "/old", kind: "shell")
    let cd = try MacTerminalProjectLaunch.draft(directory: root.path, stage: "directory", metadata: old)
    XCTAssertTrue(cd.hasPrefix("cd -- '")); XCTAssertTrue(cd.contains("'\\''")); XCTAssertFalse(cd.contains("\n"))
    XCTAssertThrowsError(try MacTerminalProjectLaunch.draft(directory: root.path, stage: "codex", metadata: old))
    let ready = MacTerminalTitleMetadata(tty: old.tty, lifetime: old.lifetime, foreground: old.foreground, directory: root.resolvingSymlinksInPath().path, kind: "shell")
    XCTAssertTrue(try MacTerminalProjectLaunch.draft(directory: root.path, stage: "codex", metadata: ready).hasPrefix("codex -C '"))
    XCTAssertThrowsError(try MacTerminalProjectLaunch.draft(directory: root.path + "/missing", stage: "directory", metadata: ready))
  }
  func testLiveNamedDisposableTabSurvivesProgramTitleChanges() async throws {
    guard let tty = ProcessInfo.processInfo.environment["CLAWDAD_TITLE_FIXTURE_TTY"], tty == "/dev/ttys019" else {
      throw XCTSkip("Requires the explicitly created disposable title fixture.")
    }
    let automation = MacTerminalAutomation()
    let before = try await automation.readTabs()
    guard let target = before.first(where: { $0.tty == tty && $0.isSelectedInWindow }) else { return XCTFail("Select the disposable fixture first") }
    let owner = try MacTerminalTitleMetadata.read(tty)
    XCTAssertEqual(owner.kind, "shell")
    MacTerminalProjectTitles.shared.refresh([target]); await MacTerminalProjectTitles.shared.refreshTask?.value
    try await MacTerminalProjectTitles.shared.rename(tty: tty, name: "Title Fixture", expectedLifetime: owner.lifetime)
    _ = try await automation.readTabs()
    try await Task.sleep(for: .milliseconds(150))
    let start = Date()
    try MacTerminalProjectTitles.nativeWrite(owner, bytes: Data("\u{1b}]0;Synthetic status | title-fixture\u{7}".utf8))
    // Allow native title notifications to restore display metadata; never sends
    // anything to the shell or reads its draft.
    try await Task.sleep(for: .milliseconds(700))
    let after = try await automation.readTabs()
    XCTAssertEqual(after.first { $0.tty == tty }?.customTitle, "Title Fixture")
    XCTAssertEqual(before.map(\.tty), after.map(\.tty))
    print("TITLE_FIXTURE_NATIVE_RECOVERY elapsed_ms=\(Date().timeIntervalSince(start)*1000) tab_lifetime=\(owner.lifetime)")
  }
  func testActualProcessMetadataHandlesWrappersAndDirectoryOverrideBeforeFirstTurn() throws {
    let listing = "10 10 20 Ss Thu Sep 10 18:00:00 2026 /usr/bin/login\n11 11 20 S Thu Sep 10 18:00:00 2026 -zsh\n20 20 20 S+ Thu Sep 10 18:01:00 2026 /versions/0.154/codex\n21 20 20 S+ Thu Sep 10 18:01:00 2026 /bin/node"
    let read = try MacTerminalTitleMetadata.read("/dev/ttys900", run: { command, _ in
      command == "/bin/ps" ? listing : "p20\nfcwd\nn/project/alpha\nftxt\nn/versions/0.154/codex"
    }, arguments: { _ in ["codex", "-c", "features.code_mode_host=true", "-C", "/project/beta"] })
    XCTAssertEqual(read.directory, "/project/beta"); XCTAssertEqual(read.kind, "codex")
    let shellRows = listing.components(separatedBy: "\n").prefix(2).joined(separator: "\n").replacingOccurrences(of: " 20 ", with: " 11 ")
    XCTAssertEqual(try MacTerminalTitleMetadata.lifetime("/dev/ttys900", rows: MacTerminalTitleMetadata.processes("/dev/ttys900", run: { _,_ in shellRows })), read.lifetime, "Agent exit must preserve this live tab's explicit name")
  }
}
