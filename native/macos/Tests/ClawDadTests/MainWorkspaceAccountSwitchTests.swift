import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDad

@MainActor final class MainWorkspaceAccountSwitchTests:XCTestCase {
  func testReportedReceiptsReadOnlyWhenRequested() throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_ACCOUNT_RECEIPTS_READONLY"]=="1" else { throw XCTSkip("Explicit read-only incident receipt check") }
    let file=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ClawDad/Assistant/state.json")
    let state=try JSONDecoder().decode([String:AssistantValue].self,from:Data(contentsOf:file))
    let jobs=try XCTUnwrap(state["jobs"]?.array).compactMap(\.object)
    let receipts=AccountWindowReceiptEvidence.collect(jobs,sessionId:"01a06f70-051d-76e2-ab41-0d816990fcd8",tabId:"b93b7f06-c993-402c-b584-deeb9931d0d7")
    let reported:Set<String>=["4b1f67cc-bb87-43aa-b008-c5e561503dde","bd4a5243-ed34-48fe-96e5-0b60e7776142","d634f3e0-63da-4903-9dc7-21e8736c9801","ace71105-38a2-4ab4-a2da-b2f9b9747382","59d13ea1-8191-4ae9-ad98-158982e29412"]
    XCTAssertTrue(reported.isSubset(of:Set(receipts.retained)))
    XCTAssertTrue(reported.isDisjoint(with:Set(receipts.pending)))
    print("Read-only receipt evidence: \(reported.count) original incident failures retained; \(receipts.pending.count) active/uncertain blockers")
  }
  func testHistoricalFailedActionsRemainRecordedWithoutBlockingWindowCapture() async throws {
    // The five receipts which blocked the real nine-tab capture: four native
    // pre-prepare failures, and one uncertain draft-only insertion.
    let actions=["terminal.queue","terminal.queue","terminal.queue","terminal.insert","terminal.send"]
    let jobs=actions.enumerated().map { index,action -> [String:AssistantValue] in
      var job:[String:AssistantValue]=["id":.string("old-\(index)"),"action":.string(action),"status":.string("attention"),
        "args":.object(["sessionId":.string("session-0")]),"error":.string("Retained historical failure")]
      if action=="terminal.insert" { job["preparedAt"] = .string("2026-09-10T23:13:29Z") }
      return job
    }
    let evidence=AccountWindowReceiptEvidence.collect(jobs,sessionId:"session-0",tabId:"tab-0")
    XCTAssertTrue(evidence.pending.isEmpty);XCTAssertEqual(evidence.retained.count,5)
    let (native,root)=try fixture(),store=engine(native,root)
    native.live[0].pendingReceipts=evidence.pending;native.live[0].retainedReceipts=evidence.retained
    let captured=try await capture(store,native)
    XCTAssertEqual(captured.tabs[0].retainedReceipts,evidence.retained)
    XCTAssertEqual(try engine(native,root).read("fixture-switch")?.tabs[0].retainedReceipts,evidence.retained)
    _=try await store.restore(operationId:"fixture-switch",target:target)
    XCTAssertEqual(native.closes,1);XCTAssertEqual(native.recovers,3)
    XCTAssertEqual(jobs[3]["status"]?.string,"attention","Original receipt status is never cleared or replayed")
  }
  func testActiveAndUncertainSubmittedReceiptsRemainBlockingWithExactTargeting() {
    func job(_ status:String,_ result:[String:AssistantValue]=[:],prepared:Bool=true)->[String:AssistantValue] {
      var value:[String:AssistantValue]=["id":.string("delivery"),"action":.string("terminal.queue"),"status":.string(status),
        "sessionId":.string("exact"),"args":.object(["tabId":.string("old-catalog-id")]),"result":.object(result),"error":.string("Failure")]
      if prepared {value["preparedAt"] = .string("time")};return value
    }
    for status in ["queued","sending","running","working","submitted","agent_queued","attention","interrupted","unknown"] {
      XCTAssertEqual(AccountWindowReceiptEvidence.collect([job(status)],sessionId:"exact",tabId:"new-id").pending,["delivery"],status)
    }
    let unsent=job("attention",["tabSent":.bool(false)])
    XCTAssertEqual(AccountWindowReceiptEvidence.collect([unsent],sessionId:"exact",tabId:"new-id").retained,["delivery"])
    for flag in ["tabSent","queueAccepted","turnAccepted","submitted"] {
      XCTAssertEqual(AccountWindowReceiptEvidence.collect([job("attention",[flag:.bool(true)],prepared:false)],sessionId:"exact",tabId:"new-id").pending,["delivery"])
    }
    XCTAssertTrue(AccountWindowReceiptEvidence.collect([job("running")],sessionId:"different-session",tabId:"old-catalog-id").pending.isEmpty)
    var targeted=job("running");targeted["sessionId"]=nil
    XCTAssertEqual(AccountWindowReceiptEvidence.collect([targeted],sessionId:"exact",tabId:"old-catalog-id").pending,["delivery"])
    XCTAssertTrue(AccountWindowReceiptEvidence.collect([targeted],sessionId:"exact",tabId:"different-id").pending.isEmpty)
  }
  func testPendingDeliveryFailureNamesItsReceiptInsteadOfSuggestingMissingHistory() async throws {
    let (native,root)=try fixture(),store=engine(native,root)
    native.live[0].pendingReceipts=["uncertain-tab-dispatch"]
    do { _=try await capture(store,native);XCTFail("Uncertain delivery must remain held") }
    catch let error as MacCodexInputFailure {
      XCTAssertEqual(error.code,"account_window_delivery_unresolved")
      XCTAssertTrue(error.message.contains("uncertain-tab-dispatch"))
    }
    XCTAssertEqual(native.closes,0);XCTAssertEqual(native.creates,0)
  }
  func testNewUncertainDeliveryAfterCaptureStopsBeforeWindowClose() async throws {
    let (native,root)=try fixture(),store=engine(native,root)
    _=try await capture(store,native)
    native.live[0].pendingReceipts=["new-uncertain-delivery"]
    do { _=try await store.restore(operationId:"fixture-switch",target:target);XCTFail("Recheck delivery evidence before closing") }
    catch let error as MacCodexInputFailure { XCTAssertEqual(error.code,"account_window_delivery_unresolved") }
    XCTAssertEqual(native.closes,0);XCTAssertEqual(native.creates,0)
  }
  func testSingleTabComposedWindowTitleUsesIndependentExactConfiguredName() {
    let row=MacTerminalTabSnapshot(windowID:5,windowIndex:1,tabIndex:1,customTitle:"project — Research — codex resume exact — 80×24",tty:"/dev/ttys099",isSelectedInWindow:true,configuredTitle:"Research")
    XCTAssertTrue(MacMainWorkspaceNative.restoredNameMatches(row,name:"Research"))
    XCTAssertFalse(MacMainWorkspaceNative.restoredNameMatches(row,name:"project"))
    XCTAssertFalse(MacMainWorkspaceNative.restoredNameMatches(row,name:"Resear"))
  }
  func testQuotaDismissalRequiresTheExactObservedInformationalChoices() {
    let notice="• Automatically switched to Luna Reserve low due to usage limits.\nYou’re now using Luna, a faster model for simpler tasks.\n› 1. Add Credits\n  2. Continue with Luna Reserve\n Press enter to confirm or esc to continue working  \n"
    XCTAssertTrue(MacMainWorkspaceNative.accountQuotaNotice(notice))
    XCTAssertFalse(MacMainWorkspaceNative.accountQuotaNotice(notice+"› Ask Codex to do anything\ngpt-6-astra max"))
    XCTAssertFalse(MacMainWorkspaceNative.accountQuotaNotice(notice.replacingOccurrences(of:"› 1. Add Credits",with:"1. Add Credits")))
    XCTAssertFalse(MacMainWorkspaceNative.accountQuotaNotice("Do you trust this directory?\n› 1. Yes\nPress enter to continue"))
    XCTAssertEqual(assistantObserveDraft("› Ask Codex to do anything\nLuna Reserve low · /fixture/project").text,"")
    XCTAssertNil(assistantObserveDraft(notice).text)
  }
  private let target=MainWorkspaceAccountSwitch.Target(authorizationHome:"/private/profile",sqliteHome:"/canonical",accountKey:String(repeating:"a",count:64))
  private func fixture() throws -> (MainWorkspaceFixture,URL) {
    let (_,native,root)=try MainTerminalWorkspaceTests().fixture()
    // Keep the independent old snapshot fixture root alive for this test.
    for i in native.live.indices { native.live[i].model="gpt-6-astra";native.live[i].effort="max";native.live[i].isBusy=false }
    var other=native.live[0];other.tabId="other";other.tty="other-tty";other.group="unrelated";other.owner="other-owner";other.sessionId="other-session"
    native.live.append(other)
    addTeardownBlock{try? FileManager.default.removeItem(at:root)}
    return (native,root)
  }
  private func engine(_ native:MainWorkspaceFixture,_ root:URL,permit:@escaping () throws -> Void = {}) -> MainWorkspaceAccountSwitch {
    MainWorkspaceAccountSwitch(root:root,native:native,generation:{7},inspectLaunch:{tab in
      if tab.isBusy==true { throw MacAssistantError("Working") }
      return tab.kind=="codex" ? .init(authorizationHome:"/canonical",options:[]):nil
    },setLaunch:{_,_,_ in},verifyOwner:{_,_,_ in},permit:{_ in try permit()})
  }
  private func capture(_ engine:MainWorkspaceAccountSwitch,_ native:MainWorkspaceFixture) async throws -> MainWorkspaceAccountSwitch.Record {
    let choice=try await native.windowChoices(observations:[]).first!
    return try await engine.capture(operationId:"fixture-switch",windowId:choice.id,tabId:choice.tabId)
  }
  func testWindowRebuildPreservesExactSameDirectoryThreadsAndUnrelatedWindow() async throws {
    let (native,root)=try fixture(),store=engine(native,root),other=native.live.last!
    let record=try await capture(store,native)
    XCTAssertEqual(record.entries.count,3);XCTAssertEqual(native.captures,1)
    _=try await capture(store,native);XCTAssertEqual(native.captures,1,"Capture receipt prevents polling sweeps")
    let result=try await store.restore(operationId:"fixture-switch",target:target)
    XCTAssertEqual(result.stage,"verified");XCTAssertEqual(native.closes,1);XCTAssertEqual(native.creates,3)
    XCTAssertEqual(Set(native.live.filter{$0.group != "unrelated"}.compactMap(\.sessionId)),Set(record.entries.compactMap(\.sessionId)))
    XCTAssertEqual(native.live.last{$0.group=="unrelated"},other)
    XCTAssertEqual(native.recovers,3);XCTAssertFalse(native.live.filter{$0.group != "unrelated"}.contains{$0.fullScreen})
    _=try await engine(native,root).restore(operationId:"fixture-switch",target:target)
    XCTAssertEqual(native.closes,1);XCTAssertEqual(native.creates,3);XCTAssertEqual(native.launches,3)
  }
  func testDraftChangesAndBusyStatePreventClosing() async throws {
    let (native,root)=try fixture(),store=engine(native,root)
    _=try await capture(store,native);native.live[0].draft?.text="User corrected the draft"
    do{_=try await store.restore(operationId:"fixture-switch",target:target);XCTFail("Changed draft must be preserved")}catch{}
    XCTAssertEqual(native.closes,0)
    native.live[0].draft?.text="draft 0";native.live[0].isBusy=true
    do{_=try await store.restore(operationId:"fixture-switch",target:target);XCTFail("Busy work must stay open")}catch{}
    XCTAssertEqual(native.closes,0)
  }
  func testPartialCloseRemainsUncertainAndNeverClosesAgainOrCreatesDuplicate() async throws {
    let (native,root)=try fixture(),store=engine(native,root)
    _=try await capture(store,native);native.partialClose=true
    for _ in 0..<2 {do{_=try await engine(native,root).restore(operationId:"fixture-switch",target:target);XCTFail()}catch{}}
    XCTAssertEqual(native.closes,1);XCTAssertEqual(native.creates,0)
    XCTAssertEqual(try store.read("fixture-switch")?.stage,"closing")
  }
  func testCancelledPermitAndMissingDirectoryPreserveOriginalWindow() async throws {
    let (native,root)=try fixture(),store=engine(native,root)
    _=try await capture(store,native)
    do{_=try await engine(native,root,permit:{throw MacAssistantError("Cancelled")}).restore(operationId:"fixture-switch",target:target);XCTFail()}catch{}
    XCTAssertEqual(native.closes,0)
    native.missing.insert("/same")
    do{_=try await store.restore(operationId:"fixture-switch",target:target);XCTFail()}catch{}
    XCTAssertEqual(native.closes,0)
  }
  func testOpaqueDraftQueueAndFreshSessionCannotBeCapturedForClosing() async throws {
    for mode in 0..<3 {
      let (native,root)=try fixture(),store=engine(native,root)
      if mode==0 {native.live[0].draft?.text=nil}
      if mode==1 {native.live[0].pendingReceipts=["accepted-native-queue"]}
      if mode==2 {native.live[0].sessionId=nil}
      do{_=try await capture(store,native);XCTFail()}catch{}
      XCTAssertEqual(native.closes,0);XCTAssertNil(try store.read("fixture-switch"))
    }
  }
  func testLostCreationReceiptReconcilesMarkerAndNeverCreatesSecondTab() async throws {
    let (native,root)=try fixture(),store=engine(native,root)
    _=try await capture(store,native);native.crashCreation=true
    do{_=try await store.restore(operationId:"fixture-switch",target:target);XCTFail()}catch{}
    XCTAssertEqual(native.creates,1)
    _=try await engine(native,root).restore(operationId:"fixture-switch",target:target)
    XCTAssertEqual(native.creates,3);XCTAssertEqual(native.closes,1)
  }
  func testNewAccountCommandUsesExactThreadAndQuotesPathsWithoutRepeatedModelOrPrompt() throws {
    let entry=MainWorkspaceEntry(id:"entry",directory:"/fixture/O'Brien",kind:"codex",sessionId:"00000000-0000-4000-8000-000000000001",executable:"/bin/codex",name:"Test",model:"gpt-6-astra",effort:"max")
    let launch=MainWorkspaceAccountSwitch.Launch(authorizationHome:"/old",options:["--model","older","-c","features.code_mode_host=true"])
    let text=try MacCodexAccountWindow.command(entry,operation:"switch",target:target,launch:launch)
    XCTAssertEqual(text.components(separatedBy:"'--model'").count,2)
    XCTAssertFalse(text.contains("older"));XCTAssertFalse(text.contains("/status"));XCTAssertFalse(text.contains("continue"))
    XCTAssertTrue(text.contains("'CODEX_HOME=/private/profile'"));XCTAssertTrue(text.contains("O'\\''Brien"));XCTAssertFalse(text.contains("\\/canonical"))
  }
  func testPersistedSettingsRemainReadableAfterLargeResearchOutputAndRestart() throws {
    let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer{try? FileManager.default.removeItem(at:file)}
    let context="{\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-6-astra\",\"effort\":\"max\"}}\n"
    let huge="{\"type\":\"response_item\",\"payload\":{\"output\":\""+String(repeating:"x",count:9*1024*1024)+"\"}}\n"
    try Data((context+huge+String(repeating:"{\"type\":\"response_item\",\"payload\":{}}\n",count:50000)).utf8).write(to:file)
    XCTAssertEqual(MacMainWorkspaceNative.resumeConfiguration(file)?.model,"gpt-6-astra")
    XCTAssertEqual(MacMainWorkspaceNative.resumeConfiguration(file)?.effort,"max")
    let handle=try FileHandle(forWritingTo:file);try handle.seekToEnd()
    try handle.write(contentsOf:Data(context.replacingOccurrences(of:"max",with:"high").utf8));try handle.close()
    XCTAssertEqual(MacMainWorkspaceNative.resumeConfiguration(file)?.effort,"high")
  }
  func testRestoredTitleSuppressionIsAReusableDisplayOption() throws {
    XCTAssertEqual(try MacCodexAccountProcess.options(["codex","-c","tui.terminal_title=[]","--model","gpt-6-astra"]),["-c","tui.terminal_title=[]","--model","gpt-6-astra"])
    XCTAssertThrowsError(try MacCodexAccountProcess.options(["codex","-c","model_provider=external"]))
    XCTAssertEqual(try MacCodexAccountProcess.options(["codex","-c","cli_auth_credentials_store=\"keyring\""]),[])
  }
}
