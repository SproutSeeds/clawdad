import XCTest

@MainActor final class CodexAccountsUITests: XCTestCase {
  func testAccountEntryAndNavigationKeepAuthenticationGuarded() { checkAccounts(largeText: false) }
  func testAccountsAtAccessibilityTextSize() { checkAccounts(largeText: true) }

  func testSelectedAccountSwitchHasImmediateFeedbackAndRecoverableWaiting() throws { try checkSwitch(lostReply: false) }
  func testLostSwitchReplyReconcilesWithoutAnotherTap() throws { try checkSwitch(lostReply: true) }
  func testExactSessionCanBeLeftUnchanged() throws { try checkSwitch(lostReply:false,skip:true) }
  func testSkipAtAccessibilityTextSize() throws { try checkSwitch(lostReply:false,skip:true,largeText:true) }
  func testChosenWindowSwitchKeepsExactSelectionAndCanCancel() throws { try checkSwitch(lostReply:false,window:true) }
  func testChosenWindowAtAccessibilityTextSize() throws { try checkSwitch(lostReply:true,largeText:true,window:true) }
  func testCancelRetriesSameRequestAfterLostConnectionAndConversationReopen() throws { try checkSwitch(lostReply:false,cancelFailure:"before") }
  func testAcceptedCancelLostReplyUnlocksControlsFromStatus() throws { try checkSwitch(lostReply:false,cancelFailure:"after") }

