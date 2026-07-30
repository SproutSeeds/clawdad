import XCTest

@MainActor
final class ClawDadMobileUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testCopyAndVoiceTranscriptionAppend() throws {
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
