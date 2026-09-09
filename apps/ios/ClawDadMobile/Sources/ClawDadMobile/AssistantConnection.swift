import ClawDadFileTransport
import ClawDadRemoteAssistProtocol
import Foundation

@MainActor
protocol AssistantTransport: AnyObject {
  var onChange: (() -> Void)? { get set }
  var connected: Bool { get }
  var lastFailure: String? { get }
  func bind(_ session: CloudSession)
  func connect()
  func request(_ action: AssistantWireRequest.Action, payload: Data) async throws -> Data
  func close()
}

extension AssistantTransport {
  var lastFailure: String? { nil }
  func request(_ action: AssistantWireRequest.Action) async throws -> Data {
    try await request(action, payload: Data())
  }
}

@MainActor
protocol AssistantSignaling: AnyObject {
  var ready: Bool { get }
  func setAssistantEnvelopeHandler(_ handler: ((CloudEnvelope) -> Void)?)
  func sendRemoteAssistEnvelope(type: String, body: [String: JSONValue]) async throws -> String
}
extension CloudSession: AssistantSignaling {}

@MainActor
protocol AssistantConnectionPeer: AnyObject {
  var onCandidate: ((String, String?, Int32) -> Void)? { get set }
  var onOpen: (() -> Void)? { get set }
  var onMessage: ((Data) -> Void)? { get set }
  var onFailure: ((Error) -> Void)? { get set }
  func configure(iceServers: [FileIceServer], permitsRelay: Bool, byteLimit: Int?) throws
  func acceptOffer(_ sdp: String) async throws -> String
  func addCandidate(sdp: String, mid: String?, index: Int32) async
  func send(_ data: Data) async throws
  func stop()
}
extension PairedFilePeer: AssistantConnectionPeer {}

@MainActor
final class AssistantConnection: AssistantTransport {
  var onChange: (() -> Void)?
  private(set) var connected = false
  private(set) var connecting = false
  private(set) var lastFailure: String?
  private weak var session: (any AssistantSignaling)?
  private var peer: (any AssistantConnectionPeer)?
  private let makePeer: () -> any AssistantConnectionPeer
  private let requestTimeout: (AssistantWireRequest.Action) -> UInt64
  private var id = ""
  private var offered = false
  private var timeout: Task<Void, Never>?
  private var sender: Task<Void, Never>?
  private var senderID: UUID?
  private var senderRequestID: String?
  private var outgoing: [AssistantWireRequest] = []
  private struct Pending {
    var data = Data()
    let continuation: CheckedContinuation<Data, Error>
    let timeout: Task<Void, Never>
  }
  private var pending: [String: Pending] = [:]

