import XCTest
@testable import ClawDadMobile

final class CloudModelsTests: XCTestCase {
#if DEBUG
  func testAppStorePreviewArgumentsRequireAnExplicitKnownScenario() {
    XCTAssertEqual(
      ClawDadAppStorePreviewScenario.parse(
        arguments: ["ClawDad", "--clawdad-app-store-preview", "workspace"]
      ),
      .workspace
    )
    XCTAssertEqual(
      ClawDadAppStorePreviewScenario.parse(
        arguments: ["ClawDad", "--clawdad-app-store-preview", "conversation"]
      ),
      .conversation
    )
    XCTAssertNil(
      ClawDadAppStorePreviewScenario.parse(
        arguments: ["ClawDad", "--clawdad-app-store-preview", "unknown"]
      )
    )
    XCTAssertNil(ClawDadAppStorePreviewScenario.parse(arguments: ["ClawDad"]))
  }

  func testAppStorePreviewUsesSyntheticReadyWorkspaceData() {
    let fixture = ClawDadAppStorePreviewFixture.make()

    XCTAssertEqual(fixture.workspace.title, "My Projects")
    XCTAssertEqual(fixture.selectedThread?.title, "Paid beta launch")
    XCTAssertEqual(fixture.historyItems.count, 2)
    XCTAssertTrue(fixture.workspace.projects.allSatisfy { $0.path.hasPrefix("/Users/demo/") })
    XCTAssertFalse(
      fixture.workspace.projects.contains {
        $0.path.contains("cody") || $0.path.contains("Code_2TB")
      }
    )
    XCTAssertEqual(
      ClawDadAppStorePreviewFixture.make(scenario: .conversation).historyItems.count,
      1
    )
  }
#endif

  @MainActor
  func testPaidBetaPlansExposeStableStorefrontFallbacks() {
    let plans = SubscriptionManager.plans
    XCTAssertEqual(
      plans,
      [
        ClawDadSubscriptionPlan(
          productId: "earth.frg.clawdad.pro.monthly",
          title: "Monthly",
          fallbackPrice: "$9.99",
          periodLabel: "per month"
        ),
        ClawDadSubscriptionPlan(
          productId: "earth.frg.clawdad.pro.annual",
          title: "Annual",
          fallbackPrice: "$99.00",
          periodLabel: "per year"
        ),
      ]
    )
  }

  @MainActor
  func testSubscriptionAvailabilityMessageDistinguishesCatalogStates() {
    XCTAssertEqual(
      SubscriptionManager.productAvailabilityMessage(loadedProductIds: []),
      "The App Store has not made ClawDad plans available yet. Try again shortly."
    )
    XCTAssertEqual(
      SubscriptionManager.productAvailabilityMessage(
        loadedProductIds: [SubscriptionManager.monthlyProductId]
      ),
      "One ClawDad plan is still unavailable. Try again shortly."
    )
    XCTAssertEqual(
      SubscriptionManager.productAvailabilityMessage(
        loadedProductIds: SubscriptionManager.productIds
      ),
      ""
    )
  }

  func testPairingPayloadCarriesPinnedMacSigningIdentity() throws {
    let data = Data(
      """
      {
        "type": "clawdad.pair.v1",
        "protocolVersion": "clawdad.cloud.v1",
        "cloudUrl": "https://clawdad-cloud.frg.earth",
        "accountId": "account",
        "workspaceId": "scratchpad",
        "hostId": "cody-mac",
        "hostName": "Studio Mac",
        "hostPlatform": "macos",
        "capabilities": ["catalog", "remote-assist"],
        "hostPublicKeyPem": "-----BEGIN PUBLIC KEY-----\\nmac-key\\n-----END PUBLIC KEY-----",
        "hostKeyId": "mac-key-id",
        "token": "one-time-token",
        "expiresAt": "2026-07-29T18:00:00Z"
      }
      """.utf8
    )

    let payload = try JSONDecoder().decode(PairingPayload.self, from: data)

    XCTAssertEqual(payload.hostId, "cody-mac")
    XCTAssertEqual(payload.hostName, "Studio Mac")
    XCTAssertEqual(payload.hostPlatform, "macos")
    XCTAssertEqual(payload.capabilities, ["catalog", "remote-assist"])
    XCTAssertEqual(payload.hostKeyId, "mac-key-id")
    XCTAssertTrue(payload.hostPublicKeyPem?.contains("mac-key") == true)
  }

