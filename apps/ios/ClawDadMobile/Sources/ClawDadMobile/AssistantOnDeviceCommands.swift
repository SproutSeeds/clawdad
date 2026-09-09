import AVFoundation
import Foundation
#if os(iOS)
import Speech
#endif

/// This object has no transport, file, history, diagnostics or analytics access.
/// Audio and hypotheses are transient and bounded to one short local segment.
@MainActor
final class AssistantOnDeviceCommands: AssistantCommandRecognizing {
  var onCommand: ((AssistantVoiceCommand) -> Void)?
  var onFailure: (() -> Void)?
  #if os(iOS)
  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var epoch = UUID()
  private var intent = AssistantCommandIntent()
  private var beganAt: TimeInterval = 0
  private var lastSpeechAt: TimeInterval = 0
  private var endingAt: TimeInterval?
  private var finalAt: TimeInterval?
  private var skipUntilQuiet = false
  private var alternates = false
  #endif

  func prepare(requestPermission: Bool) async throws {
    #if os(iOS)
    var authorized = SFSpeechRecognizer.authorizationStatus() == .authorized
    if !authorized, requestPermission {
      authorized = await withCheckedContinuation { result in
        SFSpeechRecognizer.requestAuthorization { result.resume(returning: $0 == .authorized) }
      }
    }
    guard authorized, let next = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
      next.supportsOnDeviceRecognition, next.isAvailable else { throw AssistantVoiceControlError.unavailable }
    recognizer = next
    #else
    throw AssistantVoiceControlError.unavailable
    #endif
  }

  func consume(_ samples: [Float], sampleRate: Double, at time: TimeInterval, alternates: Bool) {
    #if os(iOS)
    self.alternates = alternates
    let power = samples.reduce(0.0) { $0 + ($1.isFinite ? Double($1) * Double($1) : 0) }
    let speech = !samples.isEmpty && sqrt(power / Double(samples.count)) > 0.008
    if speech { lastSpeechAt = time }
    if skipUntilQuiet {
      if time - lastSpeechAt > 0.7 { skipUntilQuiet = false }
      return
    }
    if let command = intent.take(at: time, lastSpeechAt: lastSpeechAt) {
      reset()
      onCommand?(command)
      return
    }
    if let finalAt {
      // Allow the same stability check for a final result; then discard it.
      if time - finalAt > 0.4 { reset() }
      return
    }
    if let endingAt {
      if time - endingAt > 3 { fail() }
      return
    }
    if request == nil {
      guard speech else { return }
      guard let recognizer, recognizer.supportsOnDeviceRecognition, recognizer.isAvailable,
        SFSpeechRecognizer.authorizationStatus() == .authorized else { fail(); return }
      let request = SFSpeechAudioBufferRecognitionRequest()
      // Both checks are mandatory: Apple only honors this flag when supported.
      request.requiresOnDeviceRecognition = true
      request.shouldReportPartialResults = true
      request.addsPunctuation = false
      request.contextualStrings = ["ClawDad mute", "ClawDad unmute"]
      self.request = request
      beganAt = time
      let epoch = epoch
      task = recognizer.recognitionTask(with: request) { [weak self] result, error in
        // Extract value types off the callback queue; never log the hypothesis
        // or the system error (which may embed recognized content).
        let text = result?.bestTranscription.formattedString
        let final = result?.isFinal == true
        let failed = error != nil
        Task { @MainActor [weak self] in
          guard let self, self.epoch == epoch else { return }
          if failed { fail(); return }
          if let text {
            intent.update(text, alternates: self.alternates, at: ProcessInfo.processInfo.systemUptime)
            if final { finalAt = ProcessInfo.processInfo.systemUptime }
          }
        }
      }
    }
    guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1),
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
      let channel = buffer.floatChannelData?[0] else { fail(); return }
    buffer.frameLength = AVAudioFrameCount(samples.count)
    samples.withUnsafeBufferPointer { if let base = $0.baseAddress { channel.update(from: base, count: samples.count) } }
    request?.append(buffer)
    if time - lastSpeechAt > 0.7 {
      request?.endAudio()
      endingAt = time
    } else if time - beganAt > 8 {
      // A long private conversation is not a command. Do not split it in the
      // middle into potentially actionable suffixes, or retain its transcript.
      reset()
      lastSpeechAt = time
      skipUntilQuiet = true
    }
    #endif
  }

  func reset() {
    #if os(iOS)
    epoch = UUID()
    request?.endAudio()
    task?.cancel()
    request = nil
    task = nil
    intent = AssistantCommandIntent()
    endingAt = nil
    finalAt = nil
    skipUntilQuiet = false
    #endif
  }
  private func fail() { reset(); onFailure?() }
}
