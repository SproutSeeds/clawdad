import XCTest

@MainActor final class CodexAccountsUITests: XCTestCase {
  func testPreviewAndActivate() throws { try check(large:false,lost:false) }
  func testAccessibleTextAndLostAcknowledgment() throws { try check(large:true,lost:true) }
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
