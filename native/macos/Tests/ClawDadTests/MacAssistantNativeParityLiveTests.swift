import AppKit
import ApplicationServices
import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDad

/// Opt-in only: a launcher must supply the TTY of its disposable empty window.
/// Types harmless drafts and sends Enter only while that draft is verified empty.
@MainActor
final class MacAssistantNativeParityLiveTests: XCTestCase {
  func testNativeWindowCreationShellDraftsAndSpecialKeys() async throws {
    guard let tty = ProcessInfo.processInfo.environment["CLAWDAD_PARITY_FIXTURE_TTY"],
      let evidence = ProcessInfo.processInfo.environment["CLAWDAD_PARITY_EVIDENCE"] else { throw XCTSkip("Requires an explicitly created disposable Terminal fixture") }
    XCTAssertTrue(AXIsProcessTrusted())
    let tabs = MacTerminalTabController.shared
    let before = try await tabs.catalog()
    let anchor = try XCTUnwrap(before.selectedTabId)
    XCTAssertEqual(tabs.assistantSnapshot(tabID: anchor)?.tty,tty)
    let reuse = ProcessInfo.processInfo.environment["CLAWDAD_PARITY_REUSE_CREATED"] == "1"
    let previous = try? JSONDecoder().decode([String:AssistantValue].self,from:Data(contentsOf:URL(fileURLWithPath:evidence)))
    guard tabs.assistantSnapshot(tabID: anchor)?.tty == tty,
      (reuse ? previous?["initialInput"]?.object?["tty"]?.string == tty : tabs.assistantSnapshot(tabID: anchor)?.customTitle.contains("ClawDad Native Control Verification") == true) else { throw AssistantProtocolError.invalid }
    let input = try XCTUnwrap(MacInputController())
    let controls = MacAssistantTerminalInput()
    let ticket = try MacAssistantInteractionGate.shared.ticket()
    let (created, after) = reuse ? (try XCTUnwrap(before.tabs.first { $0.id == anchor }),before) : try await tabs.createTab(anchorId: anchor, expectedRevision: before.revision)
    var results: [String: AssistantValue] = ["anchorId":.string(anchor),"tabId":.string(created.id),
      "catalogBefore":try .encode(before),"catalogAfter":try .encode(after)]
    func persist() throws { try JSONEncoder().encode(results).write(to:URL(fileURLWithPath:evidence),options:.atomic) }
    controls.observationStep = { step in results["observationStep"] = .string(step); try? persist() }
    try persist() // Keep the new identity even if a later test fails.
    func inspect(_ tabId: String = created.id) async throws -> [String:AssistantValue] {
      try await controls.inspect(tabId:tabId,input:input,ticket:ticket)
    }
    func target(_ inspected:[String:AssistantValue]) -> [String:AssistantValue] {
      ["tabId":inspected["tabId"]!,"inputToken":inspected["inputToken"]!,"inputSessionId":inspected["inputSessionId"]!]
    }
    var fresh = try await inspect()
    results["initialInput"] = .object(fresh); try persist()
    XCTAssertEqual(fresh["kind"]?.string,"shell")
    if reuse, let existing = fresh["draftText"]?.string,
      existing == "ClawDad review draft Ω" || existing.allSatisfy(\.isWhitespace) {
      var clear = target(fresh)
      clear.merge(["mode":.string("clear"),"expectedText":.string(existing),"text":.string("")]) { _,new in new }
      _ = try await controls.execute("terminal.native.type",args:clear,input:input)
      fresh = try await inspect()
    }
    XCTAssertEqual(fresh["draftText"]?.string,"")
    var args = target(fresh)
    args.merge(["mode":.string("insert"),"expectedText":.string(""),"text":.string("ClawDad review draft Ω")]) { _,new in new }
    results["typed"] = .object(try await controls.execute("terminal.native.type",args:args,input:input)); try persist()
    fresh = try await inspect()
    XCTAssertEqual(fresh["draftText"]?.string,"ClawDad review draft Ω")
    var preserve = target(fresh); preserve.merge(["mode":.string("insert"),"expectedText":.string("ClawDad review draft Ω"),"text":.string("do not replace")]) { _,new in new }
    do { _ = try await controls.execute("terminal.native.type",args:preserve,input:input); XCTFail("Existing draft must be preserved") } catch {}
    fresh = try await inspect(); XCTAssertEqual(fresh["draftText"]?.string,"ClawDad review draft Ω")
    for shortcut in ["arrow_left","arrow_right","control_l"] {
      var command=target(try await inspect()); command["shortcut"] = .string(shortcut); command["intent"] = .string("navigation")
      results[shortcut] = .object(try await controls.execute("terminal.key",args:command,input:input))
    }
    fresh = try await inspect(); XCTAssertEqual(fresh["draftText"]?.string,"ClawDad review draft Ω")
    var replacement = target(fresh)
    replacement.merge(["mode":.string("replace"),"expectedText":.string("ClawDad review draft Ω"),"text":.string("Reviewed replacement")]) { _,new in new }
    results["replaced"] = .object(try await controls.execute("terminal.native.type",args:replacement,input:input)); try persist()
    fresh = try await inspect()
    var clear=target(fresh); clear.merge(["mode":.string("clear"),"expectedText":fresh["draftText"]!,"text":.string("")]) { _,new in new }
    results["cleared"] = .object(try await controls.execute("terminal.native.type",args:clear,input:input))
    fresh = try await inspect(); XCTAssertEqual(fresh["draftText"]?.string,"")
    var enter=target(fresh); enter["key"] = .string("enter"); enter["intent"] = .string("submit")
    results["emptyEnter"] = .object(try await controls.execute("terminal.key",args:enter,input:input))
    fresh = try await inspect(); XCTAssertEqual(fresh["draftText"]?.string,"")
    results["verified"] = .bool(true); try persist()
  }
}
