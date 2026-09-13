import XCTest

@MainActor
final class NotificationDelegateUITests: XCTestCase {
  func testRealNotificationTapFromBackgroundKeepsAppAliveAndOpensExactReply() {
    checkNotificationTap(cold: false)
  }

  func testRealNotificationTapAfterTerminationOpensExactReplyWithoutMicrophone() {
    checkNotificationTap(cold: true)
  }

  private func checkNotificationTap(cold: Bool) {
    continueAfterFailure = false
    let app = XCUIApplication()
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test",
      "--clawdad-assistant-long-history", "--clawdad-assistant-notification-reset", "--clawdad-assistant-reset-draft",
      "--clawdad-notification-delegate-fixture=\(UUID().uuidString)"]
    app.launch()
    let allow = springboard.buttons["Allow"]
    if allow.waitForExistence(timeout: 3) { allow.tap() }
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 10))
    XCUIDevice.shared.press(.home)
    let alert = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] 'ClawDad notification regression'")).firstMatch
    if !alert.waitForExistence(timeout: 12) {
      springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01))
        .press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)))
    }
    XCTAssertTrue(alert.waitForExistence(timeout: 5), springboard.debugDescription)
    if cold {
      app.terminate()
      app.launchArguments.removeAll { $0 == "--clawdad-assistant-notification-reset" }
    }
    alert.tap()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
    if cold {
      // SpringBoard cold launches do not carry XCTest's preview arguments.
      // The production delegate must survive and durably retain its target;
      // reopen with the fixture transport (without resetting that target) to
      // verify delivery. No real Mac is connected by this simulator fixture.
      XCTAssertFalse(app.buttons["End voice conversation"].exists)
      app.terminate(); app.launch()
    }
    let reply = app.textViews["clawdad.assistant.text.assistant:22222222-2222-4222-8222-222222222222:final"]
    XCTAssertTrue(reply.waitForExistence(timeout: 15))
    XCTAssertEqual(reply.value as? String, "Exact completed Assistant reply.\nYour work finished while the phone was away.")
    XCTAssertTrue(app.buttons["Pause speech"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
    XCTAssertTrue(app.buttons["clawdad.assistant.start-voice"].exists)
    app.buttons["Stop reading this message"].firstMatch.tap()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
  }
}
