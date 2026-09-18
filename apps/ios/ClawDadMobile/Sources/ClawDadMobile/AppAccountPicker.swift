import SwiftUI
import ClawDadRemoteAssistProtocol

/// One Mac-owned selection. Browsing an email only previews its allowance.
struct AppAccountPicker: View {
  @EnvironmentObject private var assistant: MobileAssistantController
  @EnvironmentObject private var session: CloudSession
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @State private var state: [String: AssistantValue] = [:]
  @State private var selectedID = ""
  @State private var email = ""
  @State private var error = ""
  @State private var busy = false
  @State private var disconnected = false
  @State private var pending: [String: AssistantValue]?
  @FocusState private var editing: Bool
  private var entries: [[String: AssistantValue]] { state["accounts"]?.array?.compactMap(\.object) ?? [] }
  private var operation: [String: AssistantValue] { state["activeOperation"]?.object ?? [:] }
  private var activeID: String { state["activeAccountId"]?.string ?? "" }
  private var selected: [String: AssistantValue] { entries.first { $0["id"]?.string == selectedID } ?? [:] }
  private var reading: [String: AssistantValue] { selected["usage"]?.object ?? [:] }
  private var authorization: [String: AssistantValue] { selected["authorization"]?.object ?? [:] }
  private var switching: Bool { operation["fenced"]?.bool == true }
  private var isActive: Bool { !activeID.isEmpty && activeID == selectedID }
  private var pendingKey: String { "clawdad.app-accounts.pending.v2.\(session.accountId).\(session.workspaceId).\(session.hostId)" }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        Label(AppAccountPresentation.activeTitle(state, disconnected: disconnected), systemImage: "checkmark.shield")
          .font(.footnote).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("clawdad.accounts.active")
        accountCard
        if let reason = AppAccountPresentation.status(state) {
          Text(reason).font(.footnote).accessibilityIdentifier("clawdad.accounts.switchStatus")
        }
        if disconnected {
          Text("Reconnect to your Mac to check the active account. Your selection is preserved.").font(.footnote).foregroundStyle(.yellow).accessibilityIdentifier("clawdad.accounts.connection")
        }
        if !error.isEmpty { Text(error).font(.footnote).foregroundStyle(.yellow).accessibilityIdentifier("clawdad.accounts.error") }
        if pending != nil && !busy { Button("Retry pending request") { perform() }.frame(minHeight: 44) }
        if switching && operation["status"]?.string == "needs_attention" {
          Button("Retry activation") { perform("accounts.retry", args: ["operationId": operation["id"] ?? .null, "confirmed": .bool(true)]) }.frame(minHeight: 44)
        }
        if switching && ["preflight", "authenticate"].contains(operation["phase"]?.string ?? "") {
          Button("Cancel activation") { perform("accounts.cancel", args: ["operationId": operation["id"] ?? .null]) }.frame(minHeight: 44)
        }
        DisclosureGroup("Add account") {
          VStack(alignment: .leading) {
            TextField("Email address", text: $email).textContentType(.emailAddress).focused($editing)
#if os(iOS)
              .keyboardType(.emailAddress).textInputAutocapitalization(.never)
#endif
              .autocorrectionDisabled().frame(minHeight: 44).accessibilityIdentifier("clawdad.accounts.email")
            Button("Add and save account") { perform("accounts.add", args: ["email": .string(email), "expectedRevision": state["revision"] ?? .null]) }
              .frame(minHeight: 44).disabled(busy || email.trimmingCharacters(in: .whitespaces).isEmpty)
          }.padding(.top, 8)
        }.font(.subheadline)
        Text("Activation is shared by this Mac and its connected phones. It supplies ClawDad projects, the main Assistant and supervisor reviews. Accepted work finishes with its original account. Terminal sign-in stays independent.")
          .font(.caption).foregroundStyle(.secondary)
      }.padding(18).frame(maxWidth: 580)
    }
    .foregroundStyle(ClawDadTheme.cream)
    .background(LinearGradient(colors: [Color(white: 0.12), Color(white: 0.04)], startPoint: .topLeading, endPoint: .bottomTrailing))
    .task(id: pendingKey) {
      state = [:]; selectedID = ""; pending = nil; disconnected = false
      if let data = UserDefaults.standard.data(forKey: pendingKey) { pending = try? JSONDecoder().decode([String: AssistantValue].self, from: data) }
      await load(); await refreshSelected()
      while !Task.isCancelled { do { try await Task.sleep(for: .seconds(2)) } catch { break }; await load() }
    }
