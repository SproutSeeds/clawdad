import ClawDadFileTransport
import ClawDadRemoteAssistProtocol
import Foundation

@MainActor
protocol AssistantTransport: AnyObject {
  var onChange: (() -> Void)? { get set }
  var connected: Bool { get }
  func bind(_ session: CloudSession)
  func connect()
  func request(_ action: AssistantWireRequest.Action, payload: Data) async throws -> Data
  func close()
}

extension AssistantTransport {
  func request(_ action: AssistantWireRequest.Action) async throws -> Data {
    try await request(action, payload: Data())
  }
}

@MainActor
final class AssistantConnection: AssistantTransport {
  var onChange: (() -> Void)?
  private(set) var connected = false
  private(set) var connecting = false
  private weak var session: CloudSession?
  private var peer: PairedFilePeer?
  private var id = ""
  private var offered = false
  private var timeout: Task<Void, Never>?
  private var sender: Task<Void, Never>?
  private var outgoing: [AssistantWireRequest] = []
  private struct Pending {
    var data = Data()
    let continuation: CheckedContinuation<Data, Error>
    let timeout: Task<Void, Never>
  }
  private var pending: [String: Pending] = [:]

  func bind(_ session: CloudSession) {
    self.session = session
    session.setAssistantEnvelopeHandler { [weak self] in self?.handle($0) }
  }
  func connect() {
    guard !connecting, !connected, let session, session.ready else { return }
    connecting = true
    offered = false
    id = UUID().uuidString.lowercased()
    let id = id
    let peer = PairedFilePeer()
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
      timeout?.cancel()
      timeout = nil
      onChange?()
    }
    peer.onMessage = { [weak self] in
      guard let self, self.id == id else { return }
      receive($0)
    }
    peer.onFailure = { [weak self] _ in
      guard let self, self.id == id else { return }
      close()
    }
    timeout = Task { [weak self] in
      do {
        _ = try await session.sendRemoteAssistEnvelope(
          type: "remote.assist.request",
          body: ["sessionId": .string(id), "purpose": .string("assistant")])
        try await Task.sleep(nanoseconds: 30_000_000_000)
        guard !Task.isCancelled, self?.id == id else { return }
        self?.close()
      } catch { if !Task.isCancelled, self?.id == id { self?.close() } }
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
        } catch { if self.id == id { close() } }
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
    case "remote.assist.stop", "remote.assist.error": close()
    default: break
    }
  }
  func request(_ action: AssistantWireRequest.Action, payload: Data = Data()) async throws -> Data {
    guard connected, pending.count < 12 else { throw AssistantProtocolError.disconnected }
    let request = AssistantWireRequest(action: action, payload: payload)
    try request.validate()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        let timeout = Task { [weak self] in
          try? await Task.sleep(nanoseconds: 150_000_000_000)
          guard !Task.isCancelled else { return }
          self?.finish(request.id, error: AssistantProtocolError.timedOut)
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
    sender = Task { [weak self] in
      guard let self else { return }
      defer {
        sender = nil
        pump()
      }
      do { try await peer.send(JSONEncoder().encode(request)) } catch {
        finish(request.id, error: error)
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
    result.timeout.cancel()
    outgoing.removeAll { $0.id == id }
    if let error {
      result.continuation.resume(throwing: error)
    } else {
      result.continuation.resume(returning: result.data)
    }
  }
  func close() {
    let previous = id
    id = ""
    connected = false
    connecting = false
    offered = false
    timeout?.cancel()
    timeout = nil
    sender?.cancel()
    sender = nil
    outgoing = []
    peer?.stop()
    peer = nil
    for key in Array(pending.keys) { finish(key, error: AssistantProtocolError.disconnected) }
    if !previous.isEmpty {
      Task {
        _ = try? await session?.sendRemoteAssistEnvelope(
          type: "remote.assist.stop", body: ["sessionId": .string(previous)])
      }
    }
    onChange?()
  }
}
