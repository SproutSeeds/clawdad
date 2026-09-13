import XCTest
import UserNotifications
@testable import ClawDad

/// Hosted iOS tests exercise the production delegate's completion boundary.
/// The SPM/macOS tests cannot compile this UIKit/UN delegate path.
@MainActor
final class NotificationDelegateTests: XCTestCase {
  private func target(_ kind: String?) -> [String: Any] {
    var value: [String: Any] = ["version": 1, "eventId": String(repeating: "a", count: 64),
      "accountId": "fixture-account", "workspaceId": "fixture-workspace", "hostId": "fixture-mac"]
    if let kind { value["kind"] = kind }
    if kind == "assistant_reply" {
      value["conversationId"] = "11111111-1111-4111-8111-111111111111"
      value["requestId"] = "22222222-2222-4222-8222-222222222222"
      value["replyId"] = "assistant:22222222-2222-4222-8222-222222222222:final"
      value["completedAt"] = "2026-09-13T23:00:00Z"
    } else if kind == nil {
      value["sessionId"] = "33333333-3333-4333-8333-333333333333"
      value["directory"] = "fixture-project"
      value["completedAt"] = "2026-09-13T23:00:00Z"
    }
    return ["clawdad": value]
  }

  private func deliver(_ info: [String: Any], action: String = UNNotificationDefaultActionIdentifier,
    verifyBeforeCompletion: @escaping @MainActor @Sendable () -> Void = {}) async throws {
    let data = try JSONSerialization.data(withJSONObject: info)
    let delegate = ClawDadPushAppDelegate()
    let result = await Task.detached {
      let payload = (try? JSONSerialization.jsonObject(with: data)) as? [AnyHashable: Any] ?? [:]
      let started = Date()
      return await withCheckedContinuation { continuation in
        delegate.handleNotificationResponse(actionIdentifier: action, userInfo: payload) {
          // Observe the boundary before SwiftUI legitimately consumes pending
          // navigation on its next render. Checking after awaiting races it.
          if Thread.isMainThread { MainActor.assumeIsolated { verifyBeforeCompletion() } }
          continuation.resume(returning: (Thread.isMainThread, Date().timeIntervalSince(started)))
        }
      }
    }.value
    XCTAssertTrue(result.0, "The OS completion must run on the main thread, even for ignored payloads")
    XCTAssertLessThan(result.1, 1, "Completion must not await a Mac, history request, or speech")
  }

  func testBackgroundDeliveryRoutesAllNotificationKindsThenCompletesOnMain() async throws {
    let controller = MobileNotificationController.shared
    let nav = AssistantReplyNavigation.shared
    let prior = (controller.pendingOpen, controller.pendingUsageOpen, controller.pendingResearchOpen, nav.pending)
    defer {
      controller.pendingOpen = prior.0; controller.pendingUsageOpen = prior.1; controller.pendingResearchOpen = prior.2
      if let current = nav.pending { nav.finishOpening(current) }
      if let previous = prior.3 { nav.receive(previous) }
    }
    for kind in [nil, "assistant_reply", "codex_weekly", "research"] as [String?] {
      let payload = target(kind)
      let terminal = CompletedTurnNotification.parse(payload), assistant = AssistantReplyNotification.parse(payload)
      let usage = WeeklyUsageNotification.parse(payload)
      try await deliver(payload) {
        switch kind {
        case nil: XCTAssertEqual(controller.pendingOpen, terminal)
        case "assistant_reply": XCTAssertEqual(nav.pending, assistant)
        case "codex_weekly": XCTAssertEqual(controller.pendingUsageOpen, usage)
        default: XCTAssertEqual(controller.pendingResearchOpen, usage)
        }
      }
    }
  }

  func testMalformedDismissedAndUnknownActionsCompleteWithoutChangingNavigation() async throws {
    let controller = MobileNotificationController.shared
    let prior = (controller.pendingOpen, controller.pendingUsageOpen, controller.pendingResearchOpen, AssistantReplyNavigation.shared.pending)
    try await deliver([:])
    try await deliver(["clawdad": ["kind": "assistant_reply", "conversationId": "bad"]])
    try await deliver(target(nil), action: UNNotificationDismissActionIdentifier)
    try await deliver(target("assistant_reply"), action: "unsupported-action")
    XCTAssertEqual(controller.pendingOpen, prior.0)
    XCTAssertEqual(controller.pendingUsageOpen, prior.1)
    XCTAssertEqual(controller.pendingResearchOpen, prior.2)
    XCTAssertEqual(AssistantReplyNavigation.shared.pending, prior.3)
  }

  func testRepeatedCallbacksCompleteOnceEachWithoutDuplicatingReplyPlayback() async throws {
    let payload = target("assistant_reply")
    let value = try XCTUnwrap(AssistantReplyNotification.parse(payload))
    let nav = AssistantReplyNavigation.shared, prior = nav.pending
    defer { nav.finishOpening(value); if let prior { nav.receive(prior) } }
    for _ in 0..<100 { try await deliver(payload) }
    XCTAssertEqual(nav.pending, value)
    let isolated = AssistantReplyNavigation(defaults: nil)
    isolated.receive(value)
    XCTAssertTrue(isolated.beginPlayback(value))
    isolated.receive(value)
    XCTAssertFalse(isolated.beginPlayback(value))
  }
}
