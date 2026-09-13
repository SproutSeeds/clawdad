import Foundation
import SwiftUI
#if os(iOS)
import UIKit
import UserNotifications
#endif

struct CompletedTurnNotification: Codable, Equatable, Sendable, Identifiable {
  var id: String { eventId }
  let version: Int
  let eventId: String
  let sessionId: String
  let directory: String
  let completedAt: String
  let accountId: String
  let workspaceId: String
  let hostId: String

  static func parse(_ userInfo: [AnyHashable: Any]) -> Self? {
    guard let value = userInfo["clawdad"] as? [String: Any],
      value["kind"] == nil,
      let data = try? JSONSerialization.data(withJSONObject: value),
      let result = try? JSONDecoder().decode(Self.self, from: data), result.version == 1,
      result.eventId.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      UUID(uuidString: result.sessionId) != nil,
      !result.directory.isEmpty, result.directory.count <= 160,
      !result.directory.contains("/"), !result.directory.contains("\\"),
      result.directory.rangeOfCharacter(from: .controlCharacters) == nil,
      validTimestamp(result.completedAt),
      [result.accountId, result.workspaceId, result.hostId].allSatisfy({
        !$0.isEmpty && $0.count <= 160 && !$0.contains("\n")
      }) else { return nil }
    return result
  }

  private static func validTimestamp(_ value: String) -> Bool {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if formatter.date(from: value) != nil { return true }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value) != nil
  }

  func matches(_ computer: PairedComputerProfile) -> Bool {
    computer.accountId == accountId && computer.workspaceId == workspaceId && computer.hostId == hostId
  }
}

@MainActor
final class MobileNotificationController: ObservableObject {
  static let shared = MobileNotificationController()
  @Published private(set) var enabled: Bool
  @Published private(set) var status = "Get an alert when Assistant or a Terminal agent finishes responding."
  @Published private(set) var denied = false
  @Published var pendingOpen: CompletedTurnNotification?
  @Published var pendingUsageOpen: WeeklyUsageNotification?
  @Published var pendingResearchOpen: WeeklyUsageNotification?
  private var token: String?
  private weak var session: CloudSession?
  private var syncing = false
  private var needsSync = false
  private var allowed = false
  private var retryTask: Task<Void, Never>?
  private var pendingRemovals: [String: URLRequest] = [:]
  private var synchronizedRequests: [String: URLRequest] = [:]
  private let defaults: UserDefaults

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    enabled = defaults.bool(forKey: "clawdad.notifications.enabled")
  }

  func bind(_ session: CloudSession) {
    self.session = session
#if os(iOS)
    guard !session.isAppStorePreview else { return }
#endif
    Task { await refresh() }
  }

  func setEnabled(_ value: Bool) {
    enabled = value
    defaults.set(value, forKey: "clawdad.notifications.enabled")
    Task {
#if os(iOS)
      if value {
        do {
          _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        } catch { status = "iPhone notification permission could not be requested." }
      }
#endif
      await refresh()
    }
  }

  func receivedToken(_ data: Data) {
    // APNs owns token rotation. Keep it in memory and request it on every launch.
    token = data.map { String(format: "%02x", $0) }.joined()
    Task { await synchronize() }
  }

  func registrationFailed() {
    guard enabled else { status = "Response notifications are off."; return }
    status = "iPhone notifications could not connect yet. Reopen ClawDad to retry."
  }

  func refresh() async {
#if os(iOS)
    guard session?.isAppStorePreview != true else { return }
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    allowed = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
    denied = settings.authorizationStatus == .denied
    if enabled && allowed { UIApplication.shared.registerForRemoteNotifications() }
    await synchronize()
#endif
  }

  func forget(_ computer: PairedComputerProfile) {
    // Capture the authenticated removal before Forget Pairing erases its Keychain
    // credential. Serialize it after any registration already in flight.
    if let request = try? registrationRequest(computer, delivery: false) {
      synchronizedRequests.removeValue(forKey: computer.id)
      pendingRemovals[computer.id] = request
      Task { await synchronize() }
    }
  }

  private func registrationRequest(_ computer: PairedComputerProfile, delivery: Bool) throws -> URLRequest {
    let credential = try DeviceIdentity.shared.relayAccessToken(
      accountId: computer.accountId, workspaceId: computer.workspaceId, hostId: computer.hostId)
    var components = URLComponents(string: computer.cloudUrl)
    guard !credential.isEmpty, components?.scheme == "https" else { throw URLError(.userAuthenticationRequired) }
    components?.path = "/workspaces/\(computer.workspaceId)/notifications/device"
    components?.queryItems = [URLQueryItem(name: "accountId", value: computer.accountId),
      URLQueryItem(name: "deviceId", value: try DeviceIdentity.shared.deviceId())]
    guard let url = components?.url else { throw URLError(.badURL) }
    var request = URLRequest(url: url, timeoutInterval: 15)
    request.httpMethod = delivery ? "PUT" : "DELETE"
    request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
    if delivery, let token {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: [
        "enabled": true, "token": token,
        "environment": Bundle.main.object(forInfoDictionaryKey: "ClawDadPushEnvironment") as? String ?? "production",
        "timeZone": TimeZone.current.identifier,
        "locale": Locale.current.identifier.components(separatedBy: "@")[0].replacingOccurrences(of: "_", with: "-")
      ])
    }
    return request
  }

  private func scheduleRetry() {
    guard retryTask == nil else { return }
    retryTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(30))
      guard !Task.isCancelled, let self else { return }
      self.retryTask = nil
      await self.synchronize()
    }
  }

  private func synchronize() async {
    needsSync = true
    guard !syncing else { return }
    syncing = true
    defer { syncing = false }
    while needsSync {
      needsSync = false
      var failures = 0
      for (id, request) in pendingRemovals {
        do {
          let (_, response) = try await URLSession.shared.data(for: request)
          let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
          if [200, 401, 403].contains(statusCode) { pendingRemovals.removeValue(forKey: id) }
          else { failures += 1 }
        } catch { failures += 1 }
      }
      guard let session, !session.pairedComputers.isEmpty else {
        if failures > 0 { scheduleRetry() }
        status = "Pair this iPhone with a Mac to enable response alerts."; continue
      }
      let wantsDelivery = enabled && allowed
      if wantsDelivery && token == nil { status = "Connecting iPhone notifications…"; continue }
      var configured = true
      for computer in session.pairedComputers {
        guard session.pairedComputers.contains(where: { $0.id == computer.id }) else { continue }
        do {
          let request = try registrationRequest(computer, delivery: wantsDelivery)
          if synchronizedRequests[computer.id] == request { continue }
          let (data, response) = try await URLSession.shared.data(for: request)
          guard (response as? HTTPURLResponse)?.statusCode == 200 else { failures += 1; continue }
          let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
          if wantsDelivery && result?["configured"] as? Bool != true { configured = false }
          else { synchronizedRequests[computer.id] = request }
        } catch { failures += 1 }
      }
      if failures > 0 { scheduleRetry() }
      else { retryTask?.cancel(); retryTask = nil }
      if denied && enabled { status = "Allow notifications for ClawDad in iPhone Settings." }
      else if failures > 0 { status = "Notification settings are reconnecting…" }
      else if !enabled { status = "Response notifications are off." }
      else if !allowed { status = "Allow notifications to receive response alerts." }
      else if !configured { status = "The notification service is awaiting Apple push setup." }
      else { status = "Alerts are on for your paired Macs, even when ClawDad is closed." }
    }
  }

  func openSystemSettings() {
#if os(iOS)
    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
#endif
  }
}

