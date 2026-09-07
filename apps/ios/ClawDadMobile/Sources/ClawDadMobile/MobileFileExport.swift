import CryptoKit
import Foundation

/// A verified, separately retained file for Quick Look and file-provider handoff.
/// Sharing a download must not depend on a list refresh or the cache's lifetime.
struct MobileFileExport: Identifiable, Sendable {
  let id: UUID
  let url: URL

  static func prepare(source: URL, version: MobileLibraryVersion, base: URL? = nil) throws -> Self {
    try version.validate()
    let info = try source.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard source.isFileURL, info.isRegularFile == true, info.fileSize == version.size else {
      throw ExportError.unavailable
    }
    let id = UUID()
    let root = base ?? FileManager.default.temporaryDirectory.appendingPathComponent("ClawDadFileExports", isDirectory: true)
    let directory = root.appendingPathComponent(id.uuidString, isDirectory: true)
    let destination = directory.appendingPathComponent(version.fileName)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    do {
      try FileManager.default.copyItem(at: source, to: destination)
      let handle = try FileHandle(forReadingFrom: destination)
      defer { try? handle.close() }
      var hash = SHA256(), size = 0
      while let bytes = try handle.read(upToCount: 64 * 1024), !bytes.isEmpty {
        hash.update(data: bytes); size += bytes.count
      }
      guard size == version.size, hash.finalize().map({ String(format: "%02x", $0) }).joined() == version.sha256 else {
        throw ExportError.changed
      }
#if os(iOS)
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
#endif
      return Self(id: id, url: destination)
    } catch {
      try? FileManager.default.removeItem(at: directory)
      throw error
    }
  }

  func remove() { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

  enum ExportError: LocalizedError {
    case unavailable, changed
    var errorDescription: String? {
      switch self {
      case .unavailable: return "This download is unavailable. Download the file again before opening or saving it."
      case .changed: return "This download no longer matches the Mac copy. Remove the iPhone download and download it again."
      }
    }
  }
}

#if os(iOS)
import QuickLook
import SwiftUI

struct MobileFileSavePicker: UIViewControllerRepresentable {
  let file: MobileFileExport
  let onComplete: (URL?) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(onComplete: onComplete) }
  func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
    let picker = UIDocumentPickerViewController(forExporting: [file.url], asCopy: true)
    picker.delegate = context.coordinator
    // Offer local storage first. The picker still lets the user choose any provider.
    let local = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
    picker.directoryURL = local
    picker.shouldShowFileExtensions = true
    return picker
  }
  func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}

  final class Coordinator: NSObject, UIDocumentPickerDelegate {
    let onComplete: (URL?) -> Void
    init(onComplete: @escaping (URL?) -> Void) { self.onComplete = onComplete }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { onComplete(urls.first) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { onComplete(nil) }
  }
}

struct MobileFileShareSheet: UIViewControllerRepresentable {
  let file: MobileFileExport
  let onComplete: (Bool, Error?) -> Void
  func makeUIViewController(context: Context) -> UIActivityViewController {
    let controller = UIActivityViewController(activityItems: [file.url], applicationActivities: nil)
    controller.completionWithItemsHandler = { _, completed, _, error in onComplete(completed, error) }
    return controller
  }
  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct MobileFilePreview: UIViewControllerRepresentable {
  let file: MobileFileExport
  let onClose: () -> Void
  func makeCoordinator() -> Coordinator { Coordinator(file: file, onClose: onClose) }
  func makeUIViewController(context: Context) -> UINavigationController {
    let preview = QLPreviewController()
    preview.dataSource = context.coordinator
    preview.navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: context.coordinator, action: #selector(Coordinator.close))
    return UINavigationController(rootViewController: preview)
  }
  func updateUIViewController(_ controller: UINavigationController, context: Context) {}
  final class Coordinator: NSObject, QLPreviewControllerDataSource {
    let file: MobileFileExport
    let onClose: () -> Void
    init(file: MobileFileExport, onClose: @escaping () -> Void) { self.file = file; self.onClose = onClose }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem { file.url as NSURL }
    @objc func close() { onClose() }
  }
}
#endif
