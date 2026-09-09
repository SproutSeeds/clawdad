import Foundation

enum AssistantVoiceCommand: Equatable, Sendable {
  case mute, unmute

  /// A complete, standalone English command. Never search for a substring or
  /// strip surrounding words: those may be a discussion or a quotation.
  static func match(_ text: String, alternates: Bool) -> Self? {
    guard !text.contains(where: { "\"'“”‘’?".contains($0) }) else { return nil }
    let words = text.lowercased().split { " ,.!\n\t".contains($0) }.map(String.init)
    let normalized = words.joined(separator: " ")
    switch normalized {
    case "clawdad mute", "claw dad mute": return .mute
    case "clawdad unmute", "claw dad unmute", "clawdad un mute", "claw dad un mute": return .unmute
    case "please mute" where alternates: return .mute
    case "please unmute" where alternates, "please un mute" where alternates: return .unmute
    default: return nil
    }
  }
}

enum AssistantCaptureMode: Equatable, Sendable {
  case conversation, commandsOnly, off
}

/// The timestamp fence also rejects audio-thread callbacks already queued on
/// MainActor at a transition. No private buffer can become conversation audio
/// just because it is delivered after unmuting.
struct AssistantCaptureBoundary {
  private(set) var mode: AssistantCaptureMode = .off
  private(set) var beganAt: TimeInterval = .infinity
  mutating func move(to mode: AssistantCaptureMode, at time: TimeInterval) {
    self.mode = mode
    beganAt = time
  }
  func route(capturedAt: TimeInterval) -> AssistantCaptureMode {
    capturedAt >= beganAt ? mode : .off
  }
}

/// Revisions do not create new commands. Require a short quiet/stable boundary
/// before acting on a partial, so "ClawDad, mute is the phrase…" is not a trigger.
struct AssistantCommandIntent {
  private var candidate: AssistantVoiceCommand?
  private var candidateAt: TimeInterval = 0
  private var consumed = false
  mutating func update(_ text: String, alternates: Bool, at time: TimeInterval) {
    let next = AssistantVoiceCommand.match(text, alternates: alternates)
    if next != candidate { candidate = next; candidateAt = time }
  }
  mutating func take(at time: TimeInterval, lastSpeechAt: TimeInterval) -> AssistantVoiceCommand? {
    guard !consumed, let candidate, time - candidateAt >= 0.3,
      time - lastSpeechAt >= 0.35 else { return nil }
    consumed = true
    return candidate
  }
}

enum AssistantVoiceControlError: LocalizedError, Equatable {
  case unavailable, failed, background, interrupted
  var errorDescription: String? {
    switch self {
    case .unavailable:
      return "On-device English (US) voice commands are unavailable. Check Speech Recognition permission and device language support. Use the microphone button to unmute."
    case .failed:
      return "Voice recognition stopped. The microphone is fully off; use the microphone button to unmute."
    case .background:
      return "Voice reactivation paused in the background. The microphone is fully off. Return here and unmute manually."
    case .interrupted:
      return "Audio was interrupted. The microphone is fully off; unmute manually when ready."
    }
  }
}

@MainActor
protocol AssistantCommandRecognizing: AnyObject {
  var onCommand: ((AssistantVoiceCommand) -> Void)? { get set }
  var onFailure: (() -> Void)? { get set }
  func prepare(requestPermission: Bool) async throws
  func consume(_ samples: [Float], sampleRate: Double, at time: TimeInterval, alternates: Bool)
  func reset()
}
