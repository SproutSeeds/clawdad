import SwiftUI
import ClawDadRemoteAssistProtocol

struct AssistantModelChoice: Codable, Equatable {
  var model: String
  var reasoningEffort: String
  var available: Bool?
  var error: String?
}

struct AssistantAvailableModel: Codable, Identifiable, Equatable {
  var id: String
  var model: String
  var displayName: String
  var defaultReasoningEffort: String
  var supportedReasoningEfforts: [String]
}

struct AssistantSupervisorModel: Codable, Identifiable {
  var id: String
  var name: String
  var project: String?
  var sessionId: String
  var status: String
  var inherited: Bool
  var selection: AssistantModelChoice
}

struct AssistantModelConfiguration: Codable {
  var revision: Int
  var main: AssistantModelChoice
  var researchDefault: AssistantModelChoice
  var models: [AssistantAvailableModel]
  var supervisors: [AssistantSupervisorModel]
  var catalogError: String?
}

struct AssistantModelSettingsPanel: View {
  @ObservedObject var controller: MobileAssistantController
  @State private var configuration: AssistantModelConfiguration?
  @State private var error = ""
  @State private var loading = false
  var body: some View {
    ClawDadPanel {
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          Text("Assistant").font(.headline).foregroundStyle(ClawDadTheme.gold)
          Spacer()
          AssistantSettingsInfo()
        }
        NavigationLink("Agent access and pending questions") { AgentAccessSettingsView(controller: controller) }
          .frame(minHeight: 44).accessibilityIdentifier("clawdad.settings.agent-access")
        if let configuration {
          editor("Main Assistant", scope: "main", choice: configuration.main, configuration: configuration)
          Divider()
          Text("Research Supervisors").font(.subheadline.bold())
          editor("Defaults", scope: "researchDefault", choice: configuration.researchDefault, configuration: configuration)
          ForEach(configuration.supervisors) { supervisor in
            VStack(alignment: .leading, spacing: 4) {
              Text(supervisor.name).font(.subheadline.bold())
              Text([supervisor.project.map { URL(fileURLWithPath: $0).lastPathComponent }, String(supervisor.sessionId.prefix(8))].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary)
              Text(supervisor.inherited ? "Uses defaults" : "Individual override").font(.caption)
              editor(supervisor.name, scope: "supervisor", thread: supervisor.id, choice: supervisor.selection,
                inherited: supervisor.inherited, configuration: configuration)
            }
          }
          if configuration.supervisors.isEmpty { Text("No configured research supervisors.").font(.caption).foregroundStyle(.secondary) }
          if let message = configuration.catalogError { Text(message).font(.caption).foregroundStyle(ClawDadTheme.gold) }
        } else if loading { ProgressView("Loading Assistant settings…") }
        if !error.isEmpty { Text(error).font(.caption).foregroundStyle(ClawDadTheme.gold).accessibilityIdentifier("clawdad.settings.assistant.error") }
        Button("Refresh models", systemImage: "arrow.clockwise") { Task { await refresh() } }
          .frame(minHeight: 44).disabled(loading).accessibilityIdentifier("clawdad.settings.assistant.refresh")
      }
    }.task(id: controller.settingsScope) { configuration = nil; await refresh() }
  }
  private func editor(_ title: String, scope: String, thread: String? = nil, choice: AssistantModelChoice,
    inherited: Bool = false, configuration: AssistantModelConfiguration) -> some View {
    NavigationLink {
      AssistantModelEditor(title: title, scope: scope, threadId: thread, inherited: inherited,
        configuration: configuration, initial: choice, controller: controller) { updated in self.configuration = updated }
    } label: {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          if scope != "supervisor" { Text(title).font(.subheadline.bold()) }
          Text("\(choice.model) · \(choice.reasoningEffort.capitalized)").font(.caption).fixedSize(horizontal: false, vertical: true)
          if choice.available == false { Text("Selection needs attention").font(.caption).foregroundStyle(ClawDadTheme.gold) }
        }
        Spacer()
        Image(systemName: "chevron.right").accessibilityHidden(true)
      }.frame(minHeight: 48).contentShape(Rectangle())
    }.buttonStyle(.plain).accessibilityIdentifier("clawdad.settings.assistant.\(thread ?? scope)")
  }
  private func refresh() async {
    guard !loading else { return }; loading = true; defer { loading = false }
    do {
      let reply = try await controller.settingsRequest("settings.read")
      guard let settings = reply["settings"] else { throw AssistantProtocolError.invalid }
      configuration = try JSONDecoder().decode(AssistantModelConfiguration.self, from: JSONEncoder().encode(settings))
      error = ""
    } catch { self.error = error.localizedDescription }
  }
}