  func testRemoteAssistSignalingNumbersDecodeWithoutStringCoercion() throws {
    let value = try JSONDecoder().decode(
      JSONValue.self,
      from: Data("7".utf8)
    )

    XCTAssertEqual(value.numberValue, 7)
    XCTAssertEqual(value.stringValue, "")
  }

  func testThreadAutoScrollsWhenHistoryFirstArrivesOrReaderIsAtLatest() {
    XCTAssertTrue(
      threadConversationShouldAutoScroll(
        hasItems: true,
        hasPositionedAtLatest: false,
        isNearLatest: true
      )
    )
    XCTAssertTrue(
      threadConversationShouldAutoScroll(
        hasItems: true,
        hasPositionedAtLatest: true,
        isNearLatest: true
      )
    )
  }

  func testThreadDoesNotAutoScrollWhileReaderBrowsesOlderMessages() {
    XCTAssertFalse(
      threadConversationShouldAutoScroll(
        hasItems: true,
        hasPositionedAtLatest: true,
        isNearLatest: false
      )
    )
    XCTAssertFalse(
      threadConversationShouldAutoScroll(
        hasItems: false,
        hasPositionedAtLatest: false,
        isNearLatest: true
      )
    )
  }

  func testLatestButtonThresholdTracksDistanceFromBottom() {
    XCTAssertTrue(
      threadConversationIsNearLatest(
        bottomOffset: 760,
        viewportHeight: 700
      )
    )
    XCTAssertFalse(
      threadConversationIsNearLatest(
        bottomOffset: 800,
        viewportHeight: 700
      )
    )
  }

  func testHistoryLifecycleDistinguishesDirectWorkFromQueuedWork() {
    let direct = MobileHistoryItem(
      id: "direct",
      requestId: "direct",
      message: "Handle this now.",
      response: "",
      status: "queued",
      sentAt: "2026-07-26T05:07:42Z",
      answeredAt: "",
      scheduleMode: "direct",
      deliveryMechanism: "dispatch_worker"
    )
    let queued = MobileHistoryItem(
      id: "queue",
      requestId: "queue",
      message: "Handle this next.",
      response: "",
      status: "queued",
      sentAt: "2026-07-26T05:07:56Z",
      answeredAt: "",
      scheduleMode: "queue",
      deliveryMechanism: "queued_worker"
    )

    XCTAssertEqual(direct.lifecycleStatus, "working")
    XCTAssertEqual(direct.lifecycleLabel, "WORKING")
    XCTAssertEqual(direct.responsePlaceholder, "Codex is working on this turn.")
    XCTAssertEqual(queued.lifecycleStatus, "queued")
    XCTAssertEqual(queued.lifecycleLabel, "QUEUED")
    XCTAssertEqual(queued.responsePlaceholder, "Waiting to send after the active turn finishes.")
  }

  func testConversationOrderStaysOnSendTimeWhileQueueMovesFromWorkingToAnswered() {
    let direct = MobileHistoryItem(
      id: "direct",
      requestId: "direct",
      message: "What was created most recently?",
      response: "The newest artifact is the food-truck cutout.",
      status: "answered",
      sentAt: "2026-07-26T07:52:01.000Z",
      answeredAt: "2026-07-26T07:55:00.000Z",
      scheduleMode: "direct",
      deliveryMechanism: "dispatch_worker"
    )
    var queued = MobileHistoryItem(
      id: "queue",
      requestId: "queue",
      message: "What should we do next?",
      response: "",
      status: "working",
      sentAt: "2026-07-26T07:52:10.000Z",
      answeredAt: "",
      scheduleMode: "queue",
      deliveryMechanism: "queued_worker"
    )

    XCTAssertEqual(
      mobileHistoryItemsInConversationOrder([queued, direct]).map(\.requestId),
      ["direct", "queue"]
    )

    queued.status = "answered"
    queued.response = "Here are the next steps."
    queued.answeredAt = "2026-07-26T07:58:00.000Z"

    XCTAssertEqual(
      mobileHistoryItemsInConversationOrder([queued, direct]).map(\.requestId),
      ["direct", "queue"]
    )
  }

