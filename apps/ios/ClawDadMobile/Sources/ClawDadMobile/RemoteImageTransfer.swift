import Foundation
import SwiftUI
import ClawDadRemoteAssistProtocol

@MainActor
final class RemoteImageTransfer: ObservableObject {
  @Published private(set) var images: [PreparedRemoteImage] = []
  @Published private(set) var busy = false
  @Published private(set) var attaching = false
  @Published private(set) var progress: Double = 0
  @Published private(set) var status = ""
  @Published private(set) var error = ""
  @Published private(set) var visible = false
  @Published private(set) var needsPaste = false
  private(set) var clipboardChangeCount = 0
  private let files = MobileFilesController()
  private weak var session: CloudSession?
  private var send: ((Data) -> Bool)?
  private var canAttach: (() -> Bool)?
  private var scope = ""
  private var work: Task<Void, Never>?
  private var receiptWait: Task<Void, Never>?
  private var dismissTask: Task<Void, Never>?
  private var generation = UUID()
  private var targetToken: String?
  private var attachment: RemoteImageAttachmentMessage?
  private var uploaded = false
  typealias Upload = @MainActor ([PreparedRemoteImage], @escaping @MainActor (Double) -> Void) async throws -> Void
  private let uploadOverride: Upload?

  init(upload: Upload? = nil) {
    uploadOverride = upload
  }

  private var belongsToActiveComputer: Bool {
    guard let session else { return false }
    return scope == "\(session.accountId)/\(session.workspaceId)/\(session.hostId)"
  }

  func bind(to session: CloudSession, canAttach: @escaping () -> Bool, send: @escaping (Data) -> Bool) {
    let newScope = "\(session.accountId)/\(session.workspaceId)/\(session.hostId)"
    if scope != newScope { discard(); scope = newScope }
    self.session = session; self.canAttach = canAttach; self.send = send
  }

  func presentError(_ message: String) { error = message; visible = true }

  func prepare(_ sources: [(Data, String?)], targetToken: String?, clipboardChangeCount: Int) {
    guard !busy, !attaching else { return }
    guard !sources.isEmpty, sources.count <= RemoteImageLimits.count else { presentError("Choose up to eight images at a time."); return }
    guard sources.reduce(0, { $0 + $1.0.count }) <= RemoteImageLimits.batchBytes else { presentError("Choose a group of images smaller than 80 MB."); return }
    discard()
    self.targetToken = targetToken; self.clipboardChangeCount = clipboardChangeCount
    visible = true; busy = true; status = "Preparing images…"
    let attempt = generation
    work = Task { @MainActor [weak self] in
      guard let self else { return }
      do {
        let prepared = try await Task.detached(priority: .userInitiated) {
          var images: [PreparedRemoteImage] = []
          var total = 0
          for source in sources {
            try Task.checkCancellation()
            let image = try RemoteImagePreparation.prepare(source.0, fileName: source.1)
            total += image.data.count
            guard total <= RemoteImageLimits.batchBytes else { throw RemoteImagePreparation.failure("Choose a group of images smaller than 80 MB.") }
            images.append(image)
          }
          return images
        }.value
        guard self.generation == attempt, !Task.isCancelled else { return }
        self.images = prepared
        self.busy = false; self.work = nil
        self.retry()
      } catch {
        guard self.generation == attempt, !Task.isCancelled else { return }
        self.busy = false; self.work = nil; self.error = error.localizedDescription
      }
    }
  }

