import XCTest

@testable import ClawDad

private final class AssistantHTTPFixture: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let failed = request.url?.query == "failure"
    let response = HTTPURLResponse(
      url: request.url!, statusCode: failed ? 503 : 202, httpVersion: nil,
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(
      self,
      didLoad: Data(
        (failed
          ? "{\"error\":\"Local model unavailable\"}" : "{\"audio\":{\"state\":\"generating\"}}")
          .utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

final class MacAssistantTests: XCTestCase {
  func testNamedKeyboardShortcutsPreserveModifiersAndRejectUnknownKeys() {
    let key = assistantKeyStroke("tab", modifiers: ["command", "shift"])
    XCTAssertEqual(key?.keyCode, 48)
    XCTAssertEqual(key?.flags, [.maskCommand, .maskShift])
    XCTAssertNil(assistantKeyStroke("unknown-key", modifiers: []))
    XCTAssertNil(assistantKeyStroke("enter", modifiers: ["unknown"]))
  }
  @MainActor func testLocalSpeechPreparationAccepts202AndPreservesRealFailures() async throws {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [AssistantHTTPFixture.self]
    var runtime = MacAssistantRuntime(
      baseURL: URL(string: "http://127.0.0.1:4487")!, token: "fixture")
    runtime.session = URLSession(configuration: config)
    defer { runtime.session.invalidateAndCancel() }
    let preparing = try await runtime.json("/v1/tts/message", ["text": .string("Hello")])
    XCTAssertEqual(preparing["audio"]?.object?["state"]?.string, "generating")
    do {
      _ = try await runtime.json("/v1/tts/message?failure")
      XCTFail("A real provider failure must not look ready")
    } catch { XCTAssertEqual(error.localizedDescription, "Local model unavailable") }
  }
  @MainActor func testManualControlInvalidatesPendingAgentInput() throws {
    let gate = MacAssistantInteractionGate(observe: false)
    let ticket = try gate.ticket()
    XCTAssertTrue(gate.isCurrent(ticket))
    gate.noteManualInput()
    XCTAssertFalse(gate.isCurrent(ticket))
    XCTAssertThrowsError(try gate.ticket())
  }
  func testOnlyEmptyCodexComposerAllowsAutomaticSubmission() {
    XCTAssertTrue(assistantPromptIsEmpty("Response completed\n› \n  gpt model · workspace"))
    XCTAssertTrue(
      assistantPromptIsEmpty("Response completed\n› Ask Codex to do anything\n  80% context left"))
    XCTAssertFalse(assistantPromptIsEmpty("› Existing unsent draft\n  gpt model"))
    XCTAssertFalse(assistantPromptIsEmpty("› \n  Existing unsent multiline draft\n  gpt model"))
    XCTAssertFalse(assistantPromptIsEmpty("› \n  Allow this command?\n  1. Yes"))
    XCTAssertFalse(assistantPromptIsEmpty("user@Mac $ "))
    XCTAssertFalse(assistantPromptIsEmpty("Allow this command?\n1. Yes\n2. No"))
    XCTAssertFalse(assistantPromptIsEmpty("Earlier › content\nRunning command"))
  }
}
