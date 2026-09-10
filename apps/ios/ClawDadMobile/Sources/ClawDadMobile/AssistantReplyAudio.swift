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
  private let fallback = AssistantDeviceSpeech()
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
    fallback.stop()
    epoch = UUID()
    let done = completion
    completion = nil
    player?.stop()
    player = nil
    delegate = nil
    done?.resume(throwing: CancellationError())
  }

  func speakFallback(_ text: String) async throws {
    stop()
    fallback.onStarted = { [weak self] in self?.onStarted?() }
    try await fallback.speak(text)
  }
}

/// Device speech is a per-reply fallback, never a saved voice preference. It
/// shares the current playback audio session and cannot activate a microphone.
@MainActor
private final class AssistantDeviceSpeech: NSObject, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private var completion: CheckedContinuation<Void, Error>?
  private var utterance: AVSpeechUtterance?
  var onStarted: (() -> Void)?
  override init() { super.init(); synthesizer.delegate = self }
  func speak(_ text: String) async throws {
    try Task.checkCancellation()
    stop()
    let item = AVSpeechUtterance(string: text)
    utterance = item
    let identifier = ObjectIdentifier(item)
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        completion = continuation
        synthesizer.speak(item)
      }
    } onCancel: { Task { @MainActor [weak self] in
      guard let self, let active = self.utterance, ObjectIdentifier(active) == identifier else { return }
      self.stop()
    } }
  }
  func stop() {
    let done = completion; completion = nil; utterance = nil
    synthesizer.stopSpeaking(at: .immediate)
    done?.resume(throwing: CancellationError())
  }
  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
    let identifier = ObjectIdentifier(utterance)
    Task { @MainActor [weak self] in guard let self, let active = self.utterance, ObjectIdentifier(active) == identifier else { return }; self.onStarted?() }
  }
  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    let identifier = ObjectIdentifier(utterance)
    Task { @MainActor [weak self] in
      guard let self, let active = self.utterance, ObjectIdentifier(active) == identifier else { return }
      let done = completion; completion = nil; self.utterance = nil; done?.resume()
    }
  }
  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    let identifier = ObjectIdentifier(utterance)
    Task { @MainActor [weak self] in
      guard let self, let active = self.utterance, ObjectIdentifier(active) == identifier else { return }
      let done = completion; completion = nil; self.utterance = nil; done?.resume(throwing: CancellationError())
    }
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
