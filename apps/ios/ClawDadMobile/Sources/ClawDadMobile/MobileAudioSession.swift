import AVFoundation
import Foundation

/// Both dictation surfaces and Read Aloud share the phone's single audio session.
/// A playback reservation covers preparation too, so capture can reject late audio.
@MainActor
final class MobileAudioSession {
  enum Use { case recording, playback }
  static let shared = MobileAudioSession()

  private struct Owner {
    let id: UUID
    let use: Use
    var active = false
    var onReplaced: (() -> Void)?
  }

  private var owner: Owner?
  private let activate: @MainActor (Use) throws -> Void
  private let deactivate: @MainActor () -> Void

  init(
    activate: @escaping @MainActor (Use) throws -> Void = MobileAudioSession.activateSystemSession,
    deactivate: @escaping @MainActor () -> Void = MobileAudioSession.deactivateSystemSession
  ) {
    self.activate = activate
    self.deactivate = deactivate
  }

  func reservePlayback(onReplaced: @escaping () -> Void) throws -> UUID {
    try requireAvailableMicrophone()
    releaseCurrentOwner()
    let id = UUID()
    owner = Owner(id: id, use: .playback, onReplaced: onReplaced)
    return id
  }

  func beginRecording() throws -> UUID {
    try requireAvailableMicrophone()
    releaseCurrentOwner()
    let id = UUID()
    owner = Owner(id: id, use: .recording)
    do {
      try activate(.recording)
      owner?.active = true
      return id
    } catch {
      release(id)
      throw error
    }
  }

  func activatePlayback(_ id: UUID) throws {
    guard owner?.id == id, owner?.use == .playback else { throw AudioError.expired }
    try activate(.playback)
    owner?.active = true
  }

  func release(_ id: UUID) {
    guard owner?.id == id else { return }
    // Normal completion does not invoke the replacement callback.
    owner?.onReplaced = nil
    releaseCurrentOwner()
  }

  private func requireAvailableMicrophone() throws {
    if owner?.use == .recording { throw AudioError.recordingInProgress }
  }

  private func releaseCurrentOwner() {
    let previous = owner
    owner = nil
    // Stop the old player before deactivating its session. Any delayed cleanup
    // carries its old ID and cannot release the next recording's session.
    previous?.onReplaced?()
    if previous?.active == true { deactivate() }
  }

  private static func activateSystemSession(_ use: Use) throws {
#if os(iOS)
    let session = AVAudioSession.sharedInstance()
    switch use {
    case .recording: try session.setCategory(.record, mode: .default)
    case .playback: try session.setCategory(.playback, mode: .spokenAudio)
    }
    try session.setActive(true)
#endif
  }

  private static func deactivateSystemSession() {
#if os(iOS)
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
#endif
  }

  enum AudioError: LocalizedError {
    case recordingInProgress, expired
    var errorDescription: String? {
      switch self {
      case .recordingInProgress: return "Finish dictation before starting audio playback."
      case .expired: return "This audio was stopped. Tap the speaker to read it again."
      }
    }
  }
}
