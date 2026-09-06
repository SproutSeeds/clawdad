import Foundation
import ClawDadFileTransport
import ClawDadRemoteAssistProtocol

struct MacFilesRuntime {
  let baseURL: URL
  let token: String

  func respond(to command: RemoteFileRequest, owner: String = "") async throws -> Data {
    try command.validate()
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
    var request: URLRequest
    switch command.action {
    case .list:
      components.path = "/v1/files/library"
      components.queryItems = [URLQueryItem(name: "limit", value: "10"), URLQueryItem(name: "cursor", value: String(command.cursor ?? 0)),
        URLQueryItem(name: "query", value: command.query ?? ""), URLQueryItem(name: "archived", value: command.archived == true ? "true" : "false"),
        URLQueryItem(name: "project", value: command.project ?? ""), URLQueryItem(name: "format", value: command.format ?? ""),
        URLQueryItem(name: "category", value: command.category ?? "documents")]
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
    case .uploadBegin, .uploadChunk, .uploadFinish, .uploadCancel:
      var body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(command)) as! [String: Any]
      body["owner"] = owner
      return try await post("/v1/files/image-upload", body: JSONSerialization.data(withJSONObject: body))
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

  func resolveImages(_ ids: [String], owner: String) async throws -> [MacReceivedImage] {
    struct Response: Decodable { let images: [MacReceivedImage] }
    let data = try await post("/v1/files/image-resolve", body: JSONSerialization.data(withJSONObject: ["owner": owner, "uploadIds": ids]))
    return try JSONDecoder().decode(Response.self, from: data).images
  }

  private func post(_ path: String, body: Data) async throws -> Data {
    var request = URLRequest(url: baseURL.appendingPathComponent(path))
    request.httpMethod = "POST"; request.httpBody = body; request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard data.count <= 1024 * 1024 else { throw RemoteFileError.tooLarge }
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      throw NSError(domain: "ClawDad.Images", code: 1, userInfo: [NSLocalizedDescriptionKey: body?["error"] as? String ?? "The Mac could not save this image."])
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
  private let imageUpload: Bool
  private var stopped = false

  init(id: String, deviceId: String, runtime: MacFilesRuntime, imageUpload: Bool = false,
       signal: @escaping (String, [String: RemoteJSONValue]) async throws -> Void) {
    self.id = id; self.deviceId = deviceId; self.runtime = runtime; self.signal = signal
    self.imageUpload = imageUpload
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
    var servers: [FileIceServer] = []
    var relayAvailable = false
    var relayReason = ""
    if imageUpload {
      // Uses the existing per-customer/global TURN budget and short-lived credentials.
      let resolution = await (try RemoteCloudConfiguration.load()).resolvedIceServers(targetDeviceId: deviceId)
      relayAvailable = resolution.relayAvailable
      relayReason = resolution.relayReason
      servers = resolution.iceServers.map { FileIceServer(urls: $0.urls, username: $0.username, credential: $0.credential) }
      try peer.configure(iceServers: servers, permitsRelay: relayAvailable, byteLimit: RemoteImageLimits.connectionBytes)
    }
    guard !stopped, isTrusted else { throw RemoteFileError.disconnected }
    let sdp = try await peer.createOffer()
    var offer: [String: RemoteJSONValue] = ["sessionId": .string(id), "purpose": .string("files"), "sdp": .string(sdp)]
    if imageUpload {
      offer["imageUpload"] = .bool(true)
      offer["relayAvailable"] = .bool(relayAvailable)
      offer["relayReason"] = .string(relayReason)
      offer["iceServers"] = .array(servers.map { .object(["urls": .array($0.urls.map(RemoteJSONValue.string)), "username": $0.username.map(RemoteJSONValue.string) ?? .null, "credential": $0.credential.map(RemoteJSONValue.string) ?? .null]) })
    }
    try await signal("remote.assist.offer", offer)
    let startedAt = Date()
    lease = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        guard !Task.isCancelled, let self else { return }
        if Date().timeIntervalSince(self.lastActivity) > 180 || !self.isTrusted || (self.imageUpload && Date().timeIntervalSince(startedAt) > 600) {
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
    guard data.count <= (imageUpload ? 256 * 1024 : 8 * 1024), operation == nil, isTrusted,
          let request = try? JSONDecoder().decode(RemoteFileRequest.self, from: data),
          (try? request.validate()) != nil else { onStop?(); return }
    let uploadAction = [RemoteFileRequest.Action.uploadBegin, .uploadChunk, .uploadFinish, .uploadCancel].contains(request.action)
    guard imageUpload == uploadAction else { onStop?(); return }
    lastActivity = Date()
    operation = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { self.operation = nil }
      let response: RemoteFileResponse
      do { response = RemoteFileResponse(requestId: request.requestId, payload: try await runtime.respond(to: request, owner: deviceId)) }
      catch { response = RemoteFileResponse(requestId: request.requestId, error: error.localizedDescription) }
      do {
        try Task.checkCancellation()
        try await peer.send(JSONEncoder().encode(response))
      } catch { if !Task.isCancelled { onStop?() } }
    }
  }

  func stop() {
    stopped = true
    onStop = nil
    operation?.cancel(); operation = nil
    lease?.cancel(); lease = nil
    peer.stop()
  }
}
