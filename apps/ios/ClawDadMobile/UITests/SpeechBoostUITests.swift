import XCTest

final class SpeechBoostUITests: XCTestCase {
  func testSpeechBoostSettingsPersistenceAndReset() { check(large: false) }
  func testSpeechBoostSettingsLargeText() { check(large: true) }
  private func check(large: Bool) {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    if large { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"] }
    func openSettings() {
      app.launch(); XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 20)); app.buttons["Settings"].tap()
      for _ in 0..<30 where !app.sliders["speechBoost.slider"].isHittable {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.78))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
        start.press(forDuration: 0.01, thenDragTo: end)
      }
      XCTAssertTrue(app.sliders["speechBoost.slider"].isHittable)
    }
    openSettings()
    let slider = app.sliders["speechBoost.slider"]
    let reset = app.buttons["speechBoost.reset"]
    reset.tap(); XCTAssertEqual(app.staticTexts["speechBoost.value"].label, "0 dB")
    slider.adjust(toNormalizedSliderPosition: 0.3)
    let selected = app.staticTexts["speechBoost.value"].label
    XCTAssertTrue(selected.hasPrefix("+")); XCTAssertTrue(selected.hasSuffix(" dB"))
    XCTAssertTrue(app.buttons["speechBoost.preview"].exists)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = large ? "Speech boost large text" : "Speech boost compact"
    screenshot.lifetime = .keepAlways; add(screenshot)
    app.terminate(); openSettings()
    XCTAssertEqual(app.staticTexts["speechBoost.value"].label, selected)
    for _ in 0..<8 where !reset.isHittable { app.swipeUp() }
    reset.tap(); XCTAssertEqual(app.staticTexts["speechBoost.value"].label, "0 dB")
    XCTAssertTrue(app.buttons["Done"].isHittable); app.buttons["Done"].tap()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
  }
}
