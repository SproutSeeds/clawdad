import AppKit
import UserNotifications

struct MacWeeklyUsageAlert: Decodable {
  let id: String
  let threshold: Int
  let remainingPercent: Double
  let resetsAt: Double
}
private struct MacWeeklyUsageSnapshot: Decodable { let alerts: [MacWeeklyUsageAlert] }

@MainActor
final class MacUsageNotifications: NSObject, UNUserNotificationCenterDelegate {
  var onOpen: (() -> Void)?
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
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void) {
    if response.notification.request.content.userInfo["clawdadUsage"] as? Bool == true {
      Task { @MainActor [weak self] in self?.onOpen?() }
    }
    completionHandler()
  }
}
