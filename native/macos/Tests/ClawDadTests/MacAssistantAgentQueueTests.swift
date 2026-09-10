import XCTest
@testable import ClawDad

final class MacAssistantAgentQueueTests: XCTestCase {
  private func screen(draft: String = "", queue: [String] = [], binding: String = "tab") -> String {
    "Earlier answer\n• Working (3s • esc to interrupt)\n" +
      (queue.isEmpty ? "" : "• Queued follow-up inputs\n" + queue.map { "  ↳ \($0)" }.joined(separator: "\n") + "\n    shift + ← edit last queued message\n") +
      "\n› \(draft.isEmpty ? "Ask Codex to do anything" : draft)\n\n  \(draft.isEmpty ? "gpt-6-astra low" : "\(binding) to queue message     93% context left")\n"
  }

  func testInstalledCodexQueueRenderingRequiresObservedBinding() {
    let snapshot = MacAssistantAgentQueueSnapshot.read(screen(queue: ["Keep first", "Keep second"]))
    XCTAssertEqual(snapshot?.draft, ""); XCTAssertEqual(snapshot?.messages, ["Keep first", "Keep second"])
    XCTAssertTrue(MacAssistantAgentQueueSnapshot.read(screen(draft: "Exact message"))?.tabQueues == true)
    XCTAssertFalse(MacAssistantAgentQueueSnapshot.read(screen(draft: "Exact message", binding: "ctrl+q"))?.tabQueues == true)
  }

  func testAttachmentsModalsAndIdlePromptsAreNotEditable() {
    for text in [screen(draft: "[Image #1]"),
      screen(draft: "[Pasted Content 9999 chars]"), screen() + "Allow this command?\n1. Yes",
      "• Earlier (3s • esc to interrupt)\n› Old request\n• Finished\n› Ask Codex to do anything\n gpt-6-astra"] {
      XCTAssertNil(MacAssistantAgentQueueSnapshot.read(text), text)
    }
  }

  @MainActor func testQueuePreservesExistingEntriesPastesAndTabsExactlyOnce() async throws {
    var current = screen(queue: ["Earlier follow-up"]), actions: [String] = [], reads = 0
    try await assistantQueueVerifiedMessage("Next follow-up", read: {
      reads += 1; return MacAssistantAgentQueueSnapshot.read(current)
    }, insert: {
      actions.append("paste"); current = self.screen(draft: "Next follow-up", queue: ["Earlier follow-up"]); return true
    }, prepare: { actions.append("prepare") }, pressTab: {
      actions.append("tab"); current = self.screen(queue: ["Earlier follow-up", "Next follow-up"]); return true
    }, wait: {})
    XCTAssertEqual(actions, ["paste", "prepare", "tab"]); XCTAssertGreaterThan(reads, 3)
  }

  @MainActor func testPreviouslyAcceptedCollapsedEntriesStayOpaqueAndUnchanged() async throws {
    let prior = "Earlier authorized long request\n…"
    var current = screen(queue: [prior]), tabs = 0
    try await assistantQueueVerifiedMessage("New complete follow-up", read: {
      MacAssistantAgentQueueSnapshot.read(current)
    }, insert: {
      current = self.screen(draft: "New complete follow-up", queue: [prior]); return true
    }, prepare: {}, pressTab: {
      tabs += 1; current = self.screen(queue: [prior, "New complete follow-up"]); return true
    }, wait: {})
    XCTAssertEqual(tabs, 1)
    XCTAssertEqual(MacAssistantAgentQueueSnapshot.read(current)?.messages, [prior, "New complete follow-up"])
  }

  @MainActor func testExistingDraftIsPreservedWithoutAnyInput() async {
    do {
      try await assistantQueueVerifiedMessage("New", read: { MacAssistantAgentQueueSnapshot.read(self.screen(draft: "Cody's unsent draft")) },
        insert: { XCTFail("Preserve draft"); return false }, prepare: { XCTFail() }, pressTab: { XCTFail(); return false }, wait: {})
      XCTFail()
    } catch { XCTAssertTrue(error.localizedDescription.contains("preserved")) }
  }

  @MainActor func testRemappedTabLeavesOneInsertedDraftAndDoesNotPressTab() async {
    var draft = "", pastes = 0
    do {
      try await assistantQueueVerifiedMessage("New", read: { MacAssistantAgentQueueSnapshot.read(self.screen(draft: draft, binding: "ctrl+q")) },
        insert: { draft = "New"; pastes += 1; return true }, prepare: { XCTFail() }, pressTab: { XCTFail(); return false }, wait: {})
      XCTFail()
    } catch { XCTAssertTrue(error.localizedDescription.contains("Tab and Enter were not sent")) }
    XCTAssertEqual(draft, "New"); XCTAssertEqual(pastes, 1)
  }

  @MainActor func testChangedAgentOrDraftBeforeTabStopsDelivery() async {
    var draft = ""
    do {
      try await assistantQueueVerifiedMessage("New", read: { MacAssistantAgentQueueSnapshot.read(self.screen(draft: draft)) },
        insert: { draft = "New"; return true }, prepare: { draft = "Cody's new draft" },
        pressTab: { XCTFail("Preserve changed input"); return false }, wait: {})
      XCTFail()
    } catch { XCTAssertTrue(error.localizedDescription.contains("changed before Tab")) }
    XCTAssertEqual(draft, "Cody's new draft")
  }

  @MainActor func testAnEmptyComposerIsNotProofOfQueueAcceptanceAndNeverRetriesTab() async {
    var draft = "", tabs = 0
    do {
      try await assistantQueueVerifiedMessage("New", read: { MacAssistantAgentQueueSnapshot.read(self.screen(draft: draft)) },
        insert: { draft = "New"; return true }, prepare: {}, pressTab: { draft = ""; tabs += 1; return true }, wait: {})
      XCTFail()
    } catch { XCTAssertTrue(error.localizedDescription.contains("Delivery is uncertain")) }
    XCTAssertEqual(tabs, 1)
  }

  @MainActor func testDelayedQueueRenderingDoesNotRepeatInput() async throws {
    var draft = "", tabs = 0, queueReads = 0
    try await assistantQueueVerifiedMessage("New", read: {
      if tabs > 0 { queueReads += 1 }
      return MacAssistantAgentQueueSnapshot.read(self.screen(draft: draft, queue: queueReads > 3 ? ["New"] : []))
    }, insert: { draft = "New"; return true }, prepare: {}, pressTab: { tabs += 1; draft = ""; return true }, wait: {})
    XCTAssertEqual(tabs, 1)
  }

  @MainActor func testInitialRedrawSettlesBeforeAnyInsertion() async throws {
    var reads = 0, draft = "", queued = false, pastes = 0
    try await assistantQueueVerifiedMessage("New", read: {
      reads += 1
      if reads < 4 { XCTAssertEqual(pastes, 0); return nil }
      return MacAssistantAgentQueueSnapshot.read(self.screen(draft: draft, queue: queued ? ["New"] : []))
    }, insert: { pastes += 1; draft = "New"; return true }, prepare: {},
      pressTab: { queued = true; draft = ""; return true }, wait: {})
    XCTAssertEqual(pastes, 1)
  }
}
