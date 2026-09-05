import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

@MainActor
final class RemoteTerminalReaderTests: XCTestCase {
  private var sent: [[String: JSONValue]] = []

  private func setupReader() -> (CloudSession, RemoteTerminalReader) {
    let domain = "RemoteTerminalReaderTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: domain)!
    addTeardownBlock { UserDefaults.standard.removePersistentDomain(forName: domain) }
    let session = CloudSession(defaults: defaults) { [weak self] type, body, _ in
      if type == "speech.synthesize.request" { self?.sent.append(body) }
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

  func testLatestAnswerUsesExistingAudioWithoutComposerProjectOrHistory() async {
    let (session, reader) = setupReader()
    defer { session.readAloud.stop() }
    session.selectedProjectPath = "/unrelated-project"
    reader.beginLookup()
    reader.expect(request)
    XCTAssertTrue(reader.receive(result(), selectedTabId: "selected-tab"))
    await drain()
    XCTAssertEqual(sent.count, 1)
    XCTAssertEqual(sent[0]["text"]?.stringValue, "The exact latest answer 🦞.")
    XCTAssertEqual(sent[0]["source"]?.stringValue, "remote-assist")
    XCTAssertEqual(sent[0]["project"]?.stringValue, "")
    XCTAssertEqual(sent[0]["historyRequestId"]?.stringValue, "")
    XCTAssertEqual(reader.title, "ClawDad")
    XCTAssertFalse(reader.receive(result(), selectedTabId: "selected-tab"))
    XCTAssertEqual(sent.count, 1)
  }

  func testWorkingTurnRequiresExplicitPlaybackOfPreviousAnswer() async {
    let (session, reader) = setupReader()
    defer { session.readAloud.stop() }
    reader.beginLookup()
    reader.expect(request)
    XCTAssertTrue(reader.receive(result(inProgress: true), selectedTabId: "selected-tab"))
    await drain()
    XCTAssertTrue(reader.inProgress)
    XCTAssertTrue(sent.isEmpty)
    reader.togglePlayback()
    await drain()
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
    XCTAssertEqual(sent[0]["text"]?.stringValue, "Selected exact text")
    XCTAssertEqual(reader.title, "Selected Mac text")
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
}
