import XCTest

@MainActor
final class AssistantUITests: XCTestCase {
  func testResponsePhoneAndAddressLinksOpenTheirIntendedDestinations() {
    checkResponseLinks(googleInstalled: true)
  }
  func testResponseAddressFallsBackToAppleMaps() {
    checkResponseLinks(googleInstalled: false)
  }
  private func checkResponseLinks(googleInstalled: Bool) {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-links-test"]
      + (googleInstalled ? [] : ["--clawdad-assistant-no-google"])
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.open"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.open"].tap()
    app.buttons["clawdad.assistant.return"].tap()
    let phone = app.links["(415) 555-0100"]
    XCTAssertTrue(phone.waitForExistence(timeout: 5))
    phone.tap()
    let destination = app.staticTexts["clawdad.assistant.link-destination"]
    XCTAssertTrue(destination.waitForExistence(timeout: 3))
    XCTAssertTrue(destination.label.hasPrefix("tel:"))
    let address = app.links["123 Main Street, San Francisco, CA 94105"]
    XCTAssertTrue(address.exists)
    address.tap()
    let prefix = googleInstalled ? "comgooglemaps:" : "https://maps.apple.com/"
    let opened = expectation(for: NSPredicate(format: "label BEGINSWITH %@", prefix), evaluatedWith: destination)
    wait(for: [opened], timeout: 3)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = googleInstalled ? "Assistant tappable business contact" : "Assistant map fallback"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    app.buttons["clawdad.assistant.back"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.return"].exists)
  }

