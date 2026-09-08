import ClawDadFileTransport
import ClawDadRemoteAssistProtocol
import Foundation

/// Speech and chat travel on a paired, media-free connection, independently of
/// Remote Assist screen capture. Models and durable state stay in the Mac runtime.
@MainActor
final class MacAssistantSession {
  let id: String
  let deviceId: String
  var onStop: (() -> Void)?
  private let peer = PairedFilePeer()
  private let runtime: MacAssistantRuntime
  private let signal: (String, [String: RemoteJSONValue]) async throws -> Void
  private var work: [String: Task<Void, Never>] = [:]
  private var lease: Task<Void, Never>?
  private var pending: [(request: AssistantWireRequest, receivedAt: TimeInterval)] = []
  private var lastActivity = Date()
  private var stopped = false

  init(
    id: String, deviceId: String, runtime: MacAssistantRuntime,
    signal: @escaping (String, [String: RemoteJSONValue]) async throws -> Void
  ) {
    self.id = id
    self.deviceId = deviceId
    self.runtime = runtime
    self.signal = signal
    peer.onCandidate = { [weak self] sdp, mid, index in
      guard let self else { return }
      Task {
        try? await self.signal(
          "remote.assist.ice",
          [
            "sessionId": .string(id),
            "candidate": .object([
              "candidate": .string(sdp), "sdpMid": mid.map(RemoteJSONValue.string) ?? .null,
              "sdpMLineIndex": .number(Double(index)),
            ]),
          ])
      }
    }
    peer.onMessage = { [weak self] data in self?.receive(data) }
    peer.onFailure = { [weak self] _ in self?.onStop?() }
  }
  private var trusted: Bool {
    (try? RemoteCloudConfiguration.load().trustedDevicePublicKeys[deviceId]) != nil
  }
  func start() async throws {
    let resolution = await (try RemoteCloudConfiguration.load()).resolvedIceServers(
      targetDeviceId: deviceId)
    guard trusted, !stopped else { throw AssistantProtocolError.disconnected }
    let servers = resolution.iceServers.map {
      FileIceServer(urls: $0.urls, username: $0.username, credential: $0.credential)
    }
    try peer.configure(
      iceServers: servers, permitsRelay: resolution.relayAvailable, byteLimit: 64 * 1024 * 1024)
    let sdp = try await peer.createOffer()
    try await signal(
      "remote.assist.offer",
      [
        "sessionId": .string(id), "purpose": .string("assistant"), "sdp": .string(sdp),
        "relayAvailable": .bool(resolution.relayAvailable),
        "iceServers": .array(
          servers.map {
            .object([
              "urls": .array($0.urls.map(RemoteJSONValue.string)),
              "username": $0.username.map(RemoteJSONValue.string) ?? .null,
              "credential": $0.credential.map(RemoteJSONValue.string) ?? .null,
            ])
          }),
      ])
    let started = Date()
    lease = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 15_000_000_000)
        guard !Task.isCancelled, let self else { return }
        if !trusted || Date().timeIntervalSince(lastActivity) > 90
          || Date().timeIntervalSince(started) > 480
        {
          onStop?()
          return
        }
      }
    }
  }
  func handle(_ envelope: RemoteCloudEnvelope) {
    guard trusted, envelope.sourceDeviceId == deviceId,
      envelope.body["sessionId"]?.stringValue == id
    else { return }
    switch envelope.type {
    case "remote.assist.answer":
      guard let sdp = envelope.body["sdp"]?.stringValue else { return }
      Task { do { try await peer.acceptAnswer(sdp) } catch { onStop?() } }
    case "remote.assist.ice":
      guard case .object(let value) = envelope.body["candidate"],
        let sdp = value["candidate"]?.stringValue,
        case .number(let index) = value["sdpMLineIndex"], index >= 0, index < 128
      else { return }
      Task {
        await peer.addCandidate(sdp: sdp, mid: value["sdpMid"]?.stringValue, index: Int32(index))
      }
    case "remote.assist.stop": onStop?()
    default: break
    }
  }
  private func receive(_ data: Data) {
    guard !stopped, trusted, data.count <= 2 * 1024 * 1024, pending.count + work.count < 16,
      let request = try? JSONDecoder().decode(AssistantWireRequest.self, from: data),
      (try? request.validate()) != nil, work[request.id] == nil,
      !pending.contains(where: { $0.request.id == request.id })
    else {
      onStop?()
      return
    }
    lastActivity = Date()
    pending.append((request, ProcessInfo.processInfo.systemUptime))
    pump()
  }
  private func pump() {
    guard !stopped, work.count < 4, !pending.isEmpty else { return }
    let queued = pending.removeFirst()
    let request = queued.request
    work[request.id] = Task { @MainActor [weak self] in
      guard let self else { return }
      defer {
        work[request.id] = nil
        pump()
      }
      do {
        let data = try await runtime.respond(request,
          queuedMs: (ProcessInfo.processInfo.systemUptime - queued.receivedAt) * 1000)
        guard !stopped, trusted else { return }
        let size = 64 * 1024
        if data.isEmpty {
          try await peer.send(JSONEncoder().encode(AssistantWireResponse(id: request.id)))
        }
        for offset in stride(from: 0, to: data.count, by: size) {
          try Task.checkCancellation()
          let end = min(data.count, offset + size)
          try await peer.send(
            JSONEncoder().encode(
              AssistantWireResponse(
                id: request.id, payload: data.subdata(in: offset..<end), more: end < data.count)))
        }
      } catch {
        if !Task.isCancelled {
          try? await peer.send(
            JSONEncoder().encode(
              AssistantWireResponse(id: request.id, error: error.localizedDescription)))
        }
      }
    }
    pump()
  }
  func stop() {
    stopped = true
    onStop = nil
    for task in work.values { task.cancel() }
    work = [:]
    lease?.cancel()
    lease = nil
    pending = []
    peer.stop()
  }
}
