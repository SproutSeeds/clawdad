import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDad

final class MacAssistantNativeParityTests: XCTestCase {
  func testForegroundIdentityUsesOwningProcessAndIgnoresInheritedHelpers() throws {
    let rows = "101 101 102 Ss Tue Sep 8 10:31:44 2026 login\n102 102 102 S+ Tue Sep 8 10:31:44 2026 -zsh\n103 103 102 S Tue Sep 8 10:31:45 2026 /some/helper"
    let first = try MacAssistantForeground.parse(rows, tty: "/dev/ttys012")
    XCTAssertEqual(first.shell, "zsh")
    XCTAssertEqual(first,try MacAssistantForeground.parse(rows.replacingOccurrences(of:"2026 -zsh",with:"2026     -zsh").replacingOccurrences(of:"S+",with:"R+"),tty:"/dev/ttys012"))
    XCTAssertEqual(first, try MacAssistantForeground.parse(rows + "\n104 104 102 S Tue Sep 8 10:31:45 2026 /another/helper", tty: "/dev/ttys012"))
    XCTAssertNotEqual(first.identity, try MacAssistantForeground.parse(rows.replacingOccurrences(of: "10:31:44", with: "11:31:44"), tty: "/dev/ttys012").identity)
    XCTAssertNotEqual(first.identity, try MacAssistantForeground.parse(rows, tty: "/dev/ttys013").identity)
    XCTAssertNil(try MacAssistantForeground.parse(rows.replacingOccurrences(of: "-zsh", with: "/bin/python"), tty: "/dev/ttys012").shell)
    XCTAssertNil(try MacAssistantForeground.parse(rows + "\n105 102 102 S+ Tue Sep 8 10:31:46 2026 /bin/python", tty: "/dev/ttys012").shell)
  }

  func testShellReadbackPreservesWhitespaceAndWrapsWithoutTrimmingDrafts() throws {
    let empty = try XCTUnwrap(MacAssistantShellDraft.read("old output\ncody@Mac test % \n\n"))
    XCTAssertEqual(empty.text, "")
    XCTAssertEqual(MacAssistantShellDraft.read("cody@Mac test %   preserve  spaces  \n", prompt: empty.prompt)?.text, "  preserve  spaces  ")
    XCTAssertEqual(MacAssistantShellDraft.read("cody@Mac test % first part\nsecond part\n", prompt: empty.prompt)?.text, "first partsecond part")
    XCTAssertNil(MacAssistantShellDraft.read("Password: "))
    XCTAssertNil(MacAssistantShellDraft.read("Password> "))
    XCTAssertEqual(MacAssistantShellDraft.read("BackToTheFort> \n\n")?.text,"")
    XCTAssertNil(MacAssistantShellDraft.read("› Ask Codex to do anything\ngpt-6-astra"))
    XCTAssertNil(MacAssistantShellDraft.read("Another prompt $ draft", prompt: empty.prompt))
  }

  func testShellErasedCellsUseCursorAndPreserveUnknownWhitespaceDrafts() {
    let prompt="BackToTheFort> "
    XCTAssertEqual(assistantShellScreen(prompt+"     \n\n",cursor:prompt.utf16.count,allowEmptyTrim:false),prompt+"     \n\n")
    XCTAssertEqual(assistantShellScreen(prompt+"     \n\n",cursor:prompt.utf16.count,allowEmptyTrim:true),prompt)
    XCTAssertEqual(assistantShellScreen(prompt+"draft  \n\n",cursor:(prompt+"draft  ").utf16.count,allowEmptyTrim:false),prompt+"draft  ")
    XCTAssertEqual(assistantShellScreen(prompt+"Ω     \n",cursor:(prompt+"Ω").utf16.count,allowEmptyTrim:false),prompt+"Ω")
    XCTAssertEqual(assistantShellScreen(prompt+"draft",cursor:prompt.utf16.count,allowEmptyTrim:true),prompt+"draft")
  }

