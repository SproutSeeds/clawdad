import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDad

@MainActor final class MainWorkspaceReviewTests: XCTestCase {
  func testTerminalAlreadyForegroundRequiresNoActivation() async throws {
    try await MacMainWorkspaceNative.verifyTerminalActivation(ready:{true},request:{XCTFail();return false},fallback:{XCTFail()},pause:{XCTFail()})
  }
  func testRejectedActivationUsesOneFallbackAndRequiresObservedForeground() async throws {
    var foreground=false,requests=0,fallbacks=0
    try await MacMainWorkspaceNative.verifyTerminalActivation(ready:{foreground},request:{requests+=1;return false},fallback:{fallbacks+=1;foreground=true},pause:{XCTFail()})
    XCTAssertEqual(requests,1);XCTAssertEqual(fallbacks,1)
  }
  func testDelayedForegroundSurvivesOldDeadlineWithoutRepeatedActivation() async throws {
    var elapsed=0,fallbacks=0
    try await MacMainWorkspaceNative.verifyTerminalActivation(ready:{elapsed>=24},request:{true},fallback:{fallbacks+=1},pause:{elapsed+=1})
    XCTAssertEqual(elapsed,24);XCTAssertEqual(fallbacks,1)
  }
  func testLockManualInputOrProcessChangeStopsBeforeFallback() async throws {
    for code in ["mac_locked","manual_input_changed","terminal_process_changed"] {
      var observations=0
      do {
        try await MacMainWorkspaceNative.verifyTerminalActivation(ready:{observations+=1;if observations>1 {throw MacCodexInputFailure(code:code,message:"Fixture boundary")};return false},request:{true},fallback:{XCTFail()},pause:{XCTFail()})
        XCTFail()
      } catch let error as MacCodexInputFailure { XCTAssertEqual(error.code,code) }
    }
  }
  func testActivationTimeoutIsBoundedAndFallbackPermissionFailureIsPreserved() async throws {
    var waits=0,fallbacks=0
    do {
      try await MacMainWorkspaceNative.verifyTerminalActivation(ready:{false},request:{true},fallback:{fallbacks+=1},pause:{waits+=1})
      XCTFail()
    } catch let error as MacCodexInputFailure { XCTAssertEqual(error.code,"terminal_activation_unverified") }
    XCTAssertEqual(waits,30);XCTAssertEqual(fallbacks,1)
    do {
      try await MacMainWorkspaceNative.verifyTerminalActivation(ready:{false},request:{false},fallback:{throw MacCodexInputFailure(code:"automation_denied",message:"Fixture permission")},pause:{XCTFail()})
      XCTFail()
    } catch let error as MacCodexInputFailure { XCTAssertEqual(error.code,"automation_denied") }
  }
  func fixture() throws -> (MainTerminalWorkspace,MainWorkspaceFixture,URL) {
    let root=FileManager.default.temporaryDirectory.appendingPathComponent("workspace-review-"+UUID().uuidString)
    let native=MainWorkspaceFixture()
    native.live=(0..<2).map { i in MainWorkspaceLiveTab(tabId:"tab-\(i)",group:"window",tty:"tty-\(i)",owner:"agent-\(i)",
      directory:"/same-project",kind:"codex",sessionId:"00000000-0000-4000-8000-00000000000\(i)",
      conversationPath:"/rollouts/\(i)",executable:"/codex",name:"Research \(i)",position:i+1,selected:i==0,fullScreen:false,
      draft:.init(text:"Exact Ω\nline \(i)",capturedAt:Date(),transcriptOffset:10)) }
    for i in native.live.indices { native.live[i].lifetime="login-\(i)" }
    addTeardownBlock { try? FileManager.default.removeItem(at:root) }
    return (MainTerminalWorkspace(root:root,native:native),native,root)
  }
  func preview(_ store:MainTerminalWorkspace,id:String="review") async throws -> String {
    let result=try await store.control("mainworkspace.preview",args:["tabId":.string("tab-0")],requestId:id)
    return try XCTUnwrap(result["windowPreview"]?.object?["token"]?.string)
  }
  func save(_ store:MainTerminalWorkspace,token:String,id:String="save") async throws {
    _=try await store.control("mainworkspace.save",args:["tabId":.string("tab-0"),"windowToken":.string(token),"name":.string("Research"),
      "expectedRevision":.number(Double(try store.read().revision))],requestId:id)
  }
  func testReviewIsNotSaveAndSurvivesCatalogReconstructionAndWorkerRestart() async throws {
    let (store,native,root)=try fixture();let token=try await preview(store)
    XCTAssertTrue(try store.read().roster.entries.isEmpty)
    for i in native.live.indices { native.live[i].tabId="rebuilt-\(i)";native.live[i].group="new-catalog-group";native.live[i].isBusy=true }
    let restarted=MainTerminalWorkspace(root:root,native:native)
    try await save(restarted,token:token)
    let state=try restarted.read()
    XCTAssertEqual(state.roster.entries.map(\.sessionId),native.live.map(\.sessionId))
    XCTAssertEqual(state.roster.entries.map{$0.draft?.text},native.live.map{$0.draft?.text})
    XCTAssertEqual(native.creates,0);XCTAssertEqual(native.closes,0);XCTAssertEqual(native.launches,0)
  }
  func testChangedWindowDraftNameProcessAndMembershipNeverSaveAnotherLineup() async throws {
    for mutation in 0..<6 {
      let (store,native,_)=try fixture();let token=try await preview(store)
      switch mutation {
      case 0:native.live[0].draft?.text="User changed it"
      case 1:native.live[0].name="User renamed"
      case 2:native.live[0].owner="new-agent"
      case 3:native.live[0].lifetime="new-login"
      case 4:native.live.removeLast()
      default:native.live[0].sessionId="different-thread"
      }
      do { try await save(store,token:token);XCTFail("Changed capture accepted: \(mutation)") }
      catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
      XCTAssertTrue(try store.read().roster.entries.isEmpty)
      XCTAssertTrue(try store.read().snapshots?.isEmpty ?? true)
      XCTAssertEqual(native.creates,0);XCTAssertEqual(native.closes,0)
    }
  }
  func testExpiredAndReusedPreviewRequestsPreserveSnapshots() async throws {
    let (store,_,root)=try fixture();let token=try await preview(store)
    let repeated=try await preview(store);XCTAssertEqual(repeated,token)
    do { _=try await store.control("mainworkspace.preview",args:["tabId":.string("other")],requestId:"review");XCTFail() } catch {}
    var state=try store.read();state.windowPreviews?[token]?.capturedAt=Date().addingTimeInterval(-601)
    try JSONEncoder().encode(state).write(to:root.appendingPathComponent("main-workspace.json"))
    do { try await save(store,token:token);XCTFail() } catch { XCTAssertTrue(error.localizedDescription.contains("expired")) }
    XCTAssertTrue(try store.read().roster.entries.isEmpty)
  }
  func testMovedRepresentativeCannotReviewAnotherWindow() async throws {
    let (store,native,_)=try fixture()
    let chosen=try MainTerminalWorkspace.windowChoiceId(native.live)
    native.live[0].group="different-window"
    do {
      _=try await store.control("mainworkspace.preview",args:["tabId":.string("tab-0"),"windowId":.string(chosen)],requestId:"moved")
      XCTFail("A moved tab must not redirect the chosen window")
    } catch { XCTAssertTrue(error.localizedDescription.contains("after selection")) }
    XCTAssertTrue(try store.read().roster.entries.isEmpty)
    XCTAssertEqual(native.closes,0);XCTAssertEqual(native.creates,0)
  }
  func testColdUnboundTabsRemainInWindowChoiceAndAreVerifiedOnlyDuringReview() async throws {
    let (store,native,_)=try fixture();native.selectedOnlyInLightInventory=true
    let result=try await store.control("mainworkspace.windows",args:[:],requestId:"cold-window-list")
    XCTAssertEqual(try store.read().observations?.count,1)
    let choice=try XCTUnwrap(result["windows"]?.array?.first?.object)
    XCTAssertEqual(choice["count"],.number(2))
    let chosen=try XCTUnwrap(choice["id"]?.string)
    let result2=try await store.control("mainworkspace.preview",args:["tabId":.string("tab-0"),"windowId":.string(chosen)],requestId:"cold-review")
    let token=try XCTUnwrap(result2["windowPreview"]?.object?["token"]?.string)
    try await save(store,token:token)
    XCTAssertEqual(try store.read().roster.entries.map(\.sessionId),native.live.map(\.sessionId))
    XCTAssertEqual(native.creates,0);XCTAssertEqual(native.closes,0);XCTAssertEqual(native.launches,0)
  }
  func testRestoreRevisionMismatchStopsBeforeAnyNativeAction() async throws {
    let (store,native,_)=try fixture();try await save(store,token:try await preview(store))
    let state=try store.read(),id=try XCTUnwrap(state.selectedSnapshotId)
    native.live=[]
    do { _=try await store.control("mainworkspace.restore",args:["snapshotId":.string(id),"expectedSnapshotRevision":.number(99)],requestId:"stale");XCTFail() }
    catch { XCTAssertTrue(error.localizedDescription.contains("changed")) }
    XCTAssertEqual(native.begins,0);XCTAssertEqual(native.creates,0);XCTAssertEqual(native.launches,0)
    let args:[String:AssistantValue]=["snapshotId":.string(id),"expectedSnapshotRevision":.number(1)]
    _=try await store.control("mainworkspace.restore",args:args,requestId:"correct")
    _=try await store.control("mainworkspace.restore",args:args,requestId:"correct")
    XCTAssertEqual(native.creates,2);XCTAssertEqual(native.launches,2)
    XCTAssertEqual(Set(native.live.compactMap(\.sessionId)).count,2)
  }
  func testNativeUIReceiptSurvivesOriginChangeAndRejectsInvalidState() throws {
    let suite="workspace-ui-test-"+UUID().uuidString,defaults=try XCTUnwrap(UserDefaults(suiteName:suite))
    defer { defaults.removePersistentDomain(forName:suite) }
    let store=MainWorkspaceDesktopState(defaults:defaults)
    let id=UUID().uuidString
    try store.save(["selected":"exact-snapshot","name":"Research Ω","pending":["id":id,"action":"mainworkspace.restore","args":["expectedSnapshotRevision":3]]])
    let restarted=MainWorkspaceDesktopState(defaults:try XCTUnwrap(UserDefaults(suiteName:suite)))
    XCTAssertEqual((restarted.read()["pending"] as? [String:Any])?["id"] as? String,id)
    XCTAssertThrowsError(try store.save(["pending":["id":id,"action":"terminal.close","args":[:]]]))
    XCTAssertThrowsError(try store.save(["name":String(repeating:"x",count:81)]))
    XCTAssertEqual(restarted.read()["name"] as? String,"Research Ω")
  }
  func testDirectSaveAndUpdateCaptureOnceAndReconcileAfterRestart() async throws {
    let (store,native,root)=try fixture()
    native.selectedOnlyInLightInventory=true
    let windowId=try MainTerminalWorkspace.windowChoiceId(native.live)
    let args:[String:AssistantValue]=["tabId":.string("tab-0"),"windowId":.string(windowId),"name":.string("Single pass Ω"),"expectedRevision":.number(1)]
    _=try await store.control("mainworkspace.save",args:args,requestId:"direct")
    let saved=try store.read(),id=try XCTUnwrap(saved.selectedSnapshotId)
    XCTAssertEqual(native.captures,1);XCTAssertEqual(native.visits,["tab-0","tab-1"])
    XCTAssertEqual(saved.roster.entries.map{$0.draft?.text},native.live.map{$0.draft?.text})
    let restarted=MainTerminalWorkspace(root:root,native:native)
    _=try await restarted.control("mainworkspace.save",args:args,requestId:"direct")
    XCTAssertEqual(native.captures,1,"A lost acknowledgement must not repeat the capture or save")
    native.live.removeLast();native.live[0].draft?.text="Changed draft retained Ω\nline two"
    var update=args;update["snapshotId"] = .string(id);update["windowId"] = .string(try MainTerminalWorkspace.windowChoiceId(native.live));update["expectedRevision"] = .number(Double(saved.revision))
    _=try await restarted.control("mainworkspace.save",args:update,requestId:"update")
    let result=try restarted.read()
    XCTAssertEqual(native.captures,2);XCTAssertEqual(result.snapshots?.count,1)
    XCTAssertEqual(result.roster.entries.count,1);XCTAssertEqual(result.previous.first?.entries.count,2)
    XCTAssertEqual(result.roster.entries[0].draft?.text,native.live[0].draft?.text)
    XCTAssertFalse(FileManager.default.fileExists(atPath:root.appendingPathComponent("capture-progress.json").path))
    XCTAssertEqual(native.creates,0);XCTAssertEqual(native.closes,0);XCTAssertEqual(native.launches,0)
  }
  func testDirectSaveRefusesStaleOrMidCaptureWindowChangesAndPreservesPrevious() async throws {
    for mutation in 0..<4 {
      let (store,native,_)=try fixture()
      let args:[String:AssistantValue]=["tabId":.string("tab-0"),"windowId":.string(try MainTerminalWorkspace.windowChoiceId(native.live)),"name":.string("Safe"),"expectedRevision":.number(1)]
      _=try await store.control("mainworkspace.save",args:args,requestId:"initial")
      let before=try store.read();var update=args;update["snapshotId"] = .string(before.selectedSnapshotId!);update["expectedRevision"] = .number(Double(before.revision))
      if mutation==0 { native.live[0].group="moved" }
      else { native.afterCapture={
        switch mutation {
        case 1:native.live.removeLast()
        case 2:native.live[0].position=3
        default:native.live[0].tabId="rebuilt"
        }
      } }
      do { _=try await store.control("mainworkspace.save",args:update,requestId:"change");XCTFail("Changed lineup saved") }
      catch { XCTAssertTrue(error.localizedDescription.contains("changed")) }
      XCTAssertEqual(try store.read().roster,before.roster)
      XCTAssertEqual(native.captures,mutation==0 ? 1:2)
      XCTAssertEqual(native.closes,0);XCTAssertEqual(native.launches,0)
    }
  }
  func testSingleCaptureFailureDoesNotPublishAndProgressContainsOnlyCounts() async throws {
    let (store,native,root)=try fixture()
    let args:[String:AssistantValue]=["tabId":.string("tab-0"),"windowId":.string(try MainTerminalWorkspace.windowChoiceId(native.live)),"name":.string("Held name"),"expectedRevision":.number(1)]
    native.afterCapture={
      let value=try! JSONSerialization.jsonObject(with:Data(contentsOf:root.appendingPathComponent("capture-progress.json"))) as! [String:Any]
      XCTAssertEqual(Set(value.map{$0.key}),Set(["requestId","current","total"]))
      XCTAssertEqual(value["current"] as? Int,2)
    }
    native.missing.insert("/same-project")
    do { _=try await store.control("mainworkspace.save",args:args,requestId:"failure");XCTFail() } catch {}
    XCTAssertTrue(try store.read().roster.entries.isEmpty)
    XCTAssertTrue(try store.read().snapshots?.isEmpty ?? true)
    XCTAssertEqual(native.captures,1);XCTAssertEqual(native.live[0].draft?.text,"Exact Ω\nline 0")
    XCTAssertFalse(FileManager.default.fileExists(atPath:root.appendingPathComponent("capture-progress.json").path))
  }
}
