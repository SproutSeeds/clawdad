import Foundation
import XCTest
@testable import ClawDad

final class MacCodexAccountStatusTests:XCTestCase {
  private let session="00000000-0000-4000-8000-000000000001"
  private func panel(email:String="a@example.test",session:String="00000000-0000-4000-8000-000000000001",directory:String="~/project") -> String {
    """
    /status
    ╭──────────────────────────────────╮
    │ >_ OpenAI Codex (v0.154.0)         │
    │ Model: gpt-6-astra (reasoning max, summaries auto) │
    │ Model provider: openai            │
    │ Directory: \(directory)            │
    │ Permissions: Read Only (never)    │
    │ Account: \(email) (Pro Lite)       │
    │ Session: \(session)                │
    ╰──────────────────────────────────╯
    › Ask Codex to do anything
    """
  }
  func testLocalStatusRetainsExactSessionDirectoryAndCurrentModelConfiguration() throws {
    let result=try XCTUnwrap(MacCodexAccountStatus.read(panel(),expectedSession:session,expectedDirectory:"/fixture/user/project",home:"/fixture/user"))
    XCTAssertEqual(result.email,"a@example.test");XCTAssertEqual(result.model,"gpt-6-astra");XCTAssertEqual(result.reasoningEffort,"max")
    XCTAssertEqual(result.permissions,"Read Only (never)");XCTAssertEqual(result.plan,"Pro Lite")
  }
  func testOnlyNewestCompletePanelCanMatchAndMissingFieldsNeverBorrowFromOlderHistory() {
    let old=panel(email:"old@example.test"),new=panel(email:"new@example.test")
    XCTAssertEqual(MacCodexAccountStatus.read(old+"\n"+new,expectedSession:session,expectedDirectory:"/fixture/user/project",home:"/fixture/user")?.email,"new@example.test")
    let incomplete=new.replacingOccurrences(of:"│ Account: new@example.test (Pro Lite)       │",with:"")
    XCTAssertNil(MacCodexAccountStatus.read(old+"\n"+incomplete,expectedSession:session,expectedDirectory:"/fixture/user/project",home:"/fixture/user"))
  }
  func testWrongThreadDirectoryProviderDuplicateFieldsAndClippedTextRemainUnavailable() {
    for text in [panel(session:"00000000-0000-4000-8000-000000000002"),panel(directory:"/fixture/other"),panel(directory:"~/project…"),
      panel().replacingOccurrences(of:"Model provider: openai",with:"Model provider: other"),
      panel().replacingOccurrences(of:"│ Session:",with:"│ Account: second@example.test (Pro) │\n│ Session:")]{
      XCTAssertNil(MacCodexAccountStatus.read(text,expectedSession:session,expectedDirectory:"/fixture/user/project",home:"/fixture/user"))
    }
  }
  func testAlreadyRecordedAuthorizedTwoAccountStatusPanelsMatchTheirExactFixture() throws {
    // Read only the synthetic fixture from the earlier approved CLI round trip.
    // No process, login, model request or Terminal window is opened here.
    let root=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ClawDad/Accounts/verification-2026-09-15/thread-continuity-1")
    guard FileManager.default.fileExists(atPath:root.path) else {throw XCTSkip("Recorded local account fixture is unavailable")}
    for (folder,email) in [("tui-status-cody-3","codyshanemitchell@gmail.com"),("tui-status-sun-1","playinthesunwithme@gmail.com"),("tui-status-cody-4","codyshanemitchell@gmail.com")] {
      let text=try String(contentsOf:root.appendingPathComponent(folder+"/rendered-terminal.txt"),encoding:.utf8)
      let status=try XCTUnwrap(MacCodexAccountStatus.read(text,expectedSession:"01a0a848-cb86-7033-ae6f-ce006f5b51bb",expectedDirectory:root.appendingPathComponent("project").path,home:FileManager.default.homeDirectoryForCurrentUser.path))
      XCTAssertEqual(status.email,email);XCTAssertEqual(status.model,"gpt-6-astra");XCTAssertEqual(status.reasoningEffort,"low");XCTAssertEqual(status.version,"0.154.0")
    }
  }
}
