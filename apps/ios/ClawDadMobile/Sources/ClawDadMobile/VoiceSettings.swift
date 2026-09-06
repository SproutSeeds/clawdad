import SwiftUI

struct MobileVoiceSelection: Codable, Equatable {
  var engine: String
  var modelId: String
  var voice: String
  var speed: Double

  var json: JSONValue {
    .object(["engine": .string(engine), "modelId": .string(modelId),
             "voice": .string(voice), "speed": .number(speed)])
  }
}

struct MobileVoice: Codable, Identifiable, Equatable {
  let id: String
  let name: String
  let language: String
  let gender: String
  var previewText: String?
  var label: String { [name, language, gender == "unspecified" ? "" : gender.capitalized].filter { !$0.isEmpty }.joined(separator: " · ") }
}

struct MobileVoiceModel: Codable, Identifiable {
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

struct MobileVoiceSettings: Codable {
  let models: [MobileVoiceModel]
  let selection: MobileVoiceSelection
  let voicesByModel: [String: MobileVoiceSelection]
  let previewText: String
}

struct VoiceSettingsPanel: View {
  @EnvironmentObject private var session: CloudSession
  @State private var selection = MobileVoiceSelection(engine: "kokoro", modelId: "", voice: "af_heart", speed: 1)
  @State private var language = "All"
  @State private var gender = "All"
  private var model: MobileVoiceModel? { session.voiceSettings?.models.first { $0.id == selection.engine } }
  private var voices: [MobileVoice] {
    (model?.voices ?? []).filter { (language == "All" || $0.language == language) && (gender == "All" || $0.gender == gender) }
  }

  var body: some View {
    ClawDadPanel {
      VStack(alignment: .leading, spacing: 12) {
        Text("Voice & Playback").font(.headline).foregroundStyle(ClawDadTheme.gold)
        Text("Used by the main app and Remote Assist. Speech is generated on your paired computer.")
          .font(.caption).foregroundStyle(ClawDadTheme.peach)
        if let settings = session.voiceSettings {
          Picker("Model", selection: $selection.engine) {
            ForEach(settings.models) { model in
              Text(model.name).tag(model.id)
            }
          }.accessibilityIdentifier("voice.model")
          if let model {
            Text("\(model.voices.count) voices · \(model.sizeLabel)").font(.caption)
            Picker("Language", selection: $language) {
              Text("All languages").tag("All")
              ForEach(Array(Set(model.voices.map(\.language))).sorted(), id: \.self) { Text($0).tag($0) }
            }
            Picker("Voice type", selection: $gender) {
              Text("All voice types").tag("All")
              ForEach(Array(Set(model.voices.map(\.gender))).sorted(), id: \.self) {
                Text($0 == "unspecified" ? "Unspecified" : $0.capitalized).tag($0)
              }
            }
            Picker("Voice", selection: $selection.voice) {
              ForEach(voices) { Text($0.label).tag($0.id) }
            }.accessibilityIdentifier("voice.voice")
            Text("Each voice has its own delivery and character. Preview voices to compare their style.")
              .font(.caption).foregroundStyle(ClawDadTheme.peach)
            if model.supportsSpeed {
              HStack {
                Text("Speaking speed")
                Slider(value: $selection.speed, in: 0.5...2, step: 0.05)
                Text(selection.speed.formatted(.number.precision(.fractionLength(2))) + "×").monospacedDigit()
              }
            } else {
              Text("Pocket uses the voice’s natural speaking pace.").font(.caption)
            }
            Text("Voice and language data downloads to your Mac on first use and stays there.")
              .font(.caption).foregroundStyle(ClawDadTheme.peach)
            HStack {
              Button("Preview voice") { session.previewVoice(selection, text: model.voices.first(where: { $0.id == selection.voice })?.previewText ?? settings.previewText) }
                .buttonStyle(ClawDadSecondaryButtonStyle()).accessibilityIdentifier("voice.preview")
              Button("Save voice") { session.requestVoiceSettings(selection: selection) }
                .buttonStyle(ClawDadSecondaryButtonStyle()).accessibilityIdentifier("voice.save")
            }.disabled(session.voiceSettingsPending || !model.installed || !model.enabled || voices.isEmpty)
            if !model.installed || !model.enabled {
              Text("Install \(model.name) in the local speech service on your Mac.").font(.caption)
            }
          }
        } else if session.voiceSettingsPending {
          ProgressView("Loading voices…")
        }
        if !session.voiceSettingsError.isEmpty {
          Text(session.voiceSettingsError).font(.caption).foregroundStyle(ClawDadTheme.peach)
        } else if !session.voiceSettingsStatus.isEmpty {
          Text(session.voiceSettingsStatus).font(.caption).foregroundStyle(ClawDadTheme.peach)
        }
        Button("Refresh voices") { session.requestVoiceSettings() }
          .disabled(session.voiceSettingsPending)
      }.foregroundStyle(ClawDadTheme.cream)
    }
    .onAppear {
      if let saved = session.voiceSettings?.selection { selection = saved }
      session.requestVoiceSettings()
    }
    .onChange(of: session.voiceSettings?.selection) { _, value in
      if let value { selection = value; language = "All"; gender = "All" }
    }
    .onChange(of: selection.engine) { _, engine in
      guard let model = session.voiceSettings?.models.first(where: { $0.id == engine }) else { return }
      selection = session.voiceSettings?.voicesByModel[engine] ?? MobileVoiceSelection(engine: engine, modelId: model.modelId, voice: model.defaultVoice, speed: 1)
      language = "All"; gender = "All"
    }
    .onChange(of: language) { _, _ in chooseVisibleVoice() }
    .onChange(of: gender) { _, _ in chooseVisibleVoice() }
  }

  private func chooseVisibleVoice() {
    if !voices.contains(where: { $0.id == selection.voice }), let first = voices.first { selection.voice = first.id }
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
