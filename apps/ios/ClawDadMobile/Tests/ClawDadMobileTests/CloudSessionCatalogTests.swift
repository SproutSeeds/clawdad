import XCTest
@testable import ClawDadMobile

@MainActor
final class CloudSessionCatalogTests: XCTestCase {
  private struct SentEnvelope {
    var type: String
    var body: [String: JSONValue]
    var id: String
  }

  private var sent: [SentEnvelope] = []
  private var defaultsDomains: [String] = []

  override func tearDown() {
    for domain in defaultsDomains {
      UserDefaults.standard.removePersistentDomain(forName: domain)
    }
    super.tearDown()
  }

  private func makeSession() -> CloudSession {
    let domain = "CloudSessionCatalogTests.\(UUID().uuidString)"
    defaultsDomains.append(domain)
    let defaults = UserDefaults(suiteName: domain)!
    let session = CloudSession(defaults: defaults) { [weak self] type, body, id in
      self?.sent.append(SentEnvelope(type: type, body: body, id: id))
    }
    session.hostId = "test-mac"
    session.pairedHostId = "test-mac"
    session.state = .connected
    session.hostOnline = true
    session.selectedProjectPath = "/projects/alpha"
    session.selectedSessionId = "older"
    return session
  }

  private func drainTasks() async {
    for _ in 0..<20 { await Task.yield() }
  }

  private func snapshot(
    for session: CloudSession,
    replyTo: String,
    sessions: [String] = ["older"],
    recent: [String] = ["older"],
    pending: Bool = false,
    recentOnly: Bool = false,
    activity: String = "2026-09-04T12:00:00Z"
  ) -> CloudEnvelope {
    func thread(_ id: String) -> JSONValue {
      .object([
        "sessionId": .string(id),
        "projectPath": .string("/projects/alpha"),
        "projectName": .string("Alpha"),
        "title": .string(id),
        "lastActivityAt": .string(activity)
      ])
    }
    return CloudEnvelope(
      type: "catalog.snapshot",
      accountId: session.accountId,
      workspaceId: session.workspaceId,
      sourceDeviceId: session.hostId,
      targetHostId: session.hostId,
      body: [
        "inReplyTo": .string(replyTo),
        "catalogRefreshPending": .bool(pending),
        "catalogRecentOnly": .bool(recentOnly),
        "projects": .array([.object([
          "path": .string("/projects/alpha"),
          "displayName": .string("Alpha"),
          "activeSessionId": .string("older"),
          "sessions": .array(sessions.map(thread))
        ])]),
        "recentThreads": .array(recent.map(thread))
      ]
    )
  }

  func testOpeningUnimportedRecentThreadSurvivesWarmCatalogAndLoadsRequestedHistory() async throws {
    let session = makeSession()
    session.selectThread(MobileThreadSummary(
      projectName: "Alpha", projectPath: "/projects/alpha", title: "New thread",
      provider: "codex", sessionId: "new", active: false, status: "idle",
      lastDispatch: "", lastResponse: "", lastActivityAt: ""
    ), historyLimit: 50)
    await drainTasks()
    let request = try XCTUnwrap(sent.first { $0.type == "catalog.request" })
    session.apply(snapshot(for: session, replyTo: request.id, recent: ["new", "older"], pending: true))
    await drainTasks()
    XCTAssertEqual(session.selectedSessionId, "new", "The warm catalog must preserve the thread being imported.")
    XCTAssertFalse(sent.contains { $0.type == "history.request" }, "Wait for import before requesting history.")

    session.apply(snapshot(for: session, replyTo: request.id, sessions: ["new", "older"], recent: ["new", "older"]))
    await drainTasks()
    XCTAssertEqual(session.selectedSessionId, "new")
    let history = try XCTUnwrap(sent.last { $0.type == "history.request" })
    XCTAssertEqual(history.body["sessionId"]?.stringValue, "new")
    XCTAssertEqual(history.body["limit"]?.stringValue, "50")
    XCTAssertFalse(session.catalogLoading)
  }

