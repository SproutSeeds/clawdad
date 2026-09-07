import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteTerminalTabCloseProtocolTests: XCTestCase {
  let state = RemoteTerminalTabState(revision: 1, selectedTabId: "a", tabs: [
    .init(id: "a", title: "same", detail: "Tab 1", isSelected: true, isBusy: false)
  ])
  func testCloseAndNativeDecisionRoundTripWithExactIdentities() throws {
    let close = RemoteTerminalTabCloseMessage.request(tabId: "a", revision: 1, requestId: "close")
    let prompt = close.result(.confirmationRequired, state: state, token: "token", prompt: "End codex?", confirmLabel: "Terminate")
    let decision = RemoteTerminalTabCloseMessage.resolve(tabId: "a", token: "token", confirm: false, requestId: "cancel")
    for message in [close, prompt, decision, decision.result(.cancelled, state: state),
      close.result(.closed, state: .init(revision: 2, selectedTabId: nil, tabs: []))] {
      XCTAssertEqual(try RemoteTerminalTabCloseMessage.decode(message.encode()), message)
    }
  }
  func testCannotClaimClosureWithTargetStillInCatalog() {
    let close = RemoteTerminalTabCloseMessage.request(tabId: "a", revision: 1, requestId: "close")
    XCTAssertThrowsError(try close.result(.closed, state: state).encode())
    XCTAssertThrowsError(try close.result(.confirmationRequired, state: state, prompt: "End?", confirmLabel: "End").encode())
    XCTAssertThrowsError(try RemoteTerminalTabCloseMessage.resolve(tabId: "a", token: "", confirm: true, requestId: "resolve").encode())
  }
  func testBoundsAndOldHostCapabilityDefaults() throws {
    XCTAssertThrowsError(try RemoteTerminalTabCloseMessage.request(tabId: "a", revision: 0, requestId: "r").encode())
    let close = RemoteTerminalTabCloseMessage.request(tabId: "a", revision: 1, requestId: "close")
    XCTAssertThrowsError(try close.result(.failed, state: nil, prompt: String(repeating: "a", count: 2049), errorCode: "bad").encode())
    var capabilities = RemoteSessionCapabilities()
    capabilities.begin(requestId: "request")
    capabilities.receive(.state(screenLocked: false, supportsQuickChat: true))
    XCTAssertNil(capabilities.terminalTabClose)
    capabilities.receive(.state(screenLocked: false, supportsTerminalTabClose: true))
    capabilities.receive(.state(screenLocked: true))
    XCTAssertEqual(capabilities.terminalTabClose, true)
  }
}
