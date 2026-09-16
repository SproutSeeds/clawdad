import SwiftUI
import ClawDadRemoteAssistProtocol

struct CodexAccountsView: View {
  @EnvironmentObject private var assistant: MobileAssistantController
  @EnvironmentObject private var session: CloudSession
  @State private var state: [String: AssistantValue] = [:]
  @State private var preview: [String: AssistantValue]?
  @State private var email = ""
  @State private var workspace = ""
  @State private var error = ""
  @State private var busy = false
  @State private var pending: [String: AssistantValue]?
  @FocusState private var editingAccount: Bool
  private var entries: [[String: AssistantValue]] { state["accounts"]?.array?.compactMap(\.object) ?? [] }
  private var operation: [String: AssistantValue] { state["activeOperation"]?.object ?? [:] }
  private var pendingKey: String { "clawdad.codex.accounts.pending.\(session.accountId).\(session.workspaceId).\(session.hostId)" }

  var body: some View {
    Form {
      Section("Current Codex login") {
        if let current = state["current"]?.object, let email = current["email"]?.string {
          Text(email).textSelection(.enabled)
          Text(current["plan"]?.string ?? "Subscription")
          if current["status"]?.string != "current" { Text("Last verified reading · refresh to check again").font(.footnote) }
        } else { Text("Verified account unavailable") }
        Text("Subscription account switching does not enable API billing.").font(.footnote)
      }
      Section("Saved accounts") {
        ForEach(entries.indices, id: \.self) { index in
          let account = entries[index]
          VStack(alignment: .leading, spacing: 8) {
            Text(account["email"]?.string ?? "Account").font(.headline)
            if let workspace = account["workspaceLabel"]?.string, !workspace.isEmpty {
              Text("\(workspace) · label supplied by you").font(.footnote)
            }
            let authorization = account["authorization"]?.object ?? [:]
            let signIn = authorization["operation"]?.object ?? [:]
            let connecting = ["checking", "starting", "awaiting_user", "cancelling"].contains(signIn["status"]?.string ?? "")
            let verified = account["authentication"]?.string == "verified"
            Text(verified ? "Saved subscription sign-in verified" : "First sign-in or verification required").font(.footnote)
            if let reason = signIn["reason"]?.string { Text(reason).font(.footnote).accessibilityIdentifier("clawdad.accounts.signinStatus") }
            if state["canConnectAccounts"]?.bool == true {
              accountButton(verified ? "Check saved sign-in" : "Connect account on Mac") {
                perform(verified ? "accounts.verify_signin" : "accounts.signin", args: ["accountId": account["id"] ?? .null, "confirmed": .bool(true)])
              }.disabled(connecting).accessibilityIdentifier("clawdad.accounts.connect")
              if !verified {
                accountButton("Check saved sign-in") { perform("accounts.verify_signin", args: ["accountId": account["id"] ?? .null]) }.disabled(connecting)
                if ["needs_check", "needs_attention"].contains(signIn["status"]?.string ?? "") {
                  accountButton("Reconnect account on Mac") {
                    perform("accounts.signin", args: ["accountId": account["id"] ?? .null, "confirmed": .bool(true), "reauthenticate": .bool(true)])
                  }.disabled(connecting)
                }
              }
              if connecting {
                accountButton("Cancel sign-in") { perform("accounts.cancel_signin", args: ["operationId": signIn["requestId"] ?? .null]) }
              }
            }
            accountButton("Review affected sessions") { inspect(account) }.frame(minHeight: 44)
            accountButton(state["capabilities"]?.object?["ready"]?.bool == true ? "Switch to this account" : "Prepare account switch") {
              perform("accounts.switch", args: ["accountId": account["id"] ?? .null, "expectedRevision": state["revision"] ?? .number(0), "confirmed": .bool(true)])
            }.frame(minHeight: 44)
          }
        }
        if entries.isEmpty { Text("No additional accounts saved") }
      }.disabled(busy || pending != nil)
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
      Section("Switch status") {
        if let reason = operation["reason"]?.string { Text(reason) }
        else {
          ForEach(Array((state["capabilities"]?.object?["reasons"]?.array ?? []).enumerated()), id: \.offset) { _, reason in
            Text(reason.object?["message"]?.string ?? "Account setup needs verification").font(.footnote)
          }
        }
        if operation["fenced"]?.bool == true {
          accountButton("Cancel switch") { perform("accounts.cancel", args: ["operationId": operation["id"] ?? .null]) }.frame(minHeight: 44)
          accountButton("Check recovery") { perform("accounts.reconcile") }.frame(minHeight: 44)
        }
        if busy { ProgressView("Checking account…") }
        if !error.isEmpty { Text(error).foregroundStyle(.yellow).accessibilityIdentifier("clawdad.accounts.error") }
        if pending != nil { accountButton("Retry pending request") { perform() }.frame(minHeight: 44) }
        accountButton("Refresh account status") { Task { await load() } }.frame(minHeight: 44)
      }.disabled(busy)
    }
    .navigationTitle("Codex accounts")
    .accessibilityIdentifier("clawdad.accounts")
    .scrollDismissesKeyboard(.interactively)
    #if os(iOS)
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
      await load()
      while !Task.isCancelled {
        do { try await Task.sleep(for: .milliseconds(1500)) } catch { break }
        if entries.contains(where: { ["checking", "starting", "awaiting_user", "cancelling"].contains($0["authorization"]?.object?["operation"]?.object?["status"]?.string ?? "") }) {
          await load()
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
    guard !busy else { return }
    do { state = try await assistant.settingsRequest("accounts.status")["accounts"]?.object ?? [:]; error = "" }
    catch { self.error = error.localizedDescription }
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
    busy = true; error = ""
    Task {
      defer { busy = false }
      do {
        let reply = try await assistant.settingsRequest(action, args: request.filter { !["action", "requestId"].contains($0.key) }, id: id)
        guard pendingKey == key else { return }
        state = reply["accounts"]?.object ?? state
        if reply["accountReceipt"]?.object?["accepted"]?.bool == false {
          error = reply["accountReceipt"]?.object?["error"]?.string ?? "Review the account selection and try again."
        }
        pending = nil; UserDefaults.standard.removeObject(forKey: key)
      } catch { self.error = error.localizedDescription + " Your selection is retained. Retry uses the same request." }
    }
  }
}