#if os(iOS)
final class ClawDadPushAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    if MobileNotificationController.shared.enabled { application.registerForRemoteNotifications() }
    return true
  }
  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    MobileNotificationController.shared.receivedToken(deviceToken)
  }
  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    MobileNotificationController.shared.registrationFailed()
  }
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void) {
    let target = AssistantReplyNotification.parse(notification.request.content.userInfo)
    Task { @MainActor in
      completionHandler(target.map { AssistantReplyNavigation.shared.suppressInterruption($0) } == true
        ? [.list] : [.banner, .list, .sound])
    }
  }
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping @Sendable () -> Void) {
    handleNotificationResponse(actionIdentifier: response.actionIdentifier,
      userInfo: response.notification.request.content.userInfo, completionHandler: completionHandler)
  }
  nonisolated func handleNotificationResponse(actionIdentifier: String, userInfo: [AnyHashable: Any],
    completionHandler: @escaping @Sendable () -> Void) {
    // Parse before crossing executors; the raw notification payload stays here.
    let isOpen = actionIdentifier == UNNotificationDefaultActionIdentifier
    let target = isOpen ? AssistantReplyNotification.parse(userInfo) : nil
    let terminal = isOpen && target == nil ? CompletedTurnNotification.parse(userInfo) : nil
    let usage = isOpen && target == nil ? WeeklyUsageNotification.parse(userInfo) : nil
    MobileCrashDiagnostics.shared.event(.notificationReceived)
    Task { @MainActor in
      // The async delegate's generated Obj-C thunk completed on a cooperative
      // worker after MainActor.run returned. UIKit's snapshot update then
      // asserted. Own the callback explicitly and complete ON the main actor,
      // once, including ignored/malformed actions. Never wait for Mac or audio.
      defer {
        completionHandler()
        MobileCrashDiagnostics.shared.event(.notificationHandled)
      }
      if let target { AssistantReplyNavigation.shared.receive(target) }
      if let terminal { MobileNotificationController.shared.pendingOpen = terminal }
      if let usage {
        if usage.kind == "research" { MobileNotificationController.shared.pendingResearchOpen = usage }
        else { MobileNotificationController.shared.pendingUsageOpen = usage }
      }
    }
  }
}
#endif

struct NotificationSettingsPanel: View {
  @ObservedObject private var notifications = MobileNotificationController.shared
  var body: some View {
    ClawDadPanel {
      VStack(alignment: .leading, spacing: 12) {
        Toggle("Response and allowance notifications", isOn: Binding(get: { notifications.enabled }, set: { value in notifications.setEnabled(value) }))
          .font(.subheadline.weight(.bold))
          .tint(ClawDadTheme.gold)
        Text("Assistant replies, agent completions, and weekly Codex allowance alerts at 5% and 0%. An Assistant reply alert opens and reads that saved reply without starting the microphone.")
          .font(.caption).foregroundStyle(ClawDadTheme.peach.opacity(0.8))
        Text(notifications.status).font(.caption).foregroundStyle(ClawDadTheme.cream)
        if notifications.denied && notifications.enabled {
          Button("Open iPhone Settings", action: notifications.openSystemSettings)
            .buttonStyle(ClawDadSecondaryButtonStyle())
        }
      }
    }
  }
}
