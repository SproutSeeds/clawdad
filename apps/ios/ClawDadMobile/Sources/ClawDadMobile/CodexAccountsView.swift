import SwiftUI
import ClawDadRemoteAssistProtocol

struct CodexAccountsView: View {
  @EnvironmentObject private var assistant: MobileAssistantController
  @EnvironmentObject private var session: CloudSession
  @State private var state: [String: AssistantValue] = [:]
  @State private var selectedAccountId = ""
  @State private var feedbackRevision = 0
  @State private var loadingStatus = false
  @State private var preview: [String: AssistantValue]?
  @State private var email = ""
  @State private var workspace = ""
  @State private var error = ""
  @State private var statusError = ""
  @State private var busy = false
  @State private var pending: [String: AssistantValue]?
  @FocusState private var editingAccount: Bool
  private var entries: [[String: AssistantValue]] { state["accounts"]?.array?.compactMap(\.object) ?? [] }
  private var operation: [String: AssistantValue] { state["activeOperation"]?.object ?? [:] }
  private var pendingKey: String { "clawdad.codex.accounts.pending.\(session.accountId).\(session.workspaceId).\(session.hostId)" }

  private var selectionKey: String { pendingKey + ".selection" }
  private var selected: [String: AssistantValue]? { entries.first { $0["id"]?.string == selectedAccountId } }
  private var switching: Bool { operation["fenced"]?.bool == true }
  private var operationEmail: String { entries.first { $0["id"] == operation["targetId"] }?["email"]?.string ?? "selected account" }
  private var activity: String {
    switch pending?["action"]?.string {
    case "accounts.switch": return "Requesting switch…"
    case "accounts.signin": return "Opening sign-in on the Mac…"
    case "accounts.verify_signin": return "Checking saved sign-in…"
    case "accounts.cancel": return "Cancelling switch…"
    default: return "Checking account…"
    }
  }