  func testFailedHistoryHidesRetryAndTransportDiagnostics() {
    let failed = MobileHistoryItem(
      id: "failed",
      requestId: "failed",
      message: "Please apply the selected wordmark.",
      response: """
      {"error":{"message":"Reconnecting... 2/5","codexErrorInfo":{"responseStreamDisconnected":{"httpStatusCode":null}},"additionalDetails":"stream disconnected before completion"},"willRetry":true}
      \u{001B}[31mERROR\u{001B}[0m rmcp::transport::worker transport channel closed
      """,
      status: "failed",
      sentAt: "2026-07-28T16:06:33Z",
      answeredAt: "2026-07-28T16:07:53Z"
    )

    XCTAssertEqual(
      failed.displayResponse,
      "Codex's response connection dropped while it was reconnecting. Your message was saved, but this turn did not finish."
    )
    XCTAssertFalse(failed.displayResponse.contains("codexErrorInfo"))
    XCTAssertFalse(failed.displayResponse.contains("rmcp"))
  }

  func testFailedHistoryPreservesReadableAgentText() {
    let failed = MobileHistoryItem(
      id: "failed-readable",
      requestId: "failed-readable",
      message: "Run the validator.",
      response: "The validator found one unresolved file.",
      status: "failed",
      sentAt: "2026-07-28T16:06:33Z",
      answeredAt: "2026-07-28T16:07:53Z"
    )

    XCTAssertEqual(failed.displayResponse, "The validator found one unresolved file.")
  }

  func testOpenThreadFollowsProvisionalAliasWithoutLosingItsName() {
    let projectPath = "/Volumes/Code_2TB/code/go-to-market"
    let provisionalId = "e43a8ddb-58bb-4a99-b20f-087b1ddb0801"
    let realId = "019f9cd2-7a08-7653-bb33-a004f5135c2e"
    let fallback = thread(
      projectPath: projectPath,
      sessionId: provisionalId,
      title: "Testing",
      active: true
    )
    let live = thread(
      projectPath: projectPath,
      sessionId: realId,
      title: "go-to-market 2",
      active: true
    )
    let workspace = MobileWorkspace(
      id: "scratchpad",
      title: "Scratchpad",
      hostId: "cody-mac",
      projects: [
        ProjectSummary(
          name: "go-to-market",
          path: projectPath,
          activeSessionId: realId,
          sessions: [live],
          sessionAliases: [provisionalId: realId]
        )
      ]
    )

    let resolved = resolveMobileThreadSelection(
      MobileThreadSelection(initialThread: fallback),
      workspace: workspace,
      selectedProjectPath: projectPath,
      selectedSessionId: realId
    )

    XCTAssertEqual(resolved.sessionId, realId)
    XCTAssertEqual(resolved.title, "Testing")
  }

  func testOpenThreadDoesNotJumpToAnotherExplicitSelection() {
    let projectPath = "/repo"
    let original = thread(
      projectPath: projectPath,
      sessionId: "session-original",
      title: "Original",
      active: false
    )
    let other = thread(
      projectPath: projectPath,
      sessionId: "session-other",
      title: "Other",
      active: true
    )
    let workspace = MobileWorkspace(
      id: "scratchpad",
      title: "Scratchpad",
      hostId: "host",
      projects: [
        ProjectSummary(
          name: "repo",
          path: projectPath,
          activeSessionId: other.sessionId,
          sessions: [original, other]
        )
      ]
    )

    let resolved = resolveMobileThreadSelection(
      MobileThreadSelection(initialThread: original),
      workspace: workspace,
      selectedProjectPath: projectPath,
      selectedSessionId: other.sessionId
    )

    XCTAssertEqual(resolved.sessionId, original.sessionId)
    XCTAssertEqual(resolved.title, original.title)
  }

