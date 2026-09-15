import XCTest

@MainActor final class CodexAccountsUITests: XCTestCase {
  func testAccountEntryAndNavigationKeepAuthenticationGuarded() { checkAccounts(largeText: false) }
  func testAccountsAtAccessibilityTextSize() { checkAccounts(largeText: true) }

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
          let down = element.exists ? element.frame.minY < top : earlier
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
    XCTAssertTrue(app.staticTexts["fixture@example.test"].waitForExistence(timeout: 5))
    let email = app.textFields["clawdad.accounts.email"]
    reveal(email); email.tap(); email.typeText("second@example.test")
    XCTAssertEqual(email.value as? String, "second@example.test")
    // Dismiss the keyboard without selecting a new account or starting a call.
    app.buttons["clawdad.accounts.keyboardDone"].tap()
    let save = app.buttons["clawdad.accounts.add"]
    reveal(save)
    XCTAssertGreaterThanOrEqual(save.frame.height, 44)
    save.tap()
    let saved = app.staticTexts["second@example.test"]
    reveal(saved, earlier: true, actionable: false)
    XCTAssertTrue(saved.waitForExistence(timeout: 5), app.debugDescription)
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
