import AVFoundation
import Foundation

@MainActor
protocol MobileSpeechEngine: AnyObject {
  func start(text: String, onStart: @escaping () -> Void, onFinish: @escaping (Bool) -> Void) throws
  func pause() -> Bool
  func resume() -> Bool
  func stop()
}

@MainActor
final class AppleMobileSpeechEngine: NSObject, MobileSpeechEngine, AVSpeechSynthesizerDelegate {
  private var synthesizer: AVSpeechSynthesizer?
  private var utteranceID: ObjectIdentifier?
  private var onStart: (() -> Void)?
  private var onFinish: ((Bool) -> Void)?

  func start(text: String, onStart: @escaping () -> Void, onFinish: @escaping (Bool) -> Void) throws {
    stop()
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.language.languageCode?.identifier ?? "en")
      ?? AVSpeechSynthesisVoice(language: "en-US")
    guard utterance.voice != nil else { throw URLError(.resourceUnavailable) }
    let synthesizer = AVSpeechSynthesizer()
    synthesizer.delegate = self
    self.synthesizer = synthesizer
    self.utteranceID = ObjectIdentifier(utterance)
    self.onStart = onStart
    self.onFinish = onFinish
    synthesizer.speak(utterance)
  }

  func pause() -> Bool { synthesizer?.pauseSpeaking(at: .immediate) == true }
  func resume() -> Bool { synthesizer?.continueSpeaking() == true }
  func stop() {
    utteranceID = nil
    onStart = nil
    onFinish = nil
    synthesizer?.delegate = nil
    synthesizer?.stopSpeaking(at: .immediate)
    synthesizer = nil
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
    let id = ObjectIdentifier(utterance)
    Task { @MainActor [weak self] in
      guard let self, self.utteranceID == id else { return }
      self.onStart?()
    }
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    finish(utterance, successfully: true)
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    finish(utterance, successfully: false)
  }

  private nonisolated func finish(_ utterance: AVSpeechUtterance, successfully: Bool) {
    let id = ObjectIdentifier(utterance)
    Task { @MainActor [weak self] in
      guard let self, self.utteranceID == id else { return }
      self.onFinish?(successfully)
    }
  }
}
