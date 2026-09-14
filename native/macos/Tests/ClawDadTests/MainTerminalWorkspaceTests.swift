import XCTest
import AppKit
import ClawDadRemoteAssistProtocol
@testable import ClawDad

@MainActor final class MainWorkspaceFixture: MainWorkspaceNative {
  var live:[MainWorkspaceLiveTab]=[]
  var creates=0,launches=0,recovers=0,finishes=0
  var missing=Set<String>(),crashCreation=false,crashLaunch=false,unmarked=false
  var slowInventory=false
  var refreshedSelection=false
  var begins=0,ends=0,incompleteVisibility=false
  var closes=0,partialClose=false
  var modalSessionStillPresent=false
  var selectedOnlyInLightInventory=false
  var captureProgress:((Int,Int)throws->Void)?
  var captures=0,captureDelay=0
  var visits:[String]=[]
  var afterCapture:(()->Void)?
  func snapshot(windowContaining tabId:String) async throws -> MainWorkspaceWindowSnapshot {
    captures += 1
    let tabs=try await inventory(captureDrafts:true)
    let group=tabs.first{$0.tabId==tabId}?.group
    let members=tabs.filter{$0.group==group}.sorted{$0.position<$1.position}
    for (index,tab) in members.enumerated() {
      visits.append(tab.tabId);try captureProgress?(index+1,members.count)
      if captureDelay>0 { try await Task.sleep(for:.milliseconds(captureDelay)) }
    }
    afterCapture?()
    return MainWorkspaceWindowSnapshot(anchorId:tabId,tabs:tabs)
  }
  func areClosed(_ tabs:[MainWorkspaceLiveTab]) async throws -> Bool {
    !modalSessionStillPresent && tabs.allSatisfy{old in !live.contains{$0.tty==old.tty && $0.lifetime==old.lifetime}}
  }
  func closeWindow(_ tabs:[MainWorkspaceLiveTab]) async throws {
    closes += 1
    if partialClose { live.removeAll{$0.tty==tabs.first?.tty};throw MacAssistantError("Partial close needs review") }
    live.removeAll{tab in tabs.contains{$0.tty==tab.tty && $0.owner==tab.owner}}
  }
  func beginRestore(entries:[MainWorkspaceEntry]) async throws { begins += 1;if incompleteVisibility { throw MacAssistantError("Hidden native controls; no creation is safe") } }
  func endRestore() async { ends += 1 }
  func inventory(captureDrafts:Bool) async throws -> [MainWorkspaceLiveTab] {
    if slowInventory { try await Task.sleep(for:.milliseconds(50)) }
    if selectedOnlyInLightInventory && !captureDrafts { return live.filter(\.selected) }
    return refreshedSelection ? live.map { var tab=$0;tab.selected=false;return tab }:live
  }
  func windowChoices(observations:[MainWorkspaceLiveTab]) async throws -> [MainWorkspaceWindowChoice] {
    try MainTerminalWorkspace.windowChoices(live)
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
  func finish(_ ordered:[MainWorkspaceLiveTab],selectedId:String?) async throws {
    finishes += 1
    for (index,tab) in ordered.enumerated() { let i=live.firstIndex{$0.tabId==tab.tabId}!;live[i].position=index+1;live[i].selected=tab.tabId==selectedId;live[i].fullScreen=false }
  }
}

@MainActor final class MainTerminalWorkspaceTests:XCTestCase {
  func fixture() throws -> (MainTerminalWorkspace,MainWorkspaceFixture,URL) {
    let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let native=MainWorkspaceFixture()
    native.live=(0..<3).map{i in MainWorkspaceLiveTab(tabId:"tab-\(i)",group:"original",tty:"tty-original-\(i)",owner:"owner-\(i)",directory:i==2 ? "/other":"/same",kind:"codex",sessionId:"00000000-0000-4000-8000-00000000000\(i)",conversationPath:"/session/\(i)",executable:"/codex",name:"Project \(i)",position:i+1,selected:i==1,fullScreen:true,draft:.init(text:"draft \(i)",capturedAt:Date(),transcriptOffset:10))}
    for i in native.live.indices { native.live[i].lifetime="login-\(i)" }
    addTeardownBlock { try? FileManager.default.removeItem(at:root) }
    return (MainTerminalWorkspace(root:root,native:native),native,root)
  }
  func save(_ store:MainTerminalWorkspace) async throws { _=try await store.control("mainworkspace.save",args:["tabId":.string("tab-1"),"expectedRevision":.number(Double(try store.read().revision))],requestId:"save") }
  func restore(_ store:MainTerminalWorkspace,_ id:String) async throws -> [String:AssistantValue] { try await store.control("mainworkspace.restore",args:[:],requestId:id) }
  func testLiveRenameDoesNotRewriteManualSnapshot() async throws {
    let (store,native,root)=try fixture();try await save(store);let before=try store.read()
    XCTAssertFalse(try store.renameExisting(name:"Different",sessionId:native.live[0].sessionId,directory:"/same",owner:"owner-0",tty:"tty-original-0"))
    let after=try MainTerminalWorkspace(root:root,native:native).read()
    XCTAssertEqual(after.roster,before.roster);XCTAssertEqual(after.revision,before.revision)
  }
  func testMigrationRetainsUncertainCreationReceiptsWithoutRepeatingDispatch() async throws {
    let (store,native,root)=try fixture();try await save(store)
    var legacy=try store.read();legacy.version=1;legacy.snapshots=nil;legacy.operations=nil
    legacy.progress=[legacy.roster.entries[0].id:MainWorkspaceStep(phase:"creating",marker:"lost-receipt",beforeOwners:[])]
    legacy.activeRequest="original-restore";legacy.receipts=["old-save":"exact-fingerprint"]
    try JSONEncoder().encode(legacy).write(to:root.appendingPathComponent("main-workspace.json"))
    native.live=[]
    _=try await store.control("mainworkspace.inspect",args:[:],requestId:"inspect-migration")
    let migrated=try store.read(),id=try XCTUnwrap(migrated.selectedSnapshotId)
    XCTAssertEqual(migrated.operations?[id]?.id,"original-restore")
    XCTAssertEqual(migrated.operations?[id]?.progress[legacy.roster.entries[0].id]?.phase,"creating")
    XCTAssertEqual(migrated.receipts["old-save"],"exact-fingerprint")
    _=try await restore(store,"retry-imported")
    XCTAssertEqual(native.creates,0);XCTAssertEqual(native.launches,0)
  }
  func testOneWindowDoubleTapConcurrentRequestsAndExactSameDirectoryConversations() async throws {
    let (store,native,_)=try fixture();try await save(store);native.live=[]
    async let a=restore(store,"restore-a");async let b=restore(store,"restore-b");_=try await (a,b)
    _=try await restore(store,"restore-a");_=try await restore(store,"restore-c")
    XCTAssertEqual(native.creates,3);XCTAssertEqual(native.launches,3);XCTAssertEqual(Set(native.live.map(\.group)).count,1)
    XCTAssertEqual(Set(native.live.compactMap(\.sessionId)).count,3)
    XCTAssertEqual(native.live.sorted{$0.position<$1.position}.compactMap(\.sessionId),["00000000-0000-4000-8000-000000000000","00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002"])
    XCTAssertEqual(native.live.first{$0.selected}?.sessionId,"00000000-0000-4000-8000-000000000001");XCTAssertTrue(native.live.allSatisfy{!$0.fullScreen})
    XCTAssertTrue(try store.read().roster.fullScreen,"The captured historical preference is preserved without entering Full Screen")
  }
  func testAvailableDisplaySizingUsesMenuDockAndCurrentMonitorWithoutFullScreen() throws {
    let primary=CGRect(x:0,y:0,width:1728,height:1117)
    let primaryUsable=CGRect(x:0,y:70,width:1728,height:1023)
    let secondary=CGRect(x:-2560,y:120,width:2560,height:1440)
    let secondaryUsable=CGRect(x:-2480,y:120,width:2480,height:1416)
    let screens=[(frame:primary,visibleFrame:primaryUsable),(frame:secondary,visibleFrame:secondaryUsable)]
    XCTAssertEqual(MainWorkspaceDisplayGeometry.target(window:CGRect(x:100,y:50,width:900,height:700),screens:screens,primaryTop:1117),CGRect(x:0,y:24,width:1728,height:1023))
    // A left/upper monitor uses negative AX coordinates; its left Dock is reserved.
    XCTAssertEqual(MainWorkspaceDisplayGeometry.target(window:CGRect(x:-2200,y:-300,width:1200,height:800),screens:screens,primaryTop:1117),CGRect(x:-2480,y:-419,width:2480,height:1416))
    // After resolution/display changes, use the current display, not saved pixels.
    let small=CGRect(x:0,y:0,width:1280,height:800)
    XCTAssertEqual(MainWorkspaceDisplayGeometry.target(window:CGRect(x:2000,y:1200,width:1000,height:800),screens:[(small,CGRect(x:0,y:48,width:1280,height:728))],primaryTop:800),CGRect(x:0,y:24,width:1280,height:728))
    XCTAssertNil(MainWorkspaceDisplayGeometry.target(window:primary,screens:[],primaryTop:1117))
  }
  func testDisplaySizingRequiresObservedUsableBoundsAndAllowsTerminalGridRounding() {
    let target=CGRect(x:-1280,y:24,width:1280,height:728)
    XCTAssertTrue(MainWorkspaceDisplayGeometry.fills(CGRect(x:-1280,y:24,width:1276,height:715),target:target))
    XCTAssertFalse(MainWorkspaceDisplayGeometry.fills(CGRect(x:-1280,y:0,width:1280,height:800),target:target),"Full display bounds cover the menu/Dock")
    XCTAssertFalse(MainWorkspaceDisplayGeometry.fills(CGRect(x:0,y:24,width:1280,height:728),target:target),"Wrong monitor")
    XCTAssertFalse(MainWorkspaceDisplayGeometry.fills(CGRect(x:-1280,y:24,width:800,height:600),target:target),"Dispatch alone does not prove maximized bounds")
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
  private func census(_ literal:String) throws -> [(String,String)] {
    let script=try XCTUnwrap(NSAppleScript(source:"return "+literal));var error:NSDictionary?
    let result=script.executeAndReturnError(&error);XCTAssertNil(error)
    return try MainWorkspaceTitleCensus.rows(result)
  }
  func testTitleCensusPreservesNamesAndSkipsOnlyAnEmptyMissingWindow() throws {
    let rows=try census("{{10,missing value,11},{{\"/dev/ttys015\"},{},{\"/dev/ttys017\"}},{{\"QA, Ω\"},{},{missing value}},{{\"/dev/ttys015\"},{},{\"/dev/ttys017\"}},{10,missing value,11}}")
    XCTAssertEqual(rows.map(\.0),["/dev/ttys015","/dev/ttys017"])
    XCTAssertEqual(rows.map(\.1),["QA, Ω",""])
  }
  func testTitleCensusRejectsAnUnidentifiedWindowContainingTabs() {
    XCTAssertThrowsError(try census("{{missing value},{{\"/dev/ttys015\"}},{{\"Keep\"}},{{\"/dev/ttys015\"}},{missing value}}"))
  }
  func testTitleCensusRejectsWindowOrTabMovementDuringNameRead() {
    XCTAssertThrowsError(try census("{{10},{{\"/dev/ttys015\"}},{{\"Keep\"}},{{\"/dev/ttys015\"}},{11}}"))
    XCTAssertThrowsError(try census("{{10},{{\"/dev/ttys015\"}},{{\"Keep\"}},{{\"/dev/ttys016\"}},{10}}"))
  }
  func testTitleCensusRejectsMissingFieldsAndMalformedDevices() {
    XCTAssertThrowsError(try census("{{10},{{\"/dev/ttys015\"}},{{}},{{\"/dev/ttys015\"}},{10}}"))
    XCTAssertThrowsError(try census("{{10},{{missing value}},{{\"Keep\"}},{{missing value}},{10}}"))
    XCTAssertThrowsError(try census("{{10},{{\"/tmp/tty\"}},{{\"Keep\"}},{{\"/tmp/tty\"}},{10}}"))
    XCTAssertThrowsError(try census("{{missing value},{{}},{missing value},{{}},{missing value}}"))
  }
  func testTitleCensusRetainsAliasConflictChecks() throws {
    let same=try census("{{10,11},{{\"/dev/ttys015\"},{\"/dev/ttys015\"}},{{\"Keep\"},{\"Keep\"}},{{\"/dev/ttys015\"},{\"/dev/ttys015\"}},{10,11}}")
    XCTAssertEqual(try MacMainWorkspaceNative.uniqueTitles(same),["/dev/ttys015":"Keep"])
    let changed=try census("{{10,11},{{\"/dev/ttys015\"},{\"/dev/ttys015\"}},{{\"Keep\"},{\"Different\"}},{{\"/dev/ttys015\"},{\"/dev/ttys015\"}},{10,11}}")
    XCTAssertThrowsError(try MacMainWorkspaceNative.uniqueTitles(changed))
  }
  func testFullScreenCloseRebindsSelectedMemberWhenFirstMemberIsTemporarilyUnbound() async throws {
    let (store,native,_)=try fixture()
    let plan=try await store.control("mainworkspace.close.inspect",args:["tabId":.string("tab-1")],requestId:"inspect-space")
    let token=try XCTUnwrap(plan["closePlan"]?.object?["token"]?.string)
    native.selectedOnlyInLightInventory=true
    let closed=try await store.control("mainworkspace.close",args:["confirmationToken":.string(token),"confirm":.bool(true)],requestId:"close-space")
    XCTAssertEqual(closed["status"]?.string,"closed");XCTAssertEqual(native.closes,1)
    XCTAssertTrue(native.live.isEmpty)
  }
  func testAutomaticObservationCannotRewriteManualMembershipIdentityOrDrafts() async throws {
    let (store,native,_)=try fixture();try await save(store);let before=try store.read()
    native.live[0].tabId="refreshed";native.live[0].sessionId=nil;native.live[0].kind="shell";native.live[0].directory="/home"
    native.live[0].draft?.text="new live words";native.live.removeLast()
    await store.automaticSnapshot();let after=try store.read()
    XCTAssertEqual(after.roster,before.roster);XCTAssertEqual(after.previous,before.previous)
    XCTAssertEqual(after.observations?.count,2)
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
  func testNewTabReconcilesReplacedAXControlsAndWindowGroupWithoutSecondCreation() throws {
    let (_,native,_)=try fixture(),original=native.live[0]
    var new=original;new.tty="new-tty";new.owner="new-shell";new.tabId="new-native-id";new.name="ClawDad Restore fixture";new.group="rebound-group"
    var rebound=original;rebound.tabId="rebound-original";rebound.group=new.group
    XCTAssertThrowsError(try MacMainWorkspaceNative.verifiedCreation(before:[original],after:[new],tty:new.tty,marker:new.name,anchor:original))
    let verified=try MacMainWorkspaceNative.verifiedCreation(before:[original],after:[new,rebound],tty:new.tty,marker:new.name,anchor:original)
    XCTAssertEqual(verified,new)
    rebound.owner="different-owner"
    XCTAssertThrowsError(try MacMainWorkspaceNative.verifiedCreation(before:[original],after:[new,rebound],tty:new.tty,marker:new.name,anchor:original))
    XCTAssertThrowsError(try MacMainWorkspaceNative.verifiedCreation(before:[original],after:[new,new,original],tty:new.tty,marker:new.name,anchor:nil))
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
      _=try await store.control("mainworkspace.save",args:["snapshotId":.string(try store.read().selectedSnapshotId!),"name":.string("Main Workspace"),"tabId":.string("tab-1"),"expectedRevision":.number(Double(try store.read().revision))],requestId:"update-\(i)")
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

  func testNamedSaveUpdateReplacesLineupAndPreservesOtherSnapshotsAndPreviousVersion() async throws {
    let (store,native,root)=try fixture();try await save(store);let first=try store.read().selectedSnapshotId!
    native.live.removeLast()
    _=try await store.control("mainworkspace.save",args:["name":.string("Two projects"),"tabId":.string("tab-1"),"expectedRevision":.number(Double(try store.read().revision))],requestId:"new")
    let second=try store.read().selectedSnapshotId!
    XCTAssertNotEqual(first,second);XCTAssertEqual(try store.read().snapshots?.count,2)
    native.live.removeFirst()
    _=try await store.control("mainworkspace.save",args:["snapshotId":.string(first),"name":.string("Focused"),"tabId":.string("tab-1"),"expectedRevision":.number(Double(try store.read().revision))],requestId:"update")
    let restored=try MainTerminalWorkspace(root:root,native:native).read()
    XCTAssertEqual(restored.roster.entries.count,1);XCTAssertEqual(restored.previous.last?.entries.count,3)
    XCTAssertEqual(restored.snapshots?.first{$0.id==second}?.roster.entries.count,2)
  }
  func testFreshUnidentifiedAndUnsupportedSavePreservesPreviousValidSnapshot() async throws {
    for invalid in ["fresh","unsupported","unknown"] {
      let (store,native,_)=try fixture();try await save(store);let before=try store.read()
      if invalid=="fresh" { native.live[0].sessionId=nil }
      if invalid=="unsupported" { native.live[0].kind="unknown" }
      if invalid=="unknown" { native.live[0].identityIssue="Its process ownership is ambiguous" }
      do {
        _=try await store.control("mainworkspace.save",args:["snapshotId":.string(before.selectedSnapshotId!),"name":.string("Update"),"tabId":.string("tab-1"),"expectedRevision":.number(Double(before.revision))],requestId:"invalid")
        XCTFail("Invalid capture must not replace the saved identity")
      } catch {}
      XCTAssertEqual(try store.read().roster,before.roster)
    }
  }
  func testMigrationBacksUpExactLegacyBytesAndFlagsQuestionableShells() async throws {
    let (_,native,root)=try fixture();try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
    var legacy=MainWorkspaceState()
    legacy.roster=MainWorkspaceRoster(entries:[.init(id:"old",directory:"/home",kind:"shell",name:"Named project",binding:native.live[0])],savedAt:Date())
    legacy.previous=[legacy.roster];legacy.receipts=["old-receipt":"unchanged"]
    let bytes=try JSONEncoder().encode(legacy);try bytes.write(to:root.appendingPathComponent("main-workspace.json"))
    let store=MainTerminalWorkspace(root:root,native:native);await store.automaticSnapshot()
    let migrated=try store.read()
    XCTAssertEqual(migrated.version,2);XCTAssertEqual(migrated.snapshots?.count,2)
    XCTAssertEqual(try Data(contentsOf:URL(fileURLWithPath:migrated.migrationBackup!)),bytes)
    XCTAssertNotNil(migrated.roster.entries[0].identityIssue);XCTAssertEqual(migrated.receipts["old-receipt"],"unchanged")
    XCTAssertEqual(migrated.snapshots?.last?.roster.entries[0].directory,"/home")
  }
  func testExistingOtherWindowRequiresExplicitReuseAndKeepsUnsavedWork() async throws {
    let (store,native,_)=try fixture();try await save(store)
    var unrelated=native.live[0];unrelated.tabId="other";unrelated.sessionId=UUID().uuidString;unrelated.group="another";unrelated.tty="other-tty";unrelated.owner="other-owner"
    native.live=[unrelated]
    _=try await restore(store,"default");XCTAssertEqual(native.creates,0)
    XCTAssertTrue(try store.read().message!.contains("Reuse"))
    _=try await store.control("mainworkspace.restore",args:["reuseWindowTabId":.string("other")],requestId:"reuse")
    XCTAssertEqual(native.creates,3);XCTAssertEqual(native.live.first{$0.tabId=="other"}?.draft,unrelated.draft)
    XCTAssertEqual(Set(native.live.map(\.group)),["another"])
  }
  func closePlan(_ store:MainTerminalWorkspace,_ id:String="inspect") async throws -> String {
    let value=try await store.control("mainworkspace.close.inspect",args:["tabId":.string("tab-1")],requestId:id)
    return value["closePlan"]!.object!["token"]!.string!
  }
  func testSaveCloseRestoreExactThreadsWithoutTaskSubmissionAndPreserveUnrelatedWindow() async throws {
    let (store,native,root)=try fixture();let original=native.live
    let token=try await closePlan(store)
    let result=try await store.control("mainworkspace.close",args:["confirmationToken":.string(token),"confirm":.bool(true),"saveName":.string("Fixture"),"expectedRevision":.number(Double(try store.read().revision))],requestId:"close")
    XCTAssertEqual(result["status"]?.string,"closed");XCTAssertEqual(native.closes,1);XCTAssertTrue(native.live.isEmpty)
    let again=MainTerminalWorkspace(root:root,native:native)
    _=try await restore(again,"restore-exact")
    XCTAssertEqual(native.live.map(\.sessionId),original.map(\.sessionId));XCTAssertEqual(native.live.map(\.directory),original.map(\.directory))
    _=try await again.control("mainworkspace.close",args:["confirmationToken":.string(token),"confirm":.bool(true),"saveName":.string("Fixture"),"expectedRevision":.number(1)],requestId:"close")
    XCTAssertEqual(native.closes,1);XCTAssertEqual(native.live.count,3)
  }
  func testCloseCancelChangedInputChangedOwnerAndPartialFailureNeverRepeatDispatch() async throws {
    for scenario in ["cancel","draft","owner","partial"] {
      let (store,native,root)=try fixture();let before=native.live
      let token=try await closePlan(store)
      if scenario=="draft" { native.live[0].draft?.text="Cody changed this" }
      if scenario=="owner" { native.live[0].owner="new process" }
      if scenario=="partial" { native.partialClose=true }
      let args:[String:AssistantValue]=["confirmationToken":.string(token),"confirm":.bool(scenario != "cancel")]
      do {
        let result=try await store.control("mainworkspace.close",args:args,requestId:"close")
        XCTAssertEqual(result["status"]?.string,scenario=="partial" ? "uncertain":"cancelled")
      } catch { XCTAssertTrue(["draft","owner"].contains(scenario)) }
      if scenario=="cancel" { XCTAssertEqual(native.live,before) }
      if scenario=="partial" {
        let restarted=MainTerminalWorkspace(root:root,native:native)
        _=try await restarted.control("mainworkspace.close",args:args,requestId:"close")
      }
      XCTAssertEqual(native.closes,scenario=="partial" ? 1:0)
    }
  }
  func testSaveAndCloseRejectsOpaqueDraftsAndUncertainQueueReceipts() async throws {
    for opaque in [true,false] {
      let (store,native,_)=try fixture()
      if opaque { native.live[0].draft?.text=nil;native.live[0].draft?.limitation="Hidden attachment" }
      else { native.live[0].pendingReceipts=["delivery-uncertain"] }
      let token=try await closePlan(store)
      do { _=try await store.control("mainworkspace.close",args:["confirmationToken":.string(token),"confirm":.bool(true),"saveName":.string("Fixture"),"expectedRevision":.number(Double(try store.read().revision))],requestId:"close");XCTFail() } catch {}
      XCTAssertEqual(native.closes,0);XCTAssertEqual(native.live.count,3)
    }
  }
  func testOmittedAXTabWithLiveModalSessionNeverReportsClosedOrRepeats() async throws {
    for restartBoundary in [false,true] {
      let (store,native,root)=try fixture(),token=try await closePlan(store)
      native.modalSessionStillPresent=true
      if restartBoundary {
        var state=try store.read();state.closePlans![token]!.status="dispatching"
        try JSONEncoder().encode(state).write(to:root.appendingPathComponent("main-workspace.json"))
        native.live=[]
      }
      let args:[String:AssistantValue]=["confirmationToken":.string(token),"confirm":.bool(true)]
      let result=try await store.control("mainworkspace.close",args:args,requestId:"modal-close")
      XCTAssertEqual(result["status"]?.string,"uncertain")
      XCTAssertTrue(native.live.isEmpty)
      let restarted=MainTerminalWorkspace(root:root,native:native)
      let replay=try await restarted.control("mainworkspace.close",args:args,requestId:"modal-close")
      XCTAssertEqual(replay["status"]?.string,"uncertain")
      XCTAssertEqual(native.closes,restartBoundary ? 0:1)
    }
  }
  func testExitedAgentEvidenceRequiresSameLoginLifetimeAndFinalNativeExitReceipt() throws {
    let (_,_,root)=try fixture(),journal=MainWorkspaceAgentBindings(file:root.appendingPathComponent("bindings.json"))
    let id="00000000-0000-4000-8000-000000000001"
    let record=MainWorkspaceAgentBindings.Record(tty:"/dev/ttys001",lifetime:"original-login",process:"codex-owner",directory:"/actual/project",sessionId:id,path:"/exact/history",executable:"/codex")
    try journal.remember(record)
    XCTAssertEqual(journal.known(tty:record.tty,lifetime:record.lifetime),record)
    XCTAssertNil(journal.known(tty:record.tty,lifetime:"restarted-login"))
    let screen="To continue this session, run codex resume \(id)\nBackToTheFort> "
    XCTAssertEqual(journal.exited(tty:record.tty,lifetime:record.lifetime,screen:screen)?.directory,"/actual/project")
    XCTAssertNil(journal.exited(tty:record.tty,lifetime:"new-login",screen:screen))
    XCTAssertNil(journal.exited(tty:record.tty,lifetime:record.lifetime,screen:screen+"echo another-command"))
    XCTAssertNil(journal.exited(tty:record.tty,lifetime:record.lifetime,screen:screen.replacingOccurrences(of:id,with:UUID().uuidString)))
    XCTAssertNil(journal.exited(tty:record.tty,lifetime:record.lifetime,screen:screen+"\ncommand output\nBackToTheFort> "))
  }
  func testInterruptedAtomicSavePreservesLastCompleteVersionAndSameIDCanRetry() async throws {
    let (store,native,root)=try fixture();try await save(store);let before=try store.read()
    native.live.removeLast()
    store.beforeAtomicWrite={state in if state.roster.entries.count==2 { throw MacAssistantError("Simulated power loss before atomic replacement") } }
    let args:[String:AssistantValue]=["snapshotId":.string(before.selectedSnapshotId!),"tabId":.string("tab-1"),"name":.string("Updated"),"expectedRevision":.number(Double(before.revision))]
    do { _=try await store.control("mainworkspace.save",args:args,requestId:"atomic-update");XCTFail() } catch {}
    let restarted=MainTerminalWorkspace(root:root,native:native)
    XCTAssertEqual(try restarted.read().roster,before.roster)
    _=try await restarted.control("mainworkspace.save",args:args,requestId:"atomic-update")
    XCTAssertEqual(try restarted.read().roster.entries.count,2);XCTAssertEqual(try restarted.read().previous.last,before.roster)
  }
  func testRestartAtCloseDispatchBoundaryReconcilesWithoutRepeatingAndExpiryNeverCloses() async throws {
    for disappeared in [false,true] {
      let (store,native,root)=try fixture();let token=try await closePlan(store)
      var state=try store.read();state.closePlans![token]!.status="dispatching"
      try JSONEncoder().encode(state).write(to:root.appendingPathComponent("main-workspace.json"),options:.atomic)
      if disappeared { native.live=[] }
      let restarted=MainTerminalWorkspace(root:root,native:native)
      let value=try await restarted.control("mainworkspace.close",args:["confirmationToken":.string(token),"confirm":.bool(true)],requestId:"reconcile")
      XCTAssertEqual(value["status"]?.string,disappeared ? "closed":"uncertain");XCTAssertEqual(native.closes,0)
    }
    let (store,native,root)=try fixture();let token=try await closePlan(store)
    var state=try store.read();state.closePlans![token]!.capturedAt=Date().addingTimeInterval(-301)
    try JSONEncoder().encode(state).write(to:root.appendingPathComponent("main-workspace.json"),options:.atomic)
    do { _=try await store.control("mainworkspace.close",args:["confirmationToken":.string(token),"confirm":.bool(true)],requestId:"expired");XCTFail() }catch{}
    XCTAssertEqual(native.closes,0)
  }
}
