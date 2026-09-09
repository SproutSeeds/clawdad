import SwiftUI

struct AssistantVoiceTranscription: View {
  @ObservedObject var controller: MobileAssistantController
  @FocusState private var editing: Bool

  private var heading: String {
    if controller.transcriptionReview == .editing { return "You · Editing · Held" }
    if controller.transcriptionReview == .held { return "You · Held" }
    return controller.hearingSpeech ? "You · Speaking" : controller.transcribingSpeech ? "You · Transcribing…" : "You · Draft"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Text(heading).font(.caption.bold()).foregroundStyle(ClawDadTheme.gold)
        Spacer(minLength: 4)
        control("pencil", name: "Edit transcription", hint: "Pauses microphone capture and holds this turn for correction", id: "edit") {
          controller.editTranscription()
        }
        control("trash", name: "Clear transcription", hint: "Asks before clearing this unsent voice turn", id: "clear") {
          controller.requestClearTranscription()
        }
      }
      if controller.transcriptionReview == .editing {
        TextEditor(text: Binding(get: { controller.transcriptionEditText }, set: { controller.updateTranscriptionEdit($0) }))
          .font(.body).scrollContentBackground(.hidden)
          .frame(minHeight: 100, maxHeight: 200).padding(8)
          .background(ClawDadTheme.cream.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
          .focused($editing).accessibilityLabel("Edit unsent voice transcription")
          .accessibilityIdentifier("clawdad.assistant.transcript.editor")
      } else {
        Text(controller.liveTranscript.isEmpty ? "Listening…" : controller.liveTranscript).textSelection(.enabled)
          .accessibilityIdentifier("clawdad.assistant.transcript")
      }
      if controller.transcriptionReview != .listening {
        Text(controller.muted
          ? "Held until Send or Resume. The microphone stays muted."
          : "Microphone paused. Held until Send or Resume listening.")
          .font(.caption).foregroundStyle(ClawDadTheme.cream.opacity(0.8))
        if controller.transcribingSpeech {
          Text("Finishing captured words. Your corrections take priority.").font(.caption)
        }
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 12) { reviewActions }
          VStack(alignment: .leading, spacing: 8) { reviewActions }
        }
      }
    }.frame(maxWidth: .infinity, alignment: .leading)
      .alert("Clear this transcription?", isPresented: Binding(
        get: { controller.transcriptionClearPresented },
        set: { if !$0 { controller.hideTranscriptionClearPrompt() } })) {
          Button("Clear", role: .destructive) { controller.clearTranscription() }
          Button("Cancel", role: .cancel) { controller.cancelClearTranscription() }
      }
      .onChange(of: controller.transcriptionReview) { _, mode in editing = mode == .editing }
      .onAppear { editing = controller.transcriptionReview == .editing }
  }

  @ViewBuilder private var reviewActions: some View {
    if controller.transcriptionReview == .editing {
      Button { editing = false; controller.saveTranscriptionEdits() } label: {
        Text("Save edits").frame(minHeight: 44).contentShape(Rectangle())
      }.accessibilityHint("Keeps the corrected transcription held without sending")
        .accessibilityIdentifier("clawdad.assistant.transcript.save")
    }
    Button {
      editing = false
      Task { await controller.resumeTranscriptionListening() }
    } label: {
      Text(controller.muted ? "Resume turn" : "Resume listening").frame(minHeight: 44).contentShape(Rectangle())
    }.disabled(controller.changingMicrophone)
      .accessibilityHint("Returns to your current automatic or Think aloud mode. A manually muted microphone stays off.")
      .accessibilityIdentifier("clawdad.assistant.transcript.resume")
  }

  private func control(_ symbol: String, name: String, hint: String, id: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol).font(.system(size: 20)).frame(width: 44, height: 44).contentShape(Rectangle())
    }.buttonStyle(.plain).disabled(!controller.canReviewTranscription)
      .accessibilityLabel(name).accessibilityHint(hint)
      .accessibilityIdentifier("clawdad.assistant.transcript.\(id)")
      #if os(iOS)
      .hoverEffect(.highlight)
      #endif
  }
}
