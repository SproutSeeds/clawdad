import CryptoKit
import Foundation

let remoteAssistCloudProtocolVersion = "clawdad.cloud.v1"

struct RemoteCloudSignature: Codable, Equatable {
  var alg: String
  var keyId: String
  var value: String
}

enum RemoteJSONValue: Codable, Equatable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: RemoteJSONValue])
  case array([RemoteJSONValue])
  case null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([String: RemoteJSONValue].self) {
      self = .object(value)
    } else {
      self = .array(try container.decode([RemoteJSONValue].self))
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let value):
      try container.encode(value)
    case .number(let value):
      try container.encode(value)
    case .bool(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .null:
      try container.encodeNil()
    }
  }

  var stringValue: String {
    if case .string(let value) = self {
      return value
    }
    return ""
  }

  var numberValue: Double? {
    if case .number(let value) = self {
      return value
    }
    return nil
  }
}

struct RemoteCloudEnvelope: Codable, Equatable {
  var id: String
  var protocolVersion: String
  var type: String
  var accountId: String
  var workspaceId: String
  var sourceDeviceId: String
  var targetHostId: String
  var seq: Int
  var createdAt: String
  var expiresAt: String
  var body: [String: RemoteJSONValue]
  var signature: RemoteCloudSignature?

  init(
    type: String,
    accountId: String,
    workspaceId: String,
    sourceDeviceId: String,
    targetHostId: String,
    seq: Int,
    body: [String: RemoteJSONValue]
  ) {
    let now = Date()
    id = UUID().uuidString.lowercased()
    protocolVersion = remoteAssistCloudProtocolVersion
    self.type = type
    self.accountId = accountId
    self.workspaceId = workspaceId
    self.sourceDeviceId = sourceDeviceId
    self.targetHostId = targetHostId
    self.seq = seq
    createdAt = RemoteCloudCodec.dateString(now)
    expiresAt = RemoteCloudCodec.dateString(now.addingTimeInterval(60))
    self.body = body
    signature = nil
  }
}

struct RemoteIceServerConfiguration: Codable, Equatable {
  var urls: [String]
  var username: String?
  var credential: String?
}

struct RemoteCloudConfiguration {
  var cloudUrl: String
  var accountId: String
  var workspaceId: String
  var hostId: String
  var relayHostToken: String
  var hostPrivateKeyPem: String
  var hostPublicKeyPem: String
  var trustedDevicePublicKeys: [String: String]
  var iceServers: [RemoteIceServerConfiguration]

  var ready: Bool {
    !cloudUrl.isEmpty &&
      !accountId.isEmpty &&
      !workspaceId.isEmpty &&
      !hostId.isEmpty &&
      !hostPrivateKeyPem.isEmpty &&
      !hostPublicKeyPem.isEmpty
  }

  static func load() throws -> RemoteCloudConfiguration {
    let home = FileManager.default.homeDirectoryForCurrentUser
    let configURL = home
      .appendingPathComponent(".clawdad", isDirectory: true)
      .appendingPathComponent("cloud.json")
    let data = try Data(contentsOf: configURL)
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw RemoteAssistHostError.invalidCloudConfiguration
    }

    let privateKey = try keyValue(
      inline: string(object["hostPrivateKey"]),
      path: string(object["hostPrivateKeyPath"])
    )
    let publicKey = try keyValue(
      inline: string(object["hostPublicKey"]),
      path: string(object["hostPublicKeyPath"])
    )
    let trusted = object["trustedDevicePublicKeys"] as? [String: String] ?? [:]
    let configuredIceServers = parseIceServers(object["remoteAssistIceServers"])

