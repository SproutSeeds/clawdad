import XCTest

@MainActor
final class ClawDadMobileUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testVoiceMenuKeepsItsScrollPositionDuringSessionUpdates() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "workspace", "--clawdad-live-voices-test", "--clawdad-voice-refresh-test"]
    app.launch()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 20))
    app.buttons["Settings"].tap()
    let model = app.buttons["voice.model"]
    XCTAssertTrue(model.waitForExistence(timeout: 15))
    model.tap()
    app.buttons["Kokoro"].tap()
    app.buttons["voice.voice"].tap()
    let list = app.descendants(matching: .any).matching(identifier: "voice.options.list").firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let lastVoice = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Yunyang")).firstMatch
    for _ in 0..<15 {
      if lastVoice.isHittable { break }
      list.swipeUp()
    }
    XCTAssertTrue(lastVoice.isHittable, "The end of the voice menu should be reachable.")
    let position = lastVoice.frame.minY
    let moved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      !lastVoice.isHittable || abs(lastVoice.frame.minY - position) > 8
    }, object: nil)
    moved.isInverted = true
    XCTAssertEqual(XCTWaiter.wait(for: [moved], timeout: 6), .completed,
      "Background catalog/heartbeat updates must not close or scroll the voice menu.")
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Voice menu stays at the last voice during updates"
    screenshot.lifetime = .keepAlways; add(screenshot)
    lastVoice.tap()
    XCTAssertTrue(waitUntil(timeout: 5) {
      app.buttons["voice.voice"].label.contains("Yunyang") ||
        (app.buttons["voice.voice"].value as? String)?.contains("Yunyang") == true
    })
    app.buttons["Done"].tap()
    XCTAssertTrue(app.buttons["Settings"].isHittable)
  }

  func testSavingAndRefreshingKeepTheCurrentVoiceFilters() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "workspace", "--clawdad-live-voices-test"]
    app.launch()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 20))
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.buttons["voice.model"].waitForExistence(timeout: 15))
    app.buttons["voice.model"].tap()
    app.buttons["Kitten TTS"].tap()
    app.buttons["voice.gender"].tap()
    app.buttons["Male"].tap()
    app.buttons["voice.voice"].tap()
    app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Jasper")).firstMatch.tap()
    app.buttons["voice.save"].tap()
    XCTAssertTrue(app.staticTexts["Voice saved. Applies to your next reading."].waitForExistence(timeout: 10))
    app.buttons["voice.refresh"].tap()
    XCTAssertTrue(waitUntil(timeout: 10) { app.buttons["voice.refresh"].isEnabled })
    let gender = app.buttons["voice.gender"]
    XCTAssertTrue(gender.label.contains("Male") || (gender.value as? String)?.contains("Male") == true)
    let voice = app.buttons["voice.voice"]
    XCTAssertTrue(voice.label.contains("Jasper") || (voice.value as? String)?.contains("Jasper") == true)
    voice.tap()
    app.buttons["voice.options.back"].tap()
    XCTAssertTrue(voice.label.contains("Jasper") || (voice.value as? String)?.contains("Jasper") == true)
    app.buttons["Done"].tap()
    XCTAssertTrue(app.buttons["Settings"].isHittable)
  }

  func testVoiceSettingsShowsEveryModelAndPreservesChoicesAfterBack() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "workspace", "--clawdad-live-voices-test"]
    app.launch()
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 20))
    settings.tap()
    let model = app.buttons["voice.model"]
    XCTAssertTrue(model.waitForExistence(timeout: 15))
    model.tap()
    app.buttons["Kitten TTS"].tap()
    XCTAssertTrue(app.staticTexts["8 voices · 80 MB model"].waitForExistence(timeout: 4))
    let voice = app.buttons["voice.voice"]
    voice.tap()
    app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Jasper")).firstMatch.tap()
    app.buttons["voice.save"].tap()
    XCTAssertTrue(waitUntil(timeout: 5) { app.buttons["voice.save"].isEnabled })
    app.buttons["Done"].tap()
    settings.tap()
    XCTAssertTrue(voice.waitForExistence(timeout: 5))
    XCTAssertTrue(waitUntil(timeout: 5) { voice.label.contains("Jasper") || (voice.value as? String)?.contains("Jasper") == true })
    model.tap()
    app.buttons["Pocket TTS"].tap()
    XCTAssertTrue(app.staticTexts["Pocket uses the voice’s natural speaking pace."].waitForExistence(timeout: 5))
    model.tap()
    app.buttons["Kokoro"].tap()
    XCTAssertTrue(app.staticTexts["54 voices · 82M parameters"].waitForExistence(timeout: 5))
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Voice and Playback Settings"; screenshot.lifetime = .keepAlways; add(screenshot)
    app.buttons["Done"].tap()
    XCTAssertTrue(settings.isHittable)
  }

  func testComposerDictationTakesOverPendingRemotePlayback() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-slow-voice"]
    app.launch()
    let speaker = app.buttons["clawdad.remote.reader"]
    XCTAssertTrue(speaker.waitForExistence(timeout: 20))
    speaker.tap()
    XCTAssertTrue(app.staticTexts["Preparing voice…"].waitForExistence(timeout: 8))
    app.buttons["Close Remote Assist"].tap()
    let mic = app.buttons["clawdad.composer.voice"]
    XCTAssertTrue(mic.waitForExistence(timeout: 5))
    mic.tap()
    XCTAssertTrue(waitUntil(timeout: 5) { mic.label == "Stop recording and transcribe" })
    let recordingStatus = app.descendants(matching: .any)
      .matching(identifier: "clawdad.composer.voice-status").firstMatch
    XCTAssertTrue(waitUntil(timeout: 14) {
      recordingStatus.label.range(of: "Recording 0:1[0-9]", options: .regularExpression) != nil
    }, "Capture must keep advancing after delayed playback. Status: \(recordingStatus.label)")
    XCTAssertFalse(app.buttons["read-aloud.stop"].exists,
                   "Starting dictation must cancel pending playback before it can take over the microphone.")
    XCUIDevice.shared.press(.home)
  }

  func testReadingSurvivesLeavingRemoteAssistAndStopsFromWorkspace() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-slow-voice"]
    app.launch()
    let speaker = app.buttons["clawdad.remote.reader"]
    XCTAssertTrue(speaker.waitForExistence(timeout: 20))
    speaker.tap()
    XCTAssertTrue(app.staticTexts["Preparing voice…"].waitForExistence(timeout: 8))
    app.buttons["Close Remote Assist"].tap()
    let stop = app.buttons["read-aloud.stop"]
    XCTAssertTrue(stop.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Selected Mac text"].exists)
    stop.tap()
    XCTAssertFalse(stop.waitForExistence(timeout: 10))
  }

  func testFirstAudioPlaysBeforeLaterPartsAndStopRejectsTheRemainingTransfer() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-streaming-voice"]
    app.launch()
    let speaker = app.buttons["clawdad.remote.reader"]
    XCTAssertTrue(speaker.waitForExistence(timeout: 20))
    speaker.tap()
    let reading = app.staticTexts["Reading: Selected Mac text"]
    XCTAssertTrue(reading.waitForExistence(timeout: 5), "First part should play before the eight-second delay for part two")
    speaker.tap()
    XCTAssertFalse(reading.waitForExistence(timeout: 10))
    XCTAssertEqual(speaker.label, "Read selected text or latest Terminal response")
  }

  func testTerminalCardsScrollFromLeftCenterAndRightWithoutSelectingOrMoving() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-window-groups"]
    for fraction in [0.15, 0.5, 0.85] {
      app.launch()
      let chooser = app.buttons["Choose Terminal tab"]
      XCTAssertTrue(chooser.waitForExistence(timeout: 20))
      chooser.tap()
      let first = app.buttons["clawdad.remote.tab.window-1-tab-1"]
      let fourth = app.buttons["clawdad.remote.tab.window-1-tab-4"]
      XCTAssertTrue(fourth.waitForExistence(timeout: 8))
      let start = fourth.coordinate(withNormalizedOffset: CGVector(dx: fraction, dy: 0.5))
      let end = first.coordinate(withNormalizedOffset: CGVector(dx: fraction, dy: 0.2))
      start.press(forDuration: fraction == 0.5 ? 0.6 : 0.05, thenDragTo: end, withVelocity: .fast, thenHoldForDuration: 0)
      let tabs = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "clawdad.remote.tab.window-1-tab-"))
      XCTAssertTrue(waitUntil(timeout: 5) {
        tabs.allElementsBoundByIndex.contains { (Int($0.identifier.split(separator: "-").last ?? "") ?? 0) >= 7 && $0.isHittable }
      }, "Card swipe at horizontal fraction \(fraction) must scroll")
      XCTAssertFalse(first.exists && first.isHittable)
      let list = app.collectionViews["clawdad.remote.terminal-list"]
      for _ in 0..<6 {
        if first.exists && first.isHittable { break }
        list.swipeDown(velocity: .fast)
      }
      XCTAssertTrue(first.isHittable)
      XCTAssertTrue(first.label.contains("selected"), "Scrolling must preserve the selected tab")
      XCTAssertTrue(first.label.contains("Tab 1"), "Scrolling must preserve tab order")
      app.terminate()
    }
  }

  func testGroupedWindowsKeepDuplicateTabsAndRememberExpandedGroups() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-window-groups"]
    app.launch()
    let chooser = app.buttons["Choose Terminal tab"]
    XCTAssertTrue(chooser.waitForExistence(timeout: 20))
    chooser.tap()
    let first = app.buttons["clawdad.remote.window.window-1"]
    XCTAssertTrue(first.waitForExistence(timeout: 8))
    XCTAssertEqual(first.value as? String, "Expanded")
    XCTAssertTrue(app.staticTexts["20 tabs"].exists)
    first.tap()
    let second = app.buttons["clawdad.remote.window.window-2"]
    XCTAssertTrue(second.waitForExistence(timeout: 5))
    second.tap()
    XCTAssertEqual(second.value as? String, "Expanded")
    let rows = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "same-directory"))
    XCTAssertEqual(rows.count, 3)
    rows.element(boundBy: 1).tap()
    XCTAssertEqual(first.value as? String, "Collapsed")
    XCTAssertEqual(second.value as? String, "Expanded")
    let source = app.buttons["clawdad.remote.tab.window-2-tab-1"]
    let target = app.buttons["clawdad.remote.tab.window-2-tab-3"]
    let handle = app.buttons["clawdad.remote.reorder.window-2-tab-1"]
    XCTAssertGreaterThanOrEqual(handle.frame.width, 44)
    XCTAssertGreaterThanOrEqual(handle.frame.minX - source.frame.maxX, 11)
    handle.press(forDuration: 0.7, thenDragTo: target)
    XCTAssertTrue(waitUntil(timeout: 6) { source.label.contains("Tab 3") })
    XCTAssertTrue(waitUntil(timeout: 6) { !app.staticTexts["Terminal tab order updated"].exists })
    XCTAssertTrue(app.buttons["Back to Remote Assist controls"].isHittable)
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "Grouped physical Terminal windows"; attachment.lifetime = .keepAlways; add(attachment)
    app.buttons["Back to Remote Assist controls"].tap()
    chooser.tap()
    XCTAssertEqual(first.value as? String, "Collapsed")
    XCTAssertEqual(second.value as? String, "Expanded")
  }

  func testTerminalHandleCancellationAndNoOpPreserveSelectionAndAllowScrolling() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-window-groups", "--clawdad-preview-terminal-poll-count"]
    app.launch()
    let chooser = app.buttons["Choose Terminal tab"]
    XCTAssertTrue(chooser.waitForExistence(timeout: 20))
    chooser.tap()
    let list = app.collectionViews["clawdad.remote.terminal-list"]
    let first = app.buttons["clawdad.remote.tab.window-1-tab-1"]
    let second = app.buttons["clawdad.remote.tab.window-1-tab-2"]
    XCTAssertTrue(second.waitForExistence(timeout: 8))
    second.tap()
    XCTAssertTrue(waitUntil(timeout: 5) { second.label.contains("selected") })
    let handle = app.buttons["clawdad.remote.reorder.window-1-tab-1"]
    handle.press(forDuration: 0.6)
    XCTAssertNotEqual(list.value as? String, "Reordering")
    let afterNoOp = second.label
    XCTAssertTrue(waitUntil(timeout: 6) { second.label != afterNoOp }, "A no-op must resume background catalog updates")
    let outside = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -0.3))
    handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.6, thenDragTo: outside)
    XCTAssertNotEqual(list.value as? String, "Reordering")
    XCTAssertTrue(first.label.contains("Tab 1"))
    XCTAssertTrue(second.label.contains("selected"))
    let afterCancel = second.label
    XCTAssertTrue(waitUntil(timeout: 6) { second.label != afterCancel }, "Cancelling must resume background catalog updates")
    let fourth = app.buttons["clawdad.remote.tab.window-1-tab-4"]
    fourth.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(forDuration: 0.05, thenDragTo: first.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)),
             withVelocity: .fast, thenHoldForDuration: 0)
    XCTAssertFalse(first.exists && first.isHittable)
    app.buttons["Back to Remote Assist controls"].tap()
    chooser.tap()
    let visible = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "clawdad.remote.tab.window-1-tab-"))
      .allElementsBoundByIndex.first { $0.isHittable }
    XCTAssertNotNil(visible)
    visible?.tap()
    XCTAssertTrue(waitUntil(timeout: 5) { visible?.label.contains("selected") == true })
  }

  func testTerminalHandleAutoScrollsAndReordersWithinItsWindow() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-window-groups"]
    app.launch()
    let chooser = app.buttons["Choose Terminal tab"]
    XCTAssertTrue(chooser.waitForExistence(timeout: 20))
    chooser.tap()
    let list = app.collectionViews["clawdad.remote.terminal-list"]
    let handle = app.buttons["clawdad.remote.reorder.window-1-tab-1"]
    XCTAssertTrue(handle.waitForExistence(timeout: 8))
    let edge = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.96))
    handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(forDuration: 0.6, thenDragTo: edge, withVelocity: .slow, thenHoldForDuration: 1.5)
    let moved = app.buttons["clawdad.remote.tab.window-1-tab-1"]
    XCTAssertTrue(waitUntil(timeout: 6) {
      moved.exists && moved.isHittable && (6...20).contains { moved.label.contains("Tab \($0),") }
    })
    XCTAssertTrue(moved.label.contains("selected"))
    XCTAssertNotEqual(list.value as? String, "Reordering")
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "Terminal handle edge scrolling"; attachment.lifetime = .keepAlways; add(attachment)
  }

  func testSlowVoicePreparationStaysInlineAndStopRejectsLateAudio() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-slow-voice"]
    app.launch()
    let speaker = app.buttons["clawdad.remote.reader"]
    XCTAssertTrue(speaker.waitForExistence(timeout: 20))
    speaker.tap()
    XCTAssertTrue(app.staticTexts["Preparing voice…"].waitForExistence(timeout: 8))
    XCTAssertEqual(speaker.label, "Stop Read Aloud")
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "Shared voice preparation inline"; attachment.lifetime = .keepAlways; add(attachment)
    speaker.tap()
    XCTAssertTrue(waitUntil(timeout: 3) { speaker.label == "Read selected text or latest Terminal response" })
    let late = app.staticTexts["Reading: Selected Mac text"]
    XCTAssertFalse(late.waitForExistence(timeout: 10))
  }

  func testFilesOpensAndReturnsToWorkspace() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "workspace"]
    app.launch()
    let files = app.buttons["clawdad.files.open"]
    XCTAssertTrue(files.waitForExistence(timeout: 20))
    files.tap()
    XCTAssertTrue(app.navigationBars["Files"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.switches["Downloaded on this iPhone"].exists)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Local Files library on iPhone"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    app.navigationBars["Files"].buttons["Back"].tap()
    XCTAssertTrue(files.waitForExistence(timeout: 3))
    XCTAssertTrue(files.isHittable)
  }

  func testOneSpeakerTapWaitsForDelayedCapabilitiesAndTargetCapture() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-slow-context"]
    app.launch()
    let speaker = app.buttons["clawdad.remote.reader"]
    XCTAssertTrue(speaker.waitForExistence(timeout: 20))
    speaker.tap()
    XCTAssertTrue(app.staticTexts["Reading: Selected Mac text"].waitForExistence(timeout: 12))
    XCTAssertFalse(app.staticTexts["Selection collided with target capture."].exists)
    speaker.tap()
  }

  func testInlineSpeakerPrioritizesSelectionWithoutOpeningASheet() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader"]
    app.launch()
    let speaker = app.buttons["clawdad.remote.reader"]
    XCTAssertTrue(speaker.waitForExistence(timeout: 20))
    XCTAssertTrue(waitUntil(timeout: 5) { !app.staticTexts["Checking speech connection…"].exists })
    speaker.tap()
    XCTAssertTrue(waitUntil(timeout: 8) { speaker.label == "Stop Read Aloud" && app.staticTexts["Reading: Selected Mac text"].exists })
    XCTAssertFalse(app.buttons["clawdad.remote.reader.back"].exists)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Inline selected text playback"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    speaker.tap()
    XCTAssertTrue(waitUntil(timeout: 3) { speaker.label == "Read selected text or latest Terminal response" })
  }

  func testInlineSpeakerFallsBackOnlyAfterConfirmedEmptySelection() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-no-selection"]
    app.launch()
    let speaker = app.buttons["clawdad.remote.reader"]
    XCTAssertTrue(speaker.waitForExistence(timeout: 20))
    XCTAssertTrue(waitUntil(timeout: 5) { !app.staticTexts["Checking speech connection…"].exists })
    speaker.tap()
    XCTAssertTrue(app.staticTexts["Reading: Preview Terminal"].waitForExistence(timeout: 8))
    speaker.tap()
  }

  func testSelectionFailureDoesNotReadAnUnrelatedTerminalAnswer() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-preview-selection-error"]
    app.launch()
    let speaker = app.buttons["clawdad.remote.reader"]
    XCTAssertTrue(speaker.waitForExistence(timeout: 20))
    XCTAssertTrue(waitUntil(timeout: 5) { !app.staticTexts["Checking speech connection…"].exists })
    speaker.tap()
    XCTAssertTrue(app.staticTexts["Selection unavailable. Tap the speaker to retry."].waitForExistence(timeout: 5))
    XCTAssertEqual(speaker.label, "Read selected text or latest Terminal response")
    XCTAssertFalse(app.staticTexts["Reading: Preview Terminal"].exists)
  }

  func testInlineDictationStopsAndAutomaticallyInserts() { exerciseInlineDictation(clipboardOnly: false) }
  func testInlineDictationCopiesAndPasteUsesTheNewTranscript() { exerciseInlineDictation(clipboardOnly: true) }

  func testRemoteDictationTakesOverPlayingAudioAndIgnoresLaterParts() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "terminal-reader",
                            "--clawdad-inline-speech-test", "--clawdad-preview-streaming-voice"]
    app.launch()
    let speaker = app.buttons["clawdad.remote.reader"]
    XCTAssertTrue(speaker.waitForExistence(timeout: 20))
    speaker.tap()
    XCTAssertTrue(app.staticTexts["Reading: Selected Mac text"].waitForExistence(timeout: 8))
    let mic = app.buttons["clawdad.remote.dictation"]
    mic.tap()
    XCTAssertTrue(app.staticTexts["Recording 0:10"].waitForExistence(timeout: 14))
    XCTAssertEqual(speaker.label, "Read selected text or latest Terminal response")
    mic.tap()
    XCTAssertTrue(app.staticTexts["Inserted on Preview Mac"].waitForExistence(timeout: 8))
    XCTAssertEqual(mic.label, "Dictate text")
  }

  func testLeavingRemoteAssistStopsPendingOrActiveMicrophoneCapture() {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "dictation", "--clawdad-inline-speech-test", "--clawdad-preview-slow-context"]
    app.launch()
    let mic = app.buttons["clawdad.remote.dictation"]
    XCTAssertTrue(mic.waitForExistence(timeout: 20))
    mic.tap()
    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertTrue(mic.waitForExistence(timeout: 5))
    XCTAssertTrue(waitUntil(timeout: 5) { !["Stop recording and insert text", "Cancel dictation"].contains(mic.label) })
    XCTAssertFalse(app.staticTexts["Recording 0:01"].exists)
  }

  private func exerciseInlineDictation(clipboardOnly: Bool) {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "dictation", "--clawdad-inline-speech-test"]
    if clipboardOnly { app.launchArguments += ["--clawdad-preview-clipboard-only"] }
    app.launch()
    let mic = app.buttons["clawdad.remote.dictation"]
    XCTAssertTrue(mic.waitForExistence(timeout: 20))
    XCTAssertTrue(waitUntil(timeout: 5) { !app.staticTexts["Checking speech connection…"].exists })
    mic.tap()
    XCTAssertTrue(waitUntil(timeout: 5) { mic.label == "Stop recording and insert text" })
    XCTAssertTrue(app.staticTexts["Recording 0:01"].waitForExistence(timeout: 4))
    XCTAssertFalse(app.textViews["clawdad.remote.dictation.transcript"].exists)
    XCTAssertFalse(app.buttons["clawdad.remote.dictation.use"].exists)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Inline recording Stop control"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    mic.tap()
    let notice = clipboardOnly ? "Copied to Preview Mac clipboard" : "Inserted on Preview Mac"
    XCTAssertTrue(app.staticTexts[notice].waitForExistence(timeout: 8))
    XCTAssertEqual(mic.label, "Dictate text")
    if clipboardOnly {
      app.buttons["clawdad.remote.paste"].tap()
      XCTAssertTrue(app.staticTexts["Pasted to Preview Mac"].waitForExistence(timeout: 4))
    } else {
      // The same menu remains open, but the next recording must capture a new caret.
      mic.tap()
      XCTAssertTrue(app.staticTexts["Recording 0:01"].waitForExistence(timeout: 4))
      mic.tap()
      XCTAssertTrue(app.staticTexts["Inserted on Preview Mac"].waitForExistence(timeout: 8))
      app.buttons["clawdad.remote.files"].tap()
      XCTAssertTrue(app.navigationBars["Files"].waitForExistence(timeout: 5))
      app.navigationBars["Files"].buttons["Back"].tap()
      XCTAssertTrue(mic.waitForExistence(timeout: 3))
    }
  }

  func testCutDraftClearsAndKeepsEditorFocused() throws {
    let app = XCUIApplication()
    app.launchArguments += ["--clawdad-app-store-preview", "workspace"]
    app.launch()

    let editor = app.textViews["clawdad.composer.editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 20), "The message editor did not appear.")
    editor.tap()
    editor.typeText("Draft to cut")

    let cutButton = app.buttons["clawdad.composer.cut"]
    XCTAssertTrue(cutButton.waitForExistence(timeout: 5), "The draft cut button did not appear.")
    XCTAssertTrue(cutButton.isEnabled, "The draft cut button did not enable for a draft.")
    cutButton.tap()

    XCTAssertTrue(
      waitUntil(timeout: 3) {
        guard let value = editor.value as? String else {
          return false
        }
        return value.isEmpty || value == "Message"
      },
      "The cut button did not clear the draft."
    )
    XCTAssertEqual(cutButton.label, "Draft cut")

    let replacementDraft = "Replacement draft"
    editor.typeText(replacementDraft)
    XCTAssertTrue(
      waitUntil(timeout: 3) { editor.value as? String == replacementDraft },
      "The editor did not retain focus after the draft was cut."
    )
  }

  func testCopyCutAndVoiceTranscriptionAppend() throws {
    let app = XCUIApplication()
    addUIInterruptionMonitor(withDescription: "Microphone permission") { alert in
      let allowButton = alert.buttons["Allow"]
      if allowButton.exists {
        allowButton.tap()
        return true
      }
      let allowWhileUsingButton = alert.buttons["Allow While Using App"]
      if allowWhileUsingButton.exists {
        allowWhileUsingButton.tap()
        return true
      }
      return false
    }

    app.launch()

    let editor = app.textViews["clawdad.composer.editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 20), "The message editor did not appear.")
    editor.tap()
    let existingDraft = "Existing ClawDad draft"
    editor.typeText(existingDraft)

    let copyButton = app.buttons["clawdad.composer.copy"]
    XCTAssertTrue(copyButton.waitForExistence(timeout: 5), "The draft copy button did not appear.")
    copyButton.tap()
    XCTAssertTrue(
      waitUntil(timeout: 3) { copyButton.label == "Draft copied" },
      "The copy button did not confirm that the draft was copied."
    )

    let cutButton = app.buttons["clawdad.composer.cut"]
    XCTAssertTrue(cutButton.waitForExistence(timeout: 5), "The draft cut button did not appear.")
    cutButton.tap()
    XCTAssertTrue(
      waitUntil(timeout: 3) {
        guard let value = editor.value as? String else {
          return false
        }
        return value.isEmpty || value == "Message"
      },
      "The cut button did not clear the draft."
    )
    editor.typeText(existingDraft)

    let voiceButton = app.buttons["clawdad.composer.voice"]
    XCTAssertTrue(voiceButton.waitForExistence(timeout: 5), "The microphone button did not appear.")
    XCTAssertTrue(
      waitUntil(timeout: 45) { voiceButton.isEnabled },
      "The microphone never became available after ClawDad connected."
    )

    voiceButton.tap()
    let recordingStarted = waitUntil(timeout: 2) {
      voiceButton.label == "Stop recording and transcribe" &&
        voiceButton.value as? String == "Recording"
    }
    if !recordingStarted {
      app.tap()
    }
    XCTAssertTrue(
      waitUntil(timeout: 10) {
        voiceButton.label == "Stop recording and transcribe" &&
          voiceButton.value as? String == "Recording"
      },
      "The microphone did not enter its visible recording state."
    )

    sleep(12)
    voiceButton.tap()

    XCTAssertTrue(
      waitUntil(timeout: 90) {
        guard let value = editor.value as? String else {
          return false
        }
        return value.hasPrefix(existingDraft + "\n\n") &&
          value.count > existingDraft.count + 2
      },
      "The transcription did not append beneath the existing draft. Editor value: \(String(describing: editor.value))"
    )
  }

  func testPairedPhoneDispatchesDirectReliabilitySmoke() throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_RUN_LIVE_IOS_SMOKE"] == "1" else {
      throw XCTSkip("Set CLAWDAD_RUN_LIVE_IOS_SMOKE=1 for the paired real-device transport smoke.")
    }

    let app = XCUIApplication()
    app.launch()

    let newThreadButton = app.buttons["Start new Codex thread"]
    XCTAssertTrue(
      waitUntil(timeout: 45) { newThreadButton.exists && newThreadButton.isEnabled },
      "ClawDad did not automatically reconnect to the paired Mac."
    )

    let editor = app.textViews["clawdad.composer.editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 10), "The message editor did not appear.")
    editor.tap()
    editor.typeText(
      "iPhone cloud reliability smoke: reply exactly IPHONE_CLOUD_DONE. Do not edit files or run tools."
    )

    let sendButton = app.buttons["Send (Direct)"]
    XCTAssertTrue(
      waitUntil(timeout: 10) { sendButton.exists && sendButton.isEnabled },
      "The Direct send button never became available."
    )
    sendButton.tap()

    XCTAssertTrue(
      waitUntil(timeout: 5) {
        let value = editor.value as? String
        return value == nil || value == "" || value == "Message"
      },
      "The composer did not clear after the phone handed off the Direct message."
    )
    XCTAssertTrue(
      waitUntil(timeout: 5) { app.keyboards.count == 0 },
      "The keyboard stayed open after the phone handed off the Direct message."
    )
  }

  func testNewThreadOffersOptionalNameBeforeCreation() throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_RUN_NAMED_THREAD_SMOKE"] == "1" else {
      throw XCTSkip("Use the ClawDadMobile-LiveSmoke scheme for the named-thread prompt smoke.")
    }

    let app = XCUIApplication()
    app.launch()

    let newThreadButton = app.buttons["Start new Codex thread"]
    XCTAssertTrue(
      waitUntil(timeout: 90) { newThreadButton.exists && newThreadButton.isEnabled },
      "ClawDad did not restore a project where a new thread could be started."
    )
    newThreadButton.tap()

    let prompt = app.alerts["Start New Thread"]
    XCTAssertTrue(
      prompt.waitForExistence(timeout: 5),
      "The optional thread-naming prompt did not appear."
    )

    let nameField = prompt.textFields.firstMatch
    XCTAssertTrue(
      nameField.waitForExistence(timeout: 5),
      "The optional thread-name field did not appear."
    )
    XCTAssertTrue(prompt.buttons["Cancel"].exists, "The naming prompt must offer a safe way back.")
    XCTAssertTrue(prompt.buttons["Start Thread"].exists, "The naming prompt did not expose its create action.")

    nameField.tap()
    nameField.typeText("Named thread preview")
    XCTAssertEqual(nameField.value as? String, "Named thread preview")
    keepScreenshot(named: "ClawDad Optional Thread Name")

    prompt.buttons["Cancel"].tap()
    XCTAssertTrue(
      waitUntil(timeout: 3) { !nameField.exists },
      "The naming prompt did not close without creating a thread."
    )
  }

  func testColdLaunchWaitsForSavedWorkspaceRestoration() throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_RUN_STARTUP_RESTORE_SMOKE"] == "1" else {
      throw XCTSkip("Use the ClawDadMobile-LiveSmoke scheme for the paired startup restoration smoke.")
    }

    let app = XCUIApplication()
    app.launch()

    let loadingSurface = app.descendants(matching: .any)["clawdad.startup.loading"]
    let workspaceSurface = app.descendants(matching: .any)["clawdad.workspace.ready"]
    XCTAssertTrue(
      loadingSurface.waitForExistence(timeout: 15),
      "The paired cold launch exposed workspace content before catalog restoration."
    )
    XCTAssertFalse(
      workspaceSurface.exists,
      "The fallback workspace was visible while ClawDad was still restoring the saved selection."
    )
    XCTAssertTrue(
      app.buttons["Settings"].exists,
      "Settings must remain available when startup is waiting for the paired Mac."
    )
    keepScreenshot(named: "ClawDad Startup Loading")

    XCTAssertTrue(
      workspaceSurface.waitForExistence(timeout: 90),
      "The saved workspace did not appear after the paired Mac returned."
    )
    XCTAssertTrue(
      waitUntil(timeout: 5) { !loadingSurface.exists },
      "The startup loading surface remained visible after workspace restoration."
    )
    RunLoop.current.run(until: Date().addingTimeInterval(0.5))
    keepScreenshot(named: "ClawDad Restored Workspace")
  }

  func testThreadScopeSwitchesBetweenAllAndProject() throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_RUN_THREAD_SCOPE_SMOKE"] == "1" else {
      throw XCTSkip("Use the ClawDadMobile-LiveSmoke scheme for the paired thread-scope smoke.")
    }

    let app = XCUIApplication()
    app.launch()

    let scope = app.segmentedControls["clawdad.threads.scope"]
    XCTAssertTrue(
      scope.waitForExistence(timeout: 90),
      "The thread scope did not appear after the paired workspace restored."
    )

    let all = scope.buttons["All"]
    let project = scope.buttons["Project"]
    XCTAssertTrue(all.exists, "The All thread scope is missing.")
    XCTAssertTrue(project.exists, "The Project thread scope is missing.")

    project.tap()
    XCTAssertTrue(
      waitUntil(timeout: 3) { project.isSelected },
      "Project did not become the selected thread scope."
    )

    all.tap()
    XCTAssertTrue(
      waitUntil(timeout: 3) {
        all.isSelected && app.staticTexts["Recent across all projects"].exists
      },
      "All did not expose the cross-project recent-thread view."
    )
    keepScreenshot(named: "ClawDad All Threads")

    project.tap()
    XCTAssertTrue(
      waitUntil(timeout: 3) { project.isSelected },
      "Project did not restore the project-scoped thread view."
    )
  }

  private func keepScreenshot(named name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func waitUntil(
    timeout: TimeInterval,
    pollInterval: TimeInterval = 0.2,
    condition: () -> Bool
  ) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if condition() {
        return true
      }
      RunLoop.current.run(until: Date().addingTimeInterval(pollInterval))
    }
    return condition()
  }
}
