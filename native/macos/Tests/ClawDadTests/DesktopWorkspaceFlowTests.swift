import XCTest
import WebKit
import ClawDadRemoteAssistProtocol
@testable import ClawDad

// Real web view -> HTTP AssistantRuntime -> native poll -> production snapshot
// engine. Only the terminal hardware boundary is an in-memory fixture. No AX,
// AppleScript, real Terminal window or real snapshot path is reachable here.
@MainActor final class DesktopWorkspaceFlowTests:XCTestCase {
  func testDesktopSaveOpenAndMCPShareExactDurableReceipts() async throws {
    let repository=URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let root=FileManager.default.temporaryDirectory.appendingPathComponent("workspace-desktop-test-"+UUID().uuidString)
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
    let process=Process();process.executableURL=URL(fileURLWithPath:"/usr/bin/env")
    process.arguments=["node",repository.appendingPathComponent("test/fixtures/workspace-desktop-server.mjs").path,root.path]
    let output=Pipe();process.standardOutput=output;process.standardError=output;try process.run()
    defer { process.terminate();try? FileManager.default.removeItem(at:root) }
    for _ in 0..<150 where !FileManager.default.fileExists(atPath:root.appendingPathComponent("ready.json").path) {
      guard process.isRunning else { throw MacAssistantError(String(data:output.fileHandleForReading.readDataToEndOfFile(),encoding:.utf8) ?? "Fixture failed") }
      try await Task.sleep(for:.milliseconds(50))
    }
    let config=try JSONSerialization.jsonObject(with:Data(contentsOf:root.appendingPathComponent("ready.json"))) as! [String:String]
    let base=try XCTUnwrap(URL(string:try XCTUnwrap(config["baseURL"])))
    let native=MainWorkspaceFixture()
    native.live=(0..<2).map { i in MainWorkspaceLiveTab(tabId:"fixture-\(i)",group:"test-window",tty:"fixture-tty-\(i)",owner:"fixture-owner-\(i)",directory:"/fixture/same-project",kind:"codex",sessionId:"00000000-0000-4000-8000-00000000000\(i)",conversationPath:"/fixture/rollout-\(i)",executable:"/fixture/codex",name:"Fixture \(i)",position:i+1,selected:i==0,fullScreen:false,draft:.init(text:"Draft Ω \(i)",capturedAt:Date(),transcriptOffset:1)) }
    for i in native.live.indices { native.live[i].lifetime="fixture-login-\(i)" }
    native.selectedOnlyInLightInventory=true // Mac restart: only selected tab has a process binding.
    let store=MainTerminalWorkspace(root:root.appendingPathComponent("MainTerminalWorkspace"),native:native)
    var finished=false
    let worker=Task { @MainActor in
      while !finished {
        if let value=try? await self.json(base,"/v1/assistant/native/poll",["workerId":"isolated-workspace-fixture"]),let raw=value["job"] as? [String:Any] {
          let action=raw["action"] as? String ?? "",id=raw["id"] as? String ?? ""
          do {
            guard ["mainworkspace.windows","mainworkspace.preview","mainworkspace.save","mainworkspace.restore"].contains(action) else { throw MacAssistantError("Fixture rejects every non-workspace action") }
            let args=try JSONDecoder().decode([String:AssistantValue].self,from:JSONSerialization.data(withJSONObject:raw["args"] ?? [:]))
            let result=try await store.control(action,args:args,requestId:id)
            let object=try JSONSerialization.jsonObject(with:JSONEncoder().encode(result))
            _=try await self.json(base,"/v1/assistant/native/result",["id":id,"result":object])
          } catch { _=try? await self.json(base,"/v1/assistant/native/result",["id":id,"error":error.localizedDescription]) }
        }
        try? await Task.sleep(for:.milliseconds(30))
      }
    }
    defer { finished=true;_ = worker }
    let view=WKWebView(frame:CGRect(x:0,y:0,width:980,height:900))
    let window=NSWindow(contentRect:view.frame,styleMask:[.titled,.closable],backing:.buffered,defer:false)
    window.title="ClawDad isolated workspace UI test";window.contentView=view;window.orderFront(nil)
    defer { window.orderOut(nil) }
    view.load(URLRequest(url:base))
    try await wait(view,"!!document.getElementById('mainWorkspaceOpen')?.onclick")
    try await js(view,"document.getElementById('mainWorkspaceSaveOpen').click()")
    try await wait(view,"document.getElementById('mainWorkspaceDialog').open && !document.getElementById('mainWorkspaceScan').disabled")
    var evidence=try await json(base,"/fixture/evidence",[:])
    XCTAssertTrue((evidence["requests"] as? [[String:Any]] ?? []).allSatisfy{$0["action"] as? String=="mainworkspace.status"},"Opening only reads status")
    try await js(view,"document.getElementById('mainWorkspaceScan').click()")
    try await wait(view,"!document.getElementById('mainWorkspaceWindow').disabled && document.getElementById('mainWorkspaceWindow').value!==''")
    XCTAssertEqual(try store.read().observations?.count,1)
    let completeChoice=try await view.evaluateJavaScript("document.getElementById('mainWorkspaceWindow').selectedOptions[0].text.includes('2 tabs')") as? Bool
    XCTAssertEqual(completeChoice,true,"Chooser uses complete topology rather than partial process observations")
    let noReview=try await view.evaluateJavaScript("document.getElementById('mainWorkspaceReview')===null") as? Bool
    XCTAssertEqual(noReview,true)
    XCTAssertEqual(native.captures,0,"Choosing a window does not tour its tabs")
    XCTAssertTrue(try store.read().roster.entries.isEmpty)
    try await js(view,"document.getElementById('mainWorkspaceName').value='Desktop fixture Ω';document.getElementById('mainWorkspaceName').dispatchEvent(new Event('input'))")
    try await wait(view,"!document.getElementById('mainWorkspaceSave').disabled")
    for width in [390,980] {
      view.setFrameSize(NSSize(width:width,height:900));window.setContentSize(view.frame.size)
      try await Task.sleep(for:.milliseconds(100))
      let fits=try await view.evaluateJavaScript("document.getElementById('mainWorkspaceDialog').getBoundingClientRect().right<=innerWidth && ['mainWorkspaceSave','mainWorkspaceName','mainWorkspaceWindow'].every(id=>document.getElementById(id).getBoundingClientRect().height>=44)") as? Bool
      XCTAssertEqual(fits,true)
      if let folder=ProcessInfo.processInfo.environment["CLAWDAD_WORKSPACE_TEST_ARTIFACTS"] {
      let shot=try await view.takeSnapshot(configuration:nil)
      if let data=shot.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]) {
        try png.write(to:URL(fileURLWithPath:folder).appendingPathComponent("desktop-save-\(width).png"))
      }
      }
    }
    native.captureDelay=2000
    try await js(view,"document.getElementById('mainWorkspaceSave').click();document.getElementById('mainWorkspaceSave').click()")
    try await wait(view,"!document.getElementById('mainWorkspaceSpinner').hidden && document.getElementById('mainWorkspaceStatus').textContent.includes('Saving tab')")
    let inputsHeld=try await view.evaluateJavaScript("document.getElementById('mainWorkspaceName').disabled && document.getElementById('mainWorkspaceSave').disabled") as? Bool
    XCTAssertEqual(inputsHeld,true)
    try await js(view,"document.getElementById('mainWorkspaceClose').click();document.getElementById('mainWorkspaceSaveOpen').click()")
    try await wait(view,"!document.getElementById('mainWorkspaceSavedPane').hidden && !document.getElementById('mainWorkspaceRestore').disabled")
    native.captureDelay=0
    XCTAssertEqual(native.captures,1);XCTAssertEqual(native.visits,["fixture-0","fixture-1"])
    let detailsOptional=try await view.evaluateJavaScript("!document.getElementById('mainWorkspaceSavedDetails').open") as? Bool
    XCTAssertEqual(detailsOptional,true)
    let saved=try store.read(),snapshot=try XCTUnwrap(saved.snapshots?.first)
    XCTAssertEqual(saved.snapshots?.count,1);XCTAssertEqual(snapshot.roster.entries.map(\.sessionId),native.live.map(\.sessionId))
    XCTAssertEqual(native.closes,0);XCTAssertEqual(native.launches,0)
    // The same exact saved setup is visible over the actual Assistant MCP tool.
    let inspected=try await json(base,"/fixture/mcp",["name":"main_terminal_workspace","arguments":["snapshotId":snapshot.id]])
    XCTAssertEqual((inspected["mainWorkspace"] as? [String:Any])?["snapshotRevision"] as? Int,1)
    evidence=try await json(base,"/fixture/evidence",[:])
    let saveRequest=try XCTUnwrap((evidence["requests"] as? [[String:Any]])?.first{$0["action"] as? String=="mainworkspace.save"})
    var savedArgs=saveRequest;savedArgs.removeValue(forKey:"action")
    let saveReplay=try await json(base,"/fixture/mcp",["name":"save_main_terminal_workspace","arguments":savedArgs])
    XCTAssertEqual((saveReplay["job"] as? [String:Any])?["status"] as? String,"completed")
    XCTAssertEqual(native.captures,1,"MCP reconciliation returns the accepted UI receipt without another pass")
    native.selectedOnlyInLightInventory=false
    native.live=[] // Only the in-memory fixture is closed. No Terminal API exists here.
    try await js(view,"document.getElementById('mainWorkspaceRestore').click();document.getElementById('mainWorkspaceRestore').click()")
    try await wait(view,"document.getElementById('mainWorkspaceStatus').textContent.includes('Setup is open')")
    XCTAssertEqual(native.creates,2);XCTAssertEqual(native.launches,2);XCTAssertEqual(native.closes,0)
    XCTAssertEqual(native.live.compactMap(\.sessionId),snapshot.roster.entries.compactMap(\.sessionId))
    let restoredID=try XCTUnwrap(try store.read().activeRequest)
    let duplicate=try await json(base,"/fixture/mcp",["name":"restore_main_terminal_workspace","arguments":["snapshotId":snapshot.id,"expectedSnapshotRevision":1,"requestId":restoredID]])
    XCTAssertEqual((duplicate["job"] as? [String:Any])?["status"] as? String,"completed")
    XCTAssertEqual(native.creates,2)
    // Polling keeps a selected saved draft's DOM node and its expanded state.
    try await js(view,"document.getElementById('mainWorkspaceSavedDetails').open=true;window.retainedRow=document.querySelector('#mainWorkspaceEntries details');retainedRow.open=true")
    try await Task.sleep(for:.milliseconds(2200))
    let retained=try await view.evaluateJavaScript("retainedRow===document.querySelector('#mainWorkspaceEntries details') && retainedRow.open") as? Bool
    XCTAssertEqual(retained,true)
    _=try await store.control("mainworkspace.remove",args:["snapshotId":.string(snapshot.id),"entryId":.string(snapshot.roster.entries[1].id),"expectedRevision":.number(Double(try store.read().revision))],requestId:"fixture-other-client-update")
    try await wait(view,"!document.getElementById('mainWorkspaceStale').hidden")
    let held=try await view.evaluateJavaScript("document.querySelectorAll('#mainWorkspaceEntries details').length===2 && document.getElementById('mainWorkspaceRestore').disabled") as? Bool
    XCTAssertEqual(held,true,"Another client's update cannot replace the reviewed lineup")
    try await js(view,"document.getElementById('mainWorkspaceReviewLatest').click()")
    try await wait(view,"document.querySelectorAll('#mainWorkspaceEntries details').length===1 && !document.getElementById('mainWorkspaceRestore').disabled")
    XCTAssertEqual(native.creates,2,"Reviewing the newer version never restores it")
    for width in [390,980] {
      view.setFrameSize(NSSize(width:width,height:844));window.setContentSize(view.frame.size)
      try await Task.sleep(for:.milliseconds(100))
      let fits=try await view.evaluateJavaScript("document.getElementById('mainWorkspaceDialog').getBoundingClientRect().right<=innerWidth") as? Bool
      XCTAssertEqual(fits,true)
      let targets=try await view.evaluateJavaScript("['mainWorkspaceNamed','mainWorkspaceRestore','mainWorkspaceClose'].every(id=>document.getElementById(id).getBoundingClientRect().height>=44)") as? Bool
      XCTAssertEqual(targets,true)
      let shot=try await view.takeSnapshot(configuration:nil)
      let attachment=XCTAttachment(image:shot);attachment.name="Terminal setups \(width)";attachment.lifetime = .keepAlways;add(attachment)
      if let folder=ProcessInfo.processInfo.environment["CLAWDAD_WORKSPACE_TEST_ARTIFACTS"],let data=shot.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]) { try png.write(to:URL(fileURLWithPath:folder).appendingPathComponent("desktop-\(width).png")) }
    }
    try await js(view,"document.getElementById('mainWorkspaceClose').click()")
    let focused=try await view.evaluateJavaScript("document.activeElement.id") as? String
    XCTAssertEqual(focused,"mainWorkspaceSaveOpen")
    try await js(view,"document.getElementById('mainWorkspaceOpen').click()")
    try await wait(view,"document.getElementById('mainWorkspaceDialog').open && !document.getElementById('mainWorkspaceSavedPane').hidden")
    try await js(view,"document.getElementById('mainWorkspaceClose').click();window.originalModal=HTMLDialogElement.prototype.showModal;HTMLDialogElement.prototype.showModal=function(){window.saveExposedAtModalOpen=!document.getElementById('mainWorkspaceSavePane').hidden;return originalModal.call(this)};document.getElementById('mainWorkspaceSaveOpen').click()")
    try await wait(view,"document.getElementById('mainWorkspaceDialog').open && !document.getElementById('mainWorkspaceSavePane').hidden")
    let modalExposed=try await view.evaluateJavaScript("saveExposedAtModalOpen && document.getElementById('mainWorkspaceWindow').labels[0].textContent.includes('Terminal window') && document.getElementById('mainWorkspaceDialog').lastElementChild.id==='mainWorkspaceSavePane' && document.getElementById('mainWorkspaceName').value==='Desktop fixture Ω'") as? Bool
    XCTAssertEqual(modalExposed,true,"Expose Save before WebKit builds the modal focus/accessibility tree")
    try await js(view,"document.getElementById('mainWorkspaceClose').click();HTMLDialogElement.prototype.showModal=originalModal;void 0")
    evidence=try await json(base,"/fixture/evidence",[:])
    if let folder=ProcessInfo.processInfo.environment["CLAWDAD_WORKSPACE_TEST_ARTIFACTS"] {
      try JSONSerialization.data(withJSONObject:evidence,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:folder).appendingPathComponent("native-transport-receipts.json"))
    }
  }
  func js(_ view:WKWebView,_ code:String) async throws { print("Workspace UI step: \(code)");_=try await view.evaluateJavaScript(code) }
  func wait(_ view:WKWebView,_ condition:String) async throws {
    print("Workspace UI wait: \(condition)")
    for _ in 0..<250 {
      if (try? await view.evaluateJavaScript(condition)) as? Bool==true { return }
      try await Task.sleep(for:.milliseconds(50))
    }
    let error=(try? await view.evaluateJavaScript("document.getElementById('mainWorkspaceError')?.textContent")) as? String
    throw MacAssistantError("UI condition timed out: \(condition). \(error ?? "")")
  }
  func json(_ base:URL,_ route:String,_ body:[String:Any]) async throws -> [String:Any] {
    var request=URLRequest(url:try XCTUnwrap(URL(string:route,relativeTo:base)))
    request.httpMethod="POST";request.setValue("application/json",forHTTPHeaderField:"Content-Type")
    request.httpBody=try JSONSerialization.data(withJSONObject:body)
    let (data,response)=try await URLSession.shared.data(for:request)
    let value=try JSONSerialization.jsonObject(with:data) as! [String:Any]
    guard (response as? HTTPURLResponse)?.statusCode==200 else { throw MacAssistantError(value["error"] as? String ?? "Fixture HTTP error") }
    return value
  }
}
