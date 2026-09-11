import XCTest

@MainActor
final class RemoteSpecialKeysUITests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }
  private func app(_ extra: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-special-keys-test", "--clawdad-reset-special-keys"] + extra
    app.launch()
    openKeys(app)
    return app
  }
  private func openKeys(_ app: XCUIApplication) {
    let button = app.buttons["clawdad.remote.specialKeys"]
    let panel = app.scrollViews["clawdad.remote.groupedControls"]
    XCTAssertTrue(panel.waitForExistence(timeout: 20))
    for _ in 0..<10 where !button.isHittable { panel.swipeUp() }
    XCTAssertTrue(button.exists)
    button.tap()
    XCTAssertTrue(app.buttons["clawdad.specialKeys.edit"].waitForExistence(timeout: 5))
  }
  private func reveal(_ button: XCUIElement, app: XCUIApplication) {
    for _ in 0..<10 where !button.isHittable { app.swipeUp() }
    XCTAssertTrue(button.isHittable)
  }
  private func photo(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = name; shot.lifetime = .keepAlways; add(shot)
  }
  func testShiftLeftSendsExactChordAndReturnsToControls() {
    let app = app(["--clawdad-special-keys-expect-shift-left"])
    let shift = app.buttons["clawdad.specialKeys.preset.shift_left"]
    reveal(shift, app: app)
    photo(app, "Special Keys with Shift Left")
    XCTAssertGreaterThanOrEqual(shift.frame.height, 44)
    shift.tap()
    XCTAssertTrue(app.staticTexts["Special key received"].waitForExistence(timeout: 8))
  }
  func testCreateEditCancelRestoreDeleteAndPersistWithoutSending() {
    let app = app()
    app.buttons["clawdad.specialKeys.edit"].tap()
    app.buttons["clawdad.specialKeys.add"].tap()
    let title = app.textFields["clawdad.specialKeys.title"]
    title.tap(); title.typeText("Select word")
    app.buttons["clawdad.specialKeys.modifier.option"].tap()
    XCTAssertEqual(app.buttons["clawdad.specialKeys.modifier.option"].value as? String, "On")
    photo(app, "Edit custom selection shortcut")
    app.buttons["clawdad.specialKeys.save"].tap()
    app.buttons["clawdad.specialKeys.edit"].tap()
    XCTAssertFalse(app.staticTexts["Special key received"].exists)
    app.terminate()
    app.launchArguments.removeAll { $0 == "--clawdad-reset-special-keys" }
    app.launch(); openKeys(app)
    app.buttons["clawdad.specialKeys.edit"].tap()
    let custom = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Select word,")).firstMatch
    reveal(custom, app: app); custom.tap()
    XCTAssertEqual(app.textFields["clawdad.specialKeys.title"].value as? String, "Select word")
    XCTAssertEqual(app.buttons["clawdad.specialKeys.modifier.option"].value as? String, "On")
    app.buttons["clawdad.specialKeys.modifier.control"].tap()
    app.buttons["clawdad.specialKeys.back"].tap()
    reveal(custom, app: app); custom.tap()
    XCTAssertEqual(app.buttons["clawdad.specialKeys.modifier.control"].value as? String, "Off")
    let delete = app.buttons["clawdad.specialKeys.delete"]
    reveal(delete, app: app); delete.tap()
    app.buttons["Delete"].tap()
    XCTAssertFalse(custom.exists)
    let builtin = app.buttons["clawdad.specialKeys.preset.shift_left"]
    reveal(builtin, app: app); builtin.tap()
    app.buttons["clawdad.specialKeys.modifier.option"].tap()
    let restore = app.buttons["clawdad.specialKeys.restore"]
    reveal(restore, app: app); restore.tap()
    XCTAssertEqual(app.buttons["clawdad.specialKeys.modifier.option"].value as? String, "Off")
    app.buttons["clawdad.specialKeys.save"].tap()
    app.buttons["clawdad.specialKeys.back"].tap()
    app.buttons["clawdad.specialKeys.back"].tap()
    XCTAssertTrue(app.buttons["clawdad.remote.specialKeys"].exists)
    XCTAssertFalse(app.staticTexts["Special key received"].exists)
  }
  func testOldHostExplainsUnsupportedChordsAndStillAllowsEditing() {
    let app = app(["--clawdad-preview-old-key-host"])
    XCTAssertTrue(app.staticTexts["clawdad.specialKeys.unavailable"].waitForExistence(timeout: 8))
    let shift = app.buttons["clawdad.specialKeys.preset.shift_left"]
    reveal(shift, app: app)
    XCTAssertFalse(shift.isEnabled)
    app.buttons["clawdad.specialKeys.edit"].tap()
    XCTAssertTrue(shift.isEnabled)
    shift.tap()
    XCTAssertTrue(app.buttons["clawdad.specialKeys.save"].exists)
    app.buttons["clawdad.specialKeys.back"].tap()
    app.buttons["clawdad.specialKeys.back"].tap()
    app.buttons["clawdad.specialKeys.back"].tap()
    XCTAssertTrue(app.buttons["clawdad.remote.specialKeys"].exists)
  }

  func testLargerTextKeyPickerAndKeyboardHaveVisibleNavigation() {
    let app = app(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"])
    photo(app, "Special Keys with accessibility text size")
    app.buttons["clawdad.specialKeys.edit"].tap()
    app.buttons["clawdad.specialKeys.add"].tap()
    let title = app.textFields["clawdad.specialKeys.title"]
    title.tap(); title.typeText("Select next")
    photo(app, "Special key editor with keyboard and larger text")
    let picker = app.buttons["clawdad.specialKeys.key"]
    reveal(picker, app: app); picker.tap()
    app.buttons["Right Arrow"].tap()
    app.buttons["clawdad.specialKeys.save"].tap()
    XCTAssertTrue(app.buttons["clawdad.specialKeys.back"].isHittable)
    app.buttons["clawdad.specialKeys.back"].tap()
    app.buttons["clawdad.specialKeys.back"].tap()
    XCTAssertTrue(app.scrollViews["clawdad.remote.groupedControls"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["clawdad.specialKeys.edit"].exists)
    XCTAssertFalse(app.staticTexts["Special key received"].exists)
  }
}
