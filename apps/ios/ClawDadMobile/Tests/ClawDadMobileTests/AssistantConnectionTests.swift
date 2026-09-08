import ClawDadFileTransport
import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

@MainActor
final class AssistantConnectionTests: XCTestCase {
  func testUnansweredHealthRequestClosesStaleConnectionAndNextAttemptUsesNewPeer() async throws {
    let signal = AssistantTestSignaling(), first = AssistantPeerFixture(), second = AssistantPeerFixture()
    var peers = [first, second]
    let connection = AssistantConnection(makePeer: { peers.removeFirst() }, requestTimeout: { _ in 20_000_000 })
    defer { connection.close() }
    connection.bindSignaling(signal)
    connection.connect()
    first.onOpen?()
    XCTAssertTrue(connection.connected)
    do { _ = try await connection.request(.state); XCTFail("An unanswered health check must fail") }
    catch { XCTAssertEqual(error.localizedDescription, AssistantProtocolError.timedOut.localizedDescription) }
    XCTAssertFalse(connection.connected, "A timed-out link must not remain marked connected")
    XCTAssertTrue(first.stopped)
    connection.connect()
    second.onOpen?()
    XCTAssertTrue(connection.connected)
    XCTAssertTrue(peers.isEmpty, "Reconnect must create a fresh peer")
    first.onFailure?(RemoteFileError.disconnected)
    XCTAssertTrue(connection.connected, "An old peer cannot close its replacement")
  }

  func testFailedSendInvalidatesConnectionWithoutReplayingCommand() async throws {
    let signal = AssistantTestSignaling(), peer = AssistantPeerFixture()
    peer.failure = RemoteFileError.disconnected
    let connection = AssistantConnection(makePeer: { peer })
    defer { connection.close() }
    connection.bindSignaling(signal)
    connection.connect()
    peer.onOpen?()
    do { _ = try await connection.request(.command, payload: Data("authorized message".utf8)); XCTFail() }
    catch {}
    XCTAssertFalse(connection.connected)
    XCTAssertTrue(peer.stopped)
    XCTAssertEqual(peer.sent.count, 1, "Transport recovery must not replay commands")
  }

  func testHostConnectionFailureKeepsItsSpecificExplanation() async throws {
    let signal = AssistantTestSignaling(), peer = AssistantPeerFixture()
    let connection = AssistantConnection(makePeer: { peer })
    defer { connection.close() }
    connection.bindSignaling(signal)
    connection.connect()
    for _ in 0..<20 where signal.sent.isEmpty { await Task.yield() }
    let id = try XCTUnwrap(signal.sent.first?.1["sessionId"]?.stringValue)
    signal.handler?(CloudEnvelope(type: "remote.assist.error", accountId: "test",
      workspaceId: "test", sourceDeviceId: "mac", targetHostId: "phone",
      body: ["sessionId": .string(id), "error": .string("Assistant is connected to another paired device.")]))
    XCTAssertEqual(connection.lastFailure, "Assistant is connected to another paired device.")
    XCTAssertFalse(connection.connected)
    XCTAssertFalse(connection.connecting)
  }

  func testApplicationErrorDoesNotResetAHealthyLinkOrReplayTheRequest() async throws {
    let signal = AssistantTestSignaling(), peer = AssistantPeerFixture()
    let connection = AssistantConnection(makePeer: { peer })
    defer { connection.close() }
    connection.bindSignaling(signal)
    connection.connect()
    peer.onOpen?()
    peer.onSend = { data in
      let request = try JSONDecoder().decode(AssistantWireRequest.self, from: data)
      peer.onMessage?(try JSONEncoder().encode(AssistantWireResponse(id: request.id, error: "Input permission required")))
    }
    do { _ = try await connection.request(.command); XCTFail() }
    catch { XCTAssertEqual(error.localizedDescription, "Input permission required") }
    XCTAssertTrue(connection.connected)
    XCTAssertFalse(peer.stopped)
    XCTAssertEqual(peer.sent.count, 1)
  }

  func testLateSenderCompletionCannotStartASecondWriterOnTheReplacement() async throws {
    let signal = AssistantTestSignaling(), first = AssistantPeerFixture(), second = AssistantPeerFixture()
    var peers = [first, second]
    let connection = AssistantConnection(makePeer: { peers.removeFirst() })
    defer { connection.close() }
    connection.bindSignaling(signal)
    connection.connect(); first.onOpen?()
    var releaseOld: CheckedContinuation<Void, Never>?
    var releaseNew: CheckedContinuation<Void, Never>?
    first.onSend = { _ in await withCheckedContinuation { releaseOld = $0 } }
    let oldRequest = Task { try? await connection.request(.state) }
    while releaseOld == nil { await Task.yield() }
    connection.close(); connection.connect(); second.onOpen?()
    second.onSend = { _ in await withCheckedContinuation { releaseNew = $0 } }
    let newRequest = Task { try? await connection.request(.state) }
    while releaseNew == nil { await Task.yield() }
    let queuedRequest = Task { try? await connection.request(.command) }
    for _ in 0..<20 { await Task.yield() }
    releaseOld?.resume()
    for _ in 0..<20 { await Task.yield() }
    XCTAssertEqual(second.sent.count, 1, "The replacement writer still owns its queue")
    connection.close()
    releaseNew?.resume()
    _ = await (oldRequest.value, newRequest.value, queuedRequest.value)
  }
}

@MainActor
private final class AssistantTestSignaling: AssistantSignaling {
  var ready = true
  var handler: ((CloudEnvelope) -> Void)?
  var sent: [(String, [String: JSONValue])] = []
  func setAssistantEnvelopeHandler(_ handler: ((CloudEnvelope) -> Void)?) { self.handler = handler }
  func sendRemoteAssistEnvelope(type: String, body: [String: JSONValue]) async throws -> String {
    sent.append((type, body)); return UUID().uuidString
  }
}

@MainActor
private final class AssistantPeerFixture: AssistantConnectionPeer {
  var onCandidate: ((String, String?, Int32) -> Void)?
  var onOpen: (() -> Void)?
  var onMessage: ((Data) -> Void)?
  var onFailure: ((Error) -> Void)?
  var failure: Error?
  var stopped = false
  var sent: [Data] = []
  var onSend: ((Data) async throws -> Void)?
  func configure(iceServers: [FileIceServer], permitsRelay: Bool, byteLimit: Int?) throws {}
  func acceptOffer(_ sdp: String) async throws -> String { "fixture answer" }
  func addCandidate(sdp: String, mid: String?, index: Int32) async {}
  func send(_ data: Data) async throws {
    sent.append(data)
    if let failure { throw failure }
    try await onSend?(data)
  }
  func stop() { stopped = true }
}