    return RemoteCloudConfiguration(
      cloudUrl: string(object["cloudUrl"]),
      accountId: string(object["accountId"]),
      workspaceId: string(object["workspaceId"]),
      hostId: string(object["hostId"]),
      relayHostToken: string(object["relayHostToken"]).isEmpty
        ? (
          string(object["devToken"]).isEmpty
            ? string(object["cloudDevToken"])
            : string(object["devToken"])
        )
        : string(object["relayHostToken"]),
      hostPrivateKeyPem: privateKey,
      hostPublicKeyPem: publicKey,
      trustedDevicePublicKeys: trusted,
      iceServers: configuredIceServers.isEmpty
        ? [RemoteIceServerConfiguration(
            urls: ["stun:stun.cloudflare.com:3478"],
            username: nil,
            credential: nil
          )]
        : configuredIceServers
    )
  }

  func realtimeURL() throws -> URL {
    guard var components = URLComponents(string: cloudUrl) else {
      throw RemoteAssistHostError.invalidCloudConfiguration
    }
    components.scheme = components.scheme == "https" ? "wss" : "ws"
    components.path = "/workspaces/\(workspaceId)/realtime"
    components.queryItems = [
      URLQueryItem(name: "hostId", value: hostId),
      URLQueryItem(name: "accountId", value: accountId)
    ]
    guard let url = components.url else {
      throw RemoteAssistHostError.invalidCloudConfiguration
    }
    return url
  }

  func resolvedIceServers() async -> [RemoteIceServerConfiguration] {
    guard !relayHostToken.isEmpty,
          var components = URLComponents(string: cloudUrl) else {
      return iceServers
    }
    components.path = "/workspaces/\(workspaceId)/remote-assist/ice-servers"
    components.queryItems = [
      URLQueryItem(name: "accountId", value: accountId)
    ]
    guard let url = components.url else {
      return iceServers
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 8
    request.setValue(
      "Bearer \(relayHostToken)",
      forHTTPHeaderField: "Authorization"
    )
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = Data("{}".utf8)

    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse,
            (200..<300).contains(http.statusCode) else {
        return iceServers
      }
      let payload = try JSONDecoder().decode(
        RemoteIceServerResponse.self,
        from: data
      )
      return payload.iceServers.isEmpty ? iceServers : payload.iceServers
    } catch {
      return iceServers
    }
  }

  private static func string(_ value: Any?) -> String {
    String(describing: value ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func keyValue(inline: String, path: String) throws -> String {
    if !inline.isEmpty {
      return inline
    }
    guard !path.isEmpty else {
      return ""
    }
    let expandedPath = NSString(string: path).expandingTildeInPath
    return try String(contentsOfFile: expandedPath, encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func parseIceServers(_ value: Any?) -> [RemoteIceServerConfiguration] {
    guard let entries = value as? [[String: Any]] else {
      return []
    }
    return entries.compactMap { entry in
      let urls: [String]
      if let values = entry["urls"] as? [String] {
        urls = values
      } else {
        let url = string(entry["url"])
        urls = url.isEmpty ? [] : [url]
      }
      guard !urls.isEmpty else {
        return nil
      }
      let username = string(entry["username"])
      let credential = string(entry["credential"])
      return RemoteIceServerConfiguration(
        urls: urls,
        username: username.isEmpty ? nil : username,
        credential: credential.isEmpty ? nil : credential
      )
    }
  }
}

private struct RemoteIceServerResponse: Decodable {
  var iceServers: [RemoteIceServerConfiguration]
}

enum RemoteCloudCodec {
  static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return encoder
  }()

  static let decoder = JSONDecoder()

  static func canonicalData(_ envelope: RemoteCloudEnvelope) throws -> Data {
    var unsigned = envelope
    unsigned.signature = nil
    return try encoder.encode(unsigned)
  }

  static func signed(
    _ envelope: RemoteCloudEnvelope,
    configuration: RemoteCloudConfiguration
  ) throws -> RemoteCloudEnvelope {
    var signedEnvelope = envelope
    let privateKey = try P256.Signing.PrivateKey(
      pemRepresentation: configuration.hostPrivateKeyPem
    )
    let signature = try privateKey.signature(for: canonicalData(envelope))
    signedEnvelope.signature = RemoteCloudSignature(
      alg: "ES256",
      keyId: hostKeyId(configuration.hostPublicKeyPem),
      value: signature.derRepresentation.base64UrlEncodedString()
    )
    return signedEnvelope
  }

  static func verifies(
    _ envelope: RemoteCloudEnvelope,
    configuration: RemoteCloudConfiguration
  ) -> Bool {
    guard envelope.protocolVersion == remoteAssistCloudProtocolVersion,
          envelope.accountId == configuration.accountId,
          envelope.workspaceId == configuration.workspaceId,
          envelope.targetHostId == configuration.hostId,
          let signature = envelope.signature,
          signature.alg == "ES256",
          let publicKeyPem = configuration.trustedDevicePublicKeys[envelope.sourceDeviceId],
          let signatureData = Data(base64UrlEncoded: signature.value),
          !envelopeHasExpired(envelope)
    else {
      return false
    }

    do {
      let publicKey = try P256.Signing.PublicKey(pemRepresentation: publicKeyPem)
      let ecdsaSignature = try P256.Signing.ECDSASignature(
        derRepresentation: signatureData
      )
      return publicKey.isValidSignature(
        ecdsaSignature,
        for: try canonicalData(envelope)
      )
    } catch {
      return false
    }
  }

  static func dateString(_ date: Date) -> String {
    ISO8601DateFormatter().string(from: date)
  }

  private static func envelopeHasExpired(_ envelope: RemoteCloudEnvelope) -> Bool {
    guard let expiry = parseDate(envelope.expiresAt) else {
      return true
    }
    return expiry.addingTimeInterval(5) < Date()
  }

  private static func parseDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let parsed = fractional.date(from: value) {
      return parsed
    }
    return ISO8601DateFormatter().date(from: value)
  }

  private static func hostKeyId(_ publicKeyPem: String) -> String {
    let body = publicKeyPem
      .replacingOccurrences(of: "-----BEGIN PUBLIC KEY-----", with: "")
      .replacingOccurrences(of: "-----END PUBLIC KEY-----", with: "")
      .replacingOccurrences(of: "\n", with: "")
      .replacingOccurrences(of: "\r", with: "")
    guard let der = Data(base64Encoded: body) else {
      return ""
    }
    return Data(SHA256.hash(data: der))
      .base64UrlEncodedString()
      .prefix(32)
      .description
  }
}

extension Data {
  init?(base64UrlEncoded value: String) {
    var normalized = value
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let remainder = normalized.count % 4
    if remainder != 0 {
      normalized.append(String(repeating: "=", count: 4 - remainder))
    }
    self.init(base64Encoded: normalized)
  }

  func base64UrlEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
