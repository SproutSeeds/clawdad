import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDadMobile

final class AppAccountPresentationTests: XCTestCase {
  func testObservedIdentityAndDisconnectOverrideSavedSelection() {
    var state: [String: AssistantValue] = ["activeAccountId": .string("saved"), "accounts": .array([
      .object(["id": .string("saved"), "email": .string("saved@example.test")])
    ]), "current": .object(["status": .string("current"), "email": .string("observed@example.test")])]
    XCTAssertEqual(AppAccountPresentation.activeTitle(state, disconnected: false), "Active · observed@example.test")
    XCTAssertEqual(AppAccountPresentation.activeTitle(state, disconnected: true), "Active account unavailable")
    state["current"] = .object(["status": .string("unavailable")])
    XCTAssertEqual(AppAccountPresentation.activeTitle(state, disconnected: false), "Active account unavailable")
    state["current"] = .object(["status": .string("current"), "email": .string("observed@example.test")])
    XCTAssertEqual(AppAccountPresentation.activeTitle(state, disconnected: false), "Active · observed@example.test")
  }
  func testWaitingRecoveryAndCompletionHaveDistinctPresentation() {
    var operation: [String: AssistantValue] = ["fenced": .bool(true), "status": .string("waiting"), "reasonCode": .string("app_process_reader_unavailable")]
    XCTAssertEqual(AppAccountPresentation.activationTitle(operation, isActive: false), "Waiting for Mac…")
    operation["reasonCode"] = .string("accepted_app_work")
    XCTAssertEqual(AppAccountPresentation.activationTitle(operation, isActive: false), "Waiting for app work…")
    operation["reasonCode"] = .string("shared_inventory_changed")
    XCTAssertEqual(AppAccountPresentation.activationTitle(operation, isActive: false), "Checking app state…")
    operation["status"] = .string("needs_attention")
    XCTAssertEqual(AppAccountPresentation.activationTitle(operation, isActive: false), "Needs attention")
    operation["fenced"] = .bool(false); operation["reason"] = .string("Completed")
    XCTAssertEqual(AppAccountPresentation.activationTitle(operation, isActive: true), "Active for ClawDad")
    XCTAssertNil(AppAccountPresentation.status(["activeOperation": .object(operation)]))
    XCTAssertEqual(AppAccountPresentation.status(["requiresActivation": .bool(true)]), "Activate a saved account to start ClawDad work.")
  }
}
