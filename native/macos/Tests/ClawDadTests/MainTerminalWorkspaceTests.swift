import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDad

@MainActor final class MainWorkspaceFixture: MainWorkspaceNative {
  var live:[MainWorkspaceLiveTab]=[]
  var creates=0,launches=0,recovers=0,finishes=0
  var missing=Set<String>(),crashCreation=false,crashLaunch=false,unmarked=false
  var slowInventory=false
  var refreshedSelection=false
  var begins=0,ends=0,incompleteVisibility=false
  func beginRestore(entries:[MainWorkspaceEntry]) async throws { begins += 1;if incompleteVisibility { throw MacAssistantError("Hidden native controls; no creation is safe") } }
  func endRestore() async { ends += 1 }
  func inventory(captureDrafts:Bool) async throws -> [MainWorkspaceLiveTab] {
    if slowInventory { try await Task.sleep(for:.milliseconds(50)) }
    return refreshedSelection ? live.map { var tab=$0;tab.selected=false;return tab }:live
  }
  func checkDirectory(_ entry:MainWorkspaceEntry) throws { if missing.contains(entry.directory) { throw MacAssistantError("Waiting for exact directory") } }
  func create(marker:String,anchor:MainWorkspaceLiveTab?) async throws -> MainWorkspaceLiveTab {
    creates += 1
    let tab=MainWorkspaceLiveTab(tabId:"created-\(creates)",group:anchor?.group ?? "main-new",tty:"tty-\(creates)",owner:"shell-\(creates)",directory:"/home",kind:"shell",name:unmarked ? "unknown":marker,position:live.filter{$0.group==(anchor?.group ?? "main-new")}.count+1,selected:true,fullScreen:false)
    live.append(tab)
    if crashCreation { crashCreation=false;throw MacAssistantError("Creation acknowledgement lost") }
    return tab
  }
  func configure(_ tab:MainWorkspaceLiveTab,entry:MainWorkspaceEntry,requestId:String,allowLaunch:Bool) async throws -> MainWorkspaceLiveTab {
    guard allowLaunch else { throw MacAssistantError("Launch uncertain; preserved") }
    launches += 1;var result=tab;result.kind=entry.kind;result.directory=entry.directory;result.sessionId=entry.sessionId
    result.owner="agent-\(creates)";live[live.firstIndex{$0.tabId==tab.tabId}!]=result
    if crashLaunch { crashLaunch=false;throw MacAssistantError("Launch acknowledgement lost") }
    return result
  }
  func recoverDraft(_ tab:MainWorkspaceLiveTab,entry:MainWorkspaceEntry) async throws { recovers += 1 }
  func finish(_ ordered:[MainWorkspaceLiveTab],selectedId:String?,fullScreen:Bool) async throws {
    finishes += 1
    for (index,tab) in ordered.enumerated() { let i=live.firstIndex{$0.tabId==tab.tabId}!;live[i].position=index+1;live[i].selected=tab.tabId==selectedId;live[i].fullScreen=fullScreen }
  }
}

