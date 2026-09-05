import Foundation
import ClawDadFileTransport
import ClawDadRemoteAssistProtocol

struct MacFilesRuntime {
  let baseURL: URL
  let token: String

  func respond(to command: RemoteFileRequest) async throws -> Data {
    try command.validate()
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
    var request: URLRequest
    switch command.action {
    case .list:
      components.path = "/v1/files/library"
      components.queryItems = [URLQueryItem(name: "limit", value: "10"), URLQueryItem(name: "cursor", value: String(command.cursor ?? 0)),
        URLQueryItem(name: "query", value: command.query ?? ""), URLQueryItem(name: "archived", value: command.archived == true ? "true" : "false"),
        URLQueryItem(name: "project", value: command.project ?? ""), URLQueryItem(name: "format", value: command.format ?? "")]
      request = URLRequest(url: components.url!)
    case .chunk:
      components.path = "/v1/files/chunk"
      components.queryItems = [URLQueryItem(name: "id", value: command.id), URLQueryItem(name: "versionId", value: command.versionId), URLQueryItem(name: "offset", value: String(command.offset ?? 0))]
      request = URLRequest(url: components.url!)
    case .update:
      components.path = "/v1/files/update"; components.queryItems = nil
      request = URLRequest(url: components.url!)
      request.httpMethod = "POST"
      request.httpBody = try JSONEncoder().encode(command)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.timeoutInterval = 12
    request.cachePolicy = .reloadIgnoringLocalCacheData
    let (data, response) = try await URLSession.shared.data(for: request)
    guard data.count <= 1024 * 1024 else { throw RemoteFileError.tooLarge }
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      throw NSError(domain: "ClawDad.Files", code: 1, userInfo: [NSLocalizedDescriptionKey: body?["error"] as? String ?? "The Mac could not open this file."])
    }
    return data
  }
}

@MainActor
final class MacFilesSession {
  let id: String
  let deviceId: String
  let peer = PairedFilePeer()
  var onStop: (() -> Void)?
  private let runtime: MacFilesRuntime
  private let signal: (String, [String: RemoteJSONValue]) async throws -> Void
  private var operation: Task<Void, Never>?
  private var lease: Task<Void, Never>?
  private var lastActivity = Date()
  private var offered = false

  init(id: String, deviceId: String, runtime: MacFilesRuntime,
       signal: @escaping (String, [String: RemoteJSONValue]) async throws -> Void) {
    self.id = id; self.deviceId = deviceId; self.runtime = runtime; self.signal = signal
    peer.onCandidate = { [weak self] sdp, mid, index in
      guard let self else { return }
      Task { try? await self.signal("remote.assist.ice", ["sessionId": .string(id), "candidate": .object([
        "candidate": .string(sdp), "sdpMid": mid.map(RemoteJSONValue.string) ?? .null, "sdpMLineIndex": .number(Double(index))])]) }
    }
    peer.onMessage = { [weak self] data in self?.receive(data) }
    peer.onFailure = { [weak self] _ in self?.onStop?() }
  }

  func start() async throws {
    guard !offered else { return }
    offered = true
    let sdp = try await peer.createOffer()
    try await signal("remote.assist.offer", ["sessionId": .string(id), "purpose": .string("files"), "sdp": .string(sdp)])
    lease = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        guard !Task.isCancelled, let self else { return }
        if Date().timeIntervalSince(self.lastActivity) > 180 || !self.isTrusted {
          self.onStop?(); return
        }
      }
    }
  }

  private var isTrusted: Bool {
    (try? RemoteCloudConfiguration.load().trustedDevicePublicKeys[deviceId]) != nil
  }

  func handle(_ envelope: RemoteCloudEnvelope) {
    guard envelope.sourceDeviceId == deviceId, envelope.body["sessionId"]?.stringValue == id else { return }
    lastActivity = Date()
    switch envelope.type {
    case "remote.assist.answer":
      guard let sdp = envelope.body["sdp"]?.stringValue else { return }
      Task { do { try await peer.acceptAnswer(sdp) } catch { onStop?() } }
    case "remote.assist.ice":
      guard case .object(let value) = envelope.body["candidate"], let sdp = value["candidate"]?.stringValue else { return }
      let mid = value["sdpMid"]?.stringValue
      let index: Int32
      if case .number(let number) = value["sdpMLineIndex"], number >= 0, number < 128 { index = Int32(number) } else { return }
      Task { await peer.addCandidate(sdp: sdp, mid: mid, index: index) }
    case "remote.assist.stop": onStop?()
    default: break
    }
  }

  private func receive(_ data: Data) {
    guard data.count <= 8 * 1024, operation == nil, isTrusted,
          let request = try? JSONDecoder().decode(RemoteFileRequest.self, from: data),
          (try? request.validate()) != nil else { onStop?(); return }
    lastActivity = Date()
    operation = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { self.operation = nil }
      let response: RemoteFileResponse
      do { response = RemoteFileResponse(requestId: request.requestId, payload: try await runtime.respond(to: request)) }
      catch { response = RemoteFileResponse(requestId: request.requestId, error: error.localizedDescription) }
      do {
        try Task.checkCancellation()
        try await peer.send(JSONEncoder().encode(response))
      } catch { if !Task.isCancelled { onStop?() } }
    }
  }

  func stop() {
    onStop = nil
    operation?.cancel(); operation = nil
    lease?.cancel(); lease = nil
    peer.stop()
  }
}
