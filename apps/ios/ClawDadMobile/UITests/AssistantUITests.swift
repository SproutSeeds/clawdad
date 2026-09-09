import XCTest

@MainActor
final class AssistantUITests: XCTestCase {
  func testCallingIsExplicitAndSpokenCommandSettingsAreRemoved() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.chat"].tap()
    XCTAssertFalse(app.buttons["clawdad.assistant.voice-controls"].exists)
    XCTAssertTrue(app.buttons["clawdad.assistant.start-voice"].exists)
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
    saveScreenshot(app, "Text chat stays separate from explicit calling without command settings")
  }

  func testManualMuteClearlyStopsMicrophoneAndKeepsCallConnected() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.chat"].tap()
    app.buttons["clawdad.assistant.start-voice"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.mute"].waitForExistence(timeout: 5))
    app.buttons["clawdad.assistant.mute"].tap()
    XCTAssertTrue(app.staticTexts.matching(identifier: "Muted · microphone off").firstMatch.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["End voice conversation"].exists)
    saveScreenshot(app, "Manual mute fully stops capture with the conversation connected")
    app.buttons["End voice conversation"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.start-voice"].exists)
  }
  func testCopyMessagesAndUpdatingTaskHistoryKeepOneOriginalCard() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-history-test", "--clawdad-assistant-reset-draft"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.chat"].tap()
    XCTAssertTrue(app.staticTexts["ClawDad · Working"].waitForExistence(timeout: 5))
    let userCopy = app.buttons["clawdad.assistant.copy.copy-user"]
    userCopy.tap()
    XCTAssertEqual(userCopy.label, "Copied")
    let composer = app.descendants(matching: .any).matching(identifier: "clawdad.assistant.composer").firstMatch
    composer.tap(); composer.press(forDuration: 1.2)
    let paste = app.menuItems["Paste"].waitForExistence(timeout: 3) ? app.menuItems["Paste"] : app.buttons["Paste"]
    XCTAssertTrue(paste.waitForExistence(timeout: 3), app.debugDescription); paste.tap()
    XCTAssertEqual(composer.value as? String, "Please inspect this request.\nKeep both lines 🦞.")
    app.buttons["clawdad.assistant.back"].tap()
    app.buttons["clawdad.assistant.chat"].tap()
    XCTAssertEqual(composer.value as? String, "Please inspect this request.\nKeep both lines 🦞.")
    app.buttons["clawdad.assistant.copy.copy-assistant"].tap()
    XCTAssertEqual(app.buttons["clawdad.assistant.copy.copy-assistant"].label, "Copied")
    app.buttons["Pause control"].tap()
    XCTAssertTrue(app.staticTexts["ClawDad · Completed"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Playback is repaired. Your draft is preserved."].exists)
    app.buttons["Resume control"].tap()
    XCTAssertEqual(app.staticTexts.matching(identifier: "Repair playback and preserve my draft.").count, 1)
    XCTAssertTrue(app.buttons["clawdad.assistant.copy.result.history-task"].exists)
    saveScreenshot(app, "Readable task result stays with original request and copy preserves draft")
  }
  func testRecoveredVoiceSurvivesReopeningAndIsExplicitlyMovedIntoTypedDraft() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft", "--clawdad-assistant-recovery-test"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.chat"].tap()
    XCTAssertTrue(app.staticTexts["Unsent voice · Review"].waitForExistence(timeout: 5))
    app.terminate()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.chat"].tap()
    app.staticTexts["Unsent voice · Review"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.recover-voice"].waitForExistence(timeout: 5))
    saveScreenshot(app, "Recovered unsent voice offers explicit review after app restart")
    app.buttons["clawdad.assistant.recover-voice"].tap()
    let composer = app.descendants(matching: .any).matching(identifier: "clawdad.assistant.composer").firstMatch
    XCTAssertEqual(composer.value as? String, "A recovered voice message.")
    XCTAssertFalse(app.staticTexts["Unsent voice · Review"].exists)
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
  }
  func testGroupedRemoteControlsHaveDistinctLabelsBackNavigationAndExplicitVoice() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.remote.assistant.chat"].waitForExistence(timeout: 20))
    for label in ["Assistant", "Mac input", "Workspace", "Chat", "Call", "Presets", "Photo to Terminal", "Copy to iPhone", "Paste to Mac"] {
      XCTAssertTrue(app.staticTexts[label].exists, label)
    }
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
    saveScreenshot(app, "Grouped Remote Assist controls in portrait")
    for button in ["clawdad.remote.quickChat", "Special commands", "Choose Terminal tab"] {
      app.buttons[button].tap()
      let back = app.buttons["Back to Remote Assist controls"]
      XCTAssertTrue(back.waitForExistence(timeout: 4))
      back.tap()
      XCTAssertTrue(app.buttons["clawdad.remote.assistant.chat"].waitForExistence(timeout: 4))
    }
    app.buttons["clawdad.remote.assistant.chat"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.attach-image"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["clawdad.assistant.start-voice"].exists)
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
    app.buttons["clawdad.assistant.back"].tap()
    XCUIDevice.shared.orientation = .landscapeLeft
    let rotated = expectation(for: NSPredicate { _, _ in app.frame.width > app.frame.height }, evaluatedWith: app)
    wait(for: [rotated], timeout: 8)
    Thread.sleep(forTimeInterval: 1)
    let panel = app.scrollViews["clawdad.remote.groupedControls"]
    XCTAssertTrue(panel.waitForExistence(timeout: 5))
    panel.swipeUp()
    XCTAssertTrue(app.buttons["Close Remote Assist"].isHittable)
    let landscapeImage = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    landscapeImage.name = "Grouped controls scroll in landscape"; landscapeImage.lifetime = .keepAlways
    add(landscapeImage)
    XCUIDevice.shared.orientation = .portrait
    let upright = expectation(for: NSPredicate { _, _ in app.frame.height > app.frame.width }, evaluatedWith: app)
    wait(for: [upright], timeout: 8)
    app.buttons["Close Remote Assist controls"].tap()
    XCTAssertTrue(app.buttons["Open Remote Assist controls"].waitForExistence(timeout: 3))
  }
  func testTextChatPhotosPreviewRemovalAndDraftSurviveCloseRestartAndFailedSend() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test",
      "--clawdad-assistant-reset-draft", "--clawdad-assistant-failed-send"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.chat"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.start-voice"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
    let composer = app.descendants(matching: .any).matching(identifier: "clawdad.assistant.composer").firstMatch
    composer.tap(); composer.typeText("Please inspect my attached screenshot.")
    selectAssistantPhoto(app)
    app.buttons["clawdad.assistant.image-preview"].firstMatch.tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.preview-back"].waitForExistence(timeout: 5))
    saveScreenshot(app, "Assistant image preview before sending")
    app.buttons["clawdad.assistant.preview-back"].tap()
    app.buttons["clawdad.assistant.image-remove"].firstMatch.tap()
    XCTAssertFalse(app.buttons["clawdad.assistant.image-preview"].exists)
    XCTAssertEqual(composer.value as? String, "Please inspect my attached screenshot.")
    selectAssistantPhoto(app)
    app.buttons["clawdad.assistant.back"].tap()
    app.buttons["clawdad.assistant.chat"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.image-preview"].waitForExistence(timeout: 5))
    XCTAssertEqual(composer.value as? String, "Please inspect my attached screenshot.")
    app.terminate()
    app.launchArguments.removeAll { $0 == "--clawdad-assistant-reset-draft" }
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.chat"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.image-preview"].waitForExistence(timeout: 5))
    XCTAssertEqual(composer.value as? String, "Please inspect my attached screenshot.")
    saveScreenshot(app, "Text conversation restores unsent text and photo after app restart")
    app.buttons["clawdad.assistant.send-chat"].tap()
    XCTAssertTrue(app.staticTexts["clawdad.assistant.error"].waitForExistence(timeout: 5))
    XCTAssertEqual(composer.value as? String, "Please inspect my attached screenshot.")
    XCTAssertTrue(app.buttons["clawdad.assistant.image-preview"].exists)
    app.buttons["clawdad.assistant.send-chat"].tap()
    let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["clawdad.assistant.image-preview"])
    wait(for: [gone], timeout: 5)
    XCTAssertTrue(app.staticTexts["Please inspect my attached screenshot."].exists)
    XCTAssertEqual(app.staticTexts.matching(identifier: "Please inspect my attached screenshot.").count, 1)
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
    saveScreenshot(app, "Assistant photo message sent once and draft cleared after acceptance")
  }
  func testRemoteAssistTextEntryKeepsVoiceExplicitAndClearDraftIsDeliberate() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.remote.assistant.chat"].waitForExistence(timeout: 20))
    app.buttons["clawdad.remote.assistant.chat"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.start-voice"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
    let composer = app.descendants(matching: .any).matching(identifier: "clawdad.assistant.composer").firstMatch
    composer.tap(); composer.typeText("A draft to explicitly delete")
    app.buttons["clawdad.assistant.clear-draft"].tap()
    app.buttons["Keep draft"].tap()
    XCTAssertEqual(composer.value as? String, "A draft to explicitly delete")
    app.buttons["clawdad.assistant.clear-draft"].tap()
    app.buttons["Delete draft"].tap()
    app.buttons["clawdad.assistant.back"].tap()
    app.buttons["clawdad.remote.assistant.chat"].tap()
    XCTAssertFalse(app.buttons["clawdad.assistant.clear-draft"].exists)
    app.buttons["clawdad.assistant.start-voice"].tap()
    XCTAssertTrue(app.buttons["End voice conversation"].waitForExistence(timeout: 5))
  }
  private func selectAssistantPhoto(_ app: XCUIApplication) {
    app.buttons["clawdad.assistant.attach-image"].tap()
    let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
    XCTAssertTrue(photo.waitForExistence(timeout: 8), app.debugDescription)
    photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    app.navigationBars["Photos"].buttons["Done"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.image-preview"].waitForExistence(timeout: 10), app.debugDescription)
  }
  private func saveScreenshot(_ app: XCUIApplication, _ name: String) {
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
  }
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
    let thinkAloud = app.switches["clawdad.assistant.think-aloud"]
    XCTAssertTrue(thinkAloud.waitForExistence(timeout: 3))
    XCTAssertEqual(thinkAloud.value as? String, "1")
    XCTAssertTrue(app.staticTexts["Keep listening through pauses until you tap Send."].exists)
    let draft = XCTAttachment(screenshot: app.screenshot())
    draft.name = "Think aloud retains the speaking turn until Send"
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
    thinkAloud.tap()
    XCTAssertEqual(thinkAloud.value as? String, "0")
    XCTAssertTrue(app.staticTexts["Automatically send after 4 seconds without new words."].exists)
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
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
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
