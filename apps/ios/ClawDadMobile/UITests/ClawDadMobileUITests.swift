import XCTest

@MainActor
final class ClawDadMobileUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
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
    let handle = app.buttons.matching(identifier: "Reorder same-directory").element(boundBy: 0)
    handle.press(forDuration: 0.7, thenDragTo: target)
    XCTAssertTrue(waitUntil(timeout: 6) { source.label.contains("Tab 3") })
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "Grouped physical Terminal windows"; attachment.lifetime = .keepAlways; add(attachment)
    app.buttons["Back to Remote Assist controls"].tap()
    chooser.tap()
    XCTAssertEqual(first.value as? String, "Collapsed")
    XCTAssertEqual(second.value as? String, "Expanded")
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