  var body: some View {
    ScrollViewReader { scroll in
    Form {
      Section("Switch status") {
        VStack(alignment: .leading, spacing: 8) {
          if busy { ProgressView(activity).accessibilityIdentifier("clawdad.accounts.progress") }
          if let reason = operation["reason"]?.string {
            Label(switching ? "Switch to \(operationEmail)" : (operation["status"]?.string == "completed" ? "Switch complete" : "Account switch"), systemImage: switching ? "clock" : "info.circle")
              .font(.headline)
            Text(reason).accessibilityIdentifier("clawdad.accounts.switchStatus")
          } else if !busy { Text("Choose an account, then switch when ready.").font(.footnote) }
          if !statusError.isEmpty { Text(statusError).foregroundStyle(.yellow) }
          if !error.isEmpty { Text(error).foregroundStyle(.yellow).accessibilityIdentifier("clawdad.accounts.error") }
          if pending != nil && !busy {
            Text("Checking whether the Mac received your request. Retry keeps the same request ID.").font(.footnote)
            accountButton("Retry pending request") { perform() }
          }
          if switching {
            if operation["cancelRequested"]?.bool == true {
              accountButton("Continue original switch") { perform("accounts.continue", args: ["operationId": operation["id"] ?? .null, "confirmed": .bool(true)]) }.disabled(pending != nil)
            } else {
              accountButton("Cancel switch") { perform("accounts.cancel", args: ["operationId": operation["id"] ?? .null]) }.disabled(pending != nil)
            }
            accountButton("Check recovery") { perform("accounts.reconcile") }.disabled(pending != nil)
          }
        }.id("accountStatus")
        .disabled(busy)
      }

      Section("Selected account") {
        if entries.isEmpty { Text("No additional accounts saved") }
        else {
          Menu {
            ForEach(entries.indices, id: \.self) { index in
              let account=entries[index]
              Button { selectedAccountId=account["id"]?.string ?? "" } label: {
                Label((account["email"]?.string ?? "Account") + ((account["workspaceLabel"]?.string ?? "").isEmpty ? "" : " · " + (account["workspaceLabel"]?.string ?? "")), systemImage: account["id"]?.string == selectedAccountId ? "checkmark" : "person.crop.circle")
              }
            }
          } label: {
            HStack {
              VStack(alignment: .leading, spacing: 4) {
                Text("Account").font(.caption)
                Text(selected?["email"]?.string ?? "Choose account").multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
              }
              Spacer(minLength: 8)
              Image(systemName: "chevron.up.chevron.down")
            }.frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
          }.accessibilityIdentifier("clawdad.accounts.selector")
            .accessibilityLabel("Choose Codex account")
            .accessibilityValue(selected?["email"]?.string ?? "None selected")
          if let workspace = selected?["workspaceLabel"]?.string, !workspace.isEmpty { Text(workspace + " · label supplied by you").font(.footnote) }
          if let account = selected {
            let authorization = account["authorization"]?.object ?? [:]
            let signIn = authorization["operation"]?.object ?? [:]
            let connecting = ["checking", "starting", "awaiting_user", "cancelling"].contains(signIn["status"]?.string ?? "")
            let verified = account["authentication"]?.string == "verified"
            Text(verified ? "Saved subscription sign-in verified" : "First sign-in or verification required").font(.footnote)
            if let reason = signIn["reason"]?.string { Text(reason).font(.footnote).accessibilityIdentifier("clawdad.accounts.signinStatus") }
            if state["canConnectAccounts"]?.bool == true {
              accountButton(verified ? "Check saved sign-in" : "Connect account on Mac") {
                perform(verified ? "accounts.verify_signin" : "accounts.signin", args: ["accountId": account["id"] ?? .null, "confirmed": .bool(true)])
              }.disabled(connecting || switching).accessibilityIdentifier("clawdad.accounts.connect")
              if !verified {
                accountButton("Check saved sign-in") { perform("accounts.verify_signin", args: ["accountId": account["id"] ?? .null]) }.disabled(connecting || switching)
                if ["needs_check", "needs_attention"].contains(signIn["status"]?.string ?? "") {
                  accountButton("Reconnect account on Mac") {
                    perform("accounts.signin", args: ["accountId": account["id"] ?? .null, "confirmed": .bool(true), "reauthenticate": .bool(true)])
                  }.disabled(connecting || switching)
                }
              }
              if connecting {
                accountButton("Cancel sign-in") { perform("accounts.cancel_signin", args: ["operationId": signIn["requestId"] ?? .null]) }
              }
            }
            accountButton("Review affected sessions") { inspect(account) }
            Button {
              perform("accounts.switch", args: ["accountId": account["id"] ?? .null, "expectedRevision": state["revision"] ?? .number(0), "confirmed": .bool(true)])
            } label: {
              Text(switching ? "Switch in progress" : (state["capabilities"]?.object?["ready"]?.bool == true ? "Switch to this account" : "Prepare account switch"))
                .frame(maxWidth: .infinity, minHeight: 44)
            }.buttonStyle(.borderedProminent).disabled(switching || connecting)
              .accessibilityIdentifier("clawdad.accounts.switch")
          }
        }
      }.disabled(busy || pending != nil)
      Section("Current Codex login") {
        if let current = state["current"]?.object, let email = current["email"]?.string {
          Text(email).textSelection(.enabled)
          Text(current["plan"]?.string ?? "Subscription")
          if current["status"]?.string != "current" { Text("Last verified reading · refresh to check again").font(.footnote) }
        } else { Text("Verified account unavailable") }
        Text("Subscription account switching does not enable API billing.").font(.footnote)
      }
      Section("Add account") {
        TextField("Account email", text: $email).textContentType(.emailAddress)
          #if os(iOS)
          .textInputAutocapitalization(.never).keyboardType(.emailAddress)
          #endif
          .autocorrectionDisabled().focused($editingAccount).frame(minHeight: 44).accessibilityIdentifier("clawdad.accounts.email")
        TextField("Workspace label (optional)", text: $workspace).focused($editingAccount).frame(minHeight: 44).accessibilityIdentifier("clawdad.accounts.workspace")
        Text("Save your account choice here. Authentication is established only after supported sign-in is verified.").font(.footnote)
        accountButton("Save account entry") {
          perform("accounts.add", args: ["email": .string(email), "workspaceLabel": .string(workspace), "expectedRevision": state["revision"] ?? .number(0)])
        }.frame(minHeight: 44).disabled(email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || state.isEmpty)
          .accessibilityIdentifier("clawdad.accounts.add")
      }.disabled(busy || pending != nil)
      if let preview {
        Section("Affected sessions") {
          ForEach(Array((preview["observation"]?.object?["reasons"]?.array ?? []).enumerated()), id: \.offset) { _, reason in
            if let text = reason.string { Text(text).font(.footnote) }
          }
          ForEach(Array((preview["observation"]?.object?["consumers"]?.array ?? []).enumerated()), id: \.offset) { _, item in
            if let consumer = item.object {
              VStack(alignment: .leading) {
                Text(consumer["title"]?.string ?? consumer["kind"]?.string ?? "Codex process")
                Text(consumer["reason"]?.string ?? "Needs verification").font(.footnote)
              }
            }
          }
        }
      }
      Section {
        if let retained = operation["retainedReceipts"]?.array, !retained.isEmpty {
          Text("\(retained.count) earlier delivery receipts remain saved for review. Account switching will not retry those messages.").font(.footnote)
        }
        accountButton("Refresh account status") { Task { await load() } }.disabled(busy)
      }
    }
    .navigationTitle("Codex accounts")
    .accessibilityIdentifier("clawdad.accounts")
    .scrollDismissesKeyboard(.interactively)
    .onChange(of: feedbackRevision) { _, _ in scroll.scrollTo("accountStatus", anchor: .top) }
    .onChange(of: selectedAccountId) { _, value in
      UserDefaults.standard.set(value, forKey: selectionKey); preview = nil
    }
    #if os(iOS)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItemGroup(placement: .keyboard) {
        Spacer()
        Button("Done") { editingAccount = false }
          .accessibilityLabel("Done entering account")
          .accessibilityIdentifier("clawdad.accounts.keyboardDone")
      }
    }
    #endif
    .task {
      if let data = UserDefaults.standard.data(forKey: pendingKey) { pending = try? JSONDecoder().decode([String: AssistantValue].self, from: data) }
      selectedAccountId = UserDefaults.standard.string(forKey: selectionKey) ?? ""
      await load()
      while !Task.isCancelled {
        do { try await Task.sleep(for: .milliseconds(1500)) } catch { break }
        if pending != nil || operation["fenced"]?.bool == true || entries.contains(where: { ["checking", "starting", "awaiting_user", "cancelling"].contains($0["authorization"]?.object?["operation"]?.object?["status"]?.string ?? "") }) {
          await load()
        }
      }
    }
    }
  }
  private func accountButton(_ title: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
    }.buttonStyle(.borderless)
  }
  private func load() async {
    guard !busy, !loadingStatus else { return }
    loadingStatus = true
    defer { loadingStatus = false }
    do {
      let key = pendingKey
      let args: [String: AssistantValue] = pending?["requestId"].map { ["receiptId": $0] } ?? [:]
      let reply = try await assistant.settingsRequest("accounts.status", args: args)
      guard key == pendingKey, !busy else { return }
      accept(reply); statusError = ""
    }
    catch { self.statusError = error.localizedDescription }
  }
  private func accept(_ reply: [String: AssistantValue]) {
    state = reply["accounts"]?.object ?? state
    if !entries.contains(where: { $0["id"]?.string == selectedAccountId }) {
      selectedAccountId = pending?["accountId"]?.string ?? operation["targetId"]?.string
        ?? entries.first?["id"]?.string ?? ""
    }
    if let request = pending, let id = request["requestId"]?.string {
      let receivedSwitch = request["action"]?.string == "accounts.switch" &&
        (state["operations"]?.array ?? []).contains { $0.object?["id"]?.string == id && $0.object?["targetId"] == request["accountId"] }
      let receivedSignIn = ["accounts.signin", "accounts.verify_signin"].contains(request["action"]?.string ?? "") && entries.contains {
        $0["id"] == request["accountId"] && $0["authorization"]?.object?["operation"]?.object?["requestId"]?.string == id
      }
      let receipt = reply["accountReceipt"]?.object
      let receivedRequest = receipt?["requestId"]?.string == id && receipt?["accepted"]?.bool == true && receipt?["accountId"] == request["accountId"]
      if receivedSwitch || receivedSignIn || receivedRequest {
        pending = nil; UserDefaults.standard.removeObject(forKey: pendingKey); error = ""
      }
    }
  }
  private func inspect(_ account: [String: AssistantValue]) {
    guard !busy else { return }; busy = true
    Task {
      defer { busy = false }
      do { preview = try await assistant.settingsRequest("accounts.preview", args: ["accountId": account["id"] ?? .null])["accountPreview"]?.object }
      catch { self.error = error.localizedDescription }
    }
  }
  private func perform(_ action: String? = nil, args: [String: AssistantValue] = [:]) {
    guard !busy else { return }
    if pending == nil, let action {
      pending = args.merging(["action": .string(action), "requestId": .string(UUID().uuidString.lowercased())]) { _, new in new }
      if let data = try? JSONEncoder().encode(pending) { UserDefaults.standard.set(data, forKey: pendingKey) }
    }
    guard let request = pending, let action = request["action"]?.string, let id = request["requestId"]?.string else { return }
    let key = pendingKey
    busy = true; error = ""; statusError = ""; feedbackRevision += 1
    Task {
      defer { busy = false }
      do {
        let reply = try await assistant.settingsRequest(action, args: request.filter { !["action", "requestId"].contains($0.key) }, id: id)
        guard pendingKey == key else { return }
        accept(reply)
        if action == "accounts.add", let account = reply["accountReceipt"]?.object?["account"]?.object?["id"]?.string { selectedAccountId = account }
        if reply["accountReceipt"]?.object?["accepted"]?.bool == false {
          error = reply["accountReceipt"]?.object?["error"]?.string ?? "Review the account selection and try again."
        }
        pending = nil; UserDefaults.standard.removeObject(forKey: key)
      } catch { self.error = error.localizedDescription + " Your selection is retained. Retry uses the same request." }
    }
  }
}
