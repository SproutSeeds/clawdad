import SwiftUI
import ClawDadRemoteAssistProtocol

struct ResearchSupervisorView: View {
  @ObservedObject var controller: MobileAssistantController
  let tabId: String
  @Environment(\.dismiss) private var dismiss
  @State private var research: [String: AssistantValue] = [:]
  @State private var target: [String: AssistantValue] = [:]
  @State private var objective = ""
  @State private var scope = ""
  @State private var requirements = ""
  @State private var evidenceRoot = ""
  @State private var evidencePaths = ""
  @State private var steering = ""
  @State private var error = ""
  @State private var busy = false
  @State private var confirmingEnable = false
  @State private var loadedConfiguration: String?
  @State private var pending: (action: String, args: [String: AssistantValue], id: String)?
  @State private var history: [AssistantValue] = []
  @State private var nextCursor: Double?
  @State private var historyOpened = false
  @FocusState private var entryFocused: Bool

  private var thread: [String: AssistantValue]? {
    research["threads"]?.array?.compactMap(\.object).first {
      target.isEmpty ? $0["tabId"]?.string == tabId :
        ($0["sessionId"] == target["sessionId"] && $0["agentInstanceId"] == target["agentInstanceId"])
    }
  }
  private var enabled: Bool { thread?["enabled"]?.bool == true }
  private var lines: (String) -> [AssistantValue] { { $0.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map(AssistantValue.string) } }

