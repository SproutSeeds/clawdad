import XCTest
import WebKit
@testable import ClawDad

@MainActor final class CodexAccountsWebTests: XCTestCase {
  func testAppAccountPreviewActivateAndLostReplyThroughRealHTTP() async throws {
    let repo=URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let root=FileManager.default.temporaryDirectory.appendingPathComponent("accounts-ui-fixture-"+UUID().uuidString)
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
    let process=Process();process.executableURL=URL(fileURLWithPath:"/usr/bin/env")
    process.arguments=["node",repo.appendingPathComponent("test/fixtures/codex-accounts-desktop-server.mjs").path,root.path]
    process.standardOutput=Pipe();let errors=Pipe();process.standardError=errors;try process.run()
    defer{process.terminate();try? FileManager.default.removeItem(at:root)}
    for _ in 0..<240 where !FileManager.default.fileExists(atPath:root.appendingPathComponent("ready.json").path){if !process.isRunning {break};try await Task.sleep(for:.milliseconds(50))}
    if !process.isRunning { XCTFail(String(data:errors.fileHandleForReading.readDataToEndOfFile(),encoding:.utf8) ?? "Fixture exited") }
    let config=try JSONSerialization.jsonObject(with:Data(contentsOf:root.appendingPathComponent("ready.json"))) as! [String:String]
    let base=try XCTUnwrap(URL(string:try XCTUnwrap(config["baseURL"])))
    let view=WKWebView(frame:CGRect(x:0,y:0,width:980,height:900))
    let window=NSWindow(contentRect:view.frame,styleMask:[.titled,.closable],backing:.buffered,defer:false)
    window.title="ClawDad account UI fixture";window.contentView=view;window.orderFront(nil);defer{window.orderOut(nil)}
    view.load(URLRequest(url:base));try await wait(view,"!!document.getElementById('weeklyUsage')?.onclick")
    try await view.evaluateJavaScript("document.getElementById('weeklyUsage').click()")
    try await wait(view,"document.getElementById('codexAccountSelector')?.options.length===2")
    try await view.evaluateJavaScript("const s=document.getElementById('codexAccountSelector');s.selectedIndex=1;s.dispatchEvent(new Event('change'))")
    try await wait(view,"document.getElementById('codexAccounts').textContent.includes('0% weekly remaining')")
    let untouched=try await view.evaluateJavaScript("document.getElementById('codexAccounts').firstChild.textContent==='Active · fixture@example.test'") as? Bool
    XCTAssertEqual(untouched,true,"Preview must not activate")
    _=try await URLSession.shared.data(from:base.appendingPathComponent("fixture/identity-mismatch"))
    try await wait(view,"document.getElementById('codexAccounts').firstChild.textContent==='Active · second@example.test'")
    _=try await URLSession.shared.data(from:base.appendingPathComponent("fixture/identity-unavailable"))
    try await wait(view,"document.getElementById('codexAccounts').firstChild.textContent==='Active account unavailable'")
    _=try await URLSession.shared.data(from:base.appendingPathComponent("fixture/identity-reset"))
    try await wait(view,"document.getElementById('codexAccounts').firstChild.textContent==='Active · fixture@example.test'")
    for width in [375,430,980] {
      view.setFrameSize(NSSize(width:width,height:900));window.setContentSize(view.frame.size)
      try await Task.sleep(for:.milliseconds(100))
      let fits=try await view.evaluateJavaScript("[...document.querySelectorAll('#codexAccounts select,#codexAccounts button,#weeklyUsageClose')].filter(n=>n.getBoundingClientRect().height>0).every(n=>n.getBoundingClientRect().height>=44&&n.getBoundingClientRect().right<=innerWidth)") as? Bool
      XCTAssertEqual(fits,true)
      if let folder=ProcessInfo.processInfo.environment["CLAWDAD_ACCOUNTS_TEST_ARTIFACTS"] {
        let shot=try await view.takeSnapshot(configuration:nil)
        if let data=shot.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]){try png.write(to:URL(fileURLWithPath:folder).appendingPathComponent("app-accounts-web-\(width).png"))}
      }
    }
    _=try await URLSession.shared.data(from:base.appendingPathComponent("fixture/drop"))
    try await view.evaluateJavaScript("document.getElementById('codexAccountSwitch').click();document.getElementById('codexAccountSwitch').click()")
    try await wait(view,"document.getElementById('codexAccounts').firstChild.textContent==='Active · second@example.test'&&document.getElementById('codexAccountSwitch').textContent==='Active'")
    let (data,_)=try await URLSession.shared.data(from:base.appendingPathComponent("fixture/evidence"))
    let evidence=try JSONSerialization.jsonObject(with:data) as! [String:Any]
    let requests=evidence["requests"] as? [[String:Any]] ?? []
    XCTAssertEqual(requests.filter{$0["action"] as? String=="accounts.activate"}.count,1)
    XCTAssertTrue(requests.allSatisfy{$0["windowSelection"]==nil})
    XCTAssertEqual((evidence["jobs"] as? [Any])?.count,0)
    try await view.evaluateJavaScript("document.getElementById('weeklyUsageClose').click()")
    let closed=try await view.evaluateJavaScript("!document.getElementById('weeklyUsageDialog').open&&document.activeElement.id==='weeklyUsage'") as? Bool
    XCTAssertEqual(closed,true)
  }
  private func wait(_ view:WKWebView,_ condition:String) async throws {
    for _ in 0..<200 {if (try? await view.evaluateJavaScript(condition)) as? Bool==true{return};try await Task.sleep(for:.milliseconds(50))}
    XCTFail("Account UI did not reach expected state: \(condition)")
  }
}
