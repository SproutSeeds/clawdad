import XCTest

@MainActor
final class AssistantUITests: XCTestCase {
  func testDestinationAcrossTextCallWorkspaceAndNavigation() {
    checkDestinationControls(largeText: false)
  }
  func testDestinationAtAccessibilityTextSize() {
    checkDestinationControls(largeText: true)
  }
  private func checkDestinationControls(largeText: Bool) {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"] }
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 15))
    app.buttons["clawdad.assistant.chat"].tap()
    let destination = app.buttons["clawdad.assistant.destination"]
    XCTAssertTrue(destination.waitForExistence(timeout: 5))
    XCTAssertEqual(destination.value as? String, "Terminal selected")
    XCTAssertGreaterThanOrEqual(destination.frame.width, 44)
    XCTAssertGreaterThanOrEqual(destination.frame.height, 44)
    destination.tap()
    let changed = expectation(for: NSPredicate(format: "value == %@", "ClawDad threads selected"), evaluatedWith: destination)
    wait(for: [changed], timeout: 3)
    XCTAssertFalse(app.buttons["End voice conversation"].exists)
    app.buttons["clawdad.assistant.start-voice"].tap()
    XCTAssertTrue(app.buttons["End voice conversation"].waitForExistence(timeout: 5))
    XCTAssertEqual(destination.value as? String, "ClawDad threads selected")
    let mic = app.buttons["clawdad.assistant.mute"]
    let micState = mic.value as? String
    let infinity = app.buttons["clawdad.assistant.think-aloud"]
    let heldState = infinity.value as? String
    app.buttons["Workspace"].tap()
    XCTAssertTrue(destination.isHittable)
    destination.tap()
    let terminal = expectation(for: NSPredicate(format: "value == %@", "Terminal selected"), evaluatedWith: destination)
    wait(for: [terminal], timeout: 3)
    XCTAssertEqual(mic.value as? String, micState)
    XCTAssertEqual(infinity.value as? String, heldState)
    app.buttons["Workspace"].tap()
    XCTAssertEqual(destination.value as? String, "Terminal selected")
    XCTAssertTrue(app.buttons["End voice conversation"].exists)
    app.buttons["clawdad.assistant.back"].tap()
    XCTAssertTrue(destination.isHittable)
    XCTAssertTrue(app.buttons["clawdad.assistant.return"].isHittable)
    app.buttons["clawdad.assistant.return"].tap()
    XCTAssertEqual(destination.value as? String, "Terminal selected")
    saveScreenshot(app, largeText ? "Destination with accessibility text" : "Destination during a call")
  }
  func testResearchBudgetDefaultOverrideAndPolling() {
    checkResearchBudgetControls(largeText: false)
  }
  func testResearchBudgetControlsAtAccessibilityTextSize() {
    checkResearchBudgetControls(largeText: true)
  }
  private func checkResearchBudgetControls(largeText: Bool) {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"] }
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 15))
    app.buttons["clawdad.assistant.chat"].tap()
    app.buttons["clawdad.assistant.start-voice"].tap()
    app.buttons["Workspace"].tap()
    let open = app.buttons["clawdad.assistant.research.code-one"]
    XCTAssertTrue(open.waitForExistence(timeout: 5)); open.tap()
    func reveal(_ element: XCUIElement, up: Bool = true) {
      for _ in 0..<16 {
        if element.exists && element.isHittable { break }
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: up ? 0.68 : 0.38))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: up ? 0.38 : 0.68))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
      }
      XCTAssertTrue(element.isHittable)
    }
    func replace(_ field: XCUIElement, with text: String) {
      field.doubleTap()
      let selectAll = app.menuItems["Select All"].exists ? app.menuItems["Select All"] : app.buttons["Select All"]
      if selectAll.exists { selectAll.tap() }
      field.typeText(text)
      XCTAssertEqual(field.value as? String, text)
      if app.buttons["Done typing"].isHittable { app.buttons["Done typing"].tap() }
    }
    for (id, text) in [("objective", "Verify fixture results."), ("scope", "Only the fixture."), ("requirements", "Check both results.")] {
      let field = app.descendants(matching: .any).matching(identifier: "clawdad.research.\(id)").firstMatch
      reveal(field); field.tap(); field.typeText(text)
      if app.buttons["Done typing"].isHittable { app.buttons["Done typing"].tap() }
    }
    let save = app.buttons["clawdad.research.save"]; reveal(save); save.tap()
    let picker = app.buttons["clawdad.research.budget.mode"]
    reveal(picker); picker.tap(); app.buttons["Custom stopping percentage"].tap()
    let percent = app.textFields["clawdad.research.budget.override"]
    reveal(percent); replace(percent, with: "0")
    // Wait through a real UI status refresh: editing must retain the exact zero.
    let retained = expectation(for: NSPredicate(format: "value == %@", "0"), evaluatedWith: percent)
    wait(for: [retained], timeout: 2)
    RunLoop.current.run(until: Date().addingTimeInterval(5.5))
    XCTAssertEqual(percent.value as? String, "0")
    let review = app.buttons["clawdad.research.budget.review-supervisor"]
    reveal(review); review.tap()
    XCTAssertTrue(app.alerts["Approve allowance setting?"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.alerts.staticTexts.element(boundBy: 1).label.contains("0%"))
    app.alerts.buttons["Cancel"].tap()
    review.tap(); app.alerts.buttons["Approve"].tap()
    let current = app.staticTexts["clawdad.research.budget.current"]
    reveal(current, up: false)
    XCTAssertTrue(current.label.contains("0% remaining"), current.label)
    saveScreenshot(app, largeText ? "Research allowance zero at accessibility text size" : "Research allowance zero override with shared default")
    reveal(picker); picker.tap(); app.buttons["Use shared default"].tap()
    reveal(review); review.tap(); app.alerts.buttons["Approve"].tap()
    reveal(current, up: false); XCTAssertTrue(current.label.contains("20% remaining"), current.label)
    let shared = app.buttons["Shared default: 20% remaining"]
    reveal(shared); shared.tap()
    let sharedPercent = app.textFields["clawdad.research.budget.default"]
    reveal(sharedPercent); replace(sharedPercent, with: "25")
    let sharedReview = app.buttons["clawdad.research.budget.review-default"]
    reveal(sharedReview); sharedReview.tap(); app.alerts.buttons["Approve"].tap()
    reveal(current, up: false); XCTAssertTrue(current.label.contains("25% remaining"), current.label)
    app.buttons["Done"].tap()
    app.buttons["Workspace"].tap()
    XCTAssertTrue(app.buttons["End voice conversation"].exists)
  }
  private func messageText(_ app: XCUIApplication, _ text: String) -> XCUIElement {
    let native = app.textViews.matching(NSPredicate(format: "value == %@ OR label == %@", text, text)).firstMatch
    return native.exists ? native : app.staticTexts[text]
  }

  func testResearchOptInPauseAndOffPreserveCallAndTypedDraft() {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 15))
    app.buttons["clawdad.assistant.chat"].tap()
    app.buttons["clawdad.assistant.start-voice"].tap()
    let composer = app.descendants(matching: .any).matching(identifier: "clawdad.assistant.composer").firstMatch
    composer.tap(); composer.typeText("Preserve my unsent note.")
    app.buttons["Workspace"].tap()
    let research = app.buttons["clawdad.assistant.research.code-one"]
    XCTAssertTrue(research.waitForExistence(timeout: 5)); research.tap()
    XCTAssertTrue(app.staticTexts["clawdad.research.status"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["clawdad.research.status"].label, "Off")
    func reveal(_ element: XCUIElement, up: Bool = true) {
      for _ in 0..<20 {
        if element.exists && element.isHittable { break }
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: up ? 0.68 : 0.38))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: up ? 0.38 : 0.68))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
      }
      XCTAssertTrue(element.isHittable)
    }
    let enable = app.buttons["clawdad.research.enable"]
    reveal(enable)
    XCTAssertTrue(enable.exists)
    XCTAssertFalse(enable.isEnabled)
    let objective = app.descendants(matching: .any).matching(identifier: "clawdad.research.objective").firstMatch
    reveal(objective, up: false)
    for (id, text) in [("objective", "Verify the two fixture calculations."), ("scope", "Only this disposable directory."), ("requirements", "Both results have test evidence.")] {
      let field = app.descendants(matching: .any).matching(identifier: "clawdad.research.\(id)").firstMatch
      reveal(field)
      field.tap(); field.typeText(text)
      if app.buttons["Done typing"].isHittable { app.buttons["Done typing"].tap() }
    }
    reveal(enable)
    XCTAssertTrue(enable.isEnabled); enable.tap()
    XCTAssertTrue(app.alerts["Enable autonomy for this exact thread?"].waitForExistence(timeout: 3))
    app.alerts.buttons["Cancel"].tap()
    reveal(enable)
    enable.tap(); app.alerts.buttons["Enable"].tap()
    let pause = app.buttons["clawdad.research.pause"]
    reveal(pause, up: false)
    XCTAssertTrue(pause.waitForExistence(timeout: 5)); pause.tap()
    reveal(app.staticTexts["clawdad.research.status"], up: false)
    XCTAssertEqual(app.staticTexts["clawdad.research.status"].label, "Paused")
    reveal(app.buttons["clawdad.research.off"])
    app.buttons["clawdad.research.off"].tap()
    reveal(app.staticTexts["clawdad.research.status"], up: false)
    XCTAssertEqual(app.staticTexts["clawdad.research.status"].label, "Off")
    saveScreenshot(app, "Research controls require opt in and preserve the connected call")
    app.buttons["Done"].tap()
    app.buttons["Workspace"].tap()
    XCTAssertEqual(composer.value as? String, "Preserve my unsent note.")
    XCTAssertTrue(app.buttons["End voice conversation"].exists)
    XCTAssertTrue(app.buttons["clawdad.assistant.think-aloud"].exists)
  }

  func testNativeSelectionHandleExtendsAcrossLines() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-selection-test", "--clawdad-assistant-reset-draft"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 15))
    app.buttons["clawdad.assistant.chat"].tap()
    let message = app.textViews["clawdad.assistant.text.selection-message"]
    XCTAssertTrue(message.waitForExistence(timeout: 5))
    let start = message.coordinate(withNormalizedOffset: .zero)
    start.withOffset(CGVector(dx: 28, dy: 12)).press(forDuration: 1.2)
    start.withOffset(CGVector(dx: 50, dy: 26)).press(forDuration: 0.3, thenDragTo: start.withOffset(CGVector(dx: 235, dy: 88)))
    let copy = app.menuItems["Copy"].waitForExistence(timeout: 2) ? app.menuItems["Copy"] : app.buttons["Copy"]
    XCTAssertTrue(copy.waitForExistence(timeout: 3))
    saveScreenshot(app, "Native selection handle extended across message lines")
    copy.tap()
    let composer = app.descendants(matching: .any).matching(identifier: "clawdad.assistant.composer").firstMatch
    composer.tap(); composer.press(forDuration: 1.2)
    let paste = app.menuItems["Paste"].waitForExistence(timeout: 2) ? app.menuItems["Paste"] : app.buttons["Paste"]
    XCTAssertTrue(paste.waitForExistence(timeout: 3)); paste.tap()
    let actual = composer.value as? String ?? ""
    XCTAssertTrue(actual.hasPrefix("Amber"), actual)
    XCTAssertTrue(actual.contains("\n"), actual)
    XCTAssertTrue(actual.contains("Select"), actual)
    XCTAssertFalse(actual.contains("let result"), actual)
  }

  func testNativePartialMessageSelectionAndCopyDuringCall() {
    checkNativePartialMessageSelectionAndCopyDuringCall(largeText: false)
  }

  func testNativePartialMessageSelectionAtAccessibilityTextSize() {
    checkNativePartialMessageSelectionAndCopyDuringCall(largeText: true)
  }

  private func checkNativePartialMessageSelectionAndCopyDuringCall(largeText: Bool) {
    for user in [false, true] {
      let app = XCUIApplication()
      app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-selection-test", "--clawdad-assistant-reset-draft"] + (user ? ["--selection-user"] : [])
      if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"] }
      app.launch()
      XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 15))
      app.buttons["clawdad.assistant.chat"].tap()
      app.buttons["clawdad.assistant.start-voice"].tap()
      let message = app.textViews["clawdad.assistant.text.selection-message"]
      XCTAssertTrue(message.waitForExistence(timeout: 5))
      if largeText {
        for _ in 0..<8 where message.frame.minY < 140 {
          app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.36)).press(forDuration: 0.05,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.68)))
        }
      }
      let start = message.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
      start.withOffset(CGVector(dx: 28, dy: 12)).press(forDuration: 1.2)
      let copy = app.menuItems["Copy"].waitForExistence(timeout: 2) ? app.menuItems["Copy"] : app.buttons["Copy"]
      XCTAssertTrue(copy.waitForExistence(timeout: 3), app.debugDescription)
      saveScreenshot(app, user ? "Native user message selection during call" : "Native Assistant response selection during call")
      copy.tap()
      XCTAssertTrue(app.buttons["End voice conversation"].exists)
      let composer = app.descendants(matching: .any).matching(identifier: "clawdad.assistant.composer").firstMatch
      composer.tap(); composer.press(forDuration: 1.2)
      let paste = app.menuItems["Paste"].waitForExistence(timeout: 2) ? app.menuItems["Paste"] : app.buttons["Paste"]
      XCTAssertTrue(paste.waitForExistence(timeout: 3)); paste.tap()
      XCTAssertEqual(composer.value as? String, "Amber")
      XCTAssertTrue(app.buttons["End voice conversation"].exists)
      XCTAssertTrue(app.buttons["clawdad.assistant.think-aloud"].exists)
      app.terminate()
    }
  }

  func testWeeklyAllowanceInMainScreenAndRemoteMenu() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-weekly-usage-test"]
    app.launch()
    let usage = app.buttons["clawdad.weeklyUsage.main"]
    XCTAssertTrue(usage.waitForExistence(timeout: 15))
    XCTAssertEqual(usage.label, "Weekly allowance details")
    XCTAssertEqual(usage.value as? String, "33% weekly remaining")
    XCTAssertEqual(app.staticTexts["clawdad.weeklyUsage.main.summary"].label, "33% weekly remaining")
    XCTAssertFalse(app.staticTexts["clawdad.weeklyUsage.reset"].exists)
    XCTAssertFalse(app.staticTexts["clawdad.weeklyUsage.refreshed"].exists)
    XCTAssertGreaterThanOrEqual(usage.frame.width, 44 - 0.001)
    XCTAssertGreaterThanOrEqual(usage.frame.height, 44 - 0.001)
    saveScreenshot(app, "Compact weekly allowance and info icon on main screen")
    usage.tap()
    XCTAssertTrue(app.navigationBars["Weekly allowance"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["clawdad.weeklyUsage.reset"].label.hasPrefix("Resets "))
    XCTAssertTrue(app.staticTexts["clawdad.weeklyUsage.refreshed"].label.hasPrefix("Last refreshed "))
    XCTAssertFalse(app.staticTexts["clawdad.weeklyUsage.explanation"].exists)
    saveScreenshot(app, "Weekly allowance with exact reset in local time")
    app.buttons["Done"].tap()
    app.terminate()
    app.launchArguments = ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-weekly-usage-test"]
    app.launch()
    let controls = app.buttons["Open Remote Assist controls"]
    if controls.waitForExistence(timeout: 2) { controls.tap() }
    let remoteUsage = app.buttons["clawdad.weeklyUsage.remote"]
    XCTAssertTrue(remoteUsage.waitForExistence(timeout: 5))
    XCTAssertEqual(remoteUsage.label, "Weekly allowance details")
    XCTAssertEqual(remoteUsage.value as? String, "33% weekly remaining")
    XCTAssertEqual(app.staticTexts["clawdad.weeklyUsage.remote.summary"].label, "33% weekly remaining")
    XCTAssertGreaterThanOrEqual(remoteUsage.frame.width, 44 - 0.001)
    XCTAssertGreaterThanOrEqual(remoteUsage.frame.height, 44 - 0.001)
    XCTAssertFalse(app.staticTexts["clawdad.weeklyUsage.reset"].exists)
    XCTAssertLessThanOrEqual(remoteUsage.frame.maxX, app.frame.maxX - 10)
    saveScreenshot(app, "Compact weekly allowance in Remote Assist menu")
    remoteUsage.tap()
    XCTAssertTrue(app.navigationBars["Weekly allowance"].waitForExistence(timeout: 5))
    saveScreenshot(app, "Weekly allowance details in Remote Assist popover")
    app.buttons["Done"].tap()
    XCTAssertTrue(app.buttons["Close Remote Assist controls"].exists)
    XCTAssertFalse(app.staticTexts["clawdad.weeklyUsage.reset"].exists)
  }

  func testWeeklyAllowanceAtAccessibilityTextSize() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-weekly-usage-test", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launch()
    let usage = app.buttons["clawdad.weeklyUsage.main"]
    XCTAssertTrue(usage.waitForExistence(timeout: 15))
    for _ in 0..<8 where !usage.isHittable { app.swipeUp() }
    let summary = app.staticTexts["clawdad.weeklyUsage.main.summary"]
    for _ in 0..<3 where summary.frame.minY < app.frame.minY + 120 {
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)))
    }
    XCTAssertGreaterThanOrEqual(usage.frame.width, 44 - 0.001)
    XCTAssertGreaterThanOrEqual(usage.frame.height, 44 - 0.001)
    saveScreenshot(app, "Compact weekly allowance at accessibility text size")
    XCTAssertTrue(usage.isHittable); usage.tap()
    XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
    let detailSummary = app.staticTexts["clawdad.weeklyUsage.detail-summary"]
    XCTAssertGreaterThanOrEqual(detailSummary.frame.minX, app.frame.minX + 10)
    XCTAssertLessThanOrEqual(detailSummary.frame.maxX, app.frame.maxX - 10)
    saveScreenshot(app, "Weekly allowance at accessibility text size")
    let refreshed = app.staticTexts["clawdad.weeklyUsage.refreshed"]
    for _ in 0..<12 where !refreshed.isHittable {
      app.scrollViews.element(boundBy: app.scrollViews.count - 1).swipeUp()
    }
    XCTAssertTrue(refreshed.isHittable, "Refresh details remain reachable with the largest text setting")
    XCTAssertTrue(app.buttons["Done"].isHittable, "Dismiss stays visible while details scroll")
    saveScreenshot(app, "Last refresh remains readable with accessibility text")
    app.buttons["Done"].tap()
  }
  func testWeeklyAllowanceStaleAndUnavailableDetailsStayInPopover() {
    for state in ["stale", "unavailable"] {
      let app = XCUIApplication()
      app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-weekly-usage-test", "--clawdad-weekly-usage-\(state)"]
      app.launch()
      let info = app.buttons["clawdad.weeklyUsage.main"]
      XCTAssertTrue(info.waitForExistence(timeout: 15))
      XCTAssertEqual(app.staticTexts["clawdad.weeklyUsage.main.summary"].label,
        state == "stale" ? "33% weekly remaining" : "Weekly allowance unavailable")
      XCTAssertFalse(app.staticTexts["clawdad.weeklyUsage.explanation"].exists)
      info.tap()
      XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
      let explanation = app.staticTexts["clawdad.weeklyUsage.explanation"]
      XCTAssertTrue(explanation.label.contains(state == "stale" ? "out of date" : "has not arrived"))
      if state == "unavailable" {
        XCTAssertEqual(app.staticTexts["clawdad.weeklyUsage.reset"].label, "Reset time: Not yet available")
        XCTAssertEqual(app.staticTexts["clawdad.weeklyUsage.refreshed"].label, "Last refreshed: Not yet available")
      }
      saveScreenshot(app, "Weekly allowance \(state) explanation")
      app.buttons["Done"].tap()
      XCTAssertTrue(info.isHittable)
      app.terminate()
    }
  }
  func testVoiceTranscriptionEditSaveReopenAndExplicitSend() {
    let app = startTranscriptionReviewFixture()
    let edit = app.buttons["clawdad.assistant.transcript.edit"]
    XCTAssertTrue(edit.waitForExistence(timeout: 5))
    XCTAssertGreaterThanOrEqual(edit.frame.width, 44)
    XCTAssertGreaterThanOrEqual(edit.frame.height, 44)
    XCTAssertEqual(edit.label, "Edit transcription")
    edit.tap()
    let editor = app.textViews["clawdad.assistant.transcript.editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap(); editor.typeText(" Corrected name: Cody.")
    let corrected = editor.value as? String
    XCTAssertTrue(corrected?.contains("Corrected name: Cody.") == true)
    saveScreenshot(app, "Editable transcription with Save and Resume while capture is paused")
    app.buttons["clawdad.assistant.transcript.save"].tap()
    XCTAssertTrue(app.staticTexts["You · Held"].waitForExistence(timeout: 5))
    XCTAssertFalse(editor.exists)
    XCTAssertFalse(app.staticTexts["You"].exists)
    XCTAssertTrue(app.buttons["End voice conversation"].isHittable)
    saveScreenshot(app, "Corrected transcription stays held with accessible edit and clear controls")
    app.buttons["clawdad.assistant.back"].tap()
    app.buttons["clawdad.assistant.return"].tap()
    XCTAssertTrue(app.staticTexts["You · Held"].waitForExistence(timeout: 5))
    XCTAssertTrue(messageText(app, corrected!).exists)
    app.buttons["clawdad.assistant.send-chat"].tap()
    XCTAssertTrue(app.staticTexts["You"].waitForExistence(timeout: 5))
    XCTAssertTrue(messageText(app, corrected!).exists)
    XCTAssertFalse(app.buttons["clawdad.assistant.transcript.edit"].exists)
    XCTAssertTrue(app.buttons["End voice conversation"].exists)
  }

  func testVoiceClearCancelAndConfirmedClearStayConnected() {
    let app = startTranscriptionReviewFixture()
    let clear = app.buttons["clawdad.assistant.transcript.clear"]
    XCTAssertTrue(clear.waitForExistence(timeout: 5))
    XCTAssertGreaterThanOrEqual(clear.frame.width, 44)
    XCTAssertGreaterThanOrEqual(clear.frame.height, 44)
    XCTAssertEqual(clear.label, "Clear transcription")
    clear.tap()
    let alert = app.alerts["Clear this transcription?"]
    XCTAssertTrue(alert.waitForExistence(timeout: 5))
    saveScreenshot(app, "Clear transcription requires an explicit confirmation")
    alert.buttons["Cancel"].tap()
    XCTAssertTrue(app.staticTexts["You · Held"].waitForExistence(timeout: 5))
    XCTAssertTrue(messageText(app, "Please check the second Terminal tab.").exists)
    XCTAssertFalse(app.staticTexts["You"].exists)
    clear.tap(); alert.buttons["Clear"].tap()
    let removed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: clear)
    wait(for: [removed], timeout: 5)
    app.buttons["clawdad.assistant.back"].tap(); app.buttons["clawdad.assistant.return"].tap()
    XCTAssertFalse(messageText(app, "Please check the second Terminal tab.").exists)
    XCTAssertFalse(app.staticTexts["You"].exists)
    XCTAssertTrue(app.buttons["End voice conversation"].exists)
  }

  func testVoiceEditorBackKeepsCorrectionAtLargeTextSize() {
    let app = startTranscriptionReviewFixture(largeText: true)
    let edit = app.buttons["clawdad.assistant.transcript.edit"]
    XCTAssertTrue(edit.waitForExistence(timeout: 5))
    for _ in 0..<8 where !edit.isHittable { app.swipeUp() }
    edit.tap()
    let editor = app.textViews["clawdad.assistant.transcript.editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap(); editor.typeText(" A correction.")
    let corrected = editor.value as? String
    app.buttons["clawdad.assistant.back"].tap()
    XCTAssertFalse(editor.exists, "Back closes the editor first and retains its contents")
    XCTAssertTrue(app.buttons["clawdad.assistant.back"].exists)
    app.buttons["clawdad.assistant.back"].tap(); app.buttons["clawdad.assistant.return"].tap()
    let held = app.staticTexts["You · Held"]
    XCTAssertTrue(held.waitForExistence(timeout: 5))
    for _ in 0..<8 where !held.isHittable { app.swipeUp() }
    XCTAssertTrue(messageText(app, corrected!).exists)
    XCTAssertFalse(app.staticTexts["You"].exists)
    XCTAssertTrue(app.buttons["End voice conversation"].isHittable)
    XCTAssertTrue(app.buttons["clawdad.assistant.mute"].isHittable)
    XCTAssertTrue(app.buttons["clawdad.assistant.send-chat"].isHittable)
    Thread.sleep(forTimeInterval: 0.5) // Capture the settled keyboard/navigation transition.
    saveScreenshot(app, "Held voice correction survives navigation at accessibility text size")
  }

  func testTranscriptionReviewGlossaryExplainsHoldAndClear() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test"]
    app.launch()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 20))
    app.buttons["Settings"].tap()
    let glossary = app.buttons["clawdad.settings.icon-glossary"]
    for _ in 0..<18 where !glossary.isHittable { app.swipeUp() }
    glossary.tap()
    XCTAssertTrue(app.buttons["clawdad.settings.icon-glossary.back"].waitForExistence(timeout: 5))
    for wording in ["Holds the unsent voice turn", "Clear discards the entire unsent voice turn"] {
      let explanation = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", wording)).firstMatch
      for _ in 0..<18 where !explanation.isHittable { app.swipeUp() }
      XCTAssertTrue(explanation.isHittable, wording)
    }
    saveScreenshot(app, "Icon glossary explains transcription editing and deliberate clearing")
    app.buttons["clawdad.settings.icon-glossary.back"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
  }

  private func startTranscriptionReviewFixture(largeText: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-send-test", "--clawdad-assistant-reset-draft"]
    if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"] }
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.open"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.open"].tap()
    app.buttons["clawdad.assistant.return"].tap()
    return app
  }

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
    XCTAssertTrue(messageText(app, "Playback is repaired. Your draft is preserved.").exists)
    app.buttons["Resume control"].tap()
    XCTAssertEqual(app.textViews.matching(identifier: "clawdad.assistant.text.request.history-task").count, 1)
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
    XCTAssertTrue(messageText(app, "Please inspect my attached screenshot.").exists)
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

  func testInfinityIsSharedAcrossViewsAndChatSendFinishesHeldVoiceWhileMuted() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-send-test"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.open"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.open"].tap()
    let thinkAloud = app.buttons["clawdad.assistant.think-aloud"]
    XCTAssertTrue(thinkAloud.waitForExistence(timeout: 5))
    XCTAssertEqual(thinkAloud.value as? String, "On")
    XCTAssertGreaterThanOrEqual(thinkAloud.frame.width, 44)
    XCTAssertGreaterThanOrEqual(thinkAloud.frame.height, 44)
    XCTAssertFalse(app.buttons["clawdad.assistant.send-now"].exists)
    saveScreenshot(app, "Infinity enabled on the persistent call bar")
    app.buttons["clawdad.assistant.return"].tap()
    XCTAssertTrue(app.staticTexts["You · Draft"].waitForExistence(timeout: 5))
    XCTAssertEqual(thinkAloud.value as? String, "On")
    XCTAssertFalse(app.switches["clawdad.assistant.think-aloud"].exists)
    XCTAssertFalse(app.staticTexts["Think aloud"].exists)
    XCTAssertFalse(app.staticTexts["Keep listening through pauses until you tap Send."].exists)
    app.buttons["clawdad.assistant.back"].tap()
    app.buttons["Mute Assistant"].tap()
    XCTAssertTrue(app.buttons["Unmute Assistant"].waitForExistence(timeout: 3))
    app.buttons["clawdad.assistant.return"].tap()
    let send = app.buttons["clawdad.assistant.send-chat"]
    XCTAssertTrue(send.isEnabled, "The retained Think aloud turn can be sent while the microphone is off")
    XCTAssertEqual(send.label, "Send voice turn")
    send.tap()
    XCTAssertTrue(app.staticTexts["You"].waitForExistence(timeout: 5))
    XCTAssertTrue(messageText(app, "Please check the second Terminal tab.").exists)
    XCTAssertFalse(app.staticTexts["You · Draft"].exists)
    XCTAssertFalse(send.isEnabled)
    // Leave the fixture's persisted preference in the default mode.
    thinkAloud.tap()
    XCTAssertEqual(thinkAloud.value as? String, "Off")
    app.buttons["clawdad.assistant.back"].tap()
    XCTAssertEqual(thinkAloud.value as? String, "Off")
    saveScreenshot(app, "Infinity off after a held voice turn is sent from messages")
  }

  func testInfinityAvailableFromTerminalPickerAndCallChat() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "terminal-reader", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.remote.assistant"].waitForExistence(timeout: 20))
    app.buttons["clawdad.remote.assistant"].tap()
    let infinity = app.buttons["clawdad.assistant.think-aloud"]
    XCTAssertTrue(infinity.waitForExistence(timeout: 5))
    if infinity.value as? String == "On" { infinity.tap() }
    infinity.tap(); XCTAssertEqual(infinity.value as? String, "On")
    if app.buttons["clawdad.assistant.back"].exists { app.buttons["clawdad.assistant.back"].tap() }
    XCTAssertEqual(infinity.value as? String, "On")
    app.buttons["Choose Terminal tab"].tap()
    XCTAssertTrue(infinity.isHittable)
    XCTAssertEqual(infinity.value as? String, "On")
    infinity.tap(); XCTAssertEqual(infinity.value as? String, "Off")
    app.buttons["clawdad.assistant.return"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.send-chat"].waitForExistence(timeout: 5))
    XCTAssertEqual(infinity.value as? String, "Off")
    saveScreenshot(app, "Terminal and chat share the same Think aloud state")
  }

  func testIconGlossaryNavigationAndActualTurnInterval() { checkIconGlossary(largeText: false) }
  func testIconGlossaryAndCallControlsAtAccessibilityTextSize() { checkIconGlossary(largeText: true) }
  private func checkIconGlossary(largeText: Bool) {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft"]
    if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.open"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.open"].tap()
    let infinity = app.buttons["clawdad.assistant.think-aloud"]
    XCTAssertTrue(infinity.waitForExistence(timeout: 5))
    XCTAssertTrue(infinity.isHittable)
    XCTAssertGreaterThanOrEqual(infinity.frame.width, 44)
    XCTAssertGreaterThanOrEqual(infinity.frame.height, 44)
    app.buttons["Settings"].tap()
    let glossary = app.buttons["clawdad.settings.icon-glossary"]
    for _ in 0..<18 where !glossary.isHittable { app.swipeUp() }
    XCTAssertTrue(glossary.isHittable, app.debugDescription)
    glossary.tap()
    XCTAssertTrue(app.buttons["clawdad.settings.icon-glossary.back"].waitForExistence(timeout: 5))
    let timing = app.staticTexts["clawdad.glossary.turn-timing"]
    for _ in 0..<8 where !timing.isHittable { app.swipeUp() }
    XCTAssertTrue(timing.label.contains("2 seconds without new transcribed words"))
    XCTAssertTrue(infinity.isHittable, "Call control remains available inside Settings and its glossary")
    saveScreenshot(app, largeText ? "Glossary and call controls at largest accessibility text size" : "Icon glossary with actual two-second interval")
    app.buttons["clawdad.settings.icon-glossary.back"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    app.buttons["Done"].tap()
    XCTAssertTrue(infinity.isHittable)
  }

  func testImageOnlyDraftSurvivesFailedSendAndReopening() {
    let app = XCUIApplication()
    app.launchArguments = ["--clawdad-app-store-preview", "workspace", "--clawdad-assistant-test", "--clawdad-assistant-reset-draft", "--clawdad-assistant-failed-send"]
    app.launch()
    XCTAssertTrue(app.buttons["clawdad.assistant.chat"].waitForExistence(timeout: 20))
    app.buttons["clawdad.assistant.chat"].tap()
    selectAssistantPhoto(app)
    let send = app.buttons["clawdad.assistant.send-chat"]
    XCTAssertTrue(send.isEnabled)
    send.tap()
    XCTAssertTrue(app.staticTexts["clawdad.assistant.error"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["clawdad.assistant.image-preview"].exists)
    app.buttons["clawdad.assistant.back"].tap()
    app.buttons["clawdad.assistant.chat"].tap()
    XCTAssertTrue(app.buttons["clawdad.assistant.image-preview"].waitForExistence(timeout: 5))
    send.tap()
    let sent = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["clawdad.assistant.image-preview"])
    wait(for: [sent], timeout: 5)
    XCTAssertFalse(app.staticTexts["clawdad.assistant.error"].exists)
    saveScreenshot(app, "Image-only message accepted without a caption after a preserved failed draft")
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
    XCTAssertTrue(messageText(app, "Could you check which Terminal tab is working?").waitForExistence(timeout: 8))
    let thread = XCTAttachment(screenshot: app.screenshot())
    thread.name = "Assistant conversation with live voice transcription"
    thread.lifetime = .keepAlways
    add(thread)
    app.buttons["clawdad.assistant.back"].tap()
    app.buttons["clawdad.assistant.return"].tap()
    XCTAssertTrue(messageText(app, "Could you check which Terminal tab is working?").waitForExistence(timeout: 5))
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
    XCTAssertTrue(messageText(app, "Which tab is working?").waitForExistence(timeout: 5))
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Assistant conversation inside ClawDad"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    app.buttons["clawdad.assistant.back"].tap()
    app.buttons["clawdad.assistant.open"].tap()
    XCTAssertTrue(messageText(app, "Which tab is working?").waitForExistence(timeout: 5))
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