private struct AgentAccessPolicy: Codable, Equatable {
  var mode: String
  var reviewer: String
  var nativeTools: Bool
  var computerUse: Bool
}
private struct AgentAccessConfiguration: Codable {
  var revision: Int
  var policy: AgentAccessPolicy
}
private struct AgentPendingDecision: Codable, Identifiable {
  var id: String
  var method: String
  var params: [String: AssistantValue]
}

private struct AgentAccessSettingsView: View {
  @ObservedObject var controller: MobileAssistantController
  @Environment(\.dismiss) private var dismiss
  @State private var configuration: AgentAccessConfiguration?
  @State private var policy = AgentAccessPolicy(mode: "full", reviewer: "auto_review", nativeTools: true, computerUse: true)
  @State private var decisions: [AgentPendingDecision] = []
  @State private var busy = false
  @State private var status = ""
  @State private var pending: (id: String, args: [String: AssistantValue])?
  var body: some View {
    Form {
      Section("This computer") {
        Picker("Files and commands", selection: $policy.mode) {
          Text("Full computer access").tag("full")
          Text("Project folders").tag("workspace")
          Text("Read only").tag("read-only")
        }
        Picker("Additional permissions", selection: $policy.reviewer) {
          Text("Automatic safety review").tag("auto_review")
          Text("Ask me").tag("user")
        }
        Toggle("ClawDad tools", isOn: $policy.nativeTools)
        Toggle("Computer and Terminal control", isOn: $policy.computerUse)
        Text("Saved on the selected computer for new Assistant and app-server requests. Your selected ChatGPT subscription supplies the intelligence. Current work keeps its permissions.")
          .font(.caption).foregroundStyle(.secondary)
        Text("Computer control also needs the desktop system permissions shown under Remote Assist. Connected tools keep their own sign-ins. Research reviewers evaluate evidence with read-only access.")
          .font(.caption).foregroundStyle(.secondary)
        Button("Save agent access") { Task { await save() } }.disabled(configuration == nil)
          .accessibilityIdentifier("clawdad.settings.agent-access.save")
      }.disabled(busy)
      if !status.isEmpty { Section { Text(status).font(.caption) } }
      Section { Button("Refresh permissions and questions") { Task { await refresh() } }.disabled(busy) }
      ForEach(decisions) { decision in
        Section("Agent needs your decision") {
          NavigationLink(decision.params["reason"]?.string ?? decision.params["message"]?.string ?? decision.method) {
            AgentDecisionView(controller: controller, decision: decision) { await refresh() }
          }
        }
      }
    }
    .navigationTitle("Agent access").clawDadInlineNavigationTitle()
    #if os(iOS)
    .navigationBarBackButtonHidden(true)
    #endif
    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Back") { dismiss() }.keyboardShortcut(.cancelAction) } }
    .task { await refresh() }
    .onChange(of: controller.settingsScope) { _, _ in dismiss() }
  }
  private func refresh() async {
    guard !busy else { return }; busy = true; defer { busy = false }
    do {
      let reply = try await controller.settingsRequest("access.read")
      guard let value = reply["access"] else { throw AssistantProtocolError.invalid }
      let saved = try JSONDecoder().decode(AgentAccessConfiguration.self, from: JSONEncoder().encode(value))
      configuration = saved; policy = saved.policy
      decisions = try JSONDecoder().decode([AgentPendingDecision].self, from: JSONEncoder().encode(reply["pendingDecisions"] ?? .array([])))
      status = reply["nativeOnline"]?.bool == true ? "Connected to this computer." : "Keep the desktop app open for native control."
    } catch { status = error.localizedDescription }
  }
  private func save() async {
    guard !busy, let configuration else { return }; busy = true; defer { busy = false }
    do {
      let args: [String: AssistantValue] = ["policy": try .encode(policy), "expectedRevision": .number(Double(configuration.revision))]
      if pending?.args != args { pending = (UUID().uuidString.lowercased(), args) }
      guard let pending else { return }
      let reply = try await controller.settingsRequest("access.update", args: pending.args, id: pending.id)
      guard let value = reply["access"] else { throw AssistantProtocolError.invalid }
      self.configuration = try JSONDecoder().decode(AgentAccessConfiguration.self, from: JSONEncoder().encode(value))
      self.pending = nil; status = "Saved for subsequent requests on this computer."
    } catch { status = error.localizedDescription }
  }
}

