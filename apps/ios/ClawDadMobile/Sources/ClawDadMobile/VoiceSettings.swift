import SwiftUI

struct MobileVoiceSelection: Codable, Equatable, Sendable {
  var engine: String
  var modelId: String
  var voice: String
  var speed: Double

  var json: JSONValue {
    .object(["engine": .string(engine), "modelId": .string(modelId),
             "voice": .string(voice), "speed": .number(speed)])
  }
}

struct MobileVoice: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let name: String
  let language: String
  let gender: String
  var previewText: String?
  var label: String { [name, language, gender == "unspecified" ? "" : gender.capitalized].filter { !$0.isEmpty }.joined(separator: " · ") }
}

struct MobileVoiceModel: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let name: String
  let modelId: String
  let defaultVoice: String
  let supportsSpeed: Bool
  let installed: Bool
  let enabled: Bool
  let sizeLabel: String
  let voices: [MobileVoice]
}

struct MobileVoiceSettings: Codable, Equatable, Sendable {
  let models: [MobileVoiceModel]
  let selection: MobileVoiceSelection
  let voicesByModel: [String: MobileVoiceSelection]
  let previewText: String
}

// A refresh updates the catalog and saved preference, while this draft belongs to
// the current Settings visit. Only an explicit model/filter choice changes it.
struct MobileVoiceSettingsDraft: Equatable {
  var selection = MobileVoiceSelection(engine: "kokoro", modelId: "", voice: "af_heart", speed: 1)
  var language = "All"
  var gender = "All"
  private(set) var initialized = false
  private(set) var settings: MobileVoiceSettings?

  init(settings: MobileVoiceSettings? = nil) { receive(settings) }

  mutating func receive(_ settings: MobileVoiceSettings?) {
    guard let settings else { return }
    self.settings = settings
    guard !initialized else { return }
    selection = settings.selection
    initialized = true
  }

  mutating func selectModel(_ engine: String) {
    guard let settings, let model = settings.models.first(where: { $0.id == engine }) else { return }
    selection = settings.voicesByModel[engine] ?? MobileVoiceSelection(
      engine: engine, modelId: model.modelId, voice: model.defaultVoice, speed: 1)
    initialized = true
    language = "All"
    gender = "All"
  }

  func visibleVoices() -> [MobileVoice] {
    (settings?.models.first { $0.id == selection.engine }?.voices ?? []).filter {
      (language == "All" || $0.language == language) && (gender == "All" || $0.gender == gender)
    }
  }

  mutating func chooseVisibleVoice() {
    let voices = visibleVoices()
    if !voices.contains(where: { $0.id == selection.voice }), let first = voices.first {
      selection.voice = first.id
    }
  }
}

struct VoiceSettingsPanel: View {
  @EnvironmentObject private var session: CloudSession
  @State private var requestedScope = ""
  private var scope: String { "\(session.accountId)/\(session.workspaceId)/\(session.hostId)" }

  var body: some View {
    VoiceSettingsEditor(settings: session.voiceSettings, pending: session.voiceSettingsPending,
      error: session.voiceSettingsError, status: session.voiceSettingsStatus,
      request: { session.requestVoiceSettings(selection: $0) },
      preview: { session.previewVoice($0, text: $1) })
      .equatable()
      .id(scope)
      .task(id: "\(scope)/\(session.ready)") {
        guard session.ready, requestedScope != scope else { return }
        requestedScope = scope
        session.requestVoiceSettings()
      }
  }
}

// This form has no CloudSession observation. Equal voice data leaves its native
// menus intact when unrelated heartbeats, threads, or playback state change.
private struct VoiceSettingsEditor: View, Equatable {
  let settings: MobileVoiceSettings?
  let pending: Bool
  let error: String
  let status: String
  let request: (MobileVoiceSelection?) -> Void
  let preview: (MobileVoiceSelection, String) -> Void
  @State private var draft: MobileVoiceSettingsDraft

  init(settings: MobileVoiceSettings?, pending: Bool, error: String, status: String,
       request: @escaping (MobileVoiceSelection?) -> Void,
       preview: @escaping (MobileVoiceSelection, String) -> Void) {
    self.settings = settings; self.pending = pending; self.error = error; self.status = status
    self.request = request; self.preview = preview
    _draft = State(initialValue: MobileVoiceSettingsDraft(settings: settings))
  }

  nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.settings == rhs.settings && lhs.pending == rhs.pending && lhs.error == rhs.error && lhs.status == rhs.status
  }

  private var model: MobileVoiceModel? { draft.settings?.models.first { $0.id == draft.selection.engine } }
  private var voices: [MobileVoice] { draft.visibleVoices() }

  var body: some View {
    ClawDadPanel {
      VStack(alignment: .leading, spacing: 12) {
        Text("Voice & Playback").font(.headline).foregroundStyle(ClawDadTheme.gold)
        Text("Used by the main app and Remote Assist. Speech is generated on your paired computer.")
          .font(.caption).foregroundStyle(ClawDadTheme.peach)
        if let settings = draft.settings {
          VoiceSettingsPicker(title: "Model", identifier: "voice.model",
            options: settings.models.map { .init(id: $0.id, label: $0.name) }, value: draft.selection.engine,
            choose: { draft.selectModel($0) }).equatable()
          if let model {
            Text("\(model.voices.count) voices · \(model.sizeLabel)").font(.caption)
            VoiceSettingsPicker(title: "Language", identifier: "voice.language",
              options: [.init(id: "All", label: "All languages")] +
                Array(Set(model.voices.map(\.language))).sorted().map { .init(id: $0, label: $0) },
              value: draft.language, choose: {
                draft.language = $0; draft.chooseVisibleVoice()
              }).equatable()
            VoiceSettingsPicker(title: "Voice type", identifier: "voice.gender",
              options: [.init(id: "All", label: "All voice types")] +
                Array(Set(model.voices.map(\.gender))).sorted().map {
                  .init(id: $0, label: $0 == "unspecified" ? "Unspecified" : $0.capitalized)
                }, value: draft.gender, choose: {
                  draft.gender = $0; draft.chooseVisibleVoice()
                }).equatable()
            VoiceSettingsPicker(title: "Voice", identifier: "voice.voice",
              options: voices.map { .init(id: $0.id, label: $0.label) }, value: draft.selection.voice,
              choose: { draft.selection.voice = $0 }).equatable()
            Text("Each voice has its own delivery and character. Preview voices to compare their style.")
              .font(.caption).foregroundStyle(ClawDadTheme.peach)
            if model.supportsSpeed {
              HStack {
                Text("Speaking speed")
                Slider(value: $draft.selection.speed, in: 0.5...2, step: 0.05)
                Text(draft.selection.speed.formatted(.number.precision(.fractionLength(2))) + "×").monospacedDigit()
              }
            } else {
              Text("Pocket uses the voice’s natural speaking pace.").font(.caption)
            }
            Text("Voice and language data downloads to your Mac on first use and stays there.")
              .font(.caption).foregroundStyle(ClawDadTheme.peach)
            HStack {
              Button("Preview voice") {
                preview(draft.selection, model.voices.first(where: { $0.id == draft.selection.voice })?.previewText ?? settings.previewText)
              }.buttonStyle(ClawDadSecondaryButtonStyle()).accessibilityIdentifier("voice.preview")
              Button("Save voice") { request(draft.selection) }
                .buttonStyle(ClawDadSecondaryButtonStyle()).accessibilityIdentifier("voice.save")
            }.disabled(pending || !model.installed || !model.enabled || !voices.contains { $0.id == draft.selection.voice })
            if !model.installed || !model.enabled {
              Text("Install \(model.name) in the local speech service on your Mac.").font(.caption)
            }
          }
        } else if pending {
          ProgressView("Loading voices…")
        }
        if !error.isEmpty {
          Text(error).font(.caption).foregroundStyle(ClawDadTheme.peach)
        } else if !status.isEmpty {
          Text(status).font(.caption).foregroundStyle(ClawDadTheme.peach)
        }
        Button("Refresh voices") { request(nil) }
          .disabled(pending).accessibilityIdentifier("voice.refresh")
      }.foregroundStyle(ClawDadTheme.cream)
    }
    .onChange(of: settings) { _, value in draft.receive(value) }
  }
}

