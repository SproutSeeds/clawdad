import SwiftUI
import PhotosUI
import ImageIO
import ClawDadRemoteAssistProtocol
#if canImport(UIKit)
import UIKit
#endif

struct AssistantChatComposer: View {
  @ObservedObject var controller: MobileAssistantController
  @ObservedObject var draft: AssistantChatDraftStore
  @State private var showPhotos = false
  @State private var selectedPhotos: [PhotosPickerItem] = []
  @State private var preview: RemoteImageUpload?
  @State private var confirmClear = false
  @State private var showCapacityDetails = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !draft.error.isEmpty { Text(draft.error).font(.footnote).foregroundStyle(ClawDadTheme.gold) }
      if let problem = controller.chatCapacityProblem {
        Button { showCapacityDetails = true } label: {
          HStack {
            Text("Message too large").font(.footnote).fixedSize(horizontal: false, vertical: true)
              .accessibilityIdentifier("clawdad.assistant.capacity-warning")
            Image(systemName: "info.circle").frame(width: 44, height: 44)
          }.foregroundStyle(ClawDadTheme.gold)
        }.accessibilityLabel("Message size details")
          .alert("Message size", isPresented: $showCapacityDetails) {
            Button("Keep editing", role: .cancel) { }
          } message: { Text(problem) }
      }
      ForEach(draft.unprocessed) { saved in
        DisclosureGroup("Unprocessed message · Review") {
          Text(saved.failure ?? "The Mac could not finish this message. It has been kept for review.")
            .font(.footnote).foregroundStyle(ClawDadTheme.gold)
          Text("The complete text and attached images are saved. Recover the message to edit it.").font(.caption)
          ForEach(saved.draft.images, id: \.id) { Label($0.fileName, systemImage: "photo").font(.caption) }
          Text("Check the original message before resending. Recovery keeps its request ID; editing creates a new draft.").font(.caption)
          Button("Recover to draft") { draft.recoverAccepted(saved.id) }
            .frame(minHeight: 44).disabled(controller.sending || !draft.value.isEmpty)
          if !draft.value.isEmpty { Text("Send or clear your current draft first.").font(.caption) }
        }
      }
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
        AssistantChatTextInput(text: Binding(get: { draft.value.text }, set: { draft.setText($0) }))
          .overlay(alignment: .topLeading) {
            if draft.value.text.isEmpty {
              Text("Message Assistant").foregroundStyle(.secondary).padding(12)
                .allowsHitTesting(false).accessibilityHidden(true)
            }
          }
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

#if canImport(UIKit)
/// A bounded native editor keeps large pasted drafts scrollable and visible.
/// SwiftUI's vertical TextField can collapse to a blank final line on large input.
private struct AssistantChatTextInput: UIViewRepresentable {
  @Binding var text: String
  @Environment(\.isEnabled) private var enabled
  @Environment(\.sizeCategory) private var sizeCategory
  func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
  func makeUIView(context: Context) -> UITextView {
    let view = UITextView()
    view.delegate = context.coordinator
    view.backgroundColor = .clear
    view.isScrollEnabled = true
    view.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
    view.adjustsFontForContentSizeCategory = true
    view.accessibilityIdentifier = "clawdad.assistant.composer"
    view.accessibilityLabel = "Message Assistant"
    view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    return view
  }
  func updateUIView(_ view: UITextView, context: Context) {
    context.coordinator.parent = self
    view.font = .preferredFont(forTextStyle: .body)
    view.textColor = UIColor(ClawDadTheme.cream)
    view.tintColor = UIColor(ClawDadTheme.gold)
    view.isEditable = enabled
    if view.text != text {
      view.text = text
      view.selectedRange = NSRange(location: (text as NSString).length, length: 0)
      view.scrollRangeToVisible(view.selectedRange)
    }
  }
  func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
    guard let width = proposal.width, width > 0 else { return nil }
    let line = uiView.font?.lineHeight ?? 24
    // Avoid measuring an entire long document to lay out the composer.
    let height = text.utf8.count > 400 ? line * 5 + 24
      : uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
    return CGSize(width: width, height: min(156, line * 5 + 24, max(44, height)))
  }
  @MainActor final class Coordinator: NSObject, UITextViewDelegate {
    var parent: AssistantChatTextInput
    init(parent: AssistantChatTextInput) { self.parent = parent }
    func textViewDidChange(_ view: UITextView) { parent.text = view.text }
  }
}
#else
private struct AssistantChatTextInput: View {
  @Binding var text: String
  var body: some View {
    TextField("Message Assistant", text: $text, axis: .vertical)
      .lineLimit(1...5).textFieldStyle(.plain).padding(12)
  }
}
#endif

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
