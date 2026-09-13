import SwiftUI

struct SpeechBoostSettings: View {
  @ObservedObject private var preference = SpeechOutputPreference.shared
  @ObservedObject var playback: MobileReadAloudController
  let previewAvailable: Bool
  let preview: () -> Void
  private var previewPlaying: Bool { playback.activeKey.hasPrefix("voice-preview:") && [.preparing, .playing, .paused].contains(playback.phase) }
  var body: some View {
    ClawDadPanel {
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          Text("Speech boost").font(.headline).foregroundStyle(ClawDadTheme.gold)
          Spacer()
          Text(preference.boostDB == 0 ? "0 dB" : "+\(Int(preference.boostDB)) dB")
            .monospacedDigit().accessibilityIdentifier("speechBoost.value")
        }
        Slider(value: Binding(get: { preference.boostDB }, set: { try? preference.set($0.rounded()) }),
          in: 0...20, step: 1)
          .accessibilityLabel("Speech boost")
          .accessibilityValue("\(Int(preference.boostDB)) decibels")
          .accessibilityIdentifier("speechBoost.slider")
        HStack {
          Button("Reset to 0 dB") { try? preference.set(0) }
            .buttonStyle(ClawDadSecondaryButtonStyle()).accessibilityIdentifier("speechBoost.reset")
          Button(previewPlaying ? "Stop preview" : "Preview") {
            if previewPlaying { playback.stop() } else { preview() }
          }
            .buttonStyle(ClawDadSecondaryButtonStyle()).accessibilityIdentifier("speechBoost.preview")
            .disabled(!previewPlaying && !previewAvailable)
        }
        Text("Applies to all ClawDad speech on this device, across accounts. Saves immediately; other devices keep their own boost.")
          .font(.caption).foregroundStyle(ClawDadTheme.peach)
        Text("The dB value is requested gain. Peak limiting can reduce the loudness increase, especially at +10 to +20 dB. Strong boost can sound more compressed; +20 dB cannot be distortion-free for every source.")
          .font(.caption).foregroundStyle(ClawDadTheme.peach)
        if !previewAvailable && !previewPlaying {
          Text("Connect to your paired computer to preview the selected voice.").font(.caption).foregroundStyle(ClawDadTheme.peach)
        }
        if !preference.error.isEmpty { Text(preference.error).font(.caption).foregroundStyle(.red) }
      }.foregroundStyle(ClawDadTheme.cream)
    }
  }
}
