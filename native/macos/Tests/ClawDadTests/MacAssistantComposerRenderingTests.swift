import XCTest
@testable import ClawDad

final class MacAssistantComposerRenderingTests: XCTestCase {
  @MainActor func testCleanInspectionRetainsBlankEvidenceForLaterAnimation() async throws {
    let rendering = MacAssistantComposerRendering()
    let clean = "› [Pasted Content 2037 chars]    \n   \n gpt-6-astra max\n"
    let animated = "› [Pasted Content 2037 chars] ⠁  \n ⠂ \n gpt-6-astra max\n"
    _ = try await rendering.read(ticket: MacAssistantInteractionGate.shared.generation, raw: { clean })
    XCTAssertEqual(assistantObserveDraft(rendering.normalized(animated)).text, "[Pasted Content 2037 chars]")
    XCTAssertEqual(rendering.normalized("› Changed ⠁\n gpt-6-astra max\n"), "› Changed ⠁\n gpt-6-astra max\n")
    rendering.invalidate()
    XCTAssertEqual(rendering.normalized(animated), animated)
  }
  func testOnlyObservedBlankCellsCanBeRemoved() throws {
    let a = try XCTUnwrap(MacAssistantComposerFrame("› Ask Codex to do anything ⠁\n  ⠂  \n gpt-6-astra max\n"))
    XCTAssertNil(a.clean(spaces: a.spaces))
    let b = try XCTUnwrap(MacAssistantComposerFrame("› Ask Codex to do anything  \n     \n gpt-6-astra max\n"))
    XCTAssertEqual(a.signature,b.signature)
    let cleaned = try XCTUnwrap(a.clean(spaces: b.spaces))
    XCTAssertEqual(assistantEditableDraft(cleaned), "")
  }
  func testLiteralBrailleAndChangedDraftArePreserved() throws {
    let a = try XCTUnwrap(MacAssistantComposerFrame("› Literal ⠁\n gpt-6-astra max\n"))
    XCTAssertNil(a.clean(spaces: a.spaces))
    XCTAssertNotEqual(a.signature, MacAssistantComposerFrame("› Different ⠁\n gpt-6-astra max\n")?.signature)
    XCTAssertNil(assistantEditableDraft("› Literal ⠁\n gpt-6-astra max\n"))
  }
  func testHistoryAndAttachmentsArePreserved() throws {
    let a = try XCTUnwrap(MacAssistantComposerFrame("History ⠁\n› [Image #1]  ⠂\n gpt-6-astra max\n"))
    let b = try XCTUnwrap(MacAssistantComposerFrame("History ⠁\n› [Image #1]   \n gpt-6-astra max\n"))
    let clean = try XCTUnwrap(a.clean(spaces: b.spaces))
    XCTAssertTrue(clean.contains("History ⠁"))
    XCTAssertEqual(assistantObserveDraft(clean).reasonCode,"attachments_present")
  }
  func testQueueBorderAnimationCannotHideAcceptedMessage() throws {
    let prefix = "• Working (5s • esc to interrupt)\n• Queued follow-up inputs\n ↳ Exact pending message\n shift + ← edit last queued message\n"
    let a = try XCTUnwrap(MacAssistantComposerFrame(prefix + " ⠁   ⠄\n› Ask Codex to do anything\n gpt-6-astra max\n"))
    let b = try XCTUnwrap(MacAssistantComposerFrame(prefix + "       \n› Ask Codex to do anything\n gpt-6-astra max\n"))
    let clean = try XCTUnwrap(a.clean(spaces: b.spaces))
    XCTAssertEqual(MacAssistantAgentQueueSnapshot.read(clean)?.messages,["Exact pending message"])
  }
}
