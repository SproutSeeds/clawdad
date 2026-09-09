import SwiftUI
import PhotosUI
import ImageIO
import ClawDadRemoteAssistProtocol

struct AssistantChatComposer: View {
  @ObservedObject var controller: MobileAssistantController
  @ObservedObject var draft: AssistantChatDraftStore
  @State private var showPhotos = false
  @State private var selectedPhotos: [PhotosPickerItem] = []
  @State private var preview: RemoteImageUpload?
  @State private var confirmClear = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !draft.error.isEmpty { Text(draft.error).font(.footnote).foregroundStyle(ClawDadTheme.gold) }
      ForEach(draft.value.recoveredVoice ?? []) { voice in
        DisclosureGroup("Unsent voice · Review") {
          Text("The microphone paused before these words were sent. Check the wording before sending.")
            .font(.caption).foregroundStyle(.secondary)
          Text(voice.text).textSelection(.enabled)
          HStack {
            Button("Use in message") { draft.useRecoveredVoice(voice.id) }
              .frame(minHeight: 44)
              .accessibilityIdentifier("clawdad.assistant.recover-voice")
            Spacer()
            Button("Discard", role: .destructive) { draft.discardRecoveredVoice(voice.id) }
              .frame(minHeight: 44)
          }.frame(minHeight: 44).disabled(controller.sending)
        }.font(.footnote)
      }
      if !draft.value.images.isEmpty {
        ScrollView(.horizontal) {
          HStack(spacing: 12) {
            ForEach(draft.value.images, id: \.id) { image in
              VStack(spacing: 2) {
                Button { preview = image } label: {
                  AssistantDraftImage(draft: draft, image: image, size: 72)
                }.accessibilityLabel("Preview \(image.fileName)")
                  .accessibilityIdentifier("clawdad.assistant.image-preview")
                Button { draft.remove(image) } label: {
                  Label("Remove", systemImage: "xmark.circle.fill").font(.caption).frame(minHeight: 32)
                }.disabled(controller.sending)
                  .accessibilityLabel("Remove \(image.fileName)")
                  .accessibilityIdentifier("clawdad.assistant.image-remove")
              }
            }
          }
        }
      }
      HStack(alignment: .bottom, spacing: 8) {
        Button { showPhotos = true } label: {
          Image(systemName: "photo.badge.plus").font(.system(size: 22)).frame(width: 44, height: 44)
            .overlay { if draft.importing { ProgressView() } }
        }.disabled(draft.importing || controller.sending || draft.value.images.count >= 4)
          .accessibilityLabel("Attach image to Assistant")
          .accessibilityIdentifier("clawdad.assistant.attach-image")
        TextField("Message Assistant", text: Binding(get: { draft.value.text }, set: { draft.setText($0) }), axis: .vertical)
          .lineLimit(1...5).textFieldStyle(.plain).padding(12)
          .background(ClawDadTheme.cream.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
          .disabled(controller.sending)
          .accessibilityIdentifier("clawdad.assistant.composer")
        Button { Task { await controller.sendDraft() } } label: {
          if controller.sending { ProgressView().frame(width: 44, height: 44) }
          else { Image(systemName: "arrow.up.circle.fill").font(.system(size: 32)).frame(width: 44, height: 44) }
        }.disabled(!controller.canSendChatInput)
          .accessibilityLabel(controller.chatSendFinishesVoice ? "Send voice turn" : "Send to Assistant")
          .accessibilityHint(controller.chatSendFinishesVoice
            ? "Finishes the held speaking turn, including while muted, after final transcription"
            : "Sends the typed message and attached images. A held voice turn stays separate.")
          .accessibilityIdentifier("clawdad.assistant.send-chat")
      }
      if !draft.value.isEmpty {
        HStack {
          Text(controller.sending ? "Sending…" : draft.error.isEmpty ? "Draft saved on this device" : "Draft kept in this conversation").font(.caption).foregroundStyle(.secondary)
          Spacer()
          Button("Clear draft", systemImage: "trash") { confirmClear = true }.font(.caption)
            .disabled(controller.sending || draft.importing)
            .accessibilityIdentifier("clawdad.assistant.clear-draft")
        }
      }
    }
    .buttonStyle(.plain)
    .photosPicker(isPresented: $showPhotos, selection: $selectedPhotos,
      maxSelectionCount: max(1, 4 - draft.value.images.count), matching: .images, preferredItemEncoding: .current)
    .onChange(of: selectedPhotos) { _, items in
      guard !items.isEmpty else { return }
      let target = draft.scope
      selectedPhotos = []
      draft.importing = true
      // This operation outlives a minimized conversation. Save to the original
      // host's draft even if the user changes computers during a Photos download.
      Task { @MainActor in
        defer { draft.importing = false }
        do {
          var images: [PreparedRemoteImage] = []
          for item in items {
            guard let data = try await item.loadTransferable(type: Data.self) else {
              throw RemoteImagePreparation.failure("The photo could not be loaded. Choose it again.")
            }
            images.append(try await Task.detached(priority: .userInitiated) { try RemoteImagePreparation.prepare(data) }.value)
          }
          try draft.add(images, to: target)
        } catch { draft.error = error.localizedDescription }
      }
    }
    .sheet(isPresented: Binding(get: { preview != nil }, set: { if !$0 { preview = nil } })) {
      NavigationStack {
        if let preview {
          AssistantDraftImage(draft: draft, image: preview, size: 320)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black).navigationTitle("Image preview")
            .toolbar {
              ToolbarItem(placement: .cancellationAction) {
                Button("Back", systemImage: "chevron.left") { self.preview = nil }
                  .keyboardShortcut(.cancelAction).accessibilityIdentifier("clawdad.assistant.preview-back")
              }
            }
        }
      }.tint(ClawDadTheme.gold)
    }
    .alert("Delete this unsent draft and its images?", isPresented: $confirmClear) {
      Button("Delete draft", role: .destructive) { draft.clear() }
      Button("Keep draft", role: .cancel) { }
    }
  }
}

private struct AssistantDraftImage: View {
  @ObservedObject var draft: AssistantChatDraftStore
  let image: RemoteImageUpload
  let size: CGFloat
  @State private var thumbnail: CGImage?
  var body: some View {
    Group {
      if let thumbnail { Image(decorative: thumbnail, scale: 1).resizable().scaledToFit() }
      else { Image(systemName: "photo").font(.title) }
    }.frame(width: size, height: size).accessibilityHidden(true)
      .task(id: image.id) {
        do {
          let data = try draft.bytes(image, scope: draft.scope)
          guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw AssistantProtocolError.invalid }
          thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(size * 3)
          ] as CFDictionary)
        } catch { draft.error = error.localizedDescription }
      }
  }
}
