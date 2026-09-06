import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

@MainActor
final class RemoteTerminalReaderTests: XCTestCase {
  private var sent: [String] = []

  private func setupReader() -> (CloudSession, RemoteTerminalReader) {
    let domain = "RemoteTerminalReaderTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: domain)!
    addTeardownBlock { UserDefaults.standard.removePersistentDomain(forName: domain) }
    let session = CloudSession(defaults: defaults, readAloud: MobileReadAloudController()) { [weak self] type, body, _ in
      XCTAssertEqual(type, "speech.synthesize.request")
      XCTAssertEqual(body["source"]?.stringValue, "remote-assist")
      XCTAssertEqual(body["executionPreference"]?.stringValue, "paired-mac-first")
      XCTAssertEqual(body["allowRemoteFallback"], .bool(false))
      XCTAssertEqual(body["project"]?.stringValue, "")
      self?.sent.append(body["text"]?.stringValue ?? "")
    }
    session.hostId = "test-mac"
    session.pairedHostId = "test-mac"
    session.state = .connected
    session.hostOnline = true
    let reader = RemoteTerminalReader()
    reader.bind(to: session)
    return (session, reader)
  }

  private var request: RemoteTerminalResponseMessage {
    .request(requestId: "request", tabId: "selected-tab", expectedRevision: 2)
  }

  private func result(inProgress: Bool = false) -> RemoteTerminalResponseMessage {
    request.success(tabTitle: "ClawDad", response: RemoteTerminalResponse(
      sessionId: "actual-cli-session", turnId: "actual-turn", text: "The exact latest answer 🦞.",
      completedAt: "2026-09-05T08:00:00Z", inProgress: inProgress
    ))
  }

  private func drain() async { for _ in 0..<20 { await Task.yield() } }

  func testLatestAnswerRequestsSharedSpeechWithExactTextWithoutComposerContext() async {
    let (session, reader) = setupReader()
    defer { session.readAloud.stop() }
    session.selectedProjectPath = "/unrelated-project"
    reader.beginLookup()
    reader.expect(request)
    XCTAssertTrue(reader.receive(result(), selectedTabId: "selected-tab"))
    await drain()
    XCTAssertEqual(sent.count, 1)
    XCTAssertEqual(sent.first, "The exact latest answer 🦞.")
    XCTAssertEqual(reader.title, "ClawDad")
    XCTAssertFalse(reader.receive(result(), selectedTabId: "selected-tab"))
    XCTAssertEqual(sent.count, 1)
  }

  func testWorkingTurnAutomaticallyReadsOnlyItsLastCompletedAnswer() async {
    let (session, reader) = setupReader()
    defer { session.readAloud.stop() }
    reader.beginLookup()
    reader.expect(request)
    XCTAssertTrue(reader.receive(result(inProgress: true), selectedTabId: "selected-tab"))
    await drain()
    XCTAssertTrue(reader.inProgress)
    XCTAssertEqual(sent.count, 1)
  }

  func testTabChangeAndCancellationRejectLateReplies() async {
    let (_, reader) = setupReader()
    reader.beginLookup()
    reader.expect(request)
    XCTAssertFalse(reader.receive(result(), selectedTabId: "different-tab"))
    XCTAssertTrue(reader.text.isEmpty)
    reader.invalidate()
    XCTAssertFalse(reader.receive(result(), selectedTabId: "selected-tab"))
    await drain()
    XCTAssertTrue(sent.isEmpty)
  }

  func testAnotherComputerCannotReceiveOrPlayThisResponse() async {
    let (session, reader) = setupReader()
    reader.beginLookup()
    reader.expect(request)
    session.hostId = "different-mac"
    XCTAssertFalse(reader.receive(result(), selectedTabId: "selected-tab"))
    await drain()
    XCTAssertTrue(sent.isEmpty)
  }

  func testSelectedTextHasIndependentOwnershipAndCancelledSelectionCannotPlay() async {
    let (session, reader) = setupReader()
    defer { session.readAloud.stop() }
    reader.beginSelection(requestId: "old", tabId: "tab")
    reader.cancelLookup()
    XCTAssertFalse(reader.receiveSelection(requestId: "old", text: "Stale selected text"))
    reader.beginSelection(requestId: "new", tabId: "tab")
    XCTAssertTrue(reader.receiveSelection(requestId: "new", text: "Selected exact text"))
    await drain()
    XCTAssertEqual(sent.count, 1)
    XCTAssertEqual(sent.first, "Selected exact text")
    XCTAssertEqual(reader.title, "Selected Mac text")
  }

  func testCancelAndImmediateRetryCannotSendTheEarlierAttemptWithTheSameKey() async {
    let (session, _) = setupReader()
    defer { session.readAloud.stop() }
    session.toggleRemoteReadAloud(key: "same", text: "Older text")
    session.readAloud.stop()
    session.toggleRemoteReadAloud(key: "same", text: "Current text")
    await drain()
    XCTAssertEqual(sent, ["Current text"])
    XCTAssertEqual(session.readAloud.phase, .preparing)
    session.readAloud.stop()
    session.readAloud.markAccepted(requestId: "stale")
    session.readAloud.receiveChunk(requestId: "stale", partIndex: 0, partCount: 1,
      chunkIndex: 0, chunkCount: 1, fileName: "stale.wav", mimeType: "audio/wav", declaredBytes: 3, dataBase64: "YWJj")
    session.readAloud.complete(requestId: "stale", partCount: 1)
    XCTAssertEqual(session.readAloud.phase, .idle)
  }

  func testBackKeepsOwnedPlaybackAndStoppingReaderDoesNotStopComposerAudio() {
    let (session, reader) = setupReader()
    defer { session.readAloud.stop() }
    reader.beginLookup()
    reader.expect(request)
    XCTAssertTrue(reader.receive(result(), selectedTabId: "selected-tab"))
    let key = reader.playbackKey
    reader.cancelLookup()
    XCTAssertEqual(session.readAloud.activeKey, key)
    session.readAloud.begin(key: "composer", requestId: "other", envelopeId: "other")
    reader.invalidate()
    XCTAssertEqual(session.readAloud.activeKey, "composer")
  }

  func testNavigationKeepsCapturedResponsePreparingAndStopRemainsAvailable() async {
    let (session, reader) = setupReader()
    defer { session.readAloud.stop() }
    reader.beginLookup()
    reader.expect(request)
    XCTAssertTrue(reader.receive(result(), selectedTabId: "selected-tab"))
    let key = reader.playbackKey
    reader.invalidate("Selected tab changed")
    await drain()
    XCTAssertEqual(sent, ["The exact latest answer 🦞."])
    XCTAssertEqual(session.readAloud.activeKey, key)
    XCTAssertEqual(session.readAloud.phase, .preparing)
    XCTAssertEqual(reader.playbackKey, key)
    reader.stopPlayback()
    XCTAssertEqual(session.readAloud.phase, .idle)
  }
}
