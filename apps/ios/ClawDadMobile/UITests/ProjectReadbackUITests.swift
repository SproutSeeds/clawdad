import XCTest

@MainActor
final class ProjectReadbackUITests: XCTestCase {
  func testProjectMessageReadbackAndResponseSwitch() { check(call: false, large: false) }
  func testProjectReadbackLargeText() { check(call: false, large: true) }
  func testProjectReadbackPreservesActiveMutedCall() { check(call: true, large: false) }
  private func check(call: Bool, large: Bool) {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", call ? "workspace" : "conversation", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    if large { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"] }
    app.launch()
    let mic = app.buttons["clawdad.assistant.mute"]
    var muted = ""
    if call {
      XCTAssertTrue(app.buttons["Call Assistant"].waitForExistence(timeout: 20)); app.buttons["Call Assistant"].tap()
      XCTAssertTrue(mic.waitForExistence(timeout: 8)); mic.tap(); muted = mic.label
      XCTAssertEqual(muted, "Unmute Assistant")
      let thread = app.buttons["Open Paid beta launch"]
      for _ in 0..<15 where !thread.isHittable { app.swipeUp() }
      XCTAssertTrue(thread.isHittable); thread.tap()
    }
    XCTAssertTrue(app.descendants(matching: .any)["clawdad.thread.detail"].waitForExistence(timeout: 15))
    func speaker(_ kind: String) -> XCUIElement {
      let query = app.buttons.matching(identifier: "clawdad.read-aloud.\(kind)")
      let scroll = app.scrollViews.matching(identifier: "clawdad.thread.detail").firstMatch
      for _ in 0..<15 {
        let visible = scroll.frame.insetBy(dx: 0, dy: 8)
        if let button = query.allElementsBoundByIndex.first(where: { $0.isHittable && visible.contains($0.frame) }) { return button }
        let known = query.allElementsBoundByIndex.first
        let older = known.map { $0.frame.midY < visible.midY } ?? (kind == "message")
        let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: older ? 0.2 : 0.8))
        let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: older ? 0.8 : 0.2))
        start.press(forDuration: 0.02, thenDragTo: end)
      }
      XCTFail("Message speaker should be reachable"); return query.firstMatch
    }
    let user = speaker("message")
    XCTAssertGreaterThanOrEqual(user.frame.width, 44); XCTAssertGreaterThanOrEqual(user.frame.height, 44)
    user.tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.pause-speech"].waitForExistence(timeout: 8))
    XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "End the Assistant voice conversation before")).firstMatch.exists)
    XCTAssertEqual(app.buttons["End voice conversation"].exists, call)
    app.buttons["clawdad.assistant.pause-speech"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.resume-speech"].waitForExistence(timeout: 5))
    app.buttons["clawdad.assistant.resume-speech"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.pause-speech"].waitForExistence(timeout: 5))
    app.buttons["Stop reading this message"].tap()
    let agent = speaker("response"); agent.tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.pause-speech"].waitForExistence(timeout: 8))
    if call { XCTAssertEqual(mic.label, muted); XCTAssertTrue(app.buttons["End voice conversation"].exists) }
    let image = XCTAttachment(screenshot: app.screenshot()); image.name = "Project readback call=\(call) large=\(large)"; image.lifetime = .keepAlways; add(image)
    app.buttons["Stop reading this message"].tap()
  }
}
