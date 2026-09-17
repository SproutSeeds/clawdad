import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDadMobile

final class CodexAccountRecoveryTests:XCTestCase {
  private var request:[String:AssistantValue] { ["action":.string("accounts.cancel"),"requestId":.string("same-request"),"operationId":.string("exact-switch")] }
  func testCancelReceiptMatchesOperationWithoutRequiringAccountInRequest() {
    let reply:[String:AssistantValue]=["accountReceipt":.object(["requestId":.string("same-request"),"accepted":.bool(true),"operationId":.string("exact-switch"),"accountId":.string("destination")])]
    XCTAssertTrue(CodexAccountRequestRecovery.acknowledged(request,reply:reply))
    var receipt=reply["accountReceipt"]!.object!;receipt["operationId"] = .string("different")
    XCTAssertFalse(CodexAccountRequestRecovery.acknowledged(request,reply:["accountReceipt":.object(receipt)]))
    receipt["operationId"] = .string("exact-switch");receipt["requestId"] = .string("another-request")
    XCTAssertFalse(CodexAccountRequestRecovery.acknowledged(request,reply:["accountReceipt":.object(receipt)]))
  }
  func testLostCancelCanRetrySameRequestAfterDraftPersistenceAndReopen() throws {
    let reopened=try JSONDecoder().decode([String:AssistantValue].self,from:JSONEncoder().encode(request))
    XCTAssertTrue(CodexAccountRequestRecovery.retryCancel(reopened,operation:["id":.string("exact-switch")]))
    XCTAssertEqual(reopened["requestId"],request["requestId"])
    XCTAssertFalse(CodexAccountRequestRecovery.retryCancel(reopened,operation:["id":.string("different")]))
    var other=reopened;other["action"] = .string("accounts.switch")
    XCTAssertFalse(CodexAccountRequestRecovery.retryCancel(other,operation:["id":.string("exact-switch")]))
  }
  func testAuthoritativeExactCancellationClearsLostReplyIncludingDesktopCompletion() {
    var operation:[String:AssistantValue]=["id":.string("exact-switch"),"status":.string("needs_attention"),"fenced":.bool(true)]
    func check()->Bool { CodexAccountRequestRecovery.acknowledged(request,reply:["accounts":.object(["activeOperation":.object(operation)])]) }
    XCTAssertFalse(check())
    operation["cancelRequested"] = .bool(true);XCTAssertTrue(check())
    operation["cancelRequested"]=nil;operation["status"] = .string("cancelled")
    XCTAssertFalse(check(),"Unverified cancellation stays held")
    operation["fenced"] = .bool(false);XCTAssertTrue(check())
    operation["id"] = .string("different");XCTAssertFalse(check())
  }
  func testCancellationHistoryNeverAcknowledgesPendingSwitchOrWrongAccount() {
    let reply:[String:AssistantValue]=["accounts":.object(["operations":.array([.object(["id":.string("exact-switch"),"status":.string("cancelled"),"fenced":.bool(false)])])])]
    XCTAssertTrue(CodexAccountRequestRecovery.acknowledged(request,reply:reply))
    var pending=request;pending["action"] = .string("accounts.switch");pending["accountId"] = .string("chosen")
    XCTAssertFalse(CodexAccountRequestRecovery.acknowledged(pending,reply:reply))
    let wrong:[String:AssistantValue]=["accountReceipt":.object(["requestId":.string("same-request"),"accepted":.bool(true),"accountId":.string("other")])]
    XCTAssertFalse(CodexAccountRequestRecovery.acknowledged(pending,reply:wrong))
  }
}
