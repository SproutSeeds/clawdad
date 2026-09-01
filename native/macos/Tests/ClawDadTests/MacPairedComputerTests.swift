import Foundation
import XCTest
@testable import ClawDad

final class MacPairedComputerTests: XCTestCase {
  func testPairingPayloadRequiresLivePinnedHostIdentity() throws {
    let expiresAt = ISO8601DateFormatter().string(
      from: Date(timeIntervalSince1970: 2_000_000_000)
    )
    let code = """
    {
      "type":"clawdad.pair.v1",
      "protocolVersion":"clawdad.cloud.v1",
      "cloudUrl":"https://cloud.example.test",
      "accountId":"account-a",
      "workspaceId":"workspace-a",
      "hostId":"studio-mac",
      "hostName":"Studio Mac",
      "hostPlatform":"darwin",
      "capabilities":["remote-assist","catalog"],
      "hostPublicKeyPem":"-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----",
      "token":"pairing-token",
      "expiresAt":"\(expiresAt)"
    }
    """

    let payload = try parseMacPairingPayload(
      code,
      now: Date(timeIntervalSince1970: 1_900_000_000)
    )

    XCTAssertEqual(payload.hostId, "studio-mac")
    XCTAssertEqual(payload.hostName, "Studio Mac")
    XCTAssertEqual(payload.hostPlatform, "darwin")
    XCTAssertEqual(payload.capabilities, ["remote-assist", "catalog"])
  }

  func testExpiredPairingPayloadIsRejected() throws {
    let code = """
    {
      "type":"clawdad.pair.v1",
      "cloudUrl":"https://cloud.example.test",
      "accountId":"account-a",
      "workspaceId":"workspace-a",
      "hostId":"studio-mac",
      "hostPublicKeyPem":"key",
      "token":"pairing-token",
      "expiresAt":"2020-01-01T00:00:00Z"
    }
    """

    XCTAssertThrowsError(try parseMacPairingPayload(code)) { error in
      XCTAssertEqual(error as? MacPairingError, .expiredCode)
    }
  }

  func testRegistryDeduplicatesComputersAndKeepsNewestProfile() {
    let older = MacPairedComputerProfile(
      displayName: "Old Name",
      platform: "darwin",
      cloudUrl: "https://cloud.example.test",
      accountId: "account-a",
      workspaceId: "workspace-a",
      hostId: "studio-mac",
      hostPublicKeyPem: "key-a",
      pairedAt: "2026-01-01T00:00:00Z",
      capabilities: ["remote-assist"],
      lastUsedAt: "2026-01-01T00:00:00Z"
    )
    let newer = MacPairedComputerProfile(
      displayName: "Studio Mac",
      platform: "macos",
      cloudUrl: "https://cloud.example.test",
      accountId: "account-a",
      workspaceId: "workspace-a",
      hostId: "studio-mac",
      hostPublicKeyPem: "key-a",
      pairedAt: "2026-02-01T00:00:00Z",
      capabilities: ["catalog", "remote-assist", "remote-assist"],
      lastUsedAt: "2026-02-01T00:00:00Z"
    )

    let profiles = MacPairedComputerRegistry.upserting(newer, into: [older])

    XCTAssertEqual(profiles.count, 1)
    XCTAssertEqual(profiles[0].displayName, "Studio Mac")
    XCTAssertEqual(profiles[0].platform, "macos")
    XCTAssertEqual(profiles[0].capabilities, ["catalog", "remote-assist"])
    XCTAssertTrue(profiles[0].supportsRemoteAssist)
  }
}
