#if os(iOS)
import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import ImageIO
import ClawDadRemoteAssistProtocol

struct RemoteImageButton: View {
  @ObservedObject var controller: RemoteAssistController
  @ObservedObject var transfer: RemoteImageTransfer
  @State private var showPhotos = false
  @State private var showFiles = false
  @State private var selectedPhotos: [PhotosPickerItem] = []
  @State private var targetToken: String?
  @State private var importing = false
  @State private var importTask: Task<Void, Never>?

  var body: some View {
    Menu {
      Button("Photo Library", systemImage: "photo.on.rectangle") {
        targetToken = controller.imageSelectionTarget()
        showPhotos = true
      }
      Button("Browse Files", systemImage: "folder") {
        targetToken = controller.imageSelectionTarget()
        showFiles = true
      }
      if transfer.needsPaste {
        Button("Paste saved images", systemImage: "doc.on.clipboard") {
          transfer.pasteSaved(targetToken: controller.imageSelectionTarget(forceFresh: true))
        }
      }
    } label: {
      Image(systemName: "photo.badge.plus")
        .font(.system(size: 19, weight: .bold))
        .frame(width: 44, height: 44)
        .overlay { if importing { ProgressView().tint(ClawDadTheme.gold) } }
    }
    .buttonStyle(RemoteAssistOverlayButtonStyle())
    .disabled(importing || transfer.busy || transfer.attaching || controller.phase != .connected || controller.remoteScreenLocked || controller.remoteInputSuppressed || controller.sessionCapabilities.imageAttachments != true)
    .accessibilityLabel("Attach photos to Terminal")
    .accessibilityIdentifier("clawdad.remote.images")
    .photosPicker(isPresented: $showPhotos, selection: $selectedPhotos, maxSelectionCount: RemoteImageLimits.count, matching: .images, preferredItemEncoding: .current)
    .onChange(of: selectedPhotos) { _, items in
      guard !items.isEmpty else { return }
      importing = true
      let token = targetToken
      importTask = Task { @MainActor in
        defer { importing = false; selectedPhotos = []; importTask = nil }
        do {
          var sources: [(Data, String?)] = []
          var sourceBytes = 0
          for item in items {
            try Task.checkCancellation()
            guard let data = try await item.loadTransferable(type: Data.self) else { throw RemoteImagePreparation.failure("The photo could not be loaded. Choose it again.") }
            sourceBytes += data.count
            guard sourceBytes <= RemoteImageLimits.batchBytes else { throw RemoteImagePreparation.failure("Choose a group of images smaller than 80 MB.") }
            sources.append((data, nil))
          }
          try Task.checkCancellation()
          transfer.prepare(sources, targetToken: token, clipboardChangeCount: UIPasteboard.general.changeCount)
        } catch is CancellationError { }
        catch { transfer.presentError(error.localizedDescription) }
      }
    }
    .fileImporter(isPresented: $showFiles, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
      switch result {
      case .success(let urls):
        guard !urls.isEmpty, urls.count <= RemoteImageLimits.count else { transfer.presentError("Choose up to eight images at a time."); return }
        let token = targetToken
        importing = true
        importTask = Task { @MainActor in
          defer { importing = false; importTask = nil }
          do {
            let sources = try await Task.detached(priority: .userInitiated) {
              var sourceBytes = 0
              return try urls.map { url -> (Data, String?) in
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                let info = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                guard info.isRegularFile == true, let size = info.fileSize, size <= 80 * 1024 * 1024 else { throw RemoteImagePreparation.failure("Choose an image smaller than 80 MB.") }
                sourceBytes += size
                guard sourceBytes <= RemoteImageLimits.batchBytes else { throw RemoteImagePreparation.failure("Choose a group of images smaller than 80 MB.") }
                return (try Data(contentsOf: url, options: .mappedIfSafe), url.lastPathComponent)
              }
            }.value
            try Task.checkCancellation()
            transfer.prepare(sources, targetToken: token, clipboardChangeCount: UIPasteboard.general.changeCount)
          } catch is CancellationError { }
          catch { transfer.presentError(error.localizedDescription) }
        }
      case .failure(let error): transfer.presentError(error.localizedDescription)
      }
    }
    .onDisappear { importTask?.cancel(); importTask = nil; importing = false }
  }
}

struct RemoteImageStatus: View {
  @ObservedObject var transfer: RemoteImageTransfer
  var body: some View {
    if transfer.visible {
      HStack(spacing: 10) {
        if let image = transfer.images.first {
          RemoteImageThumbnail(image: image)
        } else { Image(systemName: "photo.on.rectangle").foregroundStyle(ClawDadTheme.gold) }
        VStack(alignment: .leading, spacing: 4) {
          Text(transfer.error.isEmpty ? transfer.status : transfer.error).font(.caption.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
          if transfer.busy { ProgressView(value: transfer.progress).tint(ClawDadTheme.gold) }
        }
        if transfer.busy {
          Button { transfer.pause() } label: { Image(systemName: "pause.fill").frame(width: 36, height: 40) }
            .accessibilityLabel("Pause image transfer")
        } else if !transfer.attaching, !transfer.error.isEmpty || (!transfer.needsPaste && transfer.progress < 1 && !transfer.images.isEmpty) {
          Button { transfer.retry() } label: { Image(systemName: "arrow.clockwise").frame(width: 36, height: 40) }
            .accessibilityLabel("Retry image transfer")
        }
        if transfer.attaching { ProgressView().tint(ClawDadTheme.gold) }
        Button { transfer.discard() } label: { Image(systemName: "xmark").frame(width: 32, height: 40) }
          .accessibilityLabel("Dismiss image transfer")
      }
      .buttonStyle(.plain)
      .foregroundStyle(ClawDadTheme.cream)
      .padding(10)
      .frame(maxWidth: 330)
      .background(Color.black.opacity(0.84), in: RoundedRectangle(cornerRadius: 14))
      .accessibilityIdentifier("clawdad.remote.imageStatus")
    }
  }

}

private struct RemoteImageThumbnail: View {
  let image: PreparedRemoteImage
  @State private var thumbnail: UIImage?
  var body: some View {
    Group {
      if let thumbnail { Image(uiImage: thumbnail).resizable().scaledToFit() }
      else { Image(systemName: "photo") }
    }.frame(width: 38, height: 38).accessibilityHidden(true)
      .task(id: image.id) {
        guard let source = CGImageSourceCreateWithData(image.data as CFData, nil),
              let preview = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 100] as CFDictionary) else { return }
        thumbnail = UIImage(cgImage: preview)
      }
  }
}
#endif
