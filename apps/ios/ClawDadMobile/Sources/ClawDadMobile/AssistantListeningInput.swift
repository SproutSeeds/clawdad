import ClawDadRemoteAssistProtocol
import Foundation

/// Keep the audio engine receiving while excluding reply audio from STT.
struct AssistantListeningInput {
  var muted = false {
    didSet { if muted != oldValue { reset() } }
  }
  private(set) var replyActive = false
  private var resumeAt: TimeInterval = 0
  private var lastPreviewAt: TimeInterval = 0
  private var detector: AssistantVoiceActivity
  private(set) var lastSpeechAt: TimeInterval?
  var sampleRate: Double { detector.sampleRate }

  init(sampleRate: Double) { detector = AssistantVoiceActivity(sampleRate: sampleRate) }

  func acceptsInput(capturedAt time: TimeInterval) -> Bool {
    !muted && !replyActive && time >= resumeAt
  }

  mutating func setReplyActive(_ active: Bool, at time: TimeInterval) {
    guard replyActive != active else { return }
    replyActive = active
    // Discard the speaker's acoustic tail, including callbacks queued before
    // playback ended. Manual mute remains independent of this temporary hold.
    resumeAt = active ? .infinity : time + 0.35
    reset()
  }

  mutating func configure(sampleRate: Double) {
    detector = AssistantVoiceActivity(sampleRate: sampleRate)
    lastPreviewAt = 0
  }

  mutating func reset() { detector.reset(); lastPreviewAt = 0; lastSpeechAt = nil }

  mutating func finish() -> [Float]? {
    guard !muted, !replyActive else { return nil }
    return detector.finish()
  }
  func preview() -> [Float]? { !muted && !replyActive ? detector.pendingSpeech : nil }

  mutating func consume(_ values: [Float], capturedAt time: TimeInterval) -> (
    started: Bool, utterance: [Float]?, final: Bool, preview: [Float]?
  ) {
    guard acceptsInput(capturedAt: time) else { return (false, nil, false, nil) }
    let event = detector.consume(values)
    if detector.speaking, detector.trailingSilenceDuration == 0 { lastSpeechAt = time }
    if event.started || event.utterance != nil { lastPreviewAt = time }
    var preview: [Float]?
    if event.utterance == nil, time - lastPreviewAt >= 3,
      let pending = detector.pendingSpeech {
      lastPreviewAt = time
      preview = pending
    }
    return (event.started, event.utterance, event.final, preview)
  }
}
