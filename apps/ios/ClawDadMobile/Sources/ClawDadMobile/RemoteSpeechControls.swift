#if os(iOS)
import SwiftUI

struct RemoteDictationButton: View {
  @ObservedObject var controller: RemoteAssistController
  @ObservedObject var draft: RemoteDictationDraft
  @ObservedObject var recorder: VoiceRecorder

  private var active: Bool { controller.inlineDictationActive || recorder.state != .idle }
  private var busy: Bool { draft.transcribing || draft.sending || recorder.state == .requestingPermission }
  private var retry: Bool { !draft.error.isEmpty || draft.hasRecording }

  var body: some View {
    Button { controller.toggleInlineDictation() } label: {
      ZStack {
        Image(systemName: active ? "stop.fill" : (retry ? "arrow.clockwise" : "mic.fill"))
          .font(.system(size: 18, weight: .bold))
        if busy { ProgressView().controlSize(.mini).offset(x: 14, y: -14) }
      }
      .frame(width: 44, height: 44)
      .background(recorder.state == .recording ? Color.red.opacity(0.3) : Color.clear, in: Circle())
      .contentShape(Circle())
    }
    .buttonStyle(RemoteAssistOverlayButtonStyle())
    .clipShape(Circle())
    .disabled(draft.sending)
    .accessibilityLabel(recorder.state == .recording ? "Stop recording and insert text" :
      (active ? "Cancel dictation" : (retry ? "Retry dictation" : "Dictate text")))
    .accessibilityHint("Inserts into the remembered Mac input, or copies to the clipboard for Paste")
    .accessibilityIdentifier("clawdad.remote.dictation")
  }
}

struct RemoteSpeakerButton: View {
  @ObservedObject var controller: RemoteAssistController
  @ObservedObject var reader: RemoteTerminalReader
  @EnvironmentObject private var audio: MobileReadAloudController
  private var active: Bool { reader.loading || [.preparing, .playing, .paused].contains(audio.phase(for: reader.playbackKey)) }

  var body: some View {
    Button { controller.toggleInlineReadAloud() } label: {
      ZStack {
        Image(systemName: active ? "stop.fill" : "speaker.wave.2.fill")
          .font(.system(size: 18, weight: .bold))
        if reader.loading || audio.phase(for: reader.playbackKey) == .preparing { ProgressView().controlSize(.mini).offset(x: 14, y: -14) }
      }.frame(width: 44, height: 44)
    }
    .buttonStyle(RemoteAssistOverlayButtonStyle())
    .disabled(controller.inlineDictationActive)
    .accessibilityLabel(active ? "Stop Read Aloud" : "Read selected text or latest Terminal response")
    .accessibilityIdentifier("clawdad.remote.reader")
  }
}

/// Compact feedback keeps the desktop visible. Stop remains reachable when the
/// menu is collapsed; recording is owned by the controller, not a sheet lifetime.
struct RemoteSpeechStatus: View {
  @ObservedObject var controller: RemoteAssistController
  @ObservedObject var draft: RemoteDictationDraft
  @ObservedObject var recorder: VoiceRecorder
  @ObservedObject var reader: RemoteTerminalReader
  @EnvironmentObject private var audio: MobileReadAloudController
  let controlsExpanded: Bool
  private var speaking: Bool { [.preparing, .playing, .paused].contains(audio.phase(for: reader.playbackKey)) }
  private var retry: Bool { !controller.inlineDictationActive && !draft.sending && (draft.hasRecording || !draft.error.isEmpty) }

  private var status: String {
    if recorder.state == .recording {
      let duration = Int(recorder.duration)
      return "Recording \(duration / 60):\(String(format: "%02d", duration % 60))"
    }
    if recorder.state == .requestingPermission { return "Opening microphone…" }
    if draft.transcribing { return "Transcribing…" }
    if draft.sending { return "Sending text to Mac…" }
    if controller.inlineDictationActive { return controller.inlineSpeechUnavailableReason ?? "Preparing delivery…" }
    if !recorder.errorMessage.isEmpty { return recorder.errorMessage }
    if !draft.error.isEmpty { return draft.error }
    if draft.hasRecording { return "Recording saved. Tap Retry when ready." }
    if reader.loading { return "Finding text to read…" }
    if audio.phase(for: reader.playbackKey) == .preparing { return "Preparing voice…" }
    if speaking { return reader.inProgress ? "Reading last completed answer" : "Reading: \(reader.title)" }
    if !reader.error.isEmpty { return reader.error }
    let audioError = audio.message(for: reader.playbackKey)
    if !audioError.isEmpty { return audioError }
    return controlsExpanded ? (controller.inlineSpeechUnavailableReason ?? "") : ""
  }

  var body: some View {
    VStack(alignment: .trailing, spacing: 6) {
      if !status.isEmpty {
        Text(status)
          .font(.caption.weight(.semibold))
          .foregroundStyle(ClawDadTheme.cream)
          .multilineTextAlignment(.trailing)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: 270, alignment: .trailing)
          .padding(8)
          .background(Color.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 8))
          .accessibilityIdentifier("clawdad.remote.speech.status")
      }
      if retry {
        HStack {
          Button("Retry") { controller.retryInlineDictation() }
          Button("Discard") { controller.discardInlineDictation() }
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .font(.caption.weight(.bold))
      }
      if audio.phase(for: reader.playbackKey) == .failed {
        Button("Retry Read Aloud") { reader.togglePlayback() }
          .buttonStyle(RemoteAssistOverlayButtonStyle())
      }
      if !controlsExpanded {
        HStack {
          if controller.inlineDictationActive {
            RemoteDictationButton(controller: controller, draft: draft, recorder: recorder)
          }
          if speaking || reader.loading { RemoteSpeakerButton(controller: controller, reader: reader) }
        }
      }
    }
    .task(id: !reader.sourceTabId.isEmpty && (speaking || reader.loading)) {
      guard !reader.sourceTabId.isEmpty else { return }
      while !Task.isCancelled, controller.phase == .connected {
        try? await Task.sleep(for: .seconds(2))
        guard !Task.isCancelled else { return }
        controller.pollRemoteTerminalTabs()
      }
    }
  }
}
#endif
