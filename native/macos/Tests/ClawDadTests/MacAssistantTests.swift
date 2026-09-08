import XCTest
import ClawDadRemoteAssistProtocol

@testable import ClawDad

private final class AssistantHTTPFixture: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    var body = request.httpBody ?? Data()
    if body.isEmpty, let stream = request.httpBodyStream {
      stream.open()
      defer { stream.close() }
      var buffer = [UInt8](repeating: 0, count: 4096)
      while true {
        let count = stream.read(&buffer, maxLength: 4096)
        if count <= 0 { break }
        body.append(contentsOf: buffer.prefix(count))
      }
    }
    let failed = request.url?.query == "failure"
    let response = HTTPURLResponse(
      url: request.url!, statusCode: failed ? 503 : 202, httpVersion: nil,
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(
      self,
      didLoad: Data(
        (request.url?.path.hasPrefix("/v1/assistant/") == true
          ? String(decoding: body, as: UTF8.self) : failed
          ? "{\"error\":\"Local model unavailable\"}" : "{\"audio\":{\"state\":\"generating\"}}")
          .utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

final class MacAssistantTests: XCTestCase {
  @MainActor func testImageBridgeUsesTheAuthenticatedDeviceInsteadOfClaimedOwners() async throws {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [AssistantHTTPFixture.self]
    var runtime = MacAssistantRuntime(baseURL: URL(string: "http://127.0.0.1:4487")!, token: "fixture")
    runtime.session = URLSession(configuration: config)
    defer { runtime.session.invalidateAndCancel() }
    for (action, field) in [(AssistantWireRequest.Action.imageUpload, "owner"), (.command, "imageOwner")] {
      let payload = try JSONEncoder().encode(AssistantValue.object([
        "action": .string(action == .command ? "message" : "uploadBegin"),
        "owner": .string("claimed-other-phone"), "imageOwner": .string("claimed-other-phone"), "images": .array([])
      ]))
      let request = AssistantWireRequest(action: action, payload: payload)
      let response = try await runtime.respond(request, deviceId: "authenticated-phone")
      let body = try JSONDecoder().decode([String: AssistantValue].self, from: response)
      XCTAssertEqual(body[field]?.string, "authenticated-phone")
      do { _ = try await runtime.respond(request); XCTFail("An unbound image request must be rejected") }
      catch { XCTAssertTrue(error is AssistantProtocolError) }
    }
  }
  @MainActor func testDraftVerificationWaitsForRenderingAndInsertsOnlyOnce() async throws {
    var inserts = 0, reads = 0
    try await assistantInsertVerifiedDraft("hey Cody", insert: { inserts += 1; return true }, read: {
      reads += 1
      return reads < 3 ? "› Ask Codex to do anything\n gpt-6-astra" : "› hey Cody\n gpt-6-astra"
    }, wait: {})
    XCTAssertEqual(inserts, 1)
    XCTAssertEqual(reads, 3)
  }
  @MainActor func testUncertainDraftIsNotPastedAgainAndEnterIsNeverInvolved() async {
    var inserts = 0
    do {
      try await assistantInsertVerifiedDraft("hey Cody", insert: { inserts += 1; return true },
        read: { "› Existing unrelated draft\n gpt-6-astra" }, wait: {})
      XCTFail("An unobserved insertion must not claim success")
    } catch { XCTAssertTrue(error.localizedDescription.contains("Enter was not sent")) }
    XCTAssertEqual(inserts, 1)
  }
  @MainActor func testChangedTargetStopsVerificationWithoutAnotherPaste() async {
    var inserts = 0
    do {
      try await assistantInsertVerifiedDraft("hey Cody", insert: { inserts += 1; return true },
        read: { throw MacAssistantError("Target changed") }, wait: {})
      XCTFail("A changed tab must stop verification")
    } catch { XCTAssertEqual(error.localizedDescription, "Target changed") }
    XCTAssertEqual(inserts, 1)
  }
  func testDraftMatcherRequiresTheEntireCurrentComposer() {
    XCTAssertTrue(assistantDraftMatches("Earlier hey Cody\n› hey Cody\n gpt-6-astra", expected: "hey Cody"))
    XCTAssertTrue(assistantDraftMatches("› Please check\n  the second tab\n gpt-6-astra", expected: "Please check the second tab"))
    XCTAssertFalse(assistantDraftMatches("Earlier hey Cody\n› Ask Codex to do anything\n gpt-6-astra", expected: "hey Cody"))
    XCTAssertFalse(assistantDraftMatches("› hey Cody additional text\n gpt-6-astra", expected: "hey Cody"))
    XCTAssertFalse(assistantDraftMatches("user@mac $ hey Cody", expected: "hey Cody"))
  }
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
