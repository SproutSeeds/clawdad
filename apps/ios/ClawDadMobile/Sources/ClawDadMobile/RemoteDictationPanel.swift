#if os(iOS)
import SwiftUI
import UIKit

struct RemoteDictationPanel: View {
  @ObservedObject var controller: RemoteAssistController
  @ObservedObject var draft: RemoteDictationDraft
  var onClose: () -> Void
  @StateObject private var recorder = VoiceRecorder()
  @Environment(\.scenePhase) private var scenePhase
  @FocusState private var editorFocused: Bool
  @State private var pulse = false

  private var recording: Bool { recorder.state == .recording }
  private var captureBusy: Bool { recorder.state != .idle || draft.transcribing }
  private var hasText: Bool { !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Button(action: close) { Label("Back", systemImage: "chevron.left") }
          .keyboardShortcut(.cancelAction)
          .accessibilityIdentifier("clawdad.remote.dictation.back")
        Spacer()
        Text("Dictation").font(.headline)
        Spacer()
        Button("Clear") {
          recorder.cancel()
          draft.clear()
        }
        .disabled(draft.sending || (!hasText && !draft.hasRecording && !captureBusy))
      }
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(ClawDadTheme.gold)

      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          if !captureBusy, hasText {
            TextEditor(text: $draft.text)
              .focused($editorFocused)
              .scrollContentBackground(.hidden)
              .frame(minHeight: 110, maxHeight: 180)
              .padding(8)
              .background(ClawDadTheme.cream.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
              .disabled(draft.sending)
              .accessibilityLabel("Dictation transcript")
              .accessibilityIdentifier("clawdad.remote.dictation.transcript")
          }

          HStack(spacing: 14) {
            Button(action: toggleRecording) {
              ZStack {
                if recording {
                  Circle().stroke(ClawDadTheme.peach.opacity(0.7), lineWidth: 2)
                    .scaleEffect(pulse ? 1.25 : 0.9)
                    .opacity(pulse ? 0 : 1)
                }
                Image(systemName: recording ? "stop.fill" : "mic.fill")
                  .font(.title3.weight(.bold))
              }
              .frame(width: 48, height: 48)
            }
            .buttonStyle(ClawDadVoiceButtonStyle(recording: recording))
            .disabled(draft.transcribing || draft.sending || recorder.state == .requestingPermission)
            .accessibilityLabel(recording ? "Stop recording and transcribe" : "Record dictation")
            .accessibilityIdentifier("clawdad.remote.dictation.record")

            if draft.transcribing {
              ProgressView().tint(ClawDadTheme.gold)
              Text("Transcribing…")
            } else if recording {
              Text("Recording \(Int(recorder.duration) / 60):\(String(format: "%02d", Int(recorder.duration) % 60))")
                .monospacedDigit()
            } else if recorder.state == .requestingPermission {
              Text("Requesting microphone access…")
            } else {
              Text(hasText ? "Record more" : "Tap the mic to record")
            }
            Spacer()
            if captureBusy {
              Button("Cancel") {
                recorder.cancel()
                draft.cancelTranscription()
              }
              .foregroundStyle(ClawDadTheme.gold)
            }
          }

          if draft.hasRecording, !captureBusy {
            Button("Transcribe recording") { draft.retryTranscription() }
              .buttonStyle(ClawDadCompactButtonStyle())
              .disabled(draft.sending)
          }

          if !recorder.errorMessage.isEmpty {
            Text(recorder.errorMessage).foregroundStyle(ClawDadTheme.peach)
          }
          if !draft.error.isEmpty {
            Text(draft.error).foregroundStyle(ClawDadTheme.peach)
          }
          if !draft.notice.isEmpty {
            Text(draft.notice).foregroundStyle(ClawDadTheme.gold)
          }

          if hasText, !captureBusy {
            Button {
              editorFocused = false
              controller.useDictationOnComputer()
            } label: {
              HStack {
                if draft.sending { ProgressView() }
                Text(draft.sending ? "Sending…" : "Use on \(controller.remoteComputerKind)")
              }
              .frame(maxWidth: .infinity)
            }
            .buttonStyle(ClawDadPrimaryButtonStyle())
            .disabled(draft.sending || controller.clipboardBusy ||
                      controller.phase != .connected || !controller.supportsRemoteDictation ||
                      controller.remoteInputSuppressed || !draft.belongsToActiveComputer)
            .accessibilityIdentifier("clawdad.remote.dictation.use")

            Text(deliveryHelp).font(.footnote)
              .foregroundStyle(ClawDadTheme.cream.opacity(0.75))

            Button {
              UIPasteboard.general.string = draft.text
              draft.copiedToPhone()
              UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } label: {
              Label("Copy to iPhone", systemImage: "doc.on.doc")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(ClawDadCompactButtonStyle())
            .accessibilityIdentifier("clawdad.remote.dictation.copy")
          }
        }
        .font(.subheadline)
      }
    }
    .padding(20)
    .foregroundStyle(ClawDadTheme.cream)
    .background(ClawDadTheme.background)
    .task {
      if !hasText, !draft.hasRecording, !draft.transcribing {
        draft.beginRecording()
        await recorder.start()
      }
    }
    .onChange(of: recorder.state) { _, state in
      pulse = false
      if state == .recording {
        withAnimation(.easeOut(duration: 1).repeatForever(autoreverses: false)) { pulse = true }
      }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .background {
        if recording {
          do { draft.retain(try recorder.stop()) }
          catch { recorder.present(error) }
        } else { recorder.cancel() }
      }
    }
    .onDisappear {
      recorder.cancel()
      draft.cancelTranscription()
    }
  }

  private var deliveryHelp: String {
    if !draft.belongsToActiveComputer {
      return "Return to \(draft.computerName) to use this draft, or copy it to your iPhone."
    }
    if controller.phase != .connected {
      return "Reconnect to use this text on \(controller.remoteComputerName). Your draft is saved."
    }
    if !controller.supportsRemoteDictation {
      return "This computer needs a ClawDad update to receive dictation. You can copy the text to your iPhone."
    }
    return "Inserts into the focused text field, or copies to the computer clipboard for later. Enter is a separate control."
  }

  private func toggleRecording() {
    editorFocused = false
    if recording {
      do { draft.transcribe(try recorder.stop()) }
      catch { recorder.present(error) }
    } else {
      draft.beginRecording()
      Task { await recorder.start() }
    }
  }

  private func close() {
    editorFocused = false
    recorder.cancel()
    draft.cancelTranscription()
    onClose()
  }
}
#endif
