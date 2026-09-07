import XCTest

@MainActor
final class AssistantUITests: XCTestCase {
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