  private func checkSwitch(lostReply: Bool,skip:Bool=false,largeText:Bool=false,window:Bool=false,cancelFailure:String?=nil) throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-weekly-usage-test", "--clawdad-assistant-test", "--clawdad-accounts-switch-test"]
    if lostReply { app.launchArguments.append("--clawdad-accounts-lost-reply-test") }
    if skip { app.launchArguments.append("--clawdad-accounts-skip-test") }
    if window { app.launchArguments.append("--clawdad-accounts-window-test") }
    if cancelFailure=="before" { app.launchArguments.append("--clawdad-cancel-before-accept-test") }
    if cancelFailure=="after" { app.launchArguments.append("--clawdad-cancel-lost-reply-test") }
    if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryAccessibilityXL"] }
    app.launch()
    let usage = app.buttons["clawdad.weeklyUsage.main"]
    XCTAssertTrue(usage.waitForExistence(timeout: 15)); usage.tap()
    let open = app.buttons["clawdad.accounts.open"]
    for _ in 0..<6 where !open.isHittable { app.swipeUp() }
    open.tap()
    let form=app.collectionViews["clawdad.accounts"]
    func show(_ element: XCUIElement, up: Bool = false, actionable:Bool=true) {
      for _ in 0..<14 {
        if element.exists && (!actionable || element.isHittable) && element.frame.minY > app.navigationBars["Codex accounts"].frame.maxY + 12 && element.frame.maxY < app.frame.maxY - 16 { return }
        let backwards=element.exists && element.frame.height > 0 ? element.frame.minY < app.navigationBars["Codex accounts"].frame.maxY + 12 : up
        form.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: backwards ? 0.3 : 0.8)).press(forDuration: 0.05, thenDragTo: form.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: backwards ? 0.8 : 0.3)))
      }
      XCTFail(app.debugDescription)
    }
    let picker=app.buttons["clawdad.accounts.selector"]
    show(picker); XCTAssertGreaterThanOrEqual(picker.frame.height,43.99);picker.tap()
    app.buttons["second@example.test"].tap()
    show(app.buttons["clawdad.accounts.connect"])
    XCTAssertEqual(app.buttons.matching(identifier:"clawdad.accounts.connect").count,1)
    let change=app.buttons["clawdad.accounts.switch"]
    if window {
      show(change);XCTAssertFalse(change.isEnabled)
      let choice=app.buttons["clawdad.accounts.window"]
      show(choice,up:true);XCTAssertGreaterThanOrEqual(choice.frame.height,43.99);choice.tap()
      app.buttons["Terminal window 2 · 3 tabs"].tap()
    }
    show(change);change.tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "clawdad.accounts.progress").firstMatch.waitForExistence(timeout: 2),app.debugDescription)
    let status=app.staticTexts["clawdad.accounts.switchStatus"]
    XCTAssertTrue(status.waitForExistence(timeout: 8));XCTAssertTrue(status.label.contains("2 earlier work receipts"))
    let cancel=app.buttons["Cancel switch"]
    // Lost HTTP acknowledgment is resolved by status, never by a new switch ID.
    let enabled=NSPredicate(format:"enabled == true")
    expectation(for: enabled,evaluatedWith:cancel);waitForExpectations(timeout:8)
    if window {
      XCTAssertTrue(app.staticTexts["Switch stopped"].exists)
      XCTAssertFalse(app.staticTexts["??"].exists)
      let captured=app.descendants(matching:.any).matching(identifier:"clawdad.accounts.selectedWindow").firstMatch
      show(captured,actionable:false)
      XCTAssertTrue(app.staticTexts["Terminal window 2 · 3 tabs"].exists)
      show(change,actionable:false)
      XCTAssertEqual(change.label,"Switch stopped · check recovery")
    }
    if skip {
      let leave=app.buttons["clawdad.accounts.skip.room"]
      show(leave);XCTAssertGreaterThanOrEqual(leave.frame.height,43.99)
      XCTAssertTrue(leave.label.contains("RoomWave"));leave.tap()
      XCTAssertTrue(app.staticTexts["RoomWave left unchanged. Checking the remaining sessions."].waitForExistence(timeout:5))
      let skipped=app.staticTexts["RoomWave · Skipped"];show(skipped,actionable:false)
      XCTAssertTrue(skipped.exists);XCTAssertFalse(leave.exists)
    }
    let shot=XCTAttachment(screenshot:app.screenshot());shot.name=lostReply ? "Switch lost reply reconciled" : "Switch accepted and waiting";shot.lifetime = .keepAlways;add(shot)
    show(cancel,up:true);cancel.tap()
    if cancelFailure=="before" {
      XCTAssertTrue(app.staticTexts["clawdad.accounts.error"].waitForExistence(timeout:5))
      XCTAssertTrue(cancel.isEnabled,"Cancel itself must allow the original pending request to retry")
      app.buttons["Back to weekly allowance"].tap();open.tap()
      show(cancel,up:true);XCTAssertTrue(cancel.isEnabled);cancel.tap()
    }
    XCTAssertTrue(app.staticTexts["Account switch cancelled. Existing work was preserved."].waitForExistence(timeout:5))
    app.buttons["Back to weekly allowance"].tap();open.tap()
    show(picker);XCTAssertTrue(picker.isEnabled);XCTAssertEqual(picker.value as? String,"second@example.test",picker.debugDescription)
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
  }

  private func checkAccounts(largeText: Bool) {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-weekly-usage-test", "--clawdad-assistant-test"]
    if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"] }
    app.launch()
    let usage = app.buttons["clawdad.weeklyUsage.main"]
    XCTAssertTrue(usage.waitForExistence(timeout: 15)); usage.tap()
    func reveal(_ element: XCUIElement, earlier: Bool = false, actionable: Bool = true) {
      for _ in 0..<18 {
        let navigation = app.navigationBars["Codex accounts"]
        let top = navigation.exists ? navigation.frame.maxY + 56 : 0
        let bottom = app.frame.maxY - 12
        if element.exists && element.frame.minY > top && element.frame.maxY < bottom {
          // Static text has no activation point. XCTest can throw while asking
          // for its hittability even though the whole text is visibly on screen.
          if !actionable || element.isHittable { break }
        }
        if navigation.exists {
          let form = app.collectionViews["clawdad.accounts"]
          let down = element.exists && element.frame.height > 0 ? element.frame.minY < top : earlier
          let start = form.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: down ? 0.38 : 0.8))
          let end = form.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: down ? 0.7 : 0.38))
          start.press(forDuration: 0.05, thenDragTo: end)
        }
        else {
          let popover = app.popovers.firstMatch
          if popover.exists {
            popover.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.87))
              .press(forDuration: 0.05, thenDragTo: popover.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.36)))
          } else { app.swipeUp() }
        }
      }
      XCTAssertTrue(element.exists && element.frame.intersects(app.frame), app.debugDescription)
      if actionable { XCTAssertTrue(element.isHittable, app.debugDescription) }
    }
    let accounts = app.buttons["clawdad.accounts.open"]
    reveal(accounts); accounts.tap()
    XCTAssertTrue(app.navigationBars["Codex accounts"].waitForExistence(timeout: 5))
    let email = app.textFields["clawdad.accounts.email"]
    reveal(email); email.tap(); email.typeText("second@example.test")
    XCTAssertEqual(email.value as? String, "second@example.test")
    // Dismiss the keyboard without selecting a new account or starting a call.
    app.buttons["clawdad.accounts.keyboardDone"].tap()
    let save = app.buttons["clawdad.accounts.add"]
    reveal(save)
    XCTAssertGreaterThanOrEqual(save.frame.height, 44)
    save.tap()
    let saved = app.buttons["clawdad.accounts.selector"]
    reveal(saved, actionable: false)
    XCTAssertTrue(saved.waitForExistence(timeout: 5), app.debugDescription)
    XCTAssertEqual(saved.value as? String,"second@example.test")
    let connect = app.buttons["clawdad.accounts.connect"]
    reveal(connect)
    // XCTest can report a 44-point SwiftUI frame as 43.99999999999994.
    XCTAssertGreaterThanOrEqual(connect.frame.height, 44 - 0.01)
    connect.tap()
    let verified = app.staticTexts["Saved subscription sign-in verified"]
    reveal(verified, actionable: false)
    XCTAssertTrue(verified.waitForExistence(timeout: 5))
    let select = app.buttons["Prepare account switch"]
    reveal(select); select.tap()
    let status = app.staticTexts["Live switching needs isolated verification. Current work is preserved."]
    reveal(status, actionable: false)
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = largeText ? "Codex accounts accessibility text" : "Codex accounts guarded selection"
    image.lifetime = .keepAlways; add(image)
    let back = app.buttons["Back to weekly allowance"]
    XCTAssertTrue(back.isHittable); back.tap()
    reveal(accounts); accounts.tap()
    XCTAssertTrue(app.navigationBars["Codex accounts"].waitForExistence(timeout: 5))
    reveal(saved, actionable: false)
    XCTAssertTrue(saved.exists)
    back.tap(); app.buttons["Done"].tap()
    XCTAssertTrue(usage.isHittable)
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
  }
}
