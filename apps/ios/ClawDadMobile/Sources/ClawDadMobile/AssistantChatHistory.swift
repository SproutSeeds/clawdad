import SwiftUI
import ClawDadRemoteAssistProtocol
#if canImport(UIKit)
  import UIKit
#else
  import AppKit
#endif

struct AssistantCopyButton: View {
  let text: String
  let label: String
  let id: String
  @State private var copied = false
  var body: some View {
    Button {
      #if canImport(UIKit)
        UIPasteboard.general.string = text
      #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
      #endif
      copied = true
    } label: {
      Image(systemName: copied ? "checkmark" : "doc.on.doc")
        .font(.system(size: 18))
        .frame(width: 44, height: 44)
        .overlay(alignment: .leading) {
          if copied { Text("Copied").font(.system(size: 12)).fixedSize().offset(x: -44) }
        }
    }.buttonStyle(.plain).disabled(text.isEmpty)
      .accessibilityLabel(copied ? "Copied" : "Copy \(label)")
      .accessibilityIdentifier("clawdad.assistant.copy.\(id)")
      .task(id: copied) {
        guard copied else { return }
        try? await Task.sleep(for: .milliseconds(1500))
        if !Task.isCancelled { copied = false }
      }
  }
}

private enum AssistantHistoryItem: Identifiable {
  case message(AssistantMessage), task(AssistantTaskRecord)
  var id: String {
    switch self { case .message(let m): m.id; case .task(let t): t.id }
  }
  var date: String {
    switch self { case .message(let m): m.createdAt; case .task(let t): t.createdAt ?? "" }
  }
}

struct AssistantChatHistory: View {
  let snapshot: AssistantSnapshot?
  var selection: AssistantMessageSelection? = nil
  var playingMessageID: String? = nil
  var preparingPlayback = false
  var pausedPlayback = false
  var play: (String, String) -> Void = { _, _ in }
  var watch: (String) -> Void
  var cancel: (String) -> Void
  var replyScrollTarget: String?
  var replyScrollRevision = 0
  private var items: [AssistantHistoryItem] {
    ((snapshot?.messages ?? []).map(AssistantHistoryItem.message)
      + (snapshot?.tasks ?? []).filter { $0.action.hasPrefix("terminal.") || $0.action == "message" || $0.status == "attention" }
        .map(AssistantHistoryItem.task)).sorted { ($0.date, $0.id) < ($1.date, $1.id) }
  }
  var body: some View {
    ForEach(items) { item in
      switch item {
      case .message(let message):
        VStack(alignment: .leading, spacing: 5) {
          HStack {
            Text(message.role == "user" ? "You" : "Assistant").font(.caption.bold())
              .foregroundStyle(ClawDadTheme.gold)
            Spacer()
            speaker(message.text, id: message.id)
            AssistantCopyButton(text: message.text, label: "\(message.role) message", id: message.id)
          }
          AssistantResponseText(text: message.text, id: message.id, selection: selection)
            .assistantReplyScrollAnchor(active: replyScrollTarget == message.id, revision: replyScrollRevision)
          ForEach(message.images ?? [], id: \.id) { image in
            Label(image.fileName, systemImage: "photo").font(.footnote)
          }
        }.frame(maxWidth: .infinity, alignment: .leading).id(message.id)
      case .task(let task):
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            Text("\(task.displayName ?? "Terminal agent") · \(task.displayStatus)").font(.subheadline.bold())
            Spacer()
            speaker(task.requestText ?? task.args["text"]?.string ?? "", id: "request.\(task.id)")
            AssistantCopyButton(text: task.requestText ?? task.args["text"]?.string ?? "",
              label: "task request", id: "request.\(task.id)")
          }
          AssistantSelectableText(text: task.requestText ?? task.args["text"]?.string ?? "",
            id: "request.\(task.id)", selection: selection)
          if let error = task.error { Text(error).foregroundStyle(ClawDadTheme.gold).font(.footnote) }
          if task.action == "message", task.status == "running", task.progress?["stage"]?.string == "quiet" {
            Text("The Mac has not reported new progress recently. You can keep waiting or cancel this response.")
              .font(.footnote).foregroundStyle(.secondary)
          }
          if task.action != "message", let response = task.response, !response.isEmpty {
            HStack {
              Text("Assistant").font(.caption.bold()).foregroundStyle(ClawDadTheme.gold)
              Spacer()
              speaker(response, id: "result.\(task.id)")
              AssistantCopyButton(text: response, label: "Assistant result", id: "result.\(task.id)")
            }
            AssistantResponseText(text: response, id: "result.\(task.id)", selection: selection)
          }
          HStack {
            if let tab = task.args["tabId"]?.string { Button("Watch in Terminal") { watch(tab) } }
            if task.status == "queued" { Button("Cancel") { cancel(task.id) } }
            if task.action == "message", task.status == "running" {
              Button("Cancel response") { cancel(task.id) }.frame(minHeight: 44)
                .accessibilityHint("Stops this Assistant response. Already accepted project work continues.")
            }
          }.font(.footnote)
        }.padding(12).background(ClawDadTheme.cream.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
          .id(task.id)
      }
    }
  }
  private func speaker(_ text: String, id: String) -> some View {
    let active = playingMessageID == id
    return Button { play(id, text) } label: {
      Image(systemName: active ? (pausedPlayback ? "play.circle.fill" : "stop.circle.fill") : "speaker.wave.2")
        .font(.system(size: 18))
        .frame(width: 44, height: 44)
        .background(active ? ClawDadTheme.gold.opacity(0.18) : .clear, in: Circle())
    }.buttonStyle(.plain).disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      .accessibilityLabel(active ? (pausedPlayback ? "Resume reading message" : "Stop reading message") : "Read message aloud")
      .accessibilityValue(active ? (pausedPlayback ? "Paused" : preparingPlayback ? "Preparing audio" : "Playing") : "Stopped")
      .accessibilityAddTraits(active ? .isSelected : [])
      .accessibilityIdentifier("clawdad.assistant.speak.\(id)")
  }
}