private struct AgentDecisionView: View {
  @ObservedObject var controller: MobileAssistantController
  let decision: AgentPendingDecision
  var saved: () async -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var answers: [String: String] = [:]
  @State private var content = "{}"
  @State private var error = ""
  @State private var busy = false
  private var questions: [[String: AssistantValue]] { decision.params["questions"]?.array?.compactMap(\.object) ?? [] }
  var body: some View {
    Form {
      Section {
        Text(decision.params["reason"]?.string ?? decision.params["message"]?.string ?? decision.method)
        if let command = decision.params["command"]?.string { Text(command).font(.caption.monospaced()).textSelection(.enabled) }
        ForEach(Array(questions.enumerated()), id: \.offset) { _, question in
          let id = question["id"]?.string ?? ""
          Text(question["question"]?.string ?? question["header"]?.string ?? "Answer")
          if let options = question["options"]?.array {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
              if let label = option.object?["label"]?.string { Button(label) { answers[id] = label } }
            }
          }
          TextField("Your answer", text: Binding(get: { answers[id] ?? "" }, set: { answers[id] = $0 }), axis: .vertical)
        }
        if decision.method == "mcpServer/elicitation/request" {
          Text("Connected tool response (JSON)").font(.caption)
          TextEditor(text: $content).frame(minHeight: 120)
        }
      }
      Section {
        Button(questions.isEmpty ? "Allow once" : "Submit answers") { Task { await send("approve") } }
        Button("Decline", role: .destructive) { Task { await send("decline") } }
        if !error.isEmpty { Text(error).foregroundStyle(ClawDadTheme.gold) }
      }
    }.disabled(busy).navigationTitle("Agent decision").clawDadInlineNavigationTitle()
    #if os(iOS)
    .navigationBarBackButtonHidden(true)
    #endif
    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Back") { dismiss() }.keyboardShortcut(.cancelAction) } }
    .onChange(of: controller.settingsScope) { _, _ in dismiss() }
  }
  private func send(_ choice: String) async {
    guard !busy else { return }; busy = true; defer { busy = false }
    do {
      var args: [String: AssistantValue] = ["approvalId": .string(decision.id), "decision": .string(choice)]
      if !questions.isEmpty {
        args["answers"] = .object(Dictionary(uniqueKeysWithValues: questions.map { question in
          let id = question["id"]?.string ?? ""
          return (id, .object(["answers": .array([.string(answers[id] ?? "")])]))
        }))
      }
      if decision.method == "mcpServer/elicitation/request", choice == "approve" {
        args["content"] = try JSONDecoder().decode(AssistantValue.self, from: Data(content.utf8))
      }
      _ = try await controller.settingsRequest("access.decide", args: args)
      await saved(); dismiss()
    } catch { self.error = error.localizedDescription }
  }
}

private struct AssistantSettingsInfo: View {
  @State private var showing = false
  var body: some View {
    Button { showing = true } label: { Image(systemName: "info.circle").frame(width: 44, height: 44) }
      .buttonStyle(.plain).accessibilityLabel("About Assistant model settings")
      .popover(isPresented: $showing) {
        VStack(alignment: .leading, spacing: 12) {
          Text("Models and reasoning").font(.headline)
          ScrollView {
            Text("Reasoning effort can affect response time and weekly usage. Changes apply to subsequent turns or reviews; current work finishes with its original settings. Research settings choose the reviewer that plans continuations. Project agents keep their own models, objectives and allowance limits.")
          }
          Button("Done") { showing = false }.frame(minHeight: 44).keyboardShortcut(.cancelAction)
        }.padding().frame(idealWidth: 300, maxWidth: 320, idealHeight: 320, maxHeight: 400)
          #if os(iOS)
          .presentationCompactAdaptation(.popover)
          #endif
      }
  }
}

