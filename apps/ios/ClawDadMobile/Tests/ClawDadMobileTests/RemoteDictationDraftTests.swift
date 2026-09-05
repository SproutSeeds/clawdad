import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

@MainActor
final class RemoteDictationDraftTests: XCTestCase {
  private var sent: [(type: String, body: [String: JSONValue], id: String)] = []
  private var defaultsDomains: [String] = []

  override func tearDown() {
    for domain in defaultsDomains { UserDefaults.standard.removePersistentDomain(forName: domain) }
    super.tearDown()
  }

  private func makeSession() -> CloudSession {
    let domain = "RemoteDictationDraftTests.\(UUID().uuidString)"
    defaultsDomains.append(domain)
    let session = CloudSession(defaults: UserDefaults(suiteName: domain)!) { [weak self] type, body, id in
      self?.sent.append((type, body, id))
    }
    session.hostId = "test-mac"
    session.pairedHostId = "test-mac"
    session.state = .connected
    session.hostOnline = true
    return session
  }

  private var recording: VoiceRecording {
    VoiceRecording(data: Data([1, 2, 3]), fileName: "voice.m4a", mimeType: "audio/mp4", duration: 2)
  }

  private func drain() async { for _ in 0..<20 { await Task.yield() } }

  private func reply(_ session: CloudSession, requestId: String, text: String) {
    session.apply(CloudEnvelope(type: "speech.transcription", accountId: session.accountId,
      workspaceId: session.workspaceId, sourceDeviceId: session.hostId, targetHostId: session.hostId,
      body: ["requestId": .string(requestId), "text": .string(text)]))
  }

  func testRemoteTranscriptGoesOnlyToItsEditableDraftAndComposerStillWorks() async throws {
    let session = makeSession()
    session.selectedProjectPath = "/an-unavailable-previous-project"
    let draft = RemoteDictationDraft()
    draft.bind(to: session)
    draft.beginRecording()
    draft.transcribe(recording)
    await drain()
    let requestId = try XCTUnwrap(sent.last?.body["requestId"]?.stringValue)
    XCTAssertEqual(sent.last?.body["project"]?.stringValue, "",
                   "Remote dictation uses the host default, independent of the composer's selected project.")
    reply(session, requestId: requestId, text: "Dictated remote prompt")
    XCTAssertEqual(draft.text, "Dictated remote prompt")
    XCTAssertNil(session.voiceTranscription)
    XCTAssertFalse(draft.hasRecording)
    let composerId = try XCTUnwrap(session.transcribeVoice(recording.data))
    reply(session, requestId: composerId, text: "Composer prompt")
    XCTAssertEqual(session.voiceTranscription?.text, "Composer prompt")
    XCTAssertEqual(draft.text, "Dictated remote prompt")
  }

  func testDisconnectRetainsRecordingAndRetryIgnoresOldTranscript() async throws {
    let session = makeSession()
    let draft = RemoteDictationDraft()
    draft.bind(to: session)
    draft.beginRecording()
    draft.text = "Existing draft"
    draft.beginRecording()
    draft.transcribe(recording)
    await drain()
    let oldId = try XCTUnwrap(sent.last?.body["requestId"]?.stringValue)
    session.disconnect()
    XCTAssertFalse(draft.transcribing)
    XCTAssertTrue(draft.hasRecording)
    XCTAssertEqual(draft.text, "Existing draft")
    XCTAssertTrue(session.voiceTranscriptionError.isEmpty)
    draft.text = "Edited while reconnecting"
    session.state = .connected
    session.hostOnline = true
    draft.retryTranscription()
    await drain()
    let retryId = try XCTUnwrap(sent.last?.body["requestId"]?.stringValue)
    XCTAssertNotEqual(oldId, retryId)
    reply(session, requestId: oldId, text: "Stale")
    XCTAssertTrue(draft.transcribing)
    reply(session, requestId: retryId, text: "Continued")
    XCTAssertEqual(draft.text, "Edited while reconnecting\n\nContinued")
  }

  func testCancelInvalidatesOnlyOwnedTranscriptionAndKeepsAudioForRetry() async throws {
    let session = makeSession()
    let draft = RemoteDictationDraft()
    draft.bind(to: session)
    draft.beginRecording()
    draft.transcribe(recording)
    await drain()
    let oldId = try XCTUnwrap(sent.last?.body["requestId"]?.stringValue)
    draft.cancelTranscription()
    reply(session, requestId: oldId, text: "Cancelled")
    XCTAssertTrue(draft.text.isEmpty)
    XCTAssertTrue(draft.hasRecording)
    let composerId = try XCTUnwrap(session.transcribeVoice(recording.data))
    draft.cancelTranscription()
    reply(session, requestId: composerId, text: "Still mine")
    XCTAssertEqual(session.voiceTranscription?.text, "Still mine")
  }

  func testBusyComposerRejectsRemoteRequestWithoutConsumingComposerResult() async throws {
    let session = makeSession()
    let composerId = try XCTUnwrap(session.transcribeVoice(recording.data))
    let draft = RemoteDictationDraft()
    draft.bind(to: session)
    draft.beginRecording()
    draft.transcribe(recording)
    XCTAssertFalse(draft.transcribing)
    XCTAssertTrue(draft.hasRecording)
    XCTAssertFalse(draft.error.isEmpty)
    reply(session, requestId: composerId, text: "Composer owns this")
    XCTAssertEqual(session.voiceTranscription?.text, "Composer owns this")
    XCTAssertTrue(draft.text.isEmpty)
  }

  func testDeliveryRetainsDraftCoalescesTapsAndRetriesSameRequestAfterUncertainty() throws {
    let session = makeSession()
    let draft = RemoteDictationDraft()
    draft.bind(to: session)
    draft.beginRecording()
    draft.text = "Keep this text"
    let first = try XCTUnwrap(draft.beginDelivery())
    XCTAssertNil(draft.beginDelivery())
    draft.completeDelivery(requestId: "unrelated", result: .success(.copied))
    XCTAssertTrue(draft.sending)
    draft.completeDelivery(requestId: first.requestId, result: .failure(.failed("Reply lost")))
    XCTAssertEqual(draft.text, "Keep this text")
    let retry = try XCTUnwrap(draft.beginDelivery())
    XCTAssertEqual(retry.requestId, first.requestId)
    draft.completeDelivery(requestId: retry.requestId, result: .success(.copied))
    XCTAssertTrue(draft.notice.contains("clipboard"))
    XCTAssertEqual(draft.text, "Keep this text")
    let deliberateRepeat = try XCTUnwrap(draft.beginDelivery())
    XCTAssertNotEqual(deliberateRepeat.requestId, first.requestId)
  }

  func testDraftCannotBeDeliveredToAnotherComputer() {
    let session = makeSession()
    let draft = RemoteDictationDraft()
    draft.bind(to: session)
    draft.beginRecording()
    draft.text = "For the original computer"
    session.hostId = "another-mac"
    XCTAssertNil(draft.beginDelivery())
    XCTAssertEqual(draft.text, "For the original computer")
    XCTAssertFalse(draft.error.isEmpty)
  }
}
