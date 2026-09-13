import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDad

final class MacAssistantTerminalPromptTests: XCTestCase {
  private let directory = "/private/tmp/ClawDad fixture Ω"
  private func frame(_ selected: String = "1", directory: String? = nil) -> String {
    "Do you trust the contents of this directory?\n\n\(directory ?? self.directory)\nLocal configuration may run hooks.\n\n"
      + (selected == "1" ? "› " : "  ") + "1. Yes, continue\n"
      + (selected == "2" ? "› " : "  ") + "2. No, quit\n\nPress enter to continue\n\n"
  }
  private func prompt(_ selected: String = "1") throws -> MacAssistantTerminalPrompt {
    try XCTUnwrap(MacAssistantTerminalPrompt.read(frame(selected), codexDirectory: directory, foregroundShell: false))
  }
  func testExactTrustIdentityAndSelectionAreSeparate() throws {
    XCTAssertEqual(try prompt().id, try prompt("2").id)
    XCTAssertEqual(try prompt().kind, "codex_directory_trust")
    XCTAssertEqual(try prompt().selected, "1")
    XCTAssertNil(MacAssistantTerminalPrompt.read(frame(), codexDirectory: "/another", foregroundShell: false))
    XCTAssertNil(MacAssistantTerminalPrompt.read(frame(), codexDirectory: directory, foregroundShell: true))
    XCTAssertNil(MacAssistantTerminalPrompt.read(frame() + "› Ask Codex to do anything\ngpt-6-astra", codexDirectory: directory, foregroundShell: false))
    XCTAssertNil(MacAssistantTerminalPrompt.read(frame() + "Password: \n\n", codexDirectory: directory, foregroundShell: false))
    XCTAssertNil(MacAssistantTerminalPrompt.read(frame().replacingOccurrences(of: "› ", with: "  "), codexDirectory: directory, foregroundShell: false))
  }
  func testGenericMenuAndCanonicalConfirmation() throws {
    let menu = "Choose a color\n› 1. Blue\n  2. Red\nPress enter to select"
    XCTAssertEqual(MacAssistantTerminalPrompt.read(menu, codexDirectory: nil, foregroundShell: false)?.kind, "numbered_menu")
    XCTAssertEqual(MacAssistantTerminalPrompt.read("Continue fixture? [y/N]", codexDirectory: nil, foregroundShell: false)?.choices.map(\.id), ["yes", "no"])
    XCTAssertNil(MacAssistantTerminalPrompt.read("Enter API key [y/N]", codexDirectory: nil, foregroundShell: false))
  }
  func testCodex154TrustParagraphAndProjectHeadingFromLiveFixture() throws {
    let screen = "> You are in \(directory)\n\n  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection. Trusting the directory allows project-local config,\n  hooks, and exec policies to load.\n\n› 1. Yes, continue\n  2. No, quit\n\n  Press enter to continue\n"
    XCTAssertEqual(MacAssistantTerminalPrompt.read(screen, codexDirectory: directory, foregroundShell: false)?.kind,"codex_directory_trust")
    XCTAssertNil(MacAssistantTerminalPrompt.read(screen, codexDirectory: "/another-project", foregroundShell: false))
  }
  @MainActor func testAcceptAndDeclineDispatchOneDecisionOnlyAfterVerifiedChoice() async throws {
    for desired in ["1","2"] {
      var current = try prompt(), keys: [String] = []
      let result = try await assistantRespondToPrompt(current, choiceId: desired, read: { current }, prepare: { keys.append("prepare") }, key: { key in
        keys.append(key); if key == "down" { current = try! self.prompt("2") }; return true
      }, observeResult: { ["resultVerified": .bool(true)] }, wait: {})
      XCTAssertEqual(keys, desired == "1" ? ["prepare","enter"] : ["prepare","down","enter"])
      XCTAssertEqual(result["decisionSent"], .bool(true)); XCTAssertEqual(result["submitted"], .bool(false))
    }
  }
  @MainActor func testChangedPromptOrSelectionPreventsAllKeys() async throws {
    for changed in [try prompt("2"), nil] {
      do {
        _ = try await assistantRespondToPrompt(prompt(), choiceId: "1", read: { changed }, prepare: { XCTFail() }, key: { _ in XCTFail(); return false }, observeResult: { nil }, wait: {})
        XCTFail()
      } catch let error as MacAssistantSubmissionFailure { XCTAssertEqual(error.fields["keySent"], .bool(false)); XCTAssertEqual(error.fields["reasonCode"], .string("prompt_changed")) }
    }
  }
  @MainActor func testUncertainResultNeverRedispatches() async throws {
    var keys: [String] = []
    do {
      _ = try await assistantRespondToPrompt(prompt(), choiceId: "1", read: { try self.prompt() }, prepare: {}, key: { keys.append($0); return true }, observeResult: { nil }, wait: {})
      XCTFail()
    } catch let error as MacAssistantSubmissionFailure {
      XCTAssertEqual(error.fields["decisionSent"], .bool(true)); XCTAssertEqual(error.fields["reasonCode"], .string("delivery_uncertain"))
    }
    XCTAssertEqual(keys, ["enter"])
  }
  @MainActor func testChangedProcessAfterNavigationRecordsPartialKeys() async throws {
    var reads = 0, keys: [String] = []
    do {
      _ = try await assistantRespondToPrompt(prompt(), choiceId: "2", read: {
        reads += 1; if reads > 1 { throw MacAssistantError("Foreground process changed") }; return try self.prompt()
      }, prepare: {}, key: { keys.append($0); return true }, observeResult: { nil }, wait: {})
      XCTFail()
    } catch let error as MacAssistantSubmissionFailure { XCTAssertEqual(error.fields["keySent"], .bool(true)); XCTAssertEqual(error.fields["decisionSent"], .bool(false)) }
    XCTAssertEqual(keys, ["down"])
  }
  @MainActor func testLineConfirmationRequiresObservedLetterBeforeEnter() async throws {
    let line = try XCTUnwrap(MacAssistantTerminalPrompt.read("Proceed fixture? [y/N]", codexDirectory: nil, foregroundShell: false))
    for confirmed in [false,true] {
      var keys: [String] = []
      do {
        _ = try await assistantRespondToPrompt(line, choiceId: "yes", read: { line }, prepare: {}, key: { keys.append($0); return true }, verifyLineChoice: { XCTAssertEqual($0,"y");return confirmed }, observeResult: { ["resultVerified":.bool(true)] }, wait: {})
        XCTAssertTrue(confirmed)
      } catch { XCTAssertFalse(confirmed) }
      XCTAssertEqual(keys, confirmed ? ["y","enter"] : ["y"])
    }
  }
  func testChordsCannotAliasSubmissionOrQueue() throws {
    func chord(_ key: String, _ modifiers: [String], _ intent: String) -> Bool {
      MacAssistantTerminalKey(args:["chord":.object(["key":.string(key),"modifiers":.array(modifiers.map(AssistantValue.string))])])?.permits(intent:intent) == true
    }
    XCTAssertTrue(chord("left",["shift"],"navigation"))
    XCTAssertTrue(chord("left",["shift"],"edit_queue"))
    XCTAssertTrue(chord("a",["control"],"navigation"))
    for key in ["enter","tab","j","c","v","w","q","t"] { XCTAssertFalse(chord(key,["command"],"navigation")); XCTAssertFalse(chord(key,[],"submit")) }
    XCTAssertFalse(chord("left",["shift","shift"],"navigation"))
  }
}