struct AssistantModelEditor: View {
  let title: String
  let scope: String
  let threadId: String?
  @State var inherited: Bool
  @State var configuration: AssistantModelConfiguration
  let initial: AssistantModelChoice
  @ObservedObject var controller: MobileAssistantController
  var saved: (AssistantModelConfiguration) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var model = ""
  @State private var effort = ""
  @State private var error = ""
  @State private var busy = false
  @State private var originalScope: String?
  @State private var pending: (id: String, args: [String: AssistantValue])?
  private var current: AssistantAvailableModel? { configuration.models.first { $0.model == model } }
  private var valid: Bool { inherited ? configuration.researchDefault.available == true : current?.supportedReasoningEfforts.contains(effort) == true }
  var body: some View {
    Form {
      Section {
        if scope == "supervisor" {
          Toggle("Use research defaults", isOn: $inherited).frame(minHeight: 44)
            .accessibilityIdentifier("clawdad.settings.assistant.inherit")
        }
        if inherited {
          Text("\(configuration.researchDefault.model) · \(configuration.researchDefault.reasoningEffort.capitalized)")
        } else {
          Picker("Model", selection: $model) {
            if current == nil { Text(model.isEmpty ? "Choose model" : "\(model) · Unavailable").tag(model) }
            ForEach(configuration.models) { entry in Text(entry.displayName).tag(entry.model) }
          }.accessibilityIdentifier("clawdad.settings.assistant.model")
          Picker("Reasoning effort", selection: $effort) {
            if current?.supportedReasoningEfforts.contains(effort) != true { Text("Choose effort").tag(effort) }
            ForEach(current?.supportedReasoningEfforts ?? [], id: \.self) { Text($0.capitalized).tag($0) }
          }.accessibilityIdentifier("clawdad.settings.assistant.effort")
        }
        if let message = initial.error, !valid { Text(message).font(.caption).foregroundStyle(ClawDadTheme.gold) }
        Button("Refresh models", systemImage: "arrow.clockwise") { Task { await refresh() } }.frame(minHeight: 44)
      }
      if !error.isEmpty { Section { Text(error).foregroundStyle(ClawDadTheme.gold)
        if pending != nil { Button("Retry saving") { Task { await save(retry: true) } } }
      } }
      Section { Button("Save settings") { Task { await save() } }.frame(minHeight: 44).disabled(!valid)
        .accessibilityIdentifier("clawdad.settings.assistant.save") }
    }.disabled(busy)
      .navigationTitle(title)
      .clawDadInlineNavigationTitle()
      #if os(iOS)
      .navigationBarBackButtonHidden(true)
      #endif
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Back") { dismiss() }.keyboardShortcut(.cancelAction) }
        ToolbarItem(placement: .primaryAction) { AssistantSettingsInfo() } }
      .onAppear {
        if originalScope == nil { originalScope = controller.settingsScope }
        if model.isEmpty { model = initial.model; effort = initial.reasoningEffort }
      }
      .onChange(of: controller.settingsScope) { _, _ in dismiss() }
      .onChange(of: model) { previous, _ in
        guard !previous.isEmpty else { return }
        if let current, !current.supportedReasoningEfforts.contains(effort) { effort = current.defaultReasoningEffort }
      }
  }
  private func refresh() async {
    busy = true; defer { busy = false }
    do {
      let reply = try await controller.settingsRequest("settings.read")
      guard let value = reply["settings"] else { throw AssistantProtocolError.invalid }
      configuration = try JSONDecoder().decode(AssistantModelConfiguration.self, from: JSONEncoder().encode(value))
      error = configuration.catalogError ?? ""
    } catch { self.error = error.localizedDescription }
  }
  private func save(retry: Bool = false) async {
    guard originalScope == controller.settingsScope else { dismiss(); return }
    guard !busy else { return }; busy = true; defer { busy = false }
    if !retry {
      var args: [String: AssistantValue] = ["scope": .string(scope), "expectedRevision": .number(Double(configuration.revision)), "inherit": .bool(inherited)]
      if let threadId { args["threadId"] = .string(threadId) }
      if !inherited { args["selection"] = .object(["model": .string(model), "reasoningEffort": .string(effort)]) }
      pending = (UUID().uuidString.lowercased(), args)
    }
    guard let pending else { return }
    do {
      let reply = try await controller.settingsRequest("settings.update", args: pending.args, id: pending.id)
      guard let value = reply["settings"] else { throw AssistantProtocolError.invalid }
      let updated = try JSONDecoder().decode(AssistantModelConfiguration.self, from: JSONEncoder().encode(value))
      self.pending = nil; saved(updated); dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
