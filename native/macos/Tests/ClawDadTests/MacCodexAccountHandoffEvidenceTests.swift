import Foundation
import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDad

final class MacCodexAccountHandoffEvidenceTests:XCTestCase {
  func testParentShellSurvivesOnlyExactChildAndWrapperAncestry() {
    let rows="""
    10 1 10 40 Wed Sep 16 00:00:00 2026 /usr/bin/login
    20 10 20 40 Wed Sep 16 00:00:01 2026 -zsh
    30 20 40 40 Wed Sep 16 00:00:02 2026 /fixture/node
    40 30 40 40 Wed Sep 16 00:00:03 2026 /fixture/codex
    """
    let source=MacCodexAccountHandoffEvidence.shell(rows,agentPID:"40")
    XCTAssertEqual(source?.pid,"20")
    let idle="20 10 20 20 Wed Sep 16 00:00:01 2026 -zsh"
    XCTAssertEqual(source?.identity,MacCodexAccountHandoffEvidence.shell(idle,agentPID:nil)?.identity)
    XCTAssertEqual(source?.identity,MacCodexAccountHandoffEvidence.shell(idle.replacingOccurrences(of:"2026 -zsh",with:"2026     -zsh"),agentPID:nil)?.identity)
    XCTAssertNil(MacCodexAccountHandoffEvidence.shell(rows.replacingOccurrences(of:"30 20",with:"30 10"),agentPID:"40"))
    XCTAssertNil(MacCodexAccountHandoffEvidence.shell(rows,agentPID:"999"))
    XCTAssertNil(MacCodexAccountHandoffEvidence.shell(rows+"\n"+idle,agentPID:"40"))
    XCTAssertNotEqual(source?.identity,MacCodexAccountHandoffEvidence.shell(idle.replacingOccurrences(of:"00:00:01",with:"00:00:09"),agentPID:nil)?.identity)
  }
  func testAcceptedHistorySurvivesResumeMetadataButDetectsNewWork() throws {
    let url=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer{try? FileManager.default.removeItem(at:url)}
    let user="{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello 🌿\"}}\n"
    try Data(user.utf8).write(to:url);let hash=try MacCodexAccountHandoffEvidence.acceptedHistory(url)
    let metadata="{\"type\":\"session_meta\",\"payload\":{\"source\":\"cli\"}}\n"
    try Data((user+metadata).utf8).write(to:url);XCTAssertEqual(hash,try MacCodexAccountHandoffEvidence.acceptedHistory(url))
    try Data((user+metadata+user).utf8).write(to:url);XCTAssertNotEqual(hash,try MacCodexAccountHandoffEvidence.acceptedHistory(url))
    try Data((user+"unfinished").utf8).write(to:url);XCTAssertThrowsError(try MacCodexAccountHandoffEvidence.acceptedHistory(url))
  }
  func testLaunchPreservesPolicyQuotesPathsAndNeverReplaysPrompt() throws {
    let source:[String:AssistantValue]=["executable":.string("/fixture/bin/codex"),"directory":.string("/fixture/Cody's project"),
      "sessionId":.string("01a0a848-cb86-7033-ae6f-ce006f5b51bb"),"model":.string("gpt-6-astra"),"reasoningEffort":.string("max"),
      "resumeOptions":.array([.string("--sandbox"),.string("read-only"),.string("--ask-for-approval"),.string("never")])]
    let target:[String:AssistantValue]=["authorizationHome":.string("/fixture/profile"),"sqliteHome":.string("/fixture/history")]
    let command=try MacCodexAccountHandoffEvidence.launchCommand(source:source,target:target,requestId:"exact-request")
    XCTAssertTrue(command.contains("cd -- '/fixture/Cody'\\''s project' && /usr/bin/env"))
    XCTAssertTrue(command.contains("'--sandbox' 'read-only' '--ask-for-approval' 'never'"))
    XCTAssertTrue(command.contains("'CODEX_HOME=/fixture/profile'"));XCTAssertTrue(command.contains("'-u' 'OPENAI_API_KEY'"))
    XCTAssertTrue(command.contains("'CLAWDAD_ACCOUNT_TRANSITION_ID=exact-request'"))
    XCTAssertTrue(command.contains("'sqlite_home=\"/fixture/history\"'"))
    XCTAssertFalse(command.contains("\\/fixture"))
    var resumed=source;resumed["resumeOptions"] = .array([.string("--model"),.string("old-model"),.string("-c"),.string("model_reasoning_effort=\"low\""),.string("--sandbox"),.string("read-only")])
    let again=try MacCodexAccountHandoffEvidence.launchCommand(source:resumed,target:target,requestId:"second-switch")
    XCTAssertEqual(again.components(separatedBy:"'--model'").count,2)
    XCTAssertEqual(again.components(separatedBy:"model_reasoning_effort=").count,2)
    XCTAssertFalse(again.contains("old-model"));XCTAssertTrue(again.contains("'--sandbox' 'read-only'"))
    var invalid=source;invalid["resumeOptions"] = .array([.string("send this prompt")])
    XCTAssertThrowsError(try MacCodexAccountHandoffEvidence.launchCommand(source:invalid,target:target,requestId:"exact-request"))
    invalid=source;invalid["directory"] = .string("/fixture/\nwrong")
    XCTAssertThrowsError(try MacCodexAccountHandoffEvidence.launchCommand(source:invalid,target:target,requestId:"exact-request"))
  }
}