  func testEverySpecialKeyHasAnExplicitIntentAndTabCreationIsSeparate() throws {
    let intents: [RemoteShortcut: String] = [.controlC:"interrupt",.controlJ:"newline",.escape:"dismiss",.tab:"completion",.arrowUp:"navigation",.arrowDown:"navigation",.arrowLeft:"navigation",.arrowRight:"navigation",.controlL:"navigation",.commandTab:"switch_app"]
    XCTAssertEqual(Set(intents.keys).union([.commandT]), Set(RemoteShortcut.allCases))
    for (shortcut,intent) in intents {
      let command = try XCTUnwrap(MacAssistantTerminalKey(args:["shortcut":.string(shortcut.rawValue)]))
      XCTAssertTrue(command.permits(intent: intent))
      XCTAssertFalse(command.permits(intent: "unknown"))
    }
    XCTAssertNil(MacAssistantTerminalKey(args:["shortcut":.string("command_t")]))
    XCTAssertNil(MacAssistantTerminalKey(args:["key":.string("enter"),"shortcut":.string("control_c")]))
    XCTAssertTrue(try XCTUnwrap(MacAssistantTerminalKey(args:["key":.string("enter")])).permits(intent:"submit"))
    XCTAssertFalse(try XCTUnwrap(MacAssistantTerminalKey(args:["key":.string("enter")])).permits(intent:"edit"))
  }

  func testCreationRequiresExactlyOneNewTabInTheIntendedPhysicalWindow() throws {
    func row(_ id: String, _ group: String) -> RemoteTerminalTabDescriptor {
      .init(id:id,title:"same",detail:"same",isSelected:false,isBusy:false,windowGroupId:group)
    }
    let original = [row("a","one"),row("b","one"),row("c","two")]
    let before = RemoteTerminalTabState(revision:1,selectedTabId:"a",tabs:original)
    func after(_ rows: [RemoteTerminalTabDescriptor], selected: String = "new") -> RemoteTerminalTabState {
      .init(revision:2,selectedTabId:selected,tabs:rows)
    }
    let new = row("new","one")
    XCTAssertEqual(try assistantCreatedTerminalTab(before:before,after:after([original[0],new,original[1],original[2]]),anchorId:"a").id,"new")
    for candidate in [after(original),after(original+[row("new","two")]),after(original+[row("new","three")]),
      after([original[1],original[0],new,original[2]]),after(original+[new,row("other","one")]),after(original+[new],selected:"a")] {
      XCTAssertThrowsError(try assistantCreatedTerminalTab(before:before,after:candidate,anchorId:"a"))
    }
  }

  @MainActor func testQueueExistingDraftPressesTabOnceAndNeverPastes() async throws {
    var snapshot = MacAssistantAgentQueueSnapshot(draft:"Reviewed message",messages:["Earlier"],tabQueues:true)
    var pasted = 0, pressed = 0, prepared = 0
    try await assistantQueueVerifiedMessage("Reviewed message", useExistingDraft:true,
      read:{snapshot}, insert:{pasted += 1;return true}, prepare:{prepared += 1}, pressTab:{
        pressed += 1; snapshot = .init(draft:"",messages:["Earlier","Reviewed message"],tabQueues:false);return true
      },wait:{})
    XCTAssertEqual(pasted,0); XCTAssertEqual(pressed,1); XCTAssertEqual(prepared,1)
    do {
      try await assistantQueueVerifiedMessage("changed",useExistingDraft:true,read:{snapshot},insert:{pasted += 1;return true},prepare:{},pressTab:{pressed += 1;return true},wait:{})
      XCTFail("A changed existing draft must remain untouched")
    } catch {}
    XCTAssertEqual(pasted,0); XCTAssertEqual(pressed,1)
  }

  func testFilesPaginationRejectsOverflowAndFractionalValuesWithoutTrapping() throws {
    XCTAssertEqual(try assistantFilesQueryValue(.number(262144)),"262144")
    XCTAssertEqual(try assistantFilesQueryValue(.bool(true)),"true")
    XCTAssertEqual(try assistantFilesQueryValue(.string("A & B")),"A & B")
    for value in [Double.greatestFiniteMagnitude, Double.infinity, .nan, 0.5] {
      XCTAssertThrowsError(try assistantFilesQueryValue(.number(value)))
    }
  }

  func testTerminalPointerCoordinatesRemainInsideTheInspectedTextArea() throws {
    let rect = CGRect(x:-600,y:100,width:500,height:300)
    for x in [0.0,0.5,1.0] { for y in [0.0,0.5,1.0] {
      XCTAssertTrue(rect.contains(try assistantTerminalPoint(x:x,y:y,rect:rect)))
    } }
    XCTAssertThrowsError(try assistantTerminalPoint(x:1.1,y:0.5,rect:rect))
    XCTAssertThrowsError(try assistantTerminalPoint(x:0.5,y:.nan,rect:rect))
    XCTAssertThrowsError(try assistantTerminalPoint(x:0.5,y:0.5,rect:.zero))
  }
}
