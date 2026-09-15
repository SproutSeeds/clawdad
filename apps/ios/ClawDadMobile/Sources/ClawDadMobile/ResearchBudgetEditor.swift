import SwiftUI
import ClawDadRemoteAssistProtocol

struct ResearchBudgetEditor: View {
  let budget: [String: AssistantValue]
  let thread: [String: AssistantValue]?
  var inputFocused: FocusState<Bool>.Binding
  let submit: (String, [String: AssistantValue]) -> Void
  @State private var overrideText = ""
  @State private var mode = "none"
  @State private var initializedKey: String?
  @State private var confirming = false
  @State private var confirmationText = ""
  @State private var confirmedArgs: [String: AssistantValue] = [:]

  private var accountKey: String? { thread?["accountKey"]?.string ?? budget["currentAccountKey"]?.string }
  private var account: [String: AssistantValue]? {
    budget["accounts"]?.array?.compactMap(\.object).first { $0["accountKey"]?.string == accountKey }
  }
  private var usage: [String: AssistantValue] { budget["usage"]?.object ?? [:] }
  private var policy: [String: AssistantValue] { thread?["budgetPolicy"]?.object ?? [:] }
  private var editingKey: String { "\(accountKey ?? ""):\(thread?["id"]?.string ?? "")" }
  private var canChange: Bool {
    budget["available"]?.bool == true && account != nil && usage["status"]?.string == "current"
      && accountKey == budget["currentAccountKey"]?.string
      && (usage["validUntil"]?.number ?? 0) > Date().timeIntervalSince1970 * 1_000
  }

  var body: some View {
    Section("Weekly allowance") {
      if let remaining = usage["remainingPercent"]?.number {
        Text("\(remaining.formatted())% weekly remaining\(canChange ? "" : " · reading unavailable or stale")")
      } else { Text("Checking weekly allowance…") }
      Text("Project limits are optional. Pause this supervisor at a chosen percentage of the shared weekly allowance remaining. 0% allows using the remaining allowance until exhausted. Other supervisors and your manual work use the same pool. Running tasks may consume more after new work pauses.").font(.footnote)
      if let threshold = policy["threshold"]?.number {
        Text("Current: pause at \(threshold.formatted())% remaining")
          .accessibilityIdentifier("clawdad.research.budget.current")
      }
      if policy["threshold"]?.number == nil {
        Text("No project allowance limit").accessibilityIdentifier("clawdad.research.budget.current")
      }
      if let reason = policy["reason"]?.string, !reason.isEmpty { Text(reason).font(.footnote) }
      if let expiry = policy["expiresAt"]?.number {
        Text("Override ends \(Date(timeIntervalSince1970: expiry / 1_000).formatted(date: .abbreviated, time: .shortened))")
          .font(.footnote)
      }
      if thread != nil {
        Picker("This supervisor", selection: $mode) {
          Text("No project limit").tag("none")
          Text("Custom stopping percentage").tag("override")
        }.accessibilityIdentifier("clawdad.research.budget.mode")
        if mode == "override" {
          percentageInput("Pause at", text: $overrideText, id: "override")
          Text("A custom override applies to this supervisor and account through the current weekly cycle. A reset never renews it or releases its pause.").font(.footnote)
        }
        Button("Review project limit") { review(scope: "supervisor") }
          .disabled(!canChange || (mode == "override" && ResearchBudgetInput.threshold(overrideText) == nil))
          .accessibilityIdentifier("clawdad.research.budget.review-supervisor")
      } else {
        Text("Save the research setup with autonomy off to choose its custom limit before starting.").font(.footnote)
      }
      if !canChange {
        Text(budget["available"]?.bool == true ? "A current reading for this signed-in account is required to approve changes. Refresh to check again." : "Update ClawDad on your Mac to edit allowance settings.").font(.footnote)
      }
    }
    .task(id: editingKey) {
      // A Form can restart this task as rows scroll into view. Initialize once per
      // destination so scrolling and polling both preserve an unsaved choice.
      guard initializedKey != editingKey else { return }
      initializedKey = editingKey
      mode = policy["mode"]?.string == "override" ? "override" : "none"
      overrideText = policy["threshold"]?.number.map { String(Int($0)) } ?? ""
      confirming = false
    }
    .alert("Approve allowance setting?", isPresented: $confirming) {
      Button("Cancel", role: .cancel) {}
      Button("Approve") { submit("research.budget", confirmedArgs) }
    } message: { Text(confirmationText) }
  }

  private func percentageInput(_ title: String, text: Binding<String>, id: String) -> some View {
    VStack(alignment: .leading) {
      HStack {
        Text(title)
        TextField("0–100", text: text)
          .multilineTextAlignment(.trailing).frame(minWidth: 64, minHeight: 44).focused(inputFocused)
          .researchPercentageKeyboard()
          .accessibilityLabel("Supervisor percentage remaining")
          .accessibilityIdentifier("clawdad.research.budget.\(id)")
        Text("% remaining")
      }
      Stepper("Adjust percentage", value: Binding(get: { ResearchBudgetInput.threshold(text.wrappedValue) ?? 0 },
        set: { text.wrappedValue = String($0) }), in: 0...100)
        .accessibilityValue("\(text.wrappedValue)% remaining")
    }
  }
  private func review(scope: String) {
    guard canChange, let accountKey, let revision = account?["revision"] else { return }
    var args: [String: AssistantValue] = ["scope": .string(scope), "accountKey": .string(accountKey),
      "expectedBudgetRevision": revision, "confirmed": .bool(true)]
    guard let id = thread?["id"], let revision = thread?["revision"] else { return }
    args["threadId"] = id; args["expectedRevision"] = revision; args["mode"] = .string(mode)
    if mode == "override" {
      guard let threshold = ResearchBudgetInput.threshold(overrideText) else { return }
      args["threshold"] = .number(Double(threshold))
      confirmationText = "Allow this exact supervisor to run until \(threshold)% weekly allowance remains, through this weekly cycle."
    } else {
      confirmationText = "Remove this supervisor’s project allowance limit? No automatic app-wide reserve will apply."
    }
    confirmationText += " Stopped and manually paused supervisors stay stopped. Enabled work paused only by allowance may become eligible. Running tasks may consume more after the pause. This does not purchase usage."
    confirmedArgs = args; inputFocused.wrappedValue = false; confirming = true
  }
}

enum ResearchBudgetInput {
  static func threshold(_ text: String) -> Int? {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty, value.allSatisfy({ $0.isASCII && $0.isNumber }),
      let number = Int(value), (0...100).contains(number) else { return nil }
    return number
  }
}
private extension View {
  @ViewBuilder func researchPercentageKeyboard() -> some View {
    #if os(iOS)
    self.keyboardType(.numberPad)
    #else
    self
    #endif
  }
}
