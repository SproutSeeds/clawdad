import XCTest
import CryptoKit
@testable import ClawDadMobile

final class MobileNotificationTests: XCTestCase {
  private let sessionID = "11111111-1111-4111-8111-111111111111"
  private func values() -> [String: Any] {
    ["version": 1, "eventId": String(repeating: "a", count: 64), "sessionId": sessionID,
      "directory": "code", "completedAt": "2026-09-07T12:00:00Z", "accountId": "account", "workspaceId": "workspace", "hostId": "mac"]
  }
  private func profile(key: String = "") -> PairedComputerProfile {
    PairedComputerProfile(displayName: "Studio Mac", platform: "macos", cloudUrl: "https://relay.example",
      accountId: "account", workspaceId: "workspace", hostId: "mac", hostPublicKeyPem: key,
      pairedAt: "2026-09-07T00:00:00Z", selectedProjectPath: "/projects/code", selectedSessionId: "older")
  }
  func testPayloadRejectsMalformedIdentityAndFullPaths() throws {
    XCTAssertNotNil(CompletedTurnNotification.parse(["clawdad": values()]))
    for (field, invalid) in [("version", 2 as Any), ("sessionId", "not-a-session"), ("eventId", "path/elsewhere"), ("directory", "/private/code"), ("directory", "code\rhidden"), ("completedAt", "yesterday")] {
      var payload = values(); payload[field] = invalid
      XCTAssertNil(CompletedTurnNotification.parse(["clawdad": payload]))
    }
  }
  func testComputerRoutingUsesAccountWorkspaceAndHostInsteadOfDirectory() throws {
    let notification = try XCTUnwrap(CompletedTurnNotification.parse(["clawdad": values()]))
    let correct = profile()
    XCTAssertTrue(notification.matches(correct))
    var other = correct; other.workspaceId = "another-workspace"
    XCTAssertFalse(notification.matches(other))
    other = correct; other.accountId = "another-account"
    XCTAssertFalse(notification.matches(other))
    other = correct; other.hostId = "another-mac"
    XCTAssertFalse(notification.matches(other))
  }
  @MainActor
  func testUnpairedNotificationCannotChangeTheSelectedConversation() throws {
    let domain = "MobileNotificationTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: domain)!
    defer { defaults.removePersistentDomain(forName: domain) }
    let session = CloudSession(defaults: defaults) { _, _, _ in XCTFail("An unpaired alert must not send anything") }
    let previous = session.selectedSessionId
    session.openNotification(try XCTUnwrap(CompletedTurnNotification.parse(["clawdad": values()])))
    XCTAssertFalse(session.notificationError.isEmpty)
    XCTAssertEqual(session.selectedSessionId, previous)
  }
  @MainActor
  func testTapRequiresSignedMatchingReplyAndCatalogCannotSubstituteAnotherSameDirectoryThread() async throws {
    let domain = "MobileNotificationTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: domain)!
    defer { defaults.removePersistentDomain(forName: domain) }
    let key = P256.Signing.PrivateKey()
    PairedComputerRegistry.save([profile(key: key.publicKey.pemRepresentation)], to: defaults)
    var sent: [(String, String)] = []
    let session = CloudSession(defaults: defaults) { type, _, id in sent.append((type, id)) }
    session.state = .connected; session.hostOnline = true
    session.openNotification(try XCTUnwrap(CompletedTurnNotification.parse(["clawdad": values()])))
    for _ in 0..<30 { await Task.yield() }
    let request = try XCTUnwrap(sent.first { $0.0 == "notification.open.request" })
    var reply = CloudEnvelope(type: "notification.opened", accountId: "account", workspaceId: "workspace", sourceDeviceId: "mac",
      targetHostId: try DeviceIdentity.shared.deviceId(), body: ["inReplyTo": .string(request.1),
        "eventId": .string(String(repeating: "a", count: 64)), "sessionId": .string(sessionID), "projectPath": .string("/projects/code")])
    session.apply(reply)
    XCTAssertNil(session.notificationThread, "Unsigned routing data must be ignored")
    let signature = try key.signature(for: JSONEncoder.clawDadSorted.encode(reply)).derRepresentation
    reply.signature = CloudSignature(alg: "ES256", keyId: "test", value: signature.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: ""))
    session.apply(reply)
    XCTAssertEqual(session.notificationThread?.sessionId, sessionID)
    XCTAssertEqual(session.selectedSessionId, sessionID)
    for _ in 0..<30 { await Task.yield() }
    let catalog = try XCTUnwrap(sent.last { $0.0 == "catalog.request" })
    session.apply(CloudEnvelope(type: "catalog.snapshot", accountId: "account", workspaceId: "workspace", sourceDeviceId: "mac", targetHostId: "mac",
      body: ["inReplyTo": .string(catalog.1), "projects": .array([.object([
        "path": .string("/projects/code"), "name": .string("code"), "activeSessionId": .string("older"), "sessions": .array([])
      ])])]))
    XCTAssertEqual(session.selectedSessionId, sessionID, "A stale catalog must not redirect the opened alert")
    session.cancelNotificationOpen()
  }
}