  var body: some View {
    NavigationStack {
      Form {
        summarySection
        authorizationSection
        ResearchBudgetEditor(budget: research["budget"]?.object ?? [:], thread: thread, inputFocused: $entryFocused) { action, args in send(action, args) }
        activitySection
        if !error.isEmpty {
          Section { Text(error).foregroundStyle(ClawDadTheme.gold)
            if pending != nil { Button("Retry this control") { retry() } }
          }
        }
      }
      .disabled(busy)
      .navigationTitle("Research autonomy")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(false) }
        ToolbarItem(placement: .primaryAction) { Button("Refresh", systemImage: "arrow.clockwise") { Task { await refresh() } } }
        ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done typing") { entryFocused = false } }
      }
      .task {
        await refresh()
        do {
          target = try await controller.researchRequest("research.target", args: ["tabId": .string(tabId)])["researchTarget"]?.object ?? [:]
          if evidenceRoot.isEmpty { evidenceRoot = target["directory"]?.string ?? "" }
        } catch { self.error = error.localizedDescription }
        while !Task.isCancelled { try? await Task.sleep(for: .seconds(5)); if !Task.isCancelled { await refresh() } }
      }
      .alert("Enable autonomy for this exact thread?", isPresented: $confirmingEnable) {
        Button("Cancel", role: .cancel) {}
        Button("Enable") { send("research.enable", ["confirmed": .bool(true), "tabId": .string(tabId),
          "sessionId": target["sessionId"] ?? .null, "agentInstanceId": target["agentInstanceId"] ?? .null,
          "objective": .string(objective), "scope": .string(scope), "requirements": .array(lines(requirements)),
          "evidenceRoot": .string(evidenceRoot), "evidencePaths": .array(lines(evidencePaths))]) }
      } message: { Text("The supervisor may review the latest completed response and send continuations only within the objective and scope you entered. Its approved weekly stopping percentage remains in force. You can save the setup off first to choose a custom limit.") }

    }.tint(ClawDadTheme.gold).preferredColorScheme(.dark)
  }
  @ViewBuilder private var summarySection: some View {
        Section {
          Text(target["tabTitle"]?.string ?? thread?["name"]?.string ?? "Selected Terminal agent").font(.headline)
          Text((thread?["status"]?.string ?? "off").replacingOccurrences(of: "_", with: " ").capitalized)
            .accessibilityIdentifier("clawdad.research.status")
          if let reason = thread?["reason"]?.string, !reason.isEmpty { Text(reason).font(.footnote) }
          if let session = target["sessionId"]?.string ?? thread?["sessionId"]?.string {
            Text("Thread \(session.suffix(8))").font(.caption).foregroundStyle(.secondary)
          }
          Text("Autonomy reviews this agent’s completed work and sends bounded continuations within your approved objective. Your conversation stays available. Turning it off leaves running Terminal work intact.").font(.footnote)
        }
  }
  @ViewBuilder private var authorizationSection: some View {
        if enabled, let thread {
          Section("Approved objective") {
            Text(thread["objective"]?.string ?? "")
            DisclosureGroup("Scope and verification") {
              Text(thread["scope"]?.string ?? "")
              ForEach(thread["requirements"]?.array?.compactMap(\.string) ?? [], id: \.self) { Text($0) }
              Text(thread["evidenceRoot"]?.string ?? "").font(.caption)
            }
            Button("Pause automatic work") { send("research.pause", threadArgs) }
              .accessibilityIdentifier("clawdad.research.pause")
            Button("Resume approved objective") { send("research.resume", threadArgs.merging(["confirmed": .bool(true)], uniquingKeysWith: { _, b in b })) }
              .accessibilityIdentifier("clawdad.research.resume")
            Button("Turn autonomy off", role: .destructive) { send("research.off", threadArgs) }
              .accessibilityIdentifier("clawdad.research.off")
          }
          Section("Steer the next review") {
            TextField("Direction within the approved scope", text: $steering, axis: .vertical).lineLimit(2...6).focused($entryFocused)
            Button("Apply steering") {
              send("research.steer", threadArgs.merging(["text": .string(steering), "confirmed": .bool(true)], uniquingKeysWith: { _, b in b }))
            }.disabled(steering.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        } else {
          Section("Enable for this thread") {
            TextField("Objective", text: $objective, axis: .vertical).lineLimit(2...6).focused($entryFocused).accessibilityIdentifier("clawdad.research.objective")
            TextField("Allowed scope", text: $scope, axis: .vertical).lineLimit(2...6).focused($entryFocused).accessibilityIdentifier("clawdad.research.scope")
            TextField("Verification requirements, one per line", text: $requirements, axis: .vertical).lineLimit(2...8)
              .focused($entryFocused)
              .accessibilityIdentifier("clawdad.research.requirements")
            TextField("Evidence directory on your Mac", text: $evidenceRoot, axis: .vertical).researchPathInput()
              .focused($entryFocused)
              .accessibilityIdentifier("clawdad.research.directory")
            TextField("Reports or checkpoints, one path per line", text: $evidencePaths, axis: .vertical).lineLimit(1...5).researchPathInput().focused($entryFocused)
            Text("Evidence links are read only inside this directory. Missing evidence stays unverified. Broader scope, external messages, spending and subscription changes require your separate authorization.").font(.footnote)
            Button("Save setup with autonomy off") {
              entryFocused = false
              send("research.configure", ["confirmed": .bool(true), "tabId": .string(tabId),
                "sessionId": target["sessionId"] ?? .null, "agentInstanceId": target["agentInstanceId"] ?? .null,
                "objective": .string(objective), "scope": .string(scope), "requirements": .array(lines(requirements)),
                "evidenceRoot": .string(evidenceRoot), "evidencePaths": .array(lines(evidencePaths)), "start": .bool(false)])
            }.disabled(target["sessionId"]?.string == nil || [objective, scope, requirements, evidenceRoot].contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
              .accessibilityIdentifier("clawdad.research.save")
            Button("Enable research autonomy") { entryFocused = false; confirmingEnable = true }
              .disabled(target["sessionId"]?.string == nil || [objective, scope, requirements, evidenceRoot].contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
              .accessibilityIdentifier("clawdad.research.enable")
          }
        }
  }
  @ViewBuilder private var activitySection: some View {
        if let thread {
          Section("Activity") {
            ForEach(thread["activity"]?.array ?? [], id: \.objectID) { event in
              VStack(alignment: .leading) {
                Text(event.object?["text"]?.string ?? "")
                Text(event.object?["at"]?.string ?? "").font(.caption).foregroundStyle(.secondary)
              }
            }
            DisclosureGroup("Decision history", isExpanded: $historyOpened) {
              ForEach(history, id: \.objectID) { value in
                if let item = value.object {
                  DisclosureGroup(item["text"]?.string ?? item["kind"]?.string ?? "Activity") {
                    AssistantSelectableText(text: historyText(item), id: "research.\(value.objectID)")
                  }
                }
              }
              if nextCursor != nil { Button("Earlier / more decisions") { loadHistory(reset: false) } }
            }.onChange(of: historyOpened) { _, open in if open { loadHistory(reset: true) } }
              .accessibilityIdentifier("clawdad.research.history")
          }
        }
  }
  private var threadArgs: [String: AssistantValue] { ["threadId": thread?["id"] ?? .null] }
  private func refresh() async {
    do {
      research = try await controller.researchRequest("research.status")["research"]?.object ?? [:]
      if let thread, let id = thread["id"]?.string, loadedConfiguration != id {
        loadedConfiguration = id
        if objective.isEmpty { objective = thread["objective"]?.string ?? "" }
        if scope.isEmpty { scope = thread["scope"]?.string ?? "" }
        if requirements.isEmpty { requirements = thread["requirements"]?.array?.compactMap(\.string).joined(separator: "\n") ?? "" }
        if evidenceRoot.isEmpty { evidenceRoot = thread["evidenceRoot"]?.string ?? "" }
        if evidencePaths.isEmpty { evidencePaths = thread["evidencePaths"]?.array?.compactMap(\.string).joined(separator: "\n") ?? "" }
      }
    }
    catch { self.error = error.localizedDescription }
  }
  private func send(_ action: String, _ args: [String: AssistantValue]) {
    var args = args
    if ["research.enable", "research.configure"].contains(action), let thread {
      args["threadId"] = thread["id"]; args["expectedRevision"] = thread["revision"]
    }
    pending = (action, args, UUID().uuidString.lowercased()); retry()
  }
  private func retry() {
    guard let pending, !busy else { return }
    busy = true
    Task {
      defer { busy = false }
      do {
        let response = try await controller.researchRequest(pending.action, args: pending.args, id: pending.id)
        research = response["research"]?.object ?? research
        if pending.action == "research.steer" { steering = "" }
        self.pending = nil; error = ""
      } catch { self.error = error.localizedDescription }
    }
  }
  private func loadHistory(reset: Bool) {
    guard let id = thread?["id"]?.string else { return }
    Task {
      do {
        let response = try await controller.researchRequest("research.history", args: ["threadId": .string(id), "cursor": .number(reset ? 0 : nextCursor ?? 0)])["researchHistory"]?.object
        let entries = response?["entries"]?.array ?? []
        history = reset ? entries : history + entries
        nextCursor = response?["nextCursor"]?.number
      } catch { self.error = error.localizedDescription }
    }
  }
  private func historyText(_ item: [String: AssistantValue]) -> String {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return (try? String(data: encoder.encode(item), encoding: .utf8)) ?? ""
  }
}

private extension AssistantValue {
  var objectID: String { object?["id"]?.string ?? "unknown" }
}
private extension View {
  @ViewBuilder func researchPathInput() -> some View {
    #if os(iOS)
    self.textInputAutocapitalization(.never).autocorrectionDisabled()
    #else
    self.autocorrectionDisabled()
    #endif
  }
}

struct ResearchActivityNotice: View {
  let research: [String: AssistantValue]?
  var open: () -> Void
  @AppStorage("clawdad.research.notice.seen") private var seen = ""
  private var events: [[String: AssistantValue]] { research?["events"]?.array?.compactMap(\.object) ?? [] }
  var body: some View {
    if let event = events.last, let id = event["id"]?.string, !seen.split(separator: ",").contains(Substring(id)) {
      HStack {
        Button { acknowledge(); open() } label: {
          Label(event["event"]?.string == "budget" ? "Autonomy paused · allowance reserve" : event["text"]?.string ?? "Research activity", systemImage: "flask")
            .font(.caption).lineLimit(2).frame(minHeight: 44)
        }
        Spacer()
        Button { acknowledge() } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
          .accessibilityLabel("Dismiss research notice")
      }.padding(.horizontal)
    }
  }
  private func acknowledge() { seen = events.compactMap { $0["id"]?.string }.suffix(500).joined(separator: ",") }
}
