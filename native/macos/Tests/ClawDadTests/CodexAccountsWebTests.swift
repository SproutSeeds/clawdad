import XCTest
import WebKit
@testable import ClawDad

@MainActor final class CodexAccountsWebTests: XCTestCase {
  func testRealWebControlsShareAccountReceiptsAndKeepAuthenticationGuarded() async throws {
    let repo=URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let root=FileManager.default.temporaryDirectory.appendingPathComponent("accounts-ui-fixture-"+UUID().uuidString)
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
    let process=Process();process.executableURL=URL(fileURLWithPath:"/usr/bin/env")
    process.arguments=["node",repo.appendingPathComponent("test/fixtures/codex-accounts-desktop-server.mjs").path,root.path]
    let output=Pipe();process.standardOutput=output;process.standardError=output;try process.run()
    defer{process.terminate();try? FileManager.default.removeItem(at:root)}
    for _ in 0..<100 where !FileManager.default.fileExists(atPath:root.appendingPathComponent("ready.json").path){try await Task.sleep(for:.milliseconds(50))}
    let config=try JSONSerialization.jsonObject(with:Data(contentsOf:root.appendingPathComponent("ready.json"))) as! [String:String]
    let base=try XCTUnwrap(URL(string:try XCTUnwrap(config["baseURL"])))
    let view=WKWebView(frame:CGRect(x:0,y:0,width:980,height:900))
    let window=NSWindow(contentRect:view.frame,styleMask:[.titled,.closable],backing:.buffered,defer:false)
    window.title="ClawDad isolated account UI test";window.contentView=view;window.orderFront(nil)
    defer { window.orderOut(nil) }
    view.load(URLRequest(url:base))
    try await wait(view,"!!document.getElementById('weeklyUsage')?.onclick")
    try await view.evaluateJavaScript("document.getElementById('weeklyUsage').click();document.getElementById('codexAccounts').open=true")
    try await wait(view,"document.getElementById('codexAccounts').textContent.includes('fixture@example.test')")
    try await view.evaluateJavaScript("const fields=document.querySelectorAll('#codexAccounts input');fields[0].value='second@example.test';fields[0].dispatchEvent(new Event('input'));fields[1].value='Personal';document.querySelector('#codexAccounts details').open=true")
    try await view.evaluateJavaScript("const save=[...document.querySelectorAll('button')].find(b=>b.textContent==='Save account entry');save.click();save.click()")
    try await wait(view,"document.getElementById('codexAccounts').textContent.includes('First sign-in or verification required')")
    try await view.evaluateJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Connect account on Mac').click()")
    try await wait(view,"document.getElementById('codexAccounts').textContent.includes('Saved subscription sign-in verified')")
    try await view.evaluateJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Check saved sign-in').click()")
    try await wait(view,"!document.getElementById('codexAccounts').getAttribute('aria-busy') || document.getElementById('codexAccounts').getAttribute('aria-busy')==='false'")
    try await wait(view,"!document.getElementById('codexAccountSwitch').disabled")
    try await view.evaluateJavaScript("document.getElementById('codexAccountSwitch').click()")
    try await wait(view,"document.getElementById('codexAccounts').textContent.includes('Existing Terminal and app-server processes')")
    // Real HTTP acknowledgement is lost after acceptance; status polling must
    // discover the saved operation without another switch request.
    try await view.evaluateJavaScript("void fetch('/fixture/ready')")
    try await view.evaluateJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh account status').click()")
    try await wait(view,"document.getElementById('codexAccountSwitch').textContent==='Switch to this account'")
    try await view.evaluateJavaScript("document.getElementById('codexAccountSwitch').click();document.getElementById('codexAccountSwitch').click()")
    try await wait(view,"document.getElementById('codexAccountSwitchStatus').textContent.includes('Waiting for 1 accepted request')")
    try await wait(view,"[...document.querySelectorAll('button')].some(b=>b.textContent==='Cancel switch'&&!b.disabled)")
    let selectors=try await view.evaluateJavaScript("document.querySelectorAll('#codexAccountSelector').length") as? Int
    let switches=try await view.evaluateJavaScript("document.querySelectorAll('#codexAccountSwitch').length") as? Int
    XCTAssertEqual(selectors,1);XCTAssertEqual(switches,1)
    try await view.evaluateJavaScript("void fetch('/fixture/finish')")
    try await wait(view,"document.getElementById('codexAccountSwitchStatus').textContent.includes('verified') && document.getElementById('codexAccountSwitch').textContent==='Switch to this account'")
    for width in [390,980] {
      view.setFrameSize(NSSize(width:width,height:900))
      window.setContentSize(view.frame.size)
      try await Task.sleep(for:.milliseconds(100))
      let fits=try await view.evaluateJavaScript("document.getElementById('weeklyUsageDialog').getBoundingClientRect().right<=innerWidth && [...document.querySelectorAll('#codexAccounts input,#codexAccounts select,#codexAccounts button,#weeklyUsageClose')].filter(n=>n.getBoundingClientRect().height>0).every(n=>n.getBoundingClientRect().height>=44&&n.getBoundingClientRect().right<=innerWidth)") as? Bool
      XCTAssertEqual(fits,true)
      try await view.evaluateJavaScript("document.getElementById('weeklyUsageDialog').scrollTop=10000")
      let exitVisible=try await view.evaluateJavaScript("(()=>{const r=document.getElementById('weeklyUsageClose').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.height>=44;})()") as? Bool
      XCTAssertEqual(exitVisible,true,"Done remains visible while account details scroll")
      try await view.evaluateJavaScript("document.getElementById('weeklyUsageDialog').scrollTop=0")
      if let folder=ProcessInfo.processInfo.environment["CLAWDAD_ACCOUNTS_TEST_ARTIFACTS"]{
        let shot=try await view.takeSnapshot(configuration:nil)
        if let data=shot.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]){try png.write(to:URL(fileURLWithPath:folder).appendingPathComponent("accounts-web-\(width).png"))}
      }
    }
    try await view.evaluateJavaScript("document.getElementById('weeklyUsageClose').click()")
    let clickedClose=try await view.evaluateJavaScript("!document.getElementById('weeklyUsageDialog').open&&document.activeElement.id==='weeklyUsage'") as? Bool
    XCTAssertEqual(clickedClose,true)
    try await view.evaluateJavaScript("document.getElementById('weeklyUsage').click();document.getElementById('weeklyUsageDialog').dispatchEvent(new Event('cancel',{cancelable:true}))")
    let escapedClose=try await view.evaluateJavaScript("!document.getElementById('weeklyUsageDialog').open&&document.activeElement.id==='weeklyUsage'") as? Bool
    XCTAssertEqual(escapedClose,true)
    try await view.evaluateJavaScript("document.getElementById('weeklyUsage').click()")
    let (data,_)=try await URLSession.shared.data(from:base.appendingPathComponent("fixture/evidence"))
    let evidence=try JSONSerialization.jsonObject(with:data) as! [String:Any]
    XCTAssertEqual((evidence["jobs"] as? [Any])?.count,0)
    let state=try XCTUnwrap(evidence["state"] as? [String:Any]);XCTAssertEqual((state["accounts"] as? [Any])?.count,1)
    XCTAssertEqual((state["activeOperation"] as? [String:Any])?["status"] as? String,"completed")
    XCTAssertEqual((state["activeOperation"] as? [String:Any])?["fenced"] as? Bool,false)
    XCTAssertEqual((evidence["requests"] as? [[String:Any]])?.filter{$0["action"] as? String=="accounts.switch"}.count,2,"One guarded request and one supported request; no replay on double click or lost acknowledgment")
    XCTAssertEqual((evidence["requests"] as? [[String:Any]])?.filter{$0["action"] as? String=="accounts.add"}.count,1)
    XCTAssertEqual((evidence["requests"] as? [[String:Any]])?.filter{$0["action"] as? String=="accounts.signin"}.count,1)
  }
  private func wait(_ view:WKWebView,_ condition:String) async throws {
    for _ in 0..<120 {if (try? await view.evaluateJavaScript(condition)) as? Bool==true{return};try await Task.sleep(for:.milliseconds(50))}
    XCTFail("Account UI did not reach expected state: \(condition)")
  }
}
