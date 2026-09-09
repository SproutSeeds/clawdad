import SwiftUI

@MainActor
func assistantMicrophoneConfirmation() {
  #if os(iOS)
  // Haptic-only confirmation cannot feed an audible tone back into recognition.
  UINotificationFeedbackGenerator().notificationOccurred(.success)
  #endif
}

@MainActor
func assistantKeepScreenAwake(_ enabled: Bool) {
  #if os(iOS)
  UIApplication.shared.isIdleTimerDisabled = enabled
  #endif
}

struct AssistantVoicePrivacySettings: View {
  @ObservedObject var controller: MobileAssistantController
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      Form {
        Section {
          Toggle("On-device voice commands", isOn: Binding(get: { controller.voiceCommandsEnabled }, set: { enabled in
            Task { await controller.setVoiceCommands(enabled) }
          })).accessibilityIdentifier("clawdad.assistant.voice-commands")
          Text("Say “ClawDad, mute” as a standalone command. With voice unmute off, this fully stops the microphone. Tap the microphone button to resume.")
          Toggle("Voice unmute while muted", isOn: Binding(get: { controller.voiceReactivationEnabled }, set: { enabled in
            Task { await controller.setVoiceCommands(true, reactivation: enabled) }
          })).accessibilityIdentifier("clawdad.assistant.voice-reactivation")
          Text("Optional and off by default. While voice-muted, the microphone stays active only for on-device detection of “ClawDad, unmute.” This local input is discarded and is never sent to your Mac or Assistant, or saved by ClawDad. Turning this on takes effect on your next voice mute; it does not start a muted microphone.")
          Toggle("Also accept “please mute / unmute”", isOn: Binding(get: { controller.alternateVoiceCommands }, set: { enabled in
            Task { await controller.setVoiceCommands(controller.voiceCommandsEnabled, alternates: enabled) }
          })).accessibilityIdentifier("clawdad.assistant.alternate-voice-commands")
          Text("Shorter phrases may be triggered more easily by other people. Voice commands do not identify who is speaking.")
        }.disabled(controller.configuringVoiceCommands)
        Section("Microphone privacy") {
          Text("Wait for the muted state or confirmation before beginning a private conversation. Muting discards the current unsent voice turn, including pending transcription. Previously sent requests continue. Typed drafts and attachments are preserved.")
          Text("The microphone button always fully mutes. Voice commands pause during Assistant playback and briefly afterward. Use the button during a reply.")
          Text("English (US) on-device recognition and Speech Recognition permission are required. There is no online fallback. If recognition fails, capture stops and manual unmute remains available.")
          Text("Voice commands use extra battery and keep the screen awake while listening. Voice reactivation requires ClawDad in the foreground. Leaving the app or locking the phone fully mutes the microphone; returning does not restart it. The call stays open while iOS allows it, and connection recovery remains available.")
          if controller.voiceActive {
            Button("Turn microphone fully off", role: .destructive) { controller.fullyStopMicrophone() }
              .accessibilityIdentifier("clawdad.assistant.microphone-off")
          }
          if !controller.voiceControlNotice.isEmpty { Text(controller.voiceControlNotice).foregroundStyle(.secondary) }
        }
      }.navigationTitle("Voice controls")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) } }
    }
  }
}
