import Foundation

struct PairedComputerProfile: Codable, Equatable, Identifiable {
  var id: String
  var displayName: String
  var platform: String
  var cloudUrl: String
  var accountId: String
  var workspaceId: String
  var hostId: String
  var hostPublicKeyPem: String
  var pairedAt: String
  var selectedProjectPath: String
  var selectedSessionId: String
  var selectedModel: String
  var selectedReasoningEffort: String
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
    selectedProjectPath: String = "",
    selectedSessionId: String = "",
    selectedModel: String = "gpt-5.6-sol",
    selectedReasoningEffort: String = "ultra",
    capabilities: [String] = [],
    lastUsedAt: String = ""
  ) {
    self.id = pairedComputerIdentifier(
      accountId: accountId,
      workspaceId: workspaceId,
      hostId: hostId
    )
    self.displayName = pairedComputerDisplayName(displayName, hostId: hostId)
    self.platform = pairedComputerPlatform(platform, hostId: hostId)
    self.cloudUrl = cloudUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    self.accountId = accountId.trimmingCharacters(in: .whitespacesAndNewlines)
    self.workspaceId = workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
    self.hostId = hostId.trimmingCharacters(in: .whitespacesAndNewlines)
    self.hostPublicKeyPem = hostPublicKeyPem.trimmingCharacters(in: .whitespacesAndNewlines)
    self.pairedAt = pairedAt.trimmingCharacters(in: .whitespacesAndNewlines)
    self.selectedProjectPath = selectedProjectPath
    self.selectedSessionId = selectedSessionId
    self.selectedModel = selectedModel
    self.selectedReasoningEffort = selectedReasoningEffort
    self.capabilities = pairedComputerCapabilities(capabilities)
    self.lastUsedAt = lastUsedAt.isEmpty ? pairedAt : lastUsedAt
  }

  var platformLabel: String {
    switch platform {
    case "macos":
      return "Mac"
    case "windows":
      return "Windows"
    case "linux":
      return "Linux"
    default:
      return "Computer"
    }
  }

  var platformSymbolName: String {
    switch platform {
    case "macos":
      return "laptopcomputer"
    case "windows":
      return "pc"
    default:
      return "desktopcomputer"
    }
  }

  var supportsRemoteAssist: Bool {
    // Empty capability lists are legacy Mac profiles from before hosts
    // advertised their feature set.
    capabilities.isEmpty || capabilities.contains("remote-assist")
  }
}

func pairedComputerIdentifier(
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

func pairedComputerDisplayName(_ value: String, hostId: String) -> String {
  let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
  if !normalized.isEmpty {
    return normalized
  }
  let fallback = hostId.trimmingCharacters(in: .whitespacesAndNewlines)
  return fallback.isEmpty ? "ClawDad Computer" : fallback
}

func pairedComputerPlatform(_ value: String, hostId: String = "") -> String {
  let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  switch normalized {
  case "darwin", "mac", "macos", "osx":
    return "macos"
  case "win", "win32", "windows":
    return "windows"
  case "linux":
    return "linux"
  case "unknown":
    return "unknown"
  default:
    let normalizedHostId = hostId.lowercased()
    if normalizedHostId.contains("windows") || normalizedHostId.contains("-pc") {
      return "windows"
    }
    if normalizedHostId.contains("mac") {
      return "macos"
    }
    return normalized.isEmpty ? "unknown" : normalized
  }
}

func pairedComputerCapabilities(_ values: [String]) -> [String] {
  Array(Set(values.compactMap { value in
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return normalized.isEmpty ? nil : normalized
  })).sorted()
}

enum PairedComputerRegistry {
  static let storageKey = "clawdad.pairedComputers.v1"
  static let activeComputerKey = "clawdad.activeComputerId"

  static func load(from defaults: UserDefaults) -> [PairedComputerProfile] {
    guard let data = defaults.data(forKey: storageKey) else {
      return []
    }
    return normalized(
      (try? JSONDecoder().decode([PairedComputerProfile].self, from: data)) ?? []
    )
  }

  static func save(_ profiles: [PairedComputerProfile], to defaults: UserDefaults) {
    let next = normalized(profiles)
    guard let data = try? JSONEncoder().encode(next) else {
      return
    }
    defaults.set(data, forKey: storageKey)
  }

  static func normalized(_ profiles: [PairedComputerProfile]) -> [PairedComputerProfile] {
    var byId: [String: PairedComputerProfile] = [:]
    for profile in profiles {
      let normalized = PairedComputerProfile(
        displayName: profile.displayName,
        platform: profile.platform,
        cloudUrl: profile.cloudUrl,
        accountId: profile.accountId,
        workspaceId: profile.workspaceId,
        hostId: profile.hostId,
        hostPublicKeyPem: profile.hostPublicKeyPem,
        pairedAt: profile.pairedAt,
        selectedProjectPath: profile.selectedProjectPath,
        selectedSessionId: profile.selectedSessionId,
        selectedModel: profile.selectedModel,
        selectedReasoningEffort: profile.selectedReasoningEffort,
        capabilities: profile.capabilities,
        lastUsedAt: profile.lastUsedAt
      )
      guard !normalized.accountId.isEmpty,
            !normalized.workspaceId.isEmpty,
            !normalized.hostId.isEmpty else {
        continue
      }
      if let existing = byId[normalized.id] {
        byId[normalized.id] = profileIsNewer(normalized, than: existing)
          ? normalized
          : existing
      } else {
        byId[normalized.id] = normalized
      }
    }
    return byId.values.sorted { lhs, rhs in
      if lhs.lastUsedAt == rhs.lastUsedAt {
        return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
      }
      return lhs.lastUsedAt > rhs.lastUsedAt
    }
  }

  static func upserting(
    _ profile: PairedComputerProfile,
    into profiles: [PairedComputerProfile]
  ) -> [PairedComputerProfile] {
    normalized(profiles.filter { $0.id != profile.id } + [profile])
  }

  static func migratingLegacy(
    _ legacy: PairedComputerProfile?,
    into profiles: [PairedComputerProfile]
  ) -> [PairedComputerProfile] {
    guard let legacy,
          !profiles.contains(where: { $0.id == legacy.id }) else {
      return normalized(profiles)
    }
    return upserting(legacy, into: profiles)
  }

  static func removing(
    id: String,
    from profiles: [PairedComputerProfile]
  ) -> [PairedComputerProfile] {
    normalized(profiles.filter { $0.id != id })
  }

  private static func profileIsNewer(
    _ candidate: PairedComputerProfile,
    than existing: PairedComputerProfile
  ) -> Bool {
    let candidateDate = candidate.lastUsedAt.isEmpty ? candidate.pairedAt : candidate.lastUsedAt
    let existingDate = existing.lastUsedAt.isEmpty ? existing.pairedAt : existing.lastUsedAt
    return candidateDate >= existingDate
  }
}