  func testDelayedCatalogCannotOverwriteNewerProjectSelection() async throws {
    let session = makeSession()
    session.requestCatalog()
    await drainTasks()
    let older = try XCTUnwrap(sent.last { $0.type == "catalog.request" })
    session.selectedProjectPath = "/projects/beta"
    session.selectedSessionId = "beta-thread"
    session.requestCatalog()
    await drainTasks()
    let newer = try XCTUnwrap(sent.last { $0.type == "catalog.request" })
    XCTAssertNotEqual(older.id, newer.id)

    session.apply(snapshot(for: session, replyTo: older.id))
    XCTAssertEqual(session.selectedProjectPath, "/projects/beta")
    XCTAssertEqual(session.selectedSessionId, "beta-thread")
    XCTAssertTrue(session.catalogLoading, "An old response must not finish the current refresh.")
  }

  func testActivityMonitorRefreshesAllProjectsWithoutReloadingUnchangedHistory() async throws {
    let session = makeSession()
    let start = Date()
    session.requestCatalog(now: start)
    await drainTasks()
    let initial = try XCTUnwrap(sent.first { $0.type == "catalog.request" })
    session.apply(snapshot(for: session, replyTo: initial.id))
    await drainTasks()
    sent = []

    session.refreshCatalogIfNeeded(now: start.addingTimeInterval(14))
    await drainTasks()
    XCTAssertTrue(sent.isEmpty)
    session.refreshCatalogIfNeeded(now: start.addingTimeInterval(15))
    await drainTasks()
    let refresh = try XCTUnwrap(sent.first { $0.type == "catalog.request" })
    XCTAssertNil(refresh.body["project"], "Regular refresh must avoid importing a selected project's full history.")
    XCTAssertEqual(refresh.body["refreshRecent"]?.boolValue, false)
    XCTAssertEqual(refresh.body["recentOnly"]?.boolValue, true)

    let projects = session.workspace.projects
    var recentSnapshot = snapshot(for: session, replyTo: refresh.id, recent: ["new", "older"], recentOnly: true)
    recentSnapshot.body.removeValue(forKey: "projects")
    session.apply(recentSnapshot)
    await drainTasks()
    XCTAssertTrue(session.workspace.recentThreads.contains { $0.sessionId == "new" })
    XCTAssertEqual(session.selectedSessionId, "older")
    XCTAssertEqual(session.workspace.projects, projects, "A compact refresh must preserve the project picker.")
    XCTAssertFalse(sent.contains { $0.type == "history.request" || $0.type == "models.request" })
  }

  func testDuplicateRefreshCoalescesAndTimeoutRetriesWithoutLosingSelection() async throws {
    let session = makeSession()
    let start = Date()
    session.requestCatalog(now: start)
    session.requestCatalog(now: start.addingTimeInterval(1))
    await drainTasks()
    XCTAssertEqual(sent.filter { $0.type == "catalog.request" }.count, 1)
    let initial = try XCTUnwrap(sent.first { $0.type == "catalog.request" })
    session.refreshCatalogIfNeeded(now: start.addingTimeInterval(29))
    await drainTasks()
    XCTAssertEqual(sent.filter { $0.type == "catalog.request" }.count, 1)
    session.refreshCatalogIfNeeded(now: start.addingTimeInterval(30))
    await drainTasks()
    let retry = try XCTUnwrap(sent.last { $0.type == "catalog.request" })
    XCTAssertNotEqual(initial.id, retry.id)
    XCTAssertEqual(retry.body["project"]?.stringValue, "/projects/alpha")
    session.apply(snapshot(for: session, replyTo: initial.id, recent: ["stale"]))
    XCTAssertTrue(session.catalogLoading)
    session.apply(snapshot(for: session, replyTo: retry.id, recent: ["new", "older"]))
    XCTAssertFalse(session.catalogLoading)
    XCTAssertEqual(session.selectedSessionId, "older")
  }

