import AppKit
import UserNotifications

struct MacWeeklyUsageAlert: Decodable {
  let id: String
  let threshold: Int
  let remainingPercent: Double
  let resetsAt: Double
}
private struct MacWeeklyUsageSnapshot: Decodable { let alerts: [MacWeeklyUsageAlert] }
private struct MacResearchNotice: Decodable { let id: String; let event: String; let name: String?; let completedAt: String }
private struct MacResearchNotices: Decodable { let events: [MacResearchNotice] }

@MainActor
final class MacUsageNotifications: NSObject, UNUserNotificationCenterDelegate {
  var onOpen: (() -> Void)?
  var onOpenResearch: (() -> Void)?
  private var loop: Task<Void, Never>?
  private let defaults: UserDefaults
  init(defaults: UserDefaults = .standard) { self.defaults = defaults }
  func installDelegate() { UNUserNotificationCenter.current().delegate = self }
  func start(runtime: MacAssistantRuntime) {
    stop()
    installDelegate()
    loop = Task { [weak self] in
      while !Task.isCancelled {
        if let data = try? await runtime.request("/v1/codex/weekly-usage"),
           let snapshot = try? JSONDecoder().decode(MacWeeklyUsageSnapshot.self, from: data) {
          await self?.deliver(snapshot.alerts)
        }
        if let data = try? await runtime.request("/v1/assistant/research/notifications"),
          let snapshot = try? JSONDecoder().decode(MacResearchNotices.self, from: data) {
          await self?.deliverResearch(snapshot.events)
        }
        try? await Task.sleep(for: .seconds(30))
      }
    }
  }
  func stop() { loop?.cancel(); loop = nil }
  func requestPermission() async -> Bool {
    (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
  }
  private func deliver(_ alerts: [MacWeeklyUsageAlert]) async {
    let center = UNUserNotificationCenter.current()
    let permission = await center.notificationSettings().authorizationStatus
    var seen = defaults.stringArray(forKey: "clawdad.usage.notified") ?? []
    let pending = alerts.filter { !seen.contains($0.id) }
    for alert in pending {
      // Reserve before delivery: a process restart cannot resubmit an uncertain
      // notification. Disabled permission never causes a later backlog of alerts.
      seen.append(alert.id); defaults.set(seen, forKey: "clawdad.usage.notified")
      if alert.threshold == 5 && pending.contains(where: { $0.threshold == 0 }) { continue }
      guard permission == .authorized || permission == .provisional else { continue }
      let content = UNMutableNotificationContent()
      content.title = alert.threshold == 0 ? "Codex weekly allowance reached 0%" : "Codex weekly allowance is low"
      let date = DateFormatter(); date.locale = .current; date.timeZone = .current
      date.setLocalizedDateFormatFromTemplate("EEEE MMM d yyyy h:mm a z")
      content.body = "\(alert.remainingPercent.formatted())% remaining · Resets \(date.string(from: Date(timeIntervalSince1970: alert.resetsAt)))"
      content.sound = .default; content.userInfo = ["clawdadUsage": true]
      try? await center.add(UNNotificationRequest(identifier: alert.id, content: content, trigger: nil))
    }
  }
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list, .sound])
  }
  private func deliverResearch(_ events: [MacResearchNotice]) async {
    let center = UNUserNotificationCenter.current()
    let permission = await center.notificationSettings().authorizationStatus
    var seen = defaults.stringArray(forKey: "clawdad.research.notified") ?? []
    for event in events where !seen.contains(event.id) {
      seen.append(event.id); defaults.set(seen, forKey: "clawdad.research.notified")
      guard permission == .authorized || permission == .provisional,
        let at = ISO8601DateFormatter().date(from: event.completedAt.replacingOccurrences(of: #"\.\d+Z$"#, with: "Z", options: .regularExpression)),
        Date().timeIntervalSince(at) < 86400 else { continue }
      let content = UNMutableNotificationContent()
      content.title = event.event == "budget" ? "Autonomy paused · allowance reserve"
        : "\(event.name ?? "Research") · \(event.event == "complete" ? "Objective verified complete" : event.event == "milestone" ? "Research milestone" : "Autonomy paused")"
      content.body = event.event == "budget" ? "New automatic work is paused. Running tasks may use more allowance. Review a bounded override in Research autonomy." : "Open Research autonomy to review the evidence and decision."
      content.sound = .default; content.userInfo = ["clawdadResearch": true]
      try? await center.add(UNNotificationRequest(identifier: event.id, content: content, trigger: nil))
    }
  }
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void) {
    if response.notification.request.content.userInfo["clawdadUsage"] as? Bool == true {
      Task { @MainActor [weak self] in self?.onOpen?() }
    }
    if response.notification.request.content.userInfo["clawdadResearch"] as? Bool == true {
      Task { @MainActor [weak self] in self?.onOpenResearch?() }
    }
    completionHandler()
  }
}