  init(makePeer: @escaping () -> any AssistantConnectionPeer = { PairedFilePeer() },
    requestTimeout: @escaping (AssistantWireRequest.Action) -> UInt64 = {
      switch $0 {
      case .state: 12_000_000_000
      case .command: 30_000_000_000
      default: 150_000_000_000
      }
    }) {
    self.makePeer = makePeer
    self.requestTimeout = requestTimeout
  }
  func bind(_ session: CloudSession) {
    bindSignaling(session)
  }
  func bindSignaling(_ session: any AssistantSignaling) {
    if let previous = self.session, previous !== session {
      previous.setAssistantEnvelopeHandler(nil)
      close()
    }
    self.session = session
    session.setAssistantEnvelopeHandler { [weak self] in self?.handle($0) }
  }
  func connect() {
    guard !connecting, !connected, let session, session.ready else { return }
    connecting = true
    offered = false
    id = UUID().uuidString.lowercased()
    let id = id
    let peer = makePeer()
    self.peer = peer
    peer.onCandidate = { [weak self] sdp, mid, index in
      Task {
        guard let self, self.id == id else { return }
        _ = try? await session.sendRemoteAssistEnvelope(
          type: "remote.assist.ice",
          body: [
            "sessionId": .string(id),
            "candidate": .object([
              "candidate": .string(sdp), "sdpMid": mid.map(JSONValue.string) ?? .null,
              "sdpMLineIndex": .number(Double(index)),
            ]),
          ])
      }
    }
    peer.onOpen = { [weak self] in
      guard let self, self.id == id else { return }
      connecting = false
      connected = true
      lastFailure = nil
      timeout?.cancel()
      timeout = nil
      onChange?()
    }
    peer.onMessage = { [weak self] in
      guard let self, self.id == id else { return }
      receive($0)
    }
    peer.onFailure = { [weak self] error in
      guard let self, self.id == id else { return }
      disconnect(error: assistantConnectionError(error))
    }
    timeout = Task { [weak self] in
      do {
        _ = try await session.sendRemoteAssistEnvelope(
          type: "remote.assist.request",
          body: ["sessionId": .string(id), "purpose": .string("assistant")])
        try await Task.sleep(nanoseconds: 30_000_000_000)
        guard !Task.isCancelled, self?.id == id else { return }
        self?.disconnect(error: AssistantProtocolError.timedOut)
      } catch {
        if !Task.isCancelled, self?.id == id { self?.disconnect(error: assistantConnectionError(error)) }
      }
    }
  }
  private func handle(_ envelope: CloudEnvelope) {
    guard !id.isEmpty, envelope.body["sessionId"]?.stringValue == id, let peer else { return }
    let id = id
    switch envelope.type {
    case "remote.assist.offer":
      guard !offered, envelope.body["purpose"]?.stringValue == "assistant",
        let sdp = envelope.body["sdp"]?.stringValue
      else { return }
      offered = true
      Task {
        do {
          let servers = try JSONDecoder().decode(
            [FileIceServer].self,
            from: JSONEncoder().encode(envelope.body["iceServers"] ?? .array([])))
          try peer.configure(
            iceServers: servers, permitsRelay: envelope.body["relayAvailable"] == .bool(true),
            byteLimit: 64 * 1024 * 1024)
          let answer = try await peer.acceptOffer(sdp)
          guard self.id == id else { return }
          _ = try await session?.sendRemoteAssistEnvelope(
            type: "remote.assist.answer", body: ["sessionId": .string(id), "sdp": .string(answer)])
        } catch { if self.id == id { disconnect(error: assistantConnectionError(error)) } }
      }
    case "remote.assist.ice":
      guard case .object(let candidate) = envelope.body["candidate"],
        let sdp = candidate["candidate"]?.stringValue,
        let index = candidate["sdpMLineIndex"]?.numberValue, index >= 0, index < 128
      else { return }
      Task {
        await peer.addCandidate(
          sdp: sdp, mid: candidate["sdpMid"]?.stringValue, index: Int32(index))
      }
    case "remote.assist.stop": close()
    case "remote.assist.error":
      let message = envelope.body["error"]?.stringValue ?? "Assistant could not connect to this Mac."
      disconnect(error: NSError(domain: "ClawDad.Assistant", code: 1,
        userInfo: [NSLocalizedDescriptionKey: message]))
    default: break
    }
  }
  func request(_ action: AssistantWireRequest.Action, payload: Data = Data()) async throws -> Data {
    try Task.checkCancellation()
    guard connected, pending.count < 12 else { throw AssistantProtocolError.disconnected }
    let request = AssistantWireRequest(action: action, payload: payload)
    try request.validate()
    let connectionID = id
    return try await withTaskCancellationHandler {
      try Task.checkCancellation()
      return try await withCheckedThrowingContinuation { continuation in
        let timeout = Task { [weak self] in
          try? await Task.sleep(nanoseconds: self?.requestTimeout(action) ?? 150_000_000_000)
          guard !Task.isCancelled, let self, self.id == connectionID,
            self.pending[request.id] != nil else { return }
          self.finish(request.id, error: AssistantProtocolError.timedOut)
          self.disconnect(error: AssistantProtocolError.timedOut)
        }
        pending[request.id] = Pending(continuation: continuation, timeout: timeout)
        outgoing.append(request)
        pump()
      }
    } onCancel: {
      Task { @MainActor [weak self] in self?.finish(request.id, error: CancellationError()) }
    }
  }
  private func pump() {
    guard sender == nil, !outgoing.isEmpty, let peer else { return }
    let request = outgoing.removeFirst()
    let connectionID = id, sendingID = UUID()
    senderID = sendingID
    senderRequestID = request.id
    sender = Task { [weak self] in
      guard let self else { return }
      defer {
        if senderID == sendingID {
          sender = nil
          senderID = nil
          senderRequestID = nil
          pump()
        }
      }
      do {
        try Task.checkCancellation()
        guard pending[request.id] != nil else { return }
        try await peer.send(JSONEncoder().encode(request))
      } catch {
        if Task.isCancelled { return }
        if id == connectionID {
          let failure = assistantConnectionError(error)
          finish(request.id, error: failure)
          disconnect(error: failure)
        }
      }
    }
  }
  private func receive(_ data: Data) {
    guard let response = try? JSONDecoder().decode(AssistantWireResponse.self, from: data),
      pending[response.id] != nil
    else { return }
    if let error = response.error {
      finish(
        response.id,
        error: NSError(
          domain: "ClawDad.Assistant", code: 1, userInfo: [NSLocalizedDescriptionKey: error]))
      return
    }
    guard (pending[response.id]?.data.count ?? 0) + response.payload.count <= 64 * 1024 * 1024
    else {
      finish(response.id, error: AssistantProtocolError.invalid)
      return
    }
    pending[response.id]?.data.append(response.payload)
    if !response.more { finish(response.id) }
  }
  private func finish(_ id: String, error: Error? = nil) {
    guard let result = pending.removeValue(forKey: id) else { return }
    if error is CancellationError, senderRequestID == id { sender?.cancel() }
    result.timeout.cancel()
    outgoing.removeAll { $0.id == id }
    if let error {
      result.continuation.resume(throwing: error)
    } else {
      result.continuation.resume(returning: result.data)
    }
  }
  func close() {
    disconnect(error: nil)
  }
  private func disconnect(error: Error?) {
    let previous = id
    let previousSession = session
    id = ""
    connected = false
    connecting = false
    lastFailure = error?.localizedDescription
    offered = false
    timeout?.cancel()
    timeout = nil
    sender?.cancel()
    sender = nil
    senderID = nil
    senderRequestID = nil
    outgoing = []
    peer?.stop()
    peer = nil
    for key in Array(pending.keys) { finish(key, error: AssistantProtocolError.disconnected) }
    if !previous.isEmpty {
      Task {
        _ = try? await previousSession?.sendRemoteAssistEnvelope(
          type: "remote.assist.stop", body: ["sessionId": .string(previous)])
      }
    }
    onChange?()
  }
}

private func assistantConnectionError(_ error: Error) -> Error {
  if let error = error as? RemoteFileError {
    switch error {
    case .timedOut: return AssistantProtocolError.timedOut
    case .invalidMessage: return AssistantProtocolError.invalid
    case .disconnected, .tooLarge: return AssistantProtocolError.disconnected
    }
  }
  return error
}
