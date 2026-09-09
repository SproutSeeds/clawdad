import XCTest
@testable import ClawDadMobile

final class WeeklyUsageTests: XCTestCase {
  @MainActor
  func testUsageReconnectScopeAndPersistentNoticeAcknowledgment() async throws {
    let name = "WeeklyUsageTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    var requestId = ""
    let session = CloudSession(defaults: defaults) { type, _, id in if type == "usage.request" { requestId = id } }
    session.hostId = "mac"; session.pairedHostId = "mac"; session.state = .connected; session.hostOnline = true
    session.requestWeeklyUsage()
    for _ in 0..<20 { await Task.yield() }
    XCTAssertFalse(requestId.isEmpty)
    let now = Date()
    let alert = WeeklyUsageAlert(id: String(repeating: "a", count: 64), threshold: 5, remainingPercent: 4,
      resetsAt: now.addingTimeInterval(3600).timeIntervalSince1970, completedAt: ISO8601DateFormatter().string(from: now))
    let value = WeeklyUsage(status: "current", remainingPercent: 4, resetsAt: alert.resetsAt, observedAt: nil,
      validUntil: now.addingTimeInterval(600).timeIntervalSince1970 * 1000, message: nil, alerts: [alert])
    var body = try JSONDecoder().decode([String: JSONValue].self, from: JSONEncoder().encode(value))
    body["inReplyTo"] = .string(requestId)
    let reply = CloudEnvelope(type: "usage.snapshot", accountId: session.accountId, workspaceId: session.workspaceId,
      sourceDeviceId: "mac", targetHostId: "mac", body: body)
    session.apply(reply)
    XCTAssertEqual(session.weeklyUsage?.remainingPercent, 4); XCTAssertEqual(session.weeklyUsageNotice?.id, alert.id)
    session.dismissWeeklyUsageNotice(); session.apply(reply)
    XCTAssertNil(session.weeklyUsageNotice)
    XCTAssertTrue(defaults.stringArray(forKey: "clawdad.usage.seen")!.contains(alert.id))
    let reopened = CloudSession(defaults: defaults) { _, _, _ in }
    XCTAssertNil(reopened.weeklyUsage, "Restart waits for a host-bound reading")
    session.hostId = "other"; session.requestWeeklyUsage(); session.apply(reply)
    XCTAssertNil(session.weeklyUsage, "Old host replies cannot populate the new host's allowance")
    XCTAssertNil(session.weeklyUsageNotice)
  }
  func testExactResetUsesLocalZoneAndDateAcrossDSTAndMidnight() {
    let zone = TimeZone(identifier: "America/Chicago")!
    let locale = Locale(identifier: "en_US")
    let date = ISO8601DateFormatter().date(from: "2026-09-14T22:47:11Z")!
    let text = WeeklyUsage.resetText(date.timeIntervalSince1970, timeZone: zone, locale: locale)
    XCTAssertTrue(text.contains("Monday")); XCTAssertTrue(text.contains("Sep 14, 2026"))
    XCTAssertTrue(text.contains("5:47")); XCTAssertTrue(text.contains("PM")); XCTAssertTrue(text.contains("CDT"))
    let winter = ISO8601DateFormatter().date(from: "2026-12-15T01:05:00Z")!
    let result = WeeklyUsage.resetText(winter.timeIntervalSince1970, timeZone: zone, locale: locale)
    XCTAssertTrue(result.contains("Monday")); XCTAssertTrue(result.contains("Dec 14, 2026"))
    XCTAssertTrue(result.contains("7:05")); XCTAssertTrue(result.contains("CST"))
  }
  func testFreshAndExpiredOrOfflineReadingsAreClearlyDifferent() {
    let now = Date(timeIntervalSince1970: 1000)
    var value = WeeklyUsage(status: "current", remainingPercent: 33, resetsAt: 2000, observedAt: nil,
      validUntil: 1100_000, message: nil, alerts: [])
    XCTAssertEqual(value.summary(now: now), "33% weekly remaining")
    XCTAssertTrue(value.summary(now: now.addingTimeInterval(101)).contains("Stale"))
    value.status = "stale"
    XCTAssertTrue(value.summary(now: now).contains("Stale"))
    let unavailable = WeeklyUsage(status: "unavailable", remainingPercent: nil, resetsAt: nil, observedAt: nil, validUntil: nil, message: nil, alerts: [])
    XCTAssertEqual(unavailable.summary(now: now), "Weekly allowance unavailable")
  }
  func testUsageNotificationHasItsOwnValidatedDestination() {
    let data: [AnyHashable: Any] = ["clawdad": ["version": 1, "kind": "codex_weekly", "eventId": String(repeating: "a", count: 64),
      "accountId": "account", "workspaceId": "workspace", "hostId": "mac"]]
    XCTAssertNotNil(WeeklyUsageNotification.parse(data))
    XCTAssertNil(CompletedTurnNotification.parse(data))
    XCTAssertNil(WeeklyUsageNotification.parse(["clawdad": ["version": 1, "kind": "codex_weekly", "eventId": "bad"]]))
  }
}