  func retry() {
    guard !images.isEmpty, !busy, !attaching, let session else { return }
    guard belongsToActiveComputer, canAttach?() == true else { presentError("Reconnect to an unlocked, updated Mac to send these images."); return }
    dismissTask?.cancel(); visible = true; error = ""
    if uploaded { deliver(); return }
    busy = true; status = "Sending \(images.count) image\(images.count == 1 ? "" : "s") to Mac…"
    let attempt = generation
    if uploadOverride == nil { files.open(to: session, imageUpload: true) }
    work = Task { @MainActor [weak self] in
      guard let self else { return }
      defer {
        if self.generation == attempt { self.busy = false; self.work = nil; self.files.close() }
      }
      do {
        let update: @MainActor (Double) -> Void = { [weak self] value in
          guard let self, self.generation == attempt else { return }
          if value == 1 || abs(value - self.progress) >= 0.005 { self.progress = value }
        }
        if let upload = self.uploadOverride { try await upload(self.images, update) }
        else { try await self.files.uploadImages(self.images, progress: update) }
        try Task.checkCancellation()
        guard self.generation == attempt else { return }
        self.uploaded = true
        self.deliver()
      } catch is CancellationError { }
      catch { if self.generation == attempt { self.error = error.localizedDescription; self.status = "Images retained. Retry resumes the transfer." } }
    }
  }

  private func deliver() {
    guard uploaded, belongsToActiveComputer, canAttach?() == true else { presentError("Images are saved on the Mac. Reconnect to paste them."); return }
    let request = attachment ?? .request(uploadIds: images.map(\.id), targetToken: targetToken, copyOnly: targetToken == nil)
    attachment = request
    guard let data = try? request.encode() else { presentError("Choose these images again."); return }
    receiptWait?.cancel(); attaching = true; needsPaste = false
    status = "Adding images to your draft…"
    let attempt = generation
    receiptWait = Task { @MainActor [weak self] in
      for delay: UInt64 in [0, 2_000_000_000, 4_000_000_000] {
        if delay > 0 { try? await Task.sleep(nanoseconds: delay) }
        guard let self, !Task.isCancelled, self.generation == attempt, self.attachment?.requestId == request.requestId else { return }
        guard self.send?(data) == true else {
          self.attaching = false; self.presentError("Images are saved on the Mac. Reconnect to finish pasting."); return
        }
      }
      try? await Task.sleep(nanoseconds: 8_000_000_000)
      guard let self, !Task.isCancelled, self.generation == attempt else { return }
      self.attaching = false
      self.presentError("The Mac has not confirmed the paste. Retry checks the same request without pasting twice.")
    }
  }

  @discardableResult
  func receive(_ data: Data) -> Bool {
    guard let message = try? RemoteImageAttachmentMessage.decode(data), message.type == "images.attach.result" else { return false }
    guard message.requestId == attachment?.requestId else { return true }
    guard message.uploadIds == attachment?.uploadIds else { presentError("The Mac returned a different attachment receipt. Retry your saved images."); return true }
    receiptWait?.cancel(); receiptWait = nil; attaching = false
    if let error = message.error { presentError(error); return true }
    error = ""; visible = true
    needsPaste = message.disposition == "copied"
    if needsPaste, let pasted = message.pastedCount, pasted > 0, pasted < images.count {
      images = Array(images.dropFirst(pasted))
      attachment = nil
    }
    status = needsPaste ? "Images saved on Mac. Select your Terminal draft and tap Paste." : "Images sent to your Terminal draft."
    if !needsPaste {
      dismissTask = Task { @MainActor [weak self] in
        try? await Task.sleep(nanoseconds: 5_000_000_000)
        guard !Task.isCancelled else { return }
        self?.discard()
      }
    }
    return true
  }

  func pasteSaved(targetToken: String?) {
    guard uploaded, !busy, !attaching else { return }
    self.targetToken = targetToken; attachment = nil
    error = ""; visible = true
    deliver()
  }

  func pause() {
    generation = UUID()
    dismissTask?.cancel()
    work?.cancel(); work = nil; receiptWait?.cancel(); receiptWait = nil
    files.close(); busy = false; attaching = false
    if !images.isEmpty { status = "Images retained. Tap Retry to continue."; visible = true }
    else if visible { status = "Image preparation paused. Choose the image again." }
  }

  func disconnected() {
    pause()
    // A new connection has a new target registry. Automatic retries become
    // clipboard-only; only a fresh explicit Paste may target the current draft.
    targetToken = nil; attachment = nil
  }

  func discard() {
    generation = UUID(); pause(); dismissTask?.cancel()
    images = []; uploaded = false; attachment = nil; targetToken = nil
    progress = 0; status = ""; error = ""; visible = false; needsPaste = false
  }
}
