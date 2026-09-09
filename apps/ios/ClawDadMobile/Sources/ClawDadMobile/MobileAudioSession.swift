import AVFoundation
import Foundation

/// Both dictation surfaces and Read Aloud share the phone's single audio session.
/// A playback reservation covers preparation too, so capture can reject late audio.
@MainActor
final class MobileAudioSession {
  enum Use { case recording, playback, conversation }
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

  func beginConversation(onReplaced: @escaping () -> Void) throws -> UUID {
    try requireAvailableMicrophone()
    releaseCurrentOwner()
    let id=UUID()
    owner=Owner(id:id,use:.conversation,onReplaced:onReplaced)
    do {try activate(.conversation);owner?.active=true;return id}
    catch {release(id);throw error}
  }

  func activatePlayback(_ id: UUID) throws {
    guard owner?.id == id, owner?.use == .playback else { throw AudioError.expired }
    try activate(.playback)
    owner?.active = true
  }

  func reactivateConversation(_ id: UUID) throws {
    guard owner?.id == id, owner?.use == .conversation else { throw AudioError.expired }
    try activate(.conversation)
    owner?.active = true
  }

  func suspendConversationMicrophone(_ id: UUID) throws {
    guard owner?.id == id, owner?.use == .conversation else { throw AudioError.expired }
    // The conversation reservation remains owned, but iOS now has an output-
    // only session. Removing an input tap alone would leave hardware capture on.
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
    if owner?.use == .conversation { throw AudioError.conversationInProgress }
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
    case .conversation:
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
      try session.setAllowHapticsAndSystemSoundsDuringRecording(true)
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
    case recordingInProgress, conversationInProgress, expired
    var errorDescription: String? {
      switch self {
      case .recordingInProgress: return "Finish dictation before starting audio playback."
      case .conversationInProgress: return "End the Assistant voice conversation before using another microphone or playback control."
      case .expired: return "This audio was stopped. Tap the speaker to read it again."
      }
    }
  }
}
