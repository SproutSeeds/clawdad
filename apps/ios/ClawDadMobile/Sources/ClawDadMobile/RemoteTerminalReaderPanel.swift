#if os(iOS)
import SwiftUI
import UIKit

struct RemoteTerminalReaderPanel: View {
  @ObservedObject var controller: RemoteAssistController
  @ObservedObject var reader: RemoteTerminalReader
  @EnvironmentObject private var audio: MobileReadAloudController
  var onClose: () -> Void
  @State private var copied = false

  private var phase: MobileReadAloudPhase { audio.phase(for: reader.playbackKey) }
  private var available: Bool {
    controller.phase == .connected && controller.supportsTerminalReadAloud && !controller.remoteScreenLocked
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Button(action: close) { Label("Back", systemImage: "chevron.left") }
          .keyboardShortcut(.cancelAction)
          .accessibilityIdentifier("clawdad.remote.reader.back")
        Spacer()
        Text("Read Aloud").font(.headline)
        Spacer()
        Button("Stop") { controller.cancelTerminalLookup(); reader.stopPlayback() }
          .disabled(!reader.loading && ![.preparing, .playing, .paused].contains(phase))
          .accessibilityIdentifier("clawdad.remote.reader.stop")
      }
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(ClawDadTheme.gold)

      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          if reader.loading {
            HStack { ProgressView(); Text("Finding the selected tab’s latest response…") }
          }
          if !reader.text.isEmpty {
            Text(reader.title).font(.headline)
              .accessibilityIdentifier("clawdad.remote.reader.source")
            if !reader.completedAt.isEmpty {
              Text("Completed \(formattedTime)")
                .font(.caption).foregroundStyle(ClawDadTheme.cream.opacity(0.75))
            }
            if reader.inProgress {
              Text("Response in progress. The completed answer below is from the previous turn.")
                .foregroundStyle(ClawDadTheme.gold)
            }
            Text(reader.text)
              .frame(maxWidth: .infinity, alignment: .leading)
              .textSelection(.enabled)
              .padding(12)
              .background(ClawDadTheme.cream.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
              .accessibilityIdentifier("clawdad.remote.reader.text")
            Button { reader.togglePlayback() } label: {
              Label(playLabel, systemImage: phase == .playing ? "pause.fill" : "play.fill")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(ClawDadPrimaryButtonStyle())
            .disabled(reader.loading || phase == .preparing || !available)
            .accessibilityIdentifier("clawdad.remote.reader.play")
            if !audio.message(for: reader.playbackKey).isEmpty {
              Text(audio.message(for: reader.playbackKey))
                .font(.footnote).foregroundStyle(ClawDadTheme.gold)
            }
            Button {
              UIPasteboard.general.string = reader.text
              copied = true
            } label: {
              Label(copied ? "Copied to iPhone" : "Copy text to iPhone", systemImage: "doc.on.doc")
            }
            .buttonStyle(ClawDadCompactButtonStyle())
            .accessibilityIdentifier("clawdad.remote.reader.copy")
          }
          if !reader.error.isEmpty {
            Text(reader.error).foregroundStyle(ClawDadTheme.peach)
              .accessibilityIdentifier("clawdad.remote.reader.error")
          }
          if !controller.supportsTerminalReadAloud {
            Text("Update ClawDad on your Mac to read Terminal responses here.")
          }
          Button { copied = false; controller.requestLatestTerminalResponse() } label: {
            Label("Read latest response", systemImage: "speaker.wave.2.fill")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(ClawDadCompactButtonStyle())
          .disabled(reader.loading || !available)
          .accessibilityIdentifier("clawdad.remote.reader.refresh")

          Button { copied = false; controller.readSelectedMacText() } label: {
            Label("Read selected text", systemImage: "text.cursor")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(ClawDadCompactButtonStyle())
          .disabled(reader.loading || !available || controller.clipboardBusy || controller.remoteInputSuppressed)
          .accessibilityIdentifier("clawdad.remote.reader.selection")
          Text("Reads the latest completed Codex answer from the selected Terminal tab. For other text, select it on the Mac and choose Read selected text.")
            .font(.footnote).foregroundStyle(ClawDadTheme.cream.opacity(0.75))
        }
        .font(.subheadline)
      }
    }
    .padding(20)
    .foregroundStyle(ClawDadTheme.cream)
    .background(ClawDadTheme.background)
    .onDisappear { controller.cancelTerminalLookup() }
  }

  private var playLabel: String {
    switch phase {
    case .playing: "Pause"
    case .paused: "Resume"
    case .preparing: "Preparing audio…"
    default: reader.inProgress ? "Read previous completed response" : "Play response"
    }
  }

  private var formattedTime: String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = formatter.date(from: reader.completedAt) ?? ISO8601DateFormatter().date(from: reader.completedAt)
    return date?.formatted(date: .abbreviated, time: .shortened) ?? reader.completedAt
  }

  private func close() { controller.cancelTerminalLookup(); onClose() }
}

struct RemoteTerminalMiniPlayer: View {
  @ObservedObject var controller: RemoteAssistController
  @ObservedObject var reader: RemoteTerminalReader
  @EnvironmentObject private var audio: MobileReadAloudController
  var onOpen: () -> Void
  private var phase: MobileReadAloudPhase { audio.phase(for: reader.playbackKey) }

  var body: some View {
    Group {
      if [.preparing, .playing, .paused].contains(phase) {
        HStack(spacing: 12) {
          Button(action: onOpen) {
            Text(reader.title).lineLimit(1).frame(maxWidth: 140)
          }
          Button { reader.togglePlayback() } label: {
            Image(systemName: phase == .playing ? "pause.fill" : "play.fill")
          }
          .disabled(phase == .preparing)
          .accessibilityLabel(phase == .playing ? "Pause Read Aloud" : "Resume Read Aloud")
          Button { reader.stopPlayback() } label: { Image(systemName: "stop.fill") }
            .accessibilityLabel("Stop Read Aloud")
        }
        .font(.subheadline.weight(.semibold))
        .padding(12)
        .foregroundStyle(ClawDadTheme.gold)
        .background(ClawDadTheme.background, in: Capsule())
      }
    }
    .task(id: !reader.sourceTabId.isEmpty && (!reader.text.isEmpty || reader.loading)) {
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
