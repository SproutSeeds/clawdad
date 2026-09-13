import AVFoundation
import Foundation

/// Reply playback owns no microphone or capture engine. A full microphone-off
/// transition can therefore keep the current reply and call connected.
@MainActor
final class AssistantReplyAudio {
  var onStarted: (() -> Void)?
  private var player: SpeechOutputPlayer?
  private var completion: CheckedContinuation<Void, Error>?
  private var epoch = UUID()
  private var stoppedPosition: TimeInterval = 0
  var position: TimeInterval { player?.currentTime ?? stoppedPosition }
  private let volume: Float
  init(volume: Float = 1) { self.volume = volume }

  func play(_ data: Data, from position: TimeInterval = 0) async throws {
    try Task.checkCancellation()
    stop()
    stoppedPosition = position
    let player = try SpeechOutputPlayer(data: data)
    guard position.isFinite, position >= 0, position <= player.duration else { throw AssistantReplyAudioError.playbackFailed }
    player.volume = volume
    self.player = player
    let epoch = UUID()
    self.epoch = epoch
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        completion = continuation
        player.onCompletion = { [weak self] success in
          guard let self, self.epoch == epoch else { return }
          let done = completion
          completion = nil
          stoppedPosition = (success ? self.player?.duration : self.player?.currentTime) ?? stoppedPosition
          self.player = nil
          if success { done?.resume() }
          else { done?.resume(throwing: AssistantReplyAudioError.playbackFailed) }
        }
        let prepared = player.prepareToPlay()
        player.currentTime = position
        guard prepared, player.play() else {
          completion = nil
          self.player = nil
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
    stoppedPosition = player?.currentTime ?? stoppedPosition
    epoch = UUID()
    let done = completion
    completion = nil
    player?.stop()
    player = nil
    done?.resume(throwing: CancellationError())
  }

}

private enum AssistantReplyAudioError: LocalizedError {
  case playbackFailed
  var errorDescription: String? { "The spoken reply could not play. Its text is still available in the conversation." }
}