  func testCatalogErrorClearsLoadingAndNextMonitorTickRecovers() async throws {
    let session = makeSession()
    let start = Date()
    session.requestCatalog(now: start)
    await drainTasks()
    let initial = try XCTUnwrap(sent.first { $0.type == "catalog.request" })
    var error = snapshot(for: session, replyTo: initial.id)
    error.type = "error"
    error.body["error"] = .string("Temporary catalog failure")
    session.apply(error)
    XCTAssertFalse(session.catalogLoading)
    session.refreshCatalogIfNeeded(now: start.addingTimeInterval(15))
    await drainTasks()
    XCTAssertEqual(sent.filter { $0.type == "catalog.request" }.count, 2)
    XCTAssertEqual(sent.last { $0.type == "catalog.request" }?.body["recentOnly"]?.boolValue, false,
                   "Startup recovery must retry the full catalog before using compact updates.")
  }

  func testDisconnectInvalidatesRepliesAndReconnectRequestsFreshCatalog() async throws {
    let session = makeSession()
    session.requestCatalog()
    await drainTasks()
    let initial = try XCTUnwrap(sent.first { $0.type == "catalog.request" })
    session.disconnect()
    session.apply(snapshot(for: session, replyTo: initial.id))
    XCTAssertTrue(session.workspace.projects.isEmpty)
    XCTAssertFalse(session.catalogLoading)
    session.state = .connected
    session.hostOnline = true
    session.refreshCatalogIfNeeded()
    await drainTasks()
    let next = try XCTUnwrap(sent.last { $0.type == "catalog.request" })
    XCTAssertNotEqual(next.id, initial.id)
  }

  func testPeriodicActivityRefreshPreservesExpandedHistoryLimitAndRejectsOlderHistory() async throws {
    let session = makeSession()
    let start = Date()
    session.requestCatalog(now: start)
    await drainTasks()
    let initial = try XCTUnwrap(sent.first { $0.type == "catalog.request" })
    session.apply(snapshot(for: session, replyTo: initial.id))
    await drainTasks()
    let oldHistory = try XCTUnwrap(sent.last { $0.type == "history.request" })
    session.requestHistory(limit: 50)
    await drainTasks()
    session.refreshCatalogIfNeeded(now: start.addingTimeInterval(15))
    await drainTasks()
    let refresh = try XCTUnwrap(sent.last { $0.type == "catalog.request" })
    session.apply(snapshot(for: session, replyTo: refresh.id, activity: "2026-09-04T12:05:00Z"))
    await drainTasks()
    let latestHistory = try XCTUnwrap(sent.last { $0.type == "history.request" })
    XCTAssertEqual(latestHistory.body["limit"]?.stringValue, "50")
    var stalePage = snapshot(for: session, replyTo: oldHistory.id)
    stalePage.type = "history.page"
    stalePage.body["sessionId"] = .string("older")
    let previousStatus = session.historyStatus
    session.apply(stalePage)
    XCTAssertEqual(session.historyStatus, previousStatus, "A delayed older page must not replace the current history.")
  }

  func testOlderHostWithoutRequestIdsStillLoadsCatalog() async {
    let session = makeSession()
    session.requestCatalog()
    await drainTasks()
    session.apply(snapshot(for: session, replyTo: ""))
    XCTAssertFalse(session.catalogLoading)
    XCTAssertEqual(session.workspace.projects.first?.path, "/projects/alpha")
  }

  func testSelectingNewThreadSupersedesPendingSyncInSameProject() async throws {
    let session = makeSession()
    session.requestCatalog()
    await drainTasks()
    let initial = try XCTUnwrap(sent.first { $0.type == "catalog.request" })
    session.selectedSessionId = "new"
    session.requestCatalog()
    await drainTasks()
    let current = try XCTUnwrap(sent.last { $0.type == "catalog.request" })
    XCTAssertNotEqual(initial.id, current.id)
    session.apply(snapshot(for: session, replyTo: initial.id))
    XCTAssertEqual(session.selectedSessionId, "new")
    session.apply(snapshot(for: session, replyTo: current.id, sessions: ["new", "older"], recent: ["new", "older"]))
    XCTAssertEqual(session.selectedSessionId, "new")
    XCTAssertFalse(session.catalogLoading)
  }
}