  func testSendNowAndPausePreferenceAreAvailableWithoutLeavingTheCall() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-send-test"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.open"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.open"].tap()
    let send = app.buttons["clawdad.assistant.send-now"]
    XCTAssertTrue(send.waitForExistence(timeout: 5))
    XCTAssertTrue(send.isEnabled)
    let bar = XCTAttachment(screenshot: app.screenshot())
    bar.name = "Assistant Send now on the call bar"
    bar.lifetime = .keepAlways
    add(bar)
    app.buttons["clawdad.assistant.return"].tap()
    XCTAssertTrue(app.staticTexts["You · Draft"].waitForExistence(timeout: 5))
    app.buttons["clawdad.assistant.voice-sending"].tap()
    XCTAssertTrue(app.buttons["Wait for Send"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.buttons["Send after a pause"].exists)
    app.buttons["Wait for Send"].tap()
    let draft = XCTAttachment(screenshot: app.screenshot())
    draft.name = "Assistant draft waits for Send"
    draft.lifetime = .keepAlways
    add(draft)
    app.buttons["clawdad.assistant.back"].tap()
    send.tap()
    app.buttons["clawdad.assistant.return"].tap()
    XCTAssertTrue(app.staticTexts["You"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Please check the second Terminal tab."].exists)
    XCTAssertFalse(app.staticTexts["You · Draft"].exists)
    XCTAssertFalse(send.isEnabled)
    // Leave the fixture's persisted preference in the default mode.
    app.buttons["clawdad.assistant.voice-sending"].tap()
    app.buttons["Send after a pause"].tap()
  }
  func testReplyControlsAndMessagesStayAvailableAcrossNavigation() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-speaking"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.open"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.open"].tap()
    let messages = app.buttons["clawdad.assistant.return"]
    XCTAssertTrue(messages.waitForExistence(timeout: 5))
    XCTAssertEqual(messages.label, "Assistant messages")
    XCTAssertTrue(app.buttons["clawdad.assistant.interject"].isHittable)
    let bar = XCTAttachment(screenshot: app.screenshot())
    bar.name = "Assistant call with messages and Interject"
    bar.lifetime = .keepAlways
    add(bar)
    messages.tap()
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "RoomWave is working")).firstMatch.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["clawdad.assistant.interject"].isHittable)
    app.buttons["clawdad.assistant.back"].tap()
    XCTAssertTrue(messages.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["clawdad.assistant.interject"].isHittable)
    app.buttons["clawdad.assistant.interject"].tap()
    XCTAssertTrue(app.staticTexts["Listening…"].exists)
    XCTAssertFalse(app.buttons["clawdad.assistant.interject"].exists)
    XCTAssertTrue(app.buttons["End voice conversation"].exists)
    messages.tap()
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "RoomWave is working")).firstMatch.waitForExistence(timeout: 5))
  }

  func testVoiceTranscriptionUpdatesInsideTheMessageThread() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-transcript-test"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.open"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.open"].tap()
    app.buttons["clawdad.assistant.return"].tap()
    XCTAssertTrue(app.staticTexts["Could you check which Terminal tab is working?"].waitForExistence(timeout: 8))
    let thread = XCTAttachment(screenshot: app.screenshot())
    thread.name = "Assistant conversation with live voice transcription"
    thread.lifetime = .keepAlways
    add(thread)
    app.buttons["clawdad.assistant.back"].tap()
    app.buttons["clawdad.assistant.return"].tap()
    XCTAssertTrue(app.staticTexts["Could you check which Terminal tab is working?"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["End voice conversation"].exists)
  }

  func testMessagesCanBeOpenedFromSettingsWithoutEndingTheReply() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-speaking"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.open"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.open"].tap()
    app.buttons["Settings"].tap()
    let messages = app.buttons["clawdad.assistant.return"].firstMatch
    XCTAssertTrue(messages.waitForExistence(timeout: 5))
    messages.tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.back"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["clawdad.assistant.interject"].isHittable)
    app.buttons["clawdad.assistant.back"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.return"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["clawdad.assistant.interject"].isHittable)
  }

  func testAssistantLivesInsideTheAppAndConversationSurvivesBack() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.open"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.open"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.return"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["clawdad.assistant.start-voice"].exists)
    XCTAssertTrue(app.buttons["Mute Assistant"].exists)
    app.buttons["clawdad.assistant.return"].tap()
    let draft = app.descendants(matching: .any).matching(identifier: "clawdad.assistant.composer")
      .firstMatch
    draft.tap()
    draft.typeText("Which tab is working?")
    app.buttons["Send to Assistant"].tap()
    XCTAssertTrue(app.staticTexts["Which tab is working?"].waitForExistence(timeout: 5))
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Assistant conversation inside ClawDad"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    app.buttons["clawdad.assistant.back"].tap()
    app.buttons["clawdad.assistant.open"].tap()
    XCTAssertTrue(app.staticTexts["Which tab is working?"].waitForExistence(timeout: 5))
    app.buttons["clawdad.assistant.back"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.return"].waitForExistence(timeout: 5))
    app.buttons["Mute Assistant"].tap()
    XCTAssertTrue(app.buttons["Unmute Assistant"].exists)
    app.buttons["End voice conversation"].tap()
    XCTAssertFalse(app.buttons["clawdad.assistant.return"].exists)
  }
  func testRemoteAssistOpensTheSameAssistantAndKeepsDuplicateDirectoriesSeparate() {
    let app = XCUIApplication()
    app.launchArguments = [
      "--clawdad-app-store-preview", "terminal-reader", "--clawdad-assistant-test",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.remote.assistant"].waitForExistence(timeout: 20))
    app.buttons["clawdad.remote.assistant"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.return"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["Workspace"].exists)
    app.buttons["clawdad.assistant.return"].tap()
    XCTAssertTrue(app.buttons["Workspace"].waitForExistence(timeout: 5))
    app.buttons["Workspace"].tap()
    XCTAssertTrue(app.staticTexts["Window 1 · Tab 1"].exists)
    XCTAssertTrue(app.staticTexts["Window 1 · Tab 2"].exists)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Assistant sees distinct Terminal tabs"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    app.buttons["clawdad.assistant.back"].tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "clawdad.assistant.composer").firstMatch.exists)
    app.buttons["clawdad.assistant.back"].tap()
    XCTAssertTrue(app.buttons["clawdad.remote.assistant"].waitForExistence(timeout: 5))
  }
  func testHangupDuringConnectionPreventsLateMicrophoneStartup() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-delayed-start"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.open"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.open"].tap()
    XCTAssertTrue(app.buttons["End voice conversation"].waitForExistence(timeout: 2))
    app.buttons["End voice conversation"].tap()
    let lateCall = app.buttons["clawdad.assistant.return"].waitForExistence(timeout: 4)
    XCTAssertFalse(lateCall)
    XCTAssertFalse(app.buttons["Mute Assistant"].exists)
    app.buttons["clawdad.assistant.open"].tap()
    XCTAssertTrue(app.buttons["Mute Assistant"].waitForExistence(timeout: 6))
  }
}