#if os(iOS)
    .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { editing = false } } }
#endif
  }
  private var accountCard: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Subscription account").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
      Menu {
        ForEach(Array(entries.enumerated()), id: \.offset) { _, account in
          if let id = account["id"]?.string, let address = account["email"]?.string {
            Button { selectedID = id; error = ""; Task { await refreshSelected() } } label: {
              if id == activeID { Label(address + " · Active", systemImage: "checkmark") } else { Text(address) }
            }
          }
        }
      } label: {
        HStack {
          Text(selected["email"]?.string ?? "Choose an account").multilineTextAlignment(.leading).font(.body.weight(.semibold))
          Spacer(minLength: 8)
          Image(systemName: "chevron.up.chevron.down").font(.caption.weight(.bold))
        }.frame(maxWidth: .infinity, minHeight: 48).contentShape(Rectangle())
      }
      .accessibilityLabel("Preview subscription account").accessibilityValue(selected["email"]?.string ?? "None selected")
      .accessibilityHint("Choosing an email previews its allowance. Activate is a separate action.")
      .accessibilityIdentifier("clawdad.accounts.selector")
      Divider()
      Text(reading["remainingPercent"]?.number.map { "\($0.formatted(.number.precision(.fractionLength(0...2))))% weekly remaining" } ?? "Weekly allowance unavailable")
        .font(.title3.weight(.semibold)).accessibilityIdentifier("clawdad.weeklyUsage.detail-summary")
      Text(reading["resetsAt"]?.number.map { WeeklyUsage.resetText($0) } ?? "Reset time unavailable")
        .font(.subheadline).accessibilityIdentifier("clawdad.weeklyUsage.reset")
      Text(WeeklyUsage.refreshedText(reading["observedAt"]?.string)).font(.caption).foregroundStyle(.secondary)
        .accessibilityIdentifier("clawdad.weeklyUsage.refreshed")
      if reading["status"]?.string != "current" {
        Text(reading["message"]?.string ?? "Refresh to read this account’s allowance. Selecting it does not activate it.")
          .font(.footnote).accessibilityIdentifier("clawdad.weeklyUsage.explanation")
      }
      if reading["ordinaryUsageAllowed"]?.bool == false {
        Text("Included usage is currently unavailable. A shorter usage window may apply even when weekly allowance remains.").font(.footnote)
      }
      Text("Workspace: \(authorization["subscription"]?.object?["workspaceName"]?.string ?? "Not exposed by Codex")").font(.caption).foregroundStyle(.secondary)
      Button { Task { await refreshSelected() } } label: { Label("Refresh allowance", systemImage: "arrow.clockwise").frame(minHeight: 44) }
        .disabled(busy || selectedID.isEmpty)
      if selected["authentication"]?.string != "verified", !selectedID.isEmpty {
        Button("Sign in on Mac") { perform("accounts.signin", args: ["accountId": .string(selectedID), "confirmed": .bool(true)]) }.frame(minHeight: 44).disabled(busy || switching)
      }
      if let signIn = authorization["operation"]?.object, ["starting", "awaiting_user", "checking"].contains(signIn["status"]?.string ?? "") {
        Text(signIn["reason"]?.string ?? "Checking saved sign-in. Complete any sign-in prompt on your Mac.").font(.footnote)
        Button("Cancel sign-in") { perform("accounts.cancel_signin", args: ["operationId": signIn["requestId"] ?? .null]) }.frame(minHeight: 44)
      }
      Button { perform("accounts.activate", args: ["accountId": .string(selectedID), "expectedRevision": state["revision"] ?? .null, "confirmed": .bool(true)]) } label: {
        HStack {
          if busy || switching && operation["status"]?.string != "needs_attention" { ProgressView().tint(ClawDadTheme.cream) } else if isActive { Image(systemName: "checkmark.circle.fill") }
          Text(AppAccountPresentation.activationTitle(operation, isActive: isActive)).fontWeight(.semibold)
        }.frame(maxWidth: .infinity, minHeight: 48).contentShape(Rectangle())
      }.buttonStyle(.plain)
        .background(LinearGradient(colors: [.white.opacity(0.19), .white.opacity(0.06)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.white.opacity(0.25), lineWidth: 1))
        .disabled(busy || disconnected || switching || pending != nil || isActive || state["capabilities"]?.object?["appOnly"]?.bool != true || selected["authentication"]?.string != "verified")
        .accessibilityIdentifier("clawdad.accounts.activate")
        .accessibilityHint("Uses this subscription for subsequent ClawDad work on this Mac. Terminal stays independent.")
    }.padding(18)
      .background(reduceTransparency ? AnyShapeStyle(Color(white: 0.13)) : AnyShapeStyle(.ultraThinMaterial), in: RoundedRectangle(cornerRadius: 24))
      .overlay(RoundedRectangle(cornerRadius: 24).stroke(.white.opacity(0.18), lineWidth: 1))
  }
  private func accept(_ reply: [String: AssistantValue]) {
    let previous = activeID
    disconnected = false
    if let value = reply["accounts"]?.object { state = value }
    if selectedID.isEmpty || !entries.contains(where: { $0["id"]?.string == selectedID }) { selectedID = activeID.isEmpty ? state["selectedAccountId"]?.string ?? entries.first?["id"]?.string ?? "" : activeID }
    if previous != activeID { session.requestWeeklyUsage() }
    if let saved = pending, let id = saved["requestId"]?.string {
      let signInReceived = entries.contains { $0["authorization"]?.object?["operation"]?.object?["requestId"]?.string == id }
      if reply["accountReceipt"]?.object?["requestId"]?.string == id || reply["accountOperation"]?.object?["id"]?.string == id || signInReceived || CodexAccountRequestRecovery.acknowledged(saved, reply: reply) {
        pending = nil; error = ""; UserDefaults.standard.removeObject(forKey: pendingKey)
      }
    }
    if let message = reply["accountReceipt"]?.object?["error"]?.string { error = message }
  }
  private func load() async {
    let scope = pendingKey
    do {
      let args: [String: AssistantValue] = pending?["requestId"].map { ["receiptId": $0] } ?? [:]
      let reply = try await assistant.settingsRequest("accounts.status", args: args)
      if scope == pendingKey { accept(reply) }
    } catch { if scope == pendingKey { disconnected = true } }
  }
  private func refreshSelected() async {
    guard !selectedID.isEmpty, !busy else { return }; let scope = pendingKey
    do {
      let reply = try await assistant.settingsRequest("accounts.refresh", args: ["accountId": .string(selectedID), "requestId": .string(UUID().uuidString.lowercased())])
      if scope == pendingKey { accept(reply) }
    } catch { self.error = "Couldn’t refresh this saved sign-in. Its last reading is preserved." }
  }
  private func perform(_ action: String? = nil, args: [String: AssistantValue] = [:]) {
    guard !busy else { return }
    if let action {
      guard pending == nil else { return }
      var request = args; request["action"] = .string(action); request["requestId"] = .string(UUID().uuidString.lowercased()); pending = request
      if let data = try? JSONEncoder().encode(request) { UserDefaults.standard.set(data, forKey: pendingKey) }
    }
    guard let request = pending, let action = request["action"]?.string else { return }
    busy = true; error = ""; editing = false; let scope = pendingKey
    Task {
      defer { busy = false }
      do {
        var args = request; args.removeValue(forKey: "action")
        let reply = try await assistant.settingsRequest(action, args: args, id: request["requestId"]?.string ?? "")
        if scope == pendingKey { accept(reply); await load() }
      } catch { if scope == pendingKey { self.error = "The Mac’s reply hasn’t arrived. Retry keeps the same request ID." } }
    }
  }
}
