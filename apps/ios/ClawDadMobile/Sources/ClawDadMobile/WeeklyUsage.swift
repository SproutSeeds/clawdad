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
  var status: String
  let remainingPercent: Double?
  let resetsAt: Double?
  let observedAt: String?
  let validUntil: Double?
  let message: String?
  let alerts: [WeeklyUsageAlert]

  func isCurrent(now: Date = Date()) -> Bool {
    status == "current" && (validUntil ?? 0) > now.timeIntervalSince1970 * 1000 &&
      (resetsAt ?? 0) > now.timeIntervalSince1970 && remainingPercent.map { (0...100).contains($0) } == true
  }
  func summary(now: Date = Date()) -> String {
    guard let remainingPercent else { return "Weekly allowance unavailable" }
    let percent = remainingPercent.formatted(.number.precision(.fractionLength(0...2)))
    return "\(percent)% weekly remaining\(isCurrent(now: now) ? "" : " · Stale")"
  }
  static func resetText(_ timestamp: Double, timeZone: TimeZone = .current, locale: Locale = .current) -> String {
    let format = DateFormatter()
    format.locale = locale; format.timeZone = timeZone
    format.setLocalizedDateFormatFromTemplate("EEEE MMM d yyyy h:mm a z")
    return "Resets \(format.string(from: Date(timeIntervalSince1970: timestamp)))"
  }
  static func compactResetText(_ timestamp: Double) -> String {
    let date = Date(timeIntervalSince1970: timestamp), format = DateFormatter()
    format.locale = .current; format.timeZone = .current
    format.setLocalizedDateFormatFromTemplate("EEE MMM d yyyy")
    let day = format.string(from: date)
    format.setLocalizedDateFormatFromTemplate("h:mm a z")
    return "Resets \(day)\n\(format.string(from: date))"
  }
}

struct WeeklyUsageButton: View {
  var location = "main"
  var width: CGFloat? = nil
  @EnvironmentObject private var session: CloudSession
  @State private var showingUsage = false
  var body: some View {
    TimelineView(.periodic(from: .now, by: 30)) { timeline in
      Button { showingUsage = true; session.requestWeeklyUsage() } label: {
        VStack(alignment: .leading, spacing: 3) {
          Text(session.weeklyUsage?.summary(now: timeline.date) ?? "Weekly allowance unavailable")
            .font(.caption.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
          if let reset = session.weeklyUsage?.resetsAt {
            Text(WeeklyUsage.compactResetText(reset)).font(.caption2).fixedSize(horizontal: false, vertical: true)
          }
        }
        .frame(width: width, alignment: .leading)
        .multilineTextAlignment(.leading).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .padding(.vertical, 6).contentShape(Rectangle())
        .foregroundStyle(ClawDadTheme.cream)
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("clawdad.weeklyUsage.\(location)")
      .accessibilityHint("Opens the weekly Codex allowance and alerts")
    }
    .sheet(isPresented: $showingUsage) { WeeklyUsageSheet() }
  }
}

struct WeeklyUsageSheet: View {
  @EnvironmentObject private var session: CloudSession
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text(session.weeklyUsage?.summary() ?? "Weekly allowance unavailable").font(.headline)
          if let reset = session.weeklyUsage?.resetsAt { Text(WeeklyUsage.resetText(reset)) }
          if let value = session.weeklyUsage, !value.isCurrent() {
            Text(value.message ?? "Reconnect to your Mac to check the current allowance.")
          }
          ForEach(session.weeklyUsage?.alerts ?? []) { alert in
            Label(alert.title, systemImage: "exclamationmark.triangle").font(.subheadline)
          }
          Button("Check allowance") { session.requestWeeklyUsage() }.frame(minHeight: 44)
        }.padding()
      }
      .background(ClawDadTheme.background).foregroundStyle(ClawDadTheme.cream)
      .navigationTitle("Weekly allowance")
#if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
#endif
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
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
