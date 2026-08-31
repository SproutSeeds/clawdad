import XCTest
@testable import ClawDadMobile

final class PairedComputerTests: XCTestCase {
  func testComputerIdentitySeparatesHostsAndWorkspaces() {
    let mac = pairedComputerIdentifier(
      accountId: "account",
      workspaceId: "mac-workspace",
      hostId: "studio"
    )
    let windows = pairedComputerIdentifier(
      accountId: "account",
      workspaceId: "windows-workspace",
      hostId: "studio"
    )

    XCTAssertNotEqual(mac, windows)
  }

  func testLegacyMacMigrationPreservesExistingComputerAndAddsMacOnce() {
    let windows = computer(
      name: "Editing PC",
      platform: "windows",
      workspaceId: "windows-workspace",
      hostId: "editing-pc",
      lastUsedAt: "2026-08-30T17:00:00Z"
    )
    let legacyMac = computer(
      name: "Studio Mac",
      platform: "macos",
      workspaceId: "mac-workspace",
      hostId: "studio-mac",
      lastUsedAt: "2026-08-29T17:00:00Z"
    )

    let migrated = PairedComputerRegistry.migratingLegacy(
      legacyMac,
      into: [windows]
    )
    let migratedAgain = PairedComputerRegistry.migratingLegacy(
      legacyMac,
      into: migrated
    )

    XCTAssertEqual(Set(migratedAgain.map(\.id)), Set([windows.id, legacyMac.id]))
    XCTAssertEqual(migratedAgain.count, 2)
  }

  func testRegistryKeepsNewestSnapshotAndNormalizesCapabilities() {
    let older = computer(
      name: "Studio Mac",
      platform: "darwin",
      workspaceId: "workspace",
      hostId: "studio-mac",
      lastUsedAt: "2026-08-29T17:00:00Z",
      capabilities: ["Remote-Assist", "catalog"]
    )
    var newer = older
    newer.displayName = "Main Mac"
    newer.selectedProjectPath = "/Volumes/Code_2TB/code/clawdad"
    newer.capabilities = ["catalog", "remote-assist", "catalog"]
    newer.lastUsedAt = "2026-08-30T17:00:00Z"

    let profiles = PairedComputerRegistry.normalized([older, newer])

    XCTAssertEqual(profiles.count, 1)
    XCTAssertEqual(profiles[0].displayName, "Main Mac")
    XCTAssertEqual(profiles[0].platform, "macos")
    XCTAssertEqual(profiles[0].capabilities, ["catalog", "remote-assist"])
    XCTAssertEqual(
      profiles[0].selectedProjectPath,
      "/Volumes/Code_2TB/code/clawdad"
    )
  }

  func testRegistryRoundTripStoresProfilesWithoutRelayCredentials() throws {
    let suiteName = "PairedComputerTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let profile = computer(
      name: "Editing PC",
      platform: "win32",
      workspaceId: "windows-workspace",
      hostId: "editing-pc",
      lastUsedAt: "2026-08-30T17:00:00Z"
    )

    PairedComputerRegistry.save([profile], to: defaults)
    let loaded = PairedComputerRegistry.load(from: defaults)
    let storedData = try XCTUnwrap(
      defaults.data(forKey: PairedComputerRegistry.storageKey)
    )
    let storedText = try XCTUnwrap(String(data: storedData, encoding: .utf8))

    XCTAssertEqual(loaded, [profile])
    XCTAssertFalse(storedText.localizedCaseInsensitiveContains("relayAccessToken"))
    XCTAssertFalse(storedText.localizedCaseInsensitiveContains("pairingToken"))
  }

  func testRemoteAssistCapabilitySupportsLegacyAndExplicitHosts() {
    let legacyMac = computer(
      name: "Legacy Mac",
      platform: "macos",
      workspaceId: "legacy-workspace",
      hostId: "legacy-mac",
      lastUsedAt: "2026-08-30T17:00:00Z"
    )
    let windows = computer(
      name: "Editing PC",
      platform: "windows",
      workspaceId: "windows-workspace",
      hostId: "editing-pc",
      lastUsedAt: "2026-08-30T17:00:00Z",
      capabilities: ["catalog", "remote-assist"]
    )
    let threadsOnly = computer(
      name: "Build PC",
      platform: "windows",
      workspaceId: "build-workspace",
      hostId: "build-pc",
      lastUsedAt: "2026-08-30T17:00:00Z",
      capabilities: ["catalog", "threads"]
    )

    XCTAssertTrue(legacyMac.supportsRemoteAssist)
    XCTAssertTrue(windows.supportsRemoteAssist)
    XCTAssertFalse(threadsOnly.supportsRemoteAssist)
  }

  private func computer(
    name: String,
    platform: String,
    workspaceId: String,
    hostId: String,
    lastUsedAt: String,
    capabilities: [String] = []
  ) -> PairedComputerProfile {
    PairedComputerProfile(
      displayName: name,
      platform: platform,
      cloudUrl: "https://clawdad-cloud.frg.earth",
      accountId: "account",
      workspaceId: workspaceId,
      hostId: hostId,
      hostPublicKeyPem: "public-key",
      pairedAt: "2026-08-20T17:00:00Z",
      selectedModel: "gpt-5.6-sol",
      selectedReasoningEffort: "ultra",
      capabilities: capabilities,
      lastUsedAt: lastUsedAt
    )
  }
}
