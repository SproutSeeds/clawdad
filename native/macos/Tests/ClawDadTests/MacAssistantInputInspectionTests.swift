import XCTest
@testable import ClawDad

final class MacAssistantInputInspectionTests: XCTestCase {
  func testFreshNewTabAndInspectedTokensAreSingleUseAndExpire() throws {
    var date = Date(timeIntervalSince1970: 1_000)
    var store = MacAssistantInputInspections<String>(now: { date })
    store.insert("old", token: "old", expires: date.addingTimeInterval(45))
    store.invalidate("New tab is being created.")
    store.insert("native-owner", token: "new-tab-result", expires: date.addingTimeInterval(45))
    date = date.addingTimeInterval(15)
    XCTAssertEqual(try store.consume("new-tab-result"), "native-owner")
    XCTAssertThrowsError(try store.consume("new-tab-result")) { XCTAssertTrue($0.localizedDescription.contains("already consumed")) }
    store.insert("same-owner", token: "fresh-inspect", expires: date.addingTimeInterval(45))
    date = date.addingTimeInterval(46)
    XCTAssertThrowsError(try store.consume("fresh-inspect")) { XCTAssertTrue($0.localizedDescription.contains("expired")) }
    var restarted = MacAssistantInputInspections<String>()
    XCTAssertThrowsError(try restarted.consume("new-tab-result"))
  }

  func testObservedNoOpFocusPreservesFreshTokenButDifferentInputDoesNot() throws {
    var store = MacAssistantInputInspections<String>()
    store.insert("owner", token: "inspect", expires: Date().addingTimeInterval(45))
    let unchanged = assistantSameFocusedInput(before: "window/tab/tty", after: "window/tab/tty", generationUnchanged: true)
    XCTAssertTrue(unchanged)
    if !unchanged { store.invalidate("Focus changed.") }
    XCTAssertEqual(try store.consume("inspect"), "owner")
    for result in [assistantSameFocusedInput(before: nil, after: nil, generationUnchanged: true),
      assistantSameFocusedInput(before: "old", after: "new", generationUnchanged: true),
      assistantSameFocusedInput(before: "same", after: "same", generationUnchanged: false)] { XCTAssertFalse(result) }
    store.insert("owner", token: "other", expires: Date().addingTimeInterval(45))
    store.invalidate("The separate terminal.focus action invalidated this input inspection.")
    XCTAssertThrowsError(try store.consume("other")) { XCTAssertTrue($0.localizedDescription.contains("terminal.focus")) }
  }

  func testCollapsedProvenanceRequiresUnchangedExactInputAndWorker() throws {
    let text = String(repeating: "🦞 café é λ ", count: 150)
    let screen = "• Working (1s • esc to interrupt)\n\n› [Pasted Content \(text.unicodeScalars.count) chars]\n\n  tab to queue message\n"
    let now = Date(timeIntervalSince1970: 1_000)
    let context = MacAssistantDraftProvenance.Context(input: "input", process: "process", session: "session", foreground: "foreground", generation: 4)
    var provenance = MacAssistantDraftProvenance()
    XCTAssertNil(provenance.text(context: context, screen: screen, now: now))
    provenance.remember(text, context: context, now: now)
    XCTAssertEqual(provenance.text(context: context, screen: screen, now: now.addingTimeInterval(15)), text)
    for changed in [
      MacAssistantDraftProvenance.Context(input: "another", process: "process", session: "session", foreground: "foreground", generation: 4),
      .init(input: "input", process: "restarted", session: "session", foreground: "foreground", generation: 4),
      .init(input: "input", process: "process", session: "other", foreground: "foreground", generation: 4),
      .init(input: "input", process: "process", session: "session", foreground: "new", generation: 4),
      .init(input: "input", process: "process", session: "session", foreground: "foreground", generation: 5)
    ] { XCTAssertNil(provenance.text(context: changed, screen: screen, now: now)) }
    XCTAssertNil(provenance.text(context: context, screen: screen, now: now.addingTimeInterval(301)))
    XCTAssertNil(provenance.text(context: context, screen: screen.replacingOccurrences(of: "chars]", with: "chars] changed"), now: now))
    XCTAssertNil(MacAssistantAgentQueueSnapshot.read(screen))
    XCTAssertEqual(MacAssistantAgentQueueSnapshot.read(screen, knownCollapsedDraft: text)?.draft, text)
    provenance.invalidate()
    XCTAssertNil(provenance.text(context: context, screen: screen, now: now))
    XCTAssertNil(MacAssistantDraftProvenance().text(context: context, screen: screen, now: now))
  }

  @MainActor func testCollapsedExistingQueueSendsOneTabWithoutRepasteAndUncertainReceiptIsExplicit() async throws {
    let text = String(repeating: "authorized padding ", count: 80)
    var state = MacAssistantAgentQueueSnapshot(draft: text, messages: ["Earlier"], tabQueues: true)
    var pastes = 0, presses = 0
    try await assistantQueueVerifiedMessage(text, useExistingDraft: true, read: { state }, insert: { pastes += 1; return true }, prepare: {}, pressTab: {
      presses += 1; state = .init(draft: "", messages: ["Earlier", text], tabQueues: false); return true
    }, wait: {})
    XCTAssertEqual(pastes, 0); XCTAssertEqual(presses, 1)
    state = .init(draft: text, messages: ["Earlier"], tabQueues: true)
    do {
      try await assistantQueueVerifiedMessage(text, useExistingDraft: true, read: { state }, insert: { pastes += 1; return true }, prepare: {}, pressTab: {
        presses += 1; state = .init(draft: "", messages: ["Earlier", "authorized padding…"], tabQueues: false); return true
      }, wait: {})
      XCTFail("A clipped queue must await exact turn reconciliation")
    } catch let failure as MacAssistantSubmissionFailure {
      XCTAssertEqual(failure.fields["tabSent"]?.bool, true)
      XCTAssertEqual(failure.fields["queueAccepted"]?.bool, false)
    }
    XCTAssertEqual(pastes, 0); XCTAssertEqual(presses, 2)
  }
}