  func testRecentThreadsMergeProjectsSortByActivityAndResolveAliases() {
    let older = thread(
      projectPath: "/workspace/alpha",
      sessionId: "alpha-session",
      title: "Alpha",
      active: true,
      lastActivityAt: "2026-07-27T02:00:00.000Z"
    )
    let provisional = thread(
      projectPath: "/workspace/beta",
      sessionId: "provisional-session",
      title: "Beta draft",
      active: false,
      lastActivityAt: "2026-07-27T03:00:00.000Z"
    )
    let canonical = thread(
      projectPath: "/workspace/beta",
      sessionId: "beta-session",
      title: "Beta",
      active: true,
      lastActivityAt: "2026-07-27T03:10:00.000Z"
    )
    let projects = [
      ProjectSummary(
        name: "Alpha",
        path: "/workspace/alpha",
        activeSessionId: older.sessionId,
        sessions: [older]
      ),
      ProjectSummary(
        name: "Beta",
        path: "/workspace/beta",
        activeSessionId: canonical.sessionId,
        sessions: [provisional, canonical],
        sessionAliases: [provisional.sessionId: canonical.sessionId]
      ),
    ]

    let recent = mobileRecentThreads(in: projects)

    XCTAssertEqual(recent.map(\.sessionId), ["beta-session", "alpha-session"])
    XCTAssertEqual(recent.first?.projectName, "Beta")
    XCTAssertEqual(recent.first?.title, "Beta")
    XCTAssertEqual(recent.first?.active, true)
  }

  func testReadAloudKeysSeparateSentAndReturnedTextAndTrackResponseChanges() {
    let item = MobileHistoryItem(
      id: "turn-1",
      requestId: "turn-1",
      message: "Please summarize this.",
      response: "Here is the summary.",
      status: "answered",
      sentAt: "2026-08-07T12:00:00.000Z",
      answeredAt: "2026-08-07T12:00:03.000Z"
    )

    let messageKey = mobileReadAloudKey(
      item: item,
      kind: .message,
      text: item.message
    )
    let responseKey = mobileReadAloudKey(
      item: item,
      kind: .response,
      text: item.response
    )
    let revisedResponseKey = mobileReadAloudKey(
      item: item,
      kind: .response,
      text: "Here is a revised summary."
    )

    XCTAssertNotEqual(messageKey, responseKey)
    XCTAssertNotEqual(responseKey, revisedResponseKey)
    XCTAssertEqual(
      responseKey,
      mobileReadAloudKey(item: item, kind: .response, text: "  \(item.response)\n")
    )
  }

  func testProjectDirectoryNamesStayWithinTheConfiguredMacRoot() {
    XCTAssertTrue(mobileProjectDirectoryNameIsValid("new-project"))
    XCTAssertTrue(mobileProjectDirectoryNameIsValid("Client Notes"))
    XCTAssertFalse(mobileProjectDirectoryNameIsValid(""))
    XCTAssertFalse(mobileProjectDirectoryNameIsValid("."))
    XCTAssertFalse(mobileProjectDirectoryNameIsValid(".."))
    XCTAssertFalse(mobileProjectDirectoryNameIsValid(".hidden"))
    XCTAssertFalse(mobileProjectDirectoryNameIsValid("nested/project"))
    XCTAssertFalse(mobileProjectDirectoryNameIsValid("nested\\project"))
    XCTAssertFalse(mobileProjectDirectoryNameIsValid("line\nbreak"))
  }

  private func thread(
    projectPath: String,
    sessionId: String,
    title: String,
    active: Bool,
    lastActivityAt: String = ""
  ) -> MobileThreadSummary {
    MobileThreadSummary(
      projectName: URL(fileURLWithPath: projectPath).lastPathComponent,
      projectPath: projectPath,
      title: title,
      provider: "codex",
      sessionId: sessionId,
      active: active,
      status: "idle",
      lastDispatch: "",
      lastResponse: "",
      lastActivityAt: lastActivityAt
    )
  }
}