@MainActor final class MainTerminalWorkspaceTests:XCTestCase {
  func fixture() throws -> (MainTerminalWorkspace,MainWorkspaceFixture,URL) {
    let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let native=MainWorkspaceFixture()
    native.live=(0..<3).map{i in MainWorkspaceLiveTab(tabId:"tab-\(i)",group:"original",tty:"tty-original-\(i)",owner:"owner-\(i)",directory:i==2 ? "/other":"/same",kind:"codex",sessionId:"session-\(i)",conversationPath:"/session/\(i)",executable:"/codex",name:"Project \(i)",position:i+1,selected:i==1,fullScreen:true,draft:.init(text:"draft \(i)",capturedAt:Date(),transcriptOffset:10))}
    addTeardownBlock { try? FileManager.default.removeItem(at:root) }
    return (MainTerminalWorkspace(root:root,native:native),native,root)
  }
  func save(_ store:MainTerminalWorkspace) async throws { _=try await store.control("mainworkspace.save",args:["tabId":.string("tab-1"),"expectedRevision":.number(Double(try store.read().revision))],requestId:"save") }
  func restore(_ store:MainTerminalWorkspace,_ id:String) async throws -> [String:AssistantValue] { try await store.control("mainworkspace.restore",args:[:],requestId:id) }
  func testOneWindowDoubleTapConcurrentRequestsAndExactSameDirectoryConversations() async throws {
    let (store,native,_)=try fixture();try await save(store);native.live=[]
    async let a=restore(store,"restore-a");async let b=restore(store,"restore-b");_=try await (a,b)
    _=try await restore(store,"restore-a");_=try await restore(store,"restore-c")
    XCTAssertEqual(native.creates,3);XCTAssertEqual(native.launches,3);XCTAssertEqual(Set(native.live.map(\.group)).count,1)
    XCTAssertEqual(Set(native.live.compactMap(\.sessionId)).count,3)
    XCTAssertEqual(native.live.sorted{$0.position<$1.position}.compactMap(\.sessionId),["session-0","session-1","session-2"])
    XCTAssertEqual(native.live.first{$0.selected}?.sessionId,"session-1");XCTAssertTrue(native.live.allSatisfy(\.fullScreen))
  }
  func testPartialWorkspaceKeepsLiveDraftAndUnrelatedWindow() async throws {
    let (store,native,_)=try fixture();try await save(store)
    native.live.removeLast();native.live[0].draft?.text="Cody edited this"
    var unrelated=native.live[0];unrelated.tabId="unrelated";unrelated.owner="elsewhere";unrelated.sessionId="different";unrelated.group="unrelated-window";native.live.append(unrelated)
    _=try await restore(store,"partial")
    XCTAssertEqual(native.creates,1);XCTAssertEqual(native.live.first{$0.tabId=="tab-0"}?.draft?.text,"Cody edited this")
    XCTAssertEqual(native.live.first{$0.tabId=="unrelated"},unrelated)
  }
  func testIncompleteNativeVisibilityNeverMeansMissingTabsAndEndsPresentationScope() async throws {
    let (store,native,_)=try fixture();try await save(store);native.incompleteVisibility=true
    _=try await restore(store,"hidden-fullscreen")
    XCTAssertEqual(try store.read().status,"needs_attention");XCTAssertEqual(native.creates,0)
    XCTAssertEqual(native.begins,1);XCTAssertEqual(native.ends,1)
    native.incompleteVisibility=false
    _=try await restore(store,"visible-retry")
    XCTAssertEqual(try store.read().status,"restored");XCTAssertEqual(native.creates,0)
    XCTAssertEqual(native.begins,2);XCTAssertEqual(native.ends,2)
  }
  func testFullScreenScriptingAliasesAgreeBeforeDeduplication() throws {
    XCTAssertEqual(try MacMainWorkspaceNative.uniqueTitles([("/dev/ttys001","Main"),("/dev/ttys001","Main"),("/dev/ttys002","Other")]),["/dev/ttys001":"Main","/dev/ttys002":"Other"])
    XCTAssertThrowsError(try MacMainWorkspaceNative.uniqueTitles([("/dev/ttys001","Main"),("/dev/ttys001","Changed")]))
  }
  func testAutomaticSnapshotsKeepDraftHistoryInsteadOfArchivingTransientControls() async throws {
    let (store,native,_)=try fixture();try await save(store);let before=try store.read()
    native.live[0].tabId="refreshed-control";native.live[0].selected=true;native.live[0].name="Working animation"
    native.live[0].draft?.capturedAt=Date().addingTimeInterval(30)
    await store.automaticSnapshot()
    let after=try store.read()
    XCTAssertEqual(after.previous.count,before.previous.count)
    XCTAssertEqual(after.roster.entries[0].binding?.tabId,"refreshed-control")
    let (changed,other,_)=try fixture();try await save(changed);other.live[0].draft?.text="New recoverable words"
    await changed.automaticSnapshot()
    XCTAssertEqual(try changed.read().previous.count,1)
    XCTAssertEqual(try changed.read().previous[0].entries[0].draft?.text,"draft 0")
  }
  func testNativeIdentityRebindKeepsExactOwnerAcrossTitleAndPositionChanges() async throws {
    let (store,native,_)=try fixture();try await save(store)
    let entry=try store.read().roster.entries[0],original=native.live[0]
    var rebound=original;rebound.tabId="new-AX-control";rebound.name="Renamed";rebound.position=3;rebound.selected=false
    XCTAssertEqual(try MacMainWorkspaceNative.verifiedIdentity(original,entry:entry,live:[rebound]).tabId,"new-AX-control")
    var different=rebound;different.owner="another-process"
    XCTAssertThrowsError(try MacMainWorkspaceNative.verifiedIdentity(original,entry:entry,live:[different]))
    different=rebound;different.sessionId="another-conversation"
    XCTAssertThrowsError(try MacMainWorkspaceNative.verifiedIdentity(original,entry:entry,live:[different]))
    XCTAssertThrowsError(try MacMainWorkspaceNative.verifiedIdentity(original,entry:entry,live:[rebound,rebound]))
    XCTAssertThrowsError(try MacMainWorkspaceNative.verifiedIdentity(original,entry:entry,live:[]))
    var shell=rebound;shell.kind="shell";shell.sessionId=nil
    var shellEntry=entry;shellEntry.kind="shell";shellEntry.sessionId=nil
    XCTAssertEqual(try MacMainWorkspaceNative.verifiedIdentity(shell,entry:shellEntry,live:[shell]).owner,shell.owner)
    different=shell;different.directory="/wrong"
    XCTAssertThrowsError(try MacMainWorkspaceNative.verifiedIdentity(shell,entry:shellEntry,live:[different]))
  }
  func testAutomaticEmptyInventoryCannotEraseRosterAndRemovalIsExplicit() async throws {
    let (store,native,_)=try fixture();try await save(store);native.live=[]
    await store.automaticSnapshot();let before=try store.read();XCTAssertEqual(before.roster.entries.count,3)
    _=try await store.control("mainworkspace.remove",args:["entryId":.string(before.roster.entries[0].id),"expectedRevision":.number(Double(before.revision))],requestId:"remove")
    XCTAssertEqual(try store.read().roster.entries.count,2);XCTAssertEqual(try store.read().previous.last?.entries.count,3)
    XCTAssertEqual(native.creates,0)
  }
  func testUnavailableDirectoryWaitsThenSafeRetryRestoresOnlyMissing() async throws {
    let (store,native,_)=try fixture();try await save(store);native.live=[];native.missing=["/same"]
    let waiting=try await restore(store,"missing");XCTAssertEqual(waiting["status"]?.string,"waiting");XCTAssertEqual(native.creates,1)
    native.missing=[];_=try await restore(store,"retry");XCTAssertEqual(native.creates,3)
  }
  func testRestartAfterCreationReconcilesMarkerAndAfterLaunchReconcilesSession() async throws {
    for duringLaunch in [false,true] {
      let (store,native,root)=try fixture();try await save(store);native.live=[]
      native.crashCreation = !duringLaunch;native.crashLaunch=duringLaunch
      _=try await restore(store,"interrupted")
      let restarted=MainTerminalWorkspace(root:root,native:native)
      _=try await restore(restarted,"recover")
      XCTAssertEqual(native.creates,3);XCTAssertEqual(native.launches,3)
      XCTAssertEqual(try restarted.read().status,"restored")
    }
  }
  func testUnknownCreationNeverCreatesAnotherWindowOnRetry() async throws {
    let (store,native,root)=try fixture();try await save(store);native.live=[];native.crashCreation=true;native.unmarked=true
    _=try await restore(store,"lost");let restarted=MainTerminalWorkspace(root:root,native:native)
    _=try await restore(restarted,"retry")
    XCTAssertEqual(native.creates,1);XCTAssertEqual(try restarted.read().status,"needs_attention")
  }
  func testMultipleOwnersAndSplitWindowsStopBeforeAnyCreation() async throws {
    for duplicate in [false,true] {
      let (store,native,_)=try fixture();try await save(store)
      if duplicate { var second=native.live[0];second.tabId="duplicate";native.live.append(second) }
      else { native.live[1].group="another-window" }
      _=try await restore(store,"ambiguous")
      XCTAssertEqual(native.creates,0);XCTAssertEqual(try store.read().status,"needs_attention")
    }
  }
  func testSnapshotRecoveryDoesNotReopenTabsAndStaleRevisionCannotRemove() async throws {
    let (store,native,_)=try fixture();try await save(store);let state=try store.read()
    let args:[String:AssistantValue]=["entryId":.string(state.roster.entries[0].id),"expectedRevision":.number(Double(state.revision))]
    _=try await store.control("mainworkspace.remove",args:args,requestId:"remove")
    do { _=try await store.control("mainworkspace.remove",args:args,requestId:"stale");XCTFail() }catch{}
    _=try await store.control("mainworkspace.recover",args:["snapshotIndex":.number(0),"expectedRevision":.number(Double(try store.read().revision))],requestId:"recover")
    XCTAssertEqual(try store.read().roster.entries.count,3);XCTAssertEqual(native.creates,0)
  }
  func testSeparateEngineInstancesUseOneDurableLockAndKeepReceiptIdentity() async throws {
    let (store,native,root)=try fixture();try await save(store);native.live=[];native.slowInventory=true
    let second=MainTerminalWorkspace(root:root,native:native)
    let first=Task { try await self.restore(store,"one") }
    try await Task.sleep(for:.milliseconds(10))
    do { _=try await restore(second,"two");XCTFail("Concurrent owners must not create in parallel") }
    catch { XCTAssertTrue(error.localizedDescription.contains("already being updated")) }
    _=try await first.value;_=try await restore(second,"two")
    XCTAssertEqual(native.creates,3);XCTAssertEqual(try second.read().receipts.count,3)
    do { _=try await second.control("mainworkspace.restore",args:["changed":.bool(true)],requestId:"one");XCTFail() } catch {}
    XCTAssertEqual(native.creates,3)
  }
  func testBoundedSnapshotsAndOpaqueDraftLimitsSurviveRestart() async throws {
    let (store,native,root)=try fixture()
    native.live[0].draft = .init(text:nil,limitation:"Hidden text and attachments cannot be recovered",capturedAt:Date())
    native.live[0].pendingReceipts=["uncertain-receipt"]
    try await save(store)
    for i in 0..<12 {
      native.live[1].draft?.text="draft revision \(i)"
      _=try await store.control("mainworkspace.save",args:["tabId":.string("tab-1"),"expectedRevision":.number(Double(try store.read().revision))],requestId:"update-\(i)")
    }
    let restarted=MainTerminalWorkspace(root:root,native:native),state=try restarted.read()
    XCTAssertEqual(state.previous.count,8);XCTAssertNil(state.roster.entries[0].draft?.text)
    XCTAssertEqual(state.roster.entries[0].pendingReceipts,["uncertain-receipt"])
    XCTAssertTrue(MainTerminalWorkspace.notice(state.roster.entries[0],progress:nil)!.contains("not replayed automatically"))
    native.live=[];await restarted.automaticSnapshot()
    XCTAssertEqual(try restarted.read().roster.entries.count,3)
  }
  func testDifferentShellTabsInSameDirectoryRemainDistinctAcrossFreshObservations() async throws {
    let (store,native,_)=try fixture()
    for i in native.live.indices { native.live[i].kind="shell";native.live[i].sessionId=nil }
    try await save(store);native.live=[];native.refreshedSelection=true
    _=try await restore(store,"shells")
    XCTAssertEqual(native.creates,3);XCTAssertEqual(try store.read().status,"restored")
    _=try await restore(store,"again");XCTAssertEqual(native.creates,3)
  }
}
