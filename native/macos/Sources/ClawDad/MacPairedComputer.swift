import Foundation

struct MacPairedComputerProfile: Codable, Equatable, Identifiable {
  var id: String
  var displayName: String
  var platform: String
  var cloudUrl: String
  var accountId: String
  var workspaceId: String
  var hostId: String
  var hostPublicKeyPem: String
  var pairedAt: String
  var capabilities: [String]
  var lastUsedAt: String

  init(
    displayName: String,
    platform: String,
    cloudUrl: String,
    accountId: String,
    workspaceId: String,
    hostId: String,
    hostPublicKeyPem: String,
    pairedAt: String,
    capabilities: [String] = [],
    lastUsedAt: String = ""
  ) {
    self.id = macPairedComputerIdentifier(
      accountId: accountId,
      workspaceId: workspaceId,
      hostId: hostId
    )
    let normalizedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    self.displayName = normalizedName.isEmpty ? hostId : normalizedName
    self.platform = macPairedComputerPlatform(platform)
    self.cloudUrl = cloudUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    self.accountId = accountId.trimmingCharacters(in: .whitespacesAndNewlines)
    self.workspaceId = workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
    self.hostId = hostId.trimmingCharacters(in: .whitespacesAndNewlines)
    self.hostPublicKeyPem = hostPublicKeyPem.trimmingCharacters(in: .whitespacesAndNewlines)
    self.pairedAt = pairedAt
    self.capabilities = Array(Set(capabilities.map {
      $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }.filter { !$0.isEmpty })).sorted()
    self.lastUsedAt = lastUsedAt.isEmpty ? pairedAt : lastUsedAt
  }

  var supportsRemoteAssist: Bool {
    capabilities.isEmpty || capabilities.contains("remote-assist")
  }

  var dictionary: [String: Any] {
    [
      "id": id,
      "displayName": displayName,
      "platform": platform,
      "hostId": hostId,
      "capabilities": capabilities,
      "supportsRemoteAssist": supportsRemoteAssist,
      "pairedAt": pairedAt,
      "lastUsedAt": lastUsedAt
    ]
  }
}

func macPairedComputerIdentifier(
  accountId: String,
  workspaceId: String,
  hostId: String
) -> String {
  [accountId, workspaceId, hostId]
    .map { value in
      let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
      return "\(normalized.utf8.count):\(normalized)"
    }
    .joined(separator: "|")
}

func macPairedComputerPlatform(_ value: String) -> String {
  switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
  case "mac", "macos", "darwin", "osx":
    return "macos"
  case "win", "win32", "windows":
    return "windows"
  case "linux":
    return "linux"
  default:
    return "unknown"
  }
}

enum MacPairedComputerRegistry {
  static let storageKey = "clawdad.macController.pairedComputers.v1"

  static func load(from defaults: UserDefaults = .standard) -> [MacPairedComputerProfile] {
    guard let data = defaults.data(forKey: storageKey),
          let decoded = try? JSONDecoder().decode([MacPairedComputerProfile].self, from: data) else {
      return []
    }
    return normalized(decoded)
  }

  static func save(
    _ profiles: [MacPairedComputerProfile],
    to defaults: UserDefaults = .standard
  ) {
    guard let data = try? JSONEncoder().encode(normalized(profiles)) else {
      return
    }
    defaults.set(data, forKey: storageKey)
  }

  static func upserting(
    _ profile: MacPairedComputerProfile,
    into profiles: [MacPairedComputerProfile]
  ) -> [MacPairedComputerProfile] {
    normalized(profiles.filter { $0.id != profile.id } + [profile])
  }

  static func normalized(_ profiles: [MacPairedComputerProfile]) -> [MacPairedComputerProfile] {
    var unique: [String: MacPairedComputerProfile] = [:]
    for profile in profiles where !profile.hostId.isEmpty &&
      !profile.accountId.isEmpty && !profile.workspaceId.isEmpty &&
      !profile.cloudUrl.isEmpty && !profile.hostPublicKeyPem.isEmpty {
      unique[profile.id] = profile
    }
    return unique.values.sorted {
      if $0.lastUsedAt == $1.lastUsedAt {
        return $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
      }
      return $0.lastUsedAt > $1.lastUsedAt
    }
  }
}

struct MacPairingPayload: Codable, Equatable {
  var type: String
  var protocolVersion: String?
  var cloudUrl: String
  var accountId: String
  var workspaceId: String
  var hostId: String
  var hostName: String?
  var hostPlatform: String?
  var capabilities: [String]?
  var hostPublicKeyPem: String?
  var hostKeyId: String?
  var token: String
  var createdAt: String?
  var expiresAt: String
}

enum MacPairingError: LocalizedError, Equatable {
  case invalidCode
  case wrongCode
  case expiredCode
  case missingHostIdentity
  case hostIdentityChanged
  case responseTimedOut

  var errorDescription: String? {
    switch self {
    case .invalidCode:
      return "That text is not a valid ClawDad pairing code."
    case .wrongCode:
      return "That code belongs to a different service. Generate a new code in ClawDad Settings on the other computer."
    case .expiredCode:
      return "That pairing code expired. Generate a fresh code on the other computer."
    case .missingHostIdentity:
      return "That pairing code is missing the computer identity. Generate a fresh code after updating ClawDad."
    case .hostIdentityChanged:
      return "ClawDad stopped pairing because the other computer identity changed."
    case .responseTimedOut:
      return "The other computer did not finish pairing. Keep ClawDad open there and try a fresh code."
    }
  }
}

func parseMacPairingPayload(_ text: String, now: Date = Date()) throws -> MacPairingPayload {
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  guard let data = trimmed.data(using: .utf8),
        let payload = try? JSONDecoder().decode(MacPairingPayload.self, from: data) else {
    throw MacPairingError.invalidCode
  }
  guard payload.type == "clawdad.pair.v1" else {
    throw MacPairingError.wrongCode
  }
  guard !payload.cloudUrl.isEmpty,
        !payload.accountId.isEmpty,
        !payload.workspaceId.isEmpty,
        !payload.hostId.isEmpty,
        !payload.token.isEmpty,
        let expiresAt = macCloudDate(payload.expiresAt) else {
    throw MacPairingError.invalidCode
  }
  guard expiresAt > now else {
    throw MacPairingError.expiredCode
  }
  guard !(payload.hostPublicKeyPem ?? "").isEmpty else {
    throw MacPairingError.missingHostIdentity
  }
  return payload
}

func macCloudDate(_ value: String) -> Date? {
  let fractional = ISO8601DateFormatter()
  fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let parsed = fractional.date(from: value) {
    return parsed
  }
  return ISO8601DateFormatter().date(from: value)
}
