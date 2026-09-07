import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDad

@MainActor final class MacTerminalTabCloseTests: XCTestCase {
  func testDuplicateNamesCloseExactTabOnceAndFollowNativeSelection() async throws {
    let fixture = CloseFixture()
    let request = fixture.request("b")
    let reply = await fixture.controller.handle(request)
    XCTAssertEqual(reply.outcome, .closed)
    XCTAssertEqual(reply.state?.tabs.map(\.id), ["a", "c"])
    XCTAssertEqual(reply.state?.selectedTabId, "a")
    let duplicate = await fixture.controller.handle(request)
    XCTAssertEqual(duplicate, reply)
    XCTAssertEqual(fixture.closed, ["b"])
    let conflict = await fixture.controller.handle(.request(tabId: "a", revision: 2, requestId: request.requestId))
    XCTAssertEqual(conflict.errorCode, "request_conflict")
    XCTAssertEqual(fixture.closed, ["b"])
    _ = try reply.encode()
  }
  func testStaleLayoutAndUnconfirmedClosureKeepRows() async {
    let fixture = CloseFixture()
    let stale = fixture.request("a")
    fixture.revision += 1
    let rejected = await fixture.controller.handle(stale)
    XCTAssertEqual(rejected.errorCode, "stale_catalog")
    XCTAssertTrue(fixture.closed.isEmpty)
    fixture.pretendClosed = true
    let ambiguous = await fixture.controller.handle(fixture.request("b"))
    XCTAssertEqual(ambiguous.errorCode, "close_unconfirmed")
    XCTAssertEqual(ambiguous.state?.tabs.count, 3)
  }
  func testNativeWarningMustBeConfirmedAndWrongTokensCannotCancelIt() async throws {
    let fixture = CloseFixture(); fixture.warn = true
    let original = fixture.request("b")
    let warning = await fixture.controller.handle(original)
    XCTAssertEqual(warning.outcome, .confirmationRequired)
    XCTAssertTrue(fixture.closed.isEmpty)
    let bad = await fixture.controller.handle(.resolve(tabId: "a", token: "token", confirm: true, requestId: "wrong"))
    XCTAssertEqual(bad.errorCode, "confirmation_expired")
    XCTAssertTrue(fixture.controller.hasPendingConfirmation)
    XCTAssertEqual(fixture.cancellations, 0)
    let confirm = RemoteTerminalTabCloseMessage.resolve(tabId: "b", token: "token", confirm: true, requestId: "confirm")
    let closed = await fixture.controller.handle(confirm)
    XCTAssertEqual(closed.outcome, .closed)
    _ = await fixture.controller.handle(confirm)
    _ = await fixture.controller.handle(original)
    XCTAssertEqual(fixture.closed, ["b"])
    _ = try warning.encode(); _ = try closed.encode()
  }
  func testCancellationAndDisconnectKeepProcessAndConsumeWarning() async {
    for disconnect in [false, true] {
      let fixture = CloseFixture(); fixture.warn = true
      let original = fixture.request("a")
      _ = await fixture.controller.handle(original)
      if disconnect { await fixture.controller.cancel() }
      else {
        let kept = await fixture.controller.handle(.resolve(tabId: "a", token: "token", confirm: false, requestId: "cancel"))
        XCTAssertEqual(kept.outcome, .cancelled)
      }
      let stale = await fixture.controller.handle(.resolve(tabId: "a", token: "token", confirm: true, requestId: "late"))
      XCTAssertEqual(stale.errorCode, "confirmation_expired")
      XCTAssertEqual(fixture.ids, ["a", "b", "c"])
      XCTAssertTrue(fixture.closed.isEmpty)
      XCTAssertFalse(fixture.controller.hasPendingConfirmation)
    }
  }
  func testLastTabReturnsVerifiedEmptyCatalog() async {
    let fixture = CloseFixture(); fixture.ids = ["a"]
    let reply = await fixture.controller.handle(fixture.request("a"))
    XCTAssertEqual(reply.outcome, .closed)
    XCTAssertEqual(reply.state?.tabs, [])
    XCTAssertNil(reply.state?.selectedTabId)
  }
}

@MainActor private final class CloseFixture: MacTerminalAutomating {
  var ids = ["a", "b", "c"]
  var selected = "b"
  var revision = 1
  var warn = false
  var pretendClosed = false
  var closed: [String] = []
  var cancellations = 0
  var warned: String?
  lazy var controller = MacTerminalTabCloseController(automation: self, catalog: { [unowned self] in self.state },
    snapshot: { [unowned self] id in self.ids.contains(id) ? self.snapshot(id) : nil })
  var state: RemoteTerminalTabState {
    .init(revision: revision, selectedTabId: ids.contains(selected) ? selected : ids.first,
      tabs: ids.enumerated().map { offset, id in .init(id: id, title: "same-directory", detail: "Tab \(offset + 1)",
        isSelected: id == (ids.contains(selected) ? selected : ids.first), isBusy: false) })
  }
  func request(_ id: String) -> RemoteTerminalTabCloseMessage { .request(tabId: id, revision: revision, requestId: UUID().uuidString) }
  func snapshot(_ id: String) -> MacTerminalTabSnapshot {
    .init(windowID: 1, windowIndex: 1, tabIndex: 1, customTitle: "same-directory", tty: id, isSelectedInWindow: id == selected, nativeTabID: id)
  }
  func closeTab(_ snapshot: MacTerminalTabSnapshot) async throws -> MacTerminalNativeCloseOutcome {
    let id = snapshot.nativeTabID!
    if warn { warned = id; return .confirmation(token: "token", prompt: "End codex?", button: "Terminate") }
    remove(id); return .closed
  }
  func resolveTabClose(token: String, confirm: Bool) async throws -> MacTerminalNativeCloseOutcome {
    if confirm, let warned { remove(warned) }
    warned = nil
    return confirm ? .closed : .cancelled
  }
  func cancelTabClose() async { cancellations += 1; warned = nil }
  func remove(_ id: String) { if !pretendClosed { ids.removeAll { $0 == id }; revision += 1 }; closed.append(id) }
  func readTabs() async throws -> [MacTerminalTabSnapshot] { ids.map(snapshot) }
  func focusTab(windowID: Int, tabIndex: Int) async throws {}
}