// Also isolate each menu from genuine Settings status changes (for example a
// refresh completing while the user is already browsing another voice).
private struct VoiceSettingsPicker: View, Equatable {
  struct Option: Identifiable, Hashable, Sendable {
    let id: String
    let label: String
  }
  let title: String
  let identifier: String
  let options: [Option]
  let value: String
  let choose: @MainActor (String) -> Void
  @State private var voiceChoices: VoiceChoices?

  struct VoiceChoices: Identifiable, Hashable {
    let id = UUID()
    let options: [Option]
    let selected: String
  }

  nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.title == rhs.title && lhs.identifier == rhs.identifier && lhs.options == rhs.options && lhs.value == rhs.value
  }

  var body: some View {
    if identifier == "voice.voice" {
      Button {
        voiceChoices = VoiceChoices(options: options, selected: value)
      } label: {
        HStack {
          Text(options.first { $0.id == value }?.label ?? "Choose a voice")
          Spacer(minLength: 8)
          Image(systemName: "chevron.right")
        }.frame(minHeight: 44).contentShape(Rectangle())
      }
      .buttonStyle(.plain).foregroundStyle(ClawDadTheme.gold)
      .accessibilityLabel("Voice").accessibilityValue(options.first { $0.id == value }?.label ?? "Choose a voice")
      .accessibilityIdentifier(identifier)
      .navigationDestination(item: $voiceChoices) { snapshot in
        VoiceChoicesList(snapshot: snapshot, choose: choose)
      }
    } else {
      Picker(title, selection: Binding(get: { value }, set: { choose($0) })) {
        ForEach(options) { Text($0.label).tag($0.id) }
      }.accessibilityIdentifier(identifier)
    }
  }
}

// Capture the options when opening the list. Session/catalog updates can keep
// arriving without replacing rows or moving the reader's scroll position.
private struct VoiceChoicesList: View {
  @Environment(\.dismiss) private var dismiss
  let snapshot: VoiceSettingsPicker.VoiceChoices
  let choose: @MainActor (String) -> Void

  var body: some View {
    List(snapshot.options) { option in
      Button {
        choose(option.id)
        dismiss()
      } label: {
        HStack {
          Text(option.label).foregroundStyle(ClawDadTheme.cream)
          Spacer(minLength: 8)
          if snapshot.selected == option.id {
            Image(systemName: "checkmark").foregroundStyle(ClawDadTheme.gold)
          }
        }.frame(minHeight: 44).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("voice.option.\(option.id)")
      .listRowBackground(ClawDadTheme.panel)
    }
    .listStyle(.plain).scrollContentBackground(.hidden)
    .background(ClawDadTheme.background)
    .accessibilityIdentifier("voice.options.list")
    .navigationTitle("Choose a voice")
#if os(iOS)
    .navigationBarTitleDisplayMode(.inline)
    .navigationBarBackButtonHidden(true)
#endif
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button { dismiss() } label: { Label("Back", systemImage: "chevron.left") }
          .keyboardShortcut(.cancelAction).accessibilityIdentifier("voice.options.back")
      }
    }
  }
}

struct ReadAloudBar: View {
  @ObservedObject var reader: MobileReadAloudController
  var body: some View {
    if [.preparing, .playing, .paused].contains(reader.phase) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(reader.sourceTitle).font(.caption.bold()).lineLimit(1)
          Text(reader.statusMessage).font(.caption2).lineLimit(1)
        }
        Spacer(minLength: 0)
        if reader.phase != .preparing {
          Button { reader.phase == .paused ? reader.resume() : reader.pause() } label: {
            Image(systemName: reader.phase == .paused ? "play.fill" : "pause.fill").frame(width: 44, height: 44)
          }.accessibilityLabel(reader.phase == .paused ? "Resume reading" : "Pause reading")
        }
        Button { reader.stop() } label: { Image(systemName: "stop.fill").frame(width: 44, height: 44) }
          .accessibilityLabel("Stop reading").accessibilityIdentifier("read-aloud.stop")
      }
      .padding(.horizontal, 16).foregroundStyle(ClawDadTheme.cream)
      .background(ClawDadTheme.panel)
    }
  }
}
