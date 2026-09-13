import ClawDadRemoteAssistProtocol
import Foundation

struct MacAssistantRuntime {
  let baseURL: URL
  let token: String
  var session: URLSession = .shared

  func json(_ path: String, _ body: [String: AssistantValue]? = nil) async throws -> [String:
    AssistantValue]
  {
    let data = try await request(path, body: body.map { try JSONEncoder().encode($0) })
    return try JSONDecoder().decode([String: AssistantValue].self, from: data)
  }

  func request(_ path: String, body: Data? = nil, contentType: String = "application/json")
    async throws -> Data
  {
    guard path.hasPrefix("/v1/"), let url = URL(string: path, relativeTo: baseURL),
      url.host == baseURL.host, url.port == baseURL.port
    else { throw AssistantProtocolError.invalid }
    var request = URLRequest(url: url)
    request.httpMethod = body == nil ? "GET" : "POST"
    request.httpBody = body
    request.timeoutInterval = 120
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    let (data, response) = try await session.data(for: request)
    guard data.count <= 64 * 1024 * 1024 else { throw AssistantProtocolError.invalid }
    guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status)
    else {
      let value = try? JSONDecoder().decode([String: AssistantValue].self, from: data)
      throw MacAssistantError(
        value?["error"]?.string ?? "The Mac could not finish this Assistant request.")
    }
    return data
  }

  func respond(_ request: AssistantWireRequest, queuedMs: Double = 0, deviceId: String? = nil) async throws -> Data {
    try request.validate()
    switch request.action {
    case .state:
      var path = "/v1/assistant/state"
      if !request.payload.isEmpty {
        let value = try JSONDecoder().decode([String: AssistantValue].self, from: request.payload)
        if let revision = value["historyRevision"]?.string,
          revision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil {
          path += "?historyRevision=\(revision)"
        }
      }
      return try await self.request(path)
    case .command:
      var body = try JSONDecoder().decode([String: AssistantValue].self, from: request.payload)
      body.removeValue(forKey: "imageOwner")
      if body["action"]?.string == "speech.sync" {
        guard let deviceId, !deviceId.isEmpty else { throw AssistantProtocolError.invalid }
        body["deviceId"] = .string(deviceId)
        body["label"] = .string("iPhone")
      }
      if body["action"]?.string == "message" {
        body["speechDeviceId"] = deviceId.map(AssistantValue.string)
      }
      if body["action"]?.string == "message", body["images"] != nil {
        guard let deviceId, !deviceId.isEmpty else { throw AssistantProtocolError.invalid }
        body["imageOwner"] = .string(deviceId)
      }
      return try await self.request("/v1/assistant/request", body: JSONEncoder().encode(body))
    case .imageUpload:
      guard let deviceId, !deviceId.isEmpty else { throw AssistantProtocolError.invalid }
      var body = try JSONDecoder().decode([String: AssistantValue].self, from: request.payload)
      body["owner"] = .string(deviceId)
      return try await self.request("/v1/assistant/image", body: JSONEncoder().encode(body))
    case .transcribe:
      let started = ProcessInfo.processInfo.systemUptime
      let boundary = UUID().uuidString
      var body = Data(
        "--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"assistant.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
          .utf8)
      body.append(request.payload)
      body.append(Data("\r\n--\(boundary)--\r\n".utf8))
      let result = try await self.request(
        "/v1/stt/transcribe", body: body, contentType: "multipart/form-data; boundary=\(boundary)")
      var value = try JSONDecoder().decode([String: AssistantValue].self, from: result)
      value["assistantTiming"] = .object([
        "hostQueueMs": .number(max(0, queuedMs)),
        "hostTranscriptionMs": .number((ProcessInfo.processInfo.systemUptime - started) * 1000),
      ])
      return try JSONEncoder().encode(value)
    case .synthesize:
      var body = try JSONDecoder().decode([String: AssistantValue].self, from: request.payload)
      guard let text = body["text"]?.string, !text.isEmpty, text.utf8.count <= 32_000 else {
        throw AssistantProtocolError.invalid
      }
      body["source"] = .string("remote-assist")
      body["project"] = .string("")
      body["kind"] = .string("response")
      body["prepare"] = .bool(true)
      body["executionPreference"] = .string("paired-mac-first")
      body["allowRemoteFallback"] = .bool(false)
      if body["voiceSelection"] == nil {
        body["voiceSelection"] = try await json("/v1/tts/voices")["selection"]
      }
      var result = try await json("/v1/tts/message", body)
      result["voiceSelection"] = body["voiceSelection"]
      return try JSONEncoder().encode(result)
    case .audio:
      guard let value = String(data: request.payload, encoding: .utf8),
        let url = URLComponents(string: value), url.scheme == nil, url.host == nil,
        url.path == "/v1/tts/audio"
      else { throw AssistantProtocolError.invalid }
      return try await self.request(value)
    }
  }
}

struct MacAssistantError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

struct MacAssistantDeferred: Error { let message: String }
