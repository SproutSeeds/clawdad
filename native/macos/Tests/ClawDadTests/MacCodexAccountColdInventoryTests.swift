import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDad

@MainActor final class MacCodexAccountColdInventoryTests:XCTestCase {
  func testColdInventoryEnumeratesExactShellTTYsWithoutFocusingOrAssigningTitleMatches() async throws {
    let native=ColdAccountTabs(),controller=MacTerminalTabController(automation:native,activity:ColdAccountActivity())
    let catalog=try await controller.catalog()
    XCTAssertEqual(catalog.tabs.count,3)
    XCTAssertNil(controller.assistantIdentifier(tty:"/dev/ttys002"))
    let shells=try await controller.assistantAccountShells()
    XCTAssertEqual(shells.map(\.tty),["/dev/ttys001","/dev/ttys002","/dev/ttys003"])
    XCTAssertNil(controller.assistantIdentifier(tty:"/dev/ttys002"),"Read-only script rows must not invent a physical binding")
    XCTAssertTrue(native.focused.isEmpty)
    native.duplicate=true
    do{_=try await controller.assistantAccountShells();XCTFail("Duplicate TTY must fail")}
    catch{XCTAssertEqual((error as? MacCodexInputFailure)?.code,"ambiguous_terminal_tty")}
    XCTAssertTrue(native.focused.isEmpty)
  }
  func testAcceptedColdCaptureUsesObservedNativeSelectionDespiteIdenticalTitles() async throws {
    let native=ColdAccountTabs(),controller=MacTerminalTabController(automation:native,activity:ColdAccountActivity())
    let before=try await controller.catalog();var ownerChecks=0
    let result=try await controller.assistantResolveAccountTTY("/dev/ttys003") {ownerChecks += 1}
    XCTAssertEqual(native.focused,["native-1","native-2"])
    XCTAssertEqual(result.selectedTabId,before.tabs[2].id)
    XCTAssertEqual(controller.assistantSnapshot(tabID:try XCTUnwrap(result.selectedTabId))?.tty,"/dev/ttys003")
    XCTAssertGreaterThanOrEqual(ownerChecks,5)
    XCTAssertEqual(native.unrelatedDrafts,["original one","original two","original three"])
    let count=native.focused.count
    _=try await controller.assistantResolveAccountTTY("/dev/ttys003") {}
    XCTAssertEqual(native.focused.count,count,"A verified warm binding needs no sweep")
  }
  func testOwnerChangeOrManualControlStopsColdCaptureBeforeAnotherFocus() async throws {
    let native=ColdAccountTabs(),controller=MacTerminalTabController(automation:native,activity:ColdAccountActivity())
    var checks=0
    do {
      _=try await controller.assistantResolveAccountTTY("/dev/ttys003") {
        checks += 1
        if checks==3 {throw MacCodexAccountHandoffEvidence.failure("agent_owner_changed")}
      }
      XCTFail("Changed owner must stop")
    }catch{XCTAssertEqual((error as? MacCodexInputFailure)?.code,"agent_owner_changed")}
    XCTAssertEqual(native.focused,["native-1"])
    XCTAssertNil(controller.assistantIdentifier(tty:"/dev/ttys003"))
    XCTAssertEqual(native.unrelatedDrafts,["original one","original two","original three"])
  }
}

@MainActor private final class ColdAccountActivity:MacTerminalAgentActivityMonitoring {
  func busyTTYs(in ttys:Set<String>)->Set<String>{[]}
}
@MainActor private final class ColdAccountTabs:MacTerminalAutomating {
  var selected=0,known:Set<Int>=[0],focused:[String]=[],duplicate=false
  let unrelatedDrafts=["original one","original two","original three"]
  var supportsReordering:Bool{false}
  func row(_ i:Int,native:Bool)->MacTerminalTabSnapshot {
    .init(windowID:native ? 100:200+i,windowIndex:1,tabIndex:i+1,customTitle:"same-project",tty:!native || known.contains(i) ? "/dev/ttys00\(i+1)":"",
      isSelectedInWindow:i==selected,visibleGroupID:native ? 1:nil,visibleTabIndex:i+1,nativeTabID:native ? "native-\(i)":nil)
  }
  func readTabs() async throws->[MacTerminalTabSnapshot]{(0..<3).map{row($0,native:true)}}
  func readShellTabs() async throws->[MacTerminalTabSnapshot]{(0..<3).map{row($0,native:false)}+(duplicate ? [row(1,native:false)]:[])}
  func focusTab(_ snapshot:MacTerminalTabSnapshot) async throws {
    let id=try XCTUnwrap(snapshot.nativeTabID),index=try XCTUnwrap(Int(id.dropFirst("native-".count)))
    focused.append(id);selected=index;known.insert(index)
  }
  func focusTab(windowID:Int,tabIndex:Int) async throws {XCTFail("Never use scripting index as a physical-tab identity");throw MacCodexAccountHandoffEvidence.failure("wrong_adapter")}
  func moveTab(windowID:Int,fromIndex:Int,toIndex:Int,expectedTTYs:[String]) async throws {XCTFail("Inventory never reorders")}
}
