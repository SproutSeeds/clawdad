import Foundation

enum AssistantTranscriptionReview { case listening, editing, held }

/// Recording segments belong to a thought until it is explicitly committed.
/// A sealed turn keeps its identity through delayed STT and delivery retries.
@MainActor
final class AssistantVoiceTurn {
  let id = UUID().uuidString.lowercased()
  var parts: [String] = []
  var previewText = ""
  var displayText: String { (parts + [previewText]).filter { !$0.isEmpty }.joined(separator: " ") }
  var pendingSegments = 0
  var emptyTranscriptions = 0
  var sealed = false
  var lastAudioAt: TimeInterval = 0
  var endpointAt: TimeInterval?
  var ending = AssistantTurnEnding()
  var submittedAt: TimeInterval?
  var finalizedAt: TimeInterval?
  var lastSpeechAt: TimeInterval?
  var responseObservedAt: TimeInterval?
  var playbackPreparationAt: TimeInterval?
  var metrics: [String: Double] = [:]
  var text: String { parts.joined(separator: " ") }
  func add(_ key: String, _ value: Double) { metrics[key, default: 0] += max(0, value) }
}

/// Newly registered words own the pause deadline. Energy, punctuation changes
/// and repeated partials never reset it. Pending STT still protects final words.
struct AssistantTurnEnding {
  private(set) var lastWordAt: TimeInterval?
  private(set) var lastTranscriptAt: TimeInterval?
  private var beganAt: TimeInterval?
  private var words: [String] = []
  private var unchangedThroughAt: TimeInterval?

  mutating func speechStarted(at time: TimeInterval) {
    if beganAt == nil { beganAt = time }
  }

  @discardableResult mutating func transcript(_ text: String, capturedAt: TimeInterval,
    receivedAt: TimeInterval) -> Bool {
    let next = text.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init)
    // Punctuation, capitalization and repeated/retracted partial hypotheses do
    // not represent another spoken word. Only extending the known word sequence
    // moves the deadline; corrections still replace the visible/final text.
    guard next.count > words.count else {
      unchangedThroughAt = max(unchangedThroughAt ?? capturedAt, capturedAt)
      return false
    }
    words = next
    lastWordAt = max(lastWordAt ?? capturedAt, capturedAt)
    lastTranscriptAt = receivedAt
    beganAt = beganAt ?? capturedAt
    unchangedThroughAt = nil
    return true
  }

  func deadline(pause: TimeInterval) -> TimeInterval? {
    guard let anchor = lastTranscriptAt ?? beganAt else { return nil }
    return anchor + pause
  }

  func shouldFinish(at time: TimeInterval, pause: TimeInterval, thinkAloud: Bool,
    activeSpeech: Bool, transcriptionPending: Bool) -> Bool {
    guard !thinkAloud, !transcriptionPending, let deadline = deadline(pause: pause), time >= deadline else { return false }
    // A stalled recognizer is not silence. Keep recording while speech and a
    // transcription are both active. A fresh unchanged word checkpoint can
    // override room noise; genuinely new registered words restart the timer.
    if !activeSpeech { return true }
    return (unchangedThroughAt ?? -.infinity) >= deadline
  }
}
