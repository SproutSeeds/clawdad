import AVFoundation
import Foundation

/// Reply playback owns no microphone or capture engine. A full microphone-off
/// transition can therefore keep the current reply and call connected.
@MainActor
final class AssistantReplyAudio {
  var onStarted: (() -> Void)?
  private var player: AVAudioPlayer?
  private var delegate: AssistantClipDelegate?
  private var completion: CheckedContinuation<Void, Error>?
  private var epoch = UUID()
  private let volume: Float
  init(volume: Float = 1) { self.volume = volume }

  func play(_ data: Data) async throws {
    try Task.checkCancellation()
    stop()
    let player = try AVAudioPlayer(data: data)
    player.volume = volume
    self.player = player
    let epoch = UUID()
    self.epoch = epoch
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        completion = continuation
        let delegate = AssistantClipDelegate { [weak self] success in
          guard let self, self.epoch == epoch else { return }
          let done = completion
          completion = nil
          self.player = nil
          self.delegate = nil
          if success { done?.resume() }
          else { done?.resume(throwing: AssistantReplyAudioError.playbackFailed) }
        }
        self.delegate = delegate
        player.delegate = delegate
        guard player.prepareToPlay(), player.play() else {
          completion = nil
          self.player = nil
          self.delegate = nil
          continuation.resume(throwing: AssistantReplyAudioError.playbackFailed)
          return
        }
        onStarted?()
      }
    } onCancel: {
      Task { @MainActor [weak self] in
        guard let self, self.epoch == epoch else { return }
        stop()
      }
    }
  }

  func stop() {
    epoch = UUID()
    let done = completion
    completion = nil
    player?.stop()
    player = nil
    delegate = nil
    done?.resume(throwing: CancellationError())
  }
}

private enum AssistantReplyAudioError: LocalizedError {
  case playbackFailed
  var errorDescription: String? { "The spoken reply could not play. Its text is still available in the conversation." }
}

private final class AssistantClipDelegate: NSObject, AVAudioPlayerDelegate, Sendable {
  let completed: @MainActor @Sendable (Bool) -> Void
  init(completed: @escaping @MainActor @Sendable (Bool) -> Void) { self.completed = completed }
  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    Task { @MainActor in completed(flag) }
  }
  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    Task { @MainActor in completed(false) }
  }
}
