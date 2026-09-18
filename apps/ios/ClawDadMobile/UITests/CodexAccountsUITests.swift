import XCTest

@MainActor final class CodexAccountsUITests: XCTestCase {
  func testPreviewAndActivate() throws { try check(large:false,lost:false) }
  func testAccessibleTextAndLostAcknowledgment() throws { try check(large:true,lost:true) }
  func testWaitingForMac() throws { try checkState("mac",title:"Waiting for Mac…") }
  func testWaitingForAppWork() throws { try checkState("work",title:"Waiting for app work…") }
  func testRecoveryNeedsAttention() throws { try checkState("attention",title:"Needs attention") }
  func testUnavailableIdentity() throws { try checkState("unavailable",title:"Activate account") }
  private func checkState(_ mode:String,title:String) throws {
    continueAfterFailure=false
    let app=XCUIApplication();app.launchArguments=["--clawdad-app-store-preview","workspace","--clawdad-weekly-usage-test","--clawdad-assistant-test","--clawdad-accounts-state",mode]
    app.launch();let usage=app.buttons["clawdad.weeklyUsage.main"];XCTAssertTrue(usage.waitForExistence(timeout:15));usage.tap()
    let activate=app.buttons["clawdad.accounts.activate"];XCTAssertTrue(activate.waitForExistence(timeout:5));XCTAssertEqual(activate.label,title)
    if mode=="attention" { XCTAssertTrue(app.buttons["Retry activation"].exists) }
    else { XCTAssertFalse(app.buttons["Retry activation"].exists) }
    if mode=="unavailable" { XCTAssertEqual(app.descendants(matching:.any)["clawdad.accounts.active"].label,"Active account unavailable") }
    let scroll=app.scrollViews.firstMatch
    for _ in 0..<10 where !activate.isHittable || activate.frame.maxY>app.frame.maxY-30 { scroll.swipeUp() }
    XCTAssertTrue(activate.isHittable)
    let shot=XCTAttachment(screenshot:app.screenshot());shot.name="Account state \(mode)";shot.lifetime = .keepAlways;add(shot)
    app.buttons["Done"].firstMatch.tap();XCTAssertTrue(usage.isHittable)
  }
  private func check(large:Bool,lost:Bool) throws {
    continueAfterFailure=false
    let app=XCUIApplication()
    app.launchArguments=["--clawdad-app-store-preview","workspace","--clawdad-weekly-usage-test","--clawdad-assistant-test","--clawdad-accounts-switch-test"]
    if large {app.launchArguments += ["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryAccessibilityXL"]}
    if lost {app.launchArguments.append("--clawdad-accounts-lost-reply-test")}
    app.launch()
    let usage=app.buttons["clawdad.weeklyUsage.main"]
    XCTAssertTrue(usage.waitForExistence(timeout:15));usage.tap()
    let picker=app.buttons["clawdad.accounts.selector"]
    XCTAssertTrue(picker.waitForExistence(timeout:5))
    let scroll=app.scrollViews.firstMatch
    func show(_ element:XCUIElement){
      for _ in 0..<14 where !element.isHittable || element.frame.maxY>app.frame.maxY-30 { scroll.swipeUp() }
      XCTAssertTrue(element.isHittable,app.debugDescription)
    }
    show(picker);XCTAssertGreaterThanOrEqual(picker.frame.height,44);picker.tap()
    app.buttons["second@example.test"].tap()
    XCTAssertTrue(app.staticTexts["45% weekly remaining"].exists)
    XCTAssertTrue(app.descendants(matching:.any)["clawdad.accounts.active"].label.contains("first@example.test"))
    let activate=app.buttons["clawdad.accounts.activate"];show(activate)
    XCTAssertTrue(activate.isEnabled);XCTAssertGreaterThanOrEqual(activate.frame.height,44);activate.tap()
    let active=app.buttons.matching(NSPredicate(format:"label == %@","Active for ClawDad")).firstMatch
    XCTAssertTrue(active.waitForExistence(timeout:12),app.debugDescription)
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
    XCTAssertFalse(app.buttons["Terminal window to recreate"].exists)
    let shot=XCTAttachment(screenshot:app.screenshot());shot.name=large ? "App accounts large text":"App accounts glass";shot.lifetime = .keepAlways;add(shot)
    app.buttons["Done"].firstMatch.tap();XCTAssertTrue(usage.isHittable)
    usage.tap();XCTAssertTrue(picker.waitForExistence(timeout:5))
    XCTAssertTrue(picker.value as? String == "second@example.test")
    app.buttons["Done"].firstMatch.tap()
  }
}
