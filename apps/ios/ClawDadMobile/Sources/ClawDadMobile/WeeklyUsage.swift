import SwiftUI

struct WeeklyUsageNotification: Codable, Equatable {
  let version: Int
  let kind: String
  let eventId: String
  let accountId: String
  let workspaceId: String
  let hostId: String
  static func parse(_ userInfo: [AnyHashable: Any]) -> Self? {
    guard let raw = userInfo["clawdad"] as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: raw),
      let value = try? JSONDecoder().decode(Self.self, from: data), value.version == 1, ["codex_weekly", "research"].contains(value.kind),
      value.eventId.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      [value.accountId, value.workspaceId, value.hostId].allSatisfy({ !$0.isEmpty && $0.count <= 160 && $0.rangeOfCharacter(from: .controlCharacters) == nil }) else { return nil }
    return value
  }
  func matches(_ computer: PairedComputerProfile) -> Bool {
    computer.accountId == accountId && computer.workspaceId == workspaceId && computer.hostId == hostId
  }
}

struct WeeklyUsageAlert: Codable, Equatable, Identifiable {
  let id: String
  let threshold: Int
  let remainingPercent: Double
  let resetsAt: Double
  let completedAt: String
  var title: String { threshold == 0 ? "Codex weekly allowance reached 0%" : "Codex weekly allowance is low" }
}

struct WeeklyUsage: Codable, Equatable {
  struct Subscription: Codable, Equatable { let method: String?; let email: String?; let plan: String?; let workspaceName: String? }
  struct ShortWindow: Codable, Equatable { let remainingPercent: Double; let resetsAt: Double; let windowDurationMins: Int }
  var status: String
  let remainingPercent: Double?
  let resetsAt: Double?
  let observedAt: String?
  let validUntil: Double?
  let message: String?
  let alerts: [WeeklyUsageAlert]
  var subscription: Subscription? = nil
  var ordinaryUsageAllowed: Bool? = nil
  var shortWindow: ShortWindow? = nil

  func isCurrent(now: Date = Date()) -> Bool {
    status == "current" && (validUntil ?? 0) > now.timeIntervalSince1970 * 1000 &&
      (resetsAt ?? 0) > now.timeIntervalSince1970 && remainingPercent.map { (0...100).contains($0) } == true
  }
  func summary(now: Date = Date()) -> String {
    guard hasPercentage else { return "Weekly allowance unavailable" }
    return "\(compactSummary)\(isCurrent(now: now) ? "" : " · Stale")"
  }
  private var hasPercentage: Bool {
    remainingPercent.map { $0.isFinite && (0...100).contains($0) } == true
  }
  var compactSummary: String {
    guard hasPercentage, let remainingPercent else { return "Weekly allowance unavailable" }
    let percent = remainingPercent.formatted(.number.precision(.fractionLength(0...2)))
    return "\(percent)% weekly remaining"
  }
  func readingExplanation(now: Date = Date()) -> String? {
    guard !isCurrent(now: now) else { return nil }
    let explanation = hasPercentage
      ? "This is the last known allowance. It is out of date, so the amount available now may be different."
      : "A current weekly allowance reading has not arrived from your Mac yet."
    if let guidance = message?.trimmingCharacters(in: .whitespacesAndNewlines), !guidance.isEmpty {
      return explanation + "\n\n" + guidance
    }
    return explanation + "\n\nConnect to your Mac and choose Check allowance to try again."
  }
  static func resetText(_ timestamp: Double, timeZone: TimeZone = .current, locale: Locale = .current) -> String {
    let format = DateFormatter()
    format.locale = locale; format.timeZone = timeZone
    format.setLocalizedDateFormatFromTemplate("EEEE MMM d yyyy h:mm a z")
    return "Resets \(format.string(from: Date(timeIntervalSince1970: timestamp)))"
  }
  static func refreshedText(_ observedAt: String?, timeZone: TimeZone = .current, locale: Locale = .current) -> String {
    guard let observedAt else { return "Last refreshed: Not yet available" }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = iso.date(from: observedAt) ?? ISO8601DateFormatter().date(from: observedAt)
    guard let date else { return "Last refreshed: Not yet available" }
    let format = DateFormatter()
    format.locale = locale; format.timeZone = timeZone
    format.setLocalizedDateFormatFromTemplate("MMM d yyyy h:mm:ss a z")
    return "Last refreshed \(format.string(from: date))"
  }
}

struct WeeklyUsageButton: View {
  var location = "main"
  var width: CGFloat? = nil
  @EnvironmentObject private var session: CloudSession
  @State private var showingUsage = false
  var body: some View {
    TimelineView(.periodic(from: .now, by: 30)) { timeline in
      HStack(spacing: 0) {
        Text(session.weeklyUsage?.compactSummary ?? "Weekly allowance unavailable")
          .font(.caption.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("clawdad.weeklyUsage.\(location).summary")
        Button { showingUsage = true; session.requestWeeklyUsage() } label: {
          Image(systemName: "info.circle").font(.system(size: 16))
            .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("clawdad.weeklyUsage.\(location)")
        .accessibilityLabel("Weekly allowance details")
        .accessibilityValue(session.weeklyUsage?.summary(now: timeline.date) ?? "Weekly allowance unavailable")
        .accessibilityHint("Preview saved accounts and allowance, or activate an account for ClawDad")
        .popover(isPresented: $showingUsage) {
          WeeklyUsageSheet().frame(idealWidth: 350, idealHeight: 550)
#if os(iOS)
            .presentationCompactAdaptation(.sheet)
            .presentationDetents([.medium, .large])
#endif
        }
        Spacer(minLength: 0)
      }
      .frame(width: width, alignment: .leading)
      .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
      .multilineTextAlignment(.leading).foregroundStyle(ClawDadTheme.cream)
    }
  }
}

struct WeeklyUsageSheet: View {
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      CodexAccountsView().navigationTitle("Weekly allowance")
#if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
#endif
        .toolbar { ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }.keyboardShortcut(.cancelAction).frame(minWidth: 44, minHeight: 44)
        } }
    }.preferredColorScheme(.dark)
  }
}

struct WeeklyUsageNotice: View {
  @EnvironmentObject private var session: CloudSession
  @State private var showing = false
  var body: some View {
    Group {
    if let notice = session.weeklyUsageNotice {
      HStack {
        Button { session.dismissWeeklyUsageNotice(); showing = true } label: {
          Label(notice.title, systemImage: "exclamationmark.triangle").font(.caption.weight(.semibold))
        }.frame(minHeight: 44)
        Spacer()
        Button { session.dismissWeeklyUsageNotice() } label: { Image(systemName: "xmark") }
          .frame(width: 44, height: 44).accessibilityLabel("Dismiss allowance alert")
      }
      .padding(.horizontal, 12).foregroundStyle(ClawDadTheme.cream).background(ClawDadTheme.background)
    }
    }.sheet(isPresented: $showing) { WeeklyUsageSheet() }
  }
}
