import ClawDadRemoteAssistProtocol
import CryptoKit
import Foundation

/// One message owns one voice and an immutable prefix of audio. Kept by the
/// shared controller across navigation and recoverable connection failures.
@MainActor
final class AssistantSpeechPlayback {
  let id: String
  let batches: [String]
  let automatic: Bool
  var batch = 0
  var part = 0
  var selection: AssistantValue?
  var voice: [String: AssistantValue]?
  var audioID: String?
  var observedParts: [[String: AssistantValue]] = []
  var pendingAudio: Data?
  var position: TimeInterval = 0
  var poll = false
  var retry = false
  var stage = "synthesis"
  let diagnostics = AssistantPlaybackDiagnostics()

  init(id: String, text: String, automatic: Bool) {
    self.id = id; self.batches = AssistantMessagePlaybackText.batches(text); self.automatic = automatic
  }
  var requestID: String { "message:\(id):\(batch)" }

  func inspect(_ body: [String: AssistantValue]) throws -> [String: AssistantValue] {
    if let incoming = body["voiceSelection"] {
      if let selection, incoming != selection { throw AssistantSpeechFailure.voiceChanged }
      selection = incoming
    }
    guard let audio = body["audio"]?.object else { throw AssistantSpeechFailure.invalidAudio }
    let parts = audio["parts"]?.array?.compactMap(\.object) ?? []
    // A preparation receipt can precede its manifest. Pin metadata as soon as
    // audio exists, before fetching or playing any of it.
    if !parts.isEmpty {
      guard selection != nil, let identifier = audio["audioId"]?.string, !identifier.isEmpty,
        let provider = audio["provider"]?.string, !provider.isEmpty,
        let model = audio["modelId"]?.string, !model.isEmpty,
        let voiceID = audio["voiceId"]?.string, !voiceID.isEmpty else { throw AssistantSpeechFailure.invalidAudio }
      let engine = audio["engine"]?.string.flatMap { $0.isEmpty ? nil : $0 } ?? selection?.object?["engine"]?.string ?? model
      if let expected = selection?.object {
        guard expected["engine"]?.string == engine, expected["voice"]?.string == voiceID,
          (expected["speed"] ?? .number(1)) == (audio["speed"] ?? .number(1)) else { throw AssistantSpeechFailure.voiceChanged }
      }
      let identity: [String: AssistantValue] = ["provider": .string(provider), "model": .string(model),
        "voice": .string(voiceID), "engine": .string(engine),
        "speed": audio["speed"] ?? .number(1)]
      if let voice, identity != voice { throw AssistantSpeechFailure.voiceChanged }
      voice = identity
      if let audioID, identifier != audioID { throw AssistantSpeechFailure.cacheChanged }
      audioID = identifier
    }
    guard parts.count >= observedParts.count else { throw AssistantSpeechFailure.cacheChanged }
    let signatures = parts.map { part in
      part.filter { ["url", "bytes", "charCount", "textHash", "audioHash"].contains($0.key)
        && $0.value != .null && $0.value != .string("") }
    }
    for index in observedParts.indices {
      guard signatures[index] == observedParts[index] else { throw AssistantSpeechFailure.cacheChanged }
    }
    observedParts = signatures
    return audio
  }

  func verify(_ data: Data, part: [String: AssistantValue]) throws {
    guard !data.isEmpty else { throw AssistantSpeechFailure.invalidAudio }
    if let expected = part["audioHash"]?.string, !expected.isEmpty,
      Self.hash(data) != expected { throw AssistantSpeechFailure.cacheChanged }
  }
  func nextBatch() {
    batch += 1; part = 0; audioID = nil; observedParts = []
    pendingAudio = nil; position = 0; poll = false; retry = false
  }
  func record(_ event: String, reason: String? = nil) {
    switch event {
    case "startedOrResumed": MobileCrashDiagnostics.shared.event(.playbackStart)
    case "partCompleted": MobileCrashDiagnostics.shared.event(.playbackPart)
    case "paused": MobileCrashDiagnostics.shared.event(.playbackPause)
    case "completed", "stopped": MobileCrashDiagnostics.shared.event(.playbackStop)
    default: break
    }
    diagnostics.record(message: Self.hash(Data(id.utf8)), batch: batch, part: part, position: position,
      event: event, stage: stage, reason: reason, voice: voice, audioID: audioID)
  }
  static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
}

enum AssistantSpeechFailure: Error {
  case voiceChanged, cacheChanged, invalidAudio, synthesisFailed, stalled
  var reason: String { String(describing: self) }
  var retryable: Bool { self != .voiceChanged && self != .cacheChanged }
}

/// Bounded local playback metadata. Never stores message text or audio, raw
/// error strings, URLs, microphone samples, or speech recognition results.
@MainActor
final class AssistantPlaybackDiagnostics {
  private static var entries: [[String: AssistantValue]] = []
  func record(message: String, batch: Int, part: Int, position: TimeInterval, event: String,
    stage: String, reason: String?, voice: [String: AssistantValue]?, audioID: String?) {
    var entry: [String: AssistantValue] = ["at": .string(ISO8601DateFormatter().string(from: Date())),
      "messageHash": .string(message), "batch": .number(Double(batch)), "part": .number(Double(part)),
      "positionSeconds": .number(position), "event": .string(event), "stage": .string(stage)]
    entry["reason"] = reason.map(AssistantValue.string)
    entry["voice"] = voice.map(AssistantValue.object)
    entry["audioId"] = audioID.map(AssistantValue.string)
    Self.entries.append(entry); Self.entries = Array(Self.entries.suffix(160))
    #if os(iOS)
    do {
      var folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("ClawDad/AssistantDiagnostics")
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      var values = URLResourceValues(); values.isExcludedFromBackup = true; try folder.setResourceValues(values)
      let file = folder.appendingPathComponent("playback-events.json")
      try JSONEncoder().encode(Self.entries).write(to: file, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    } catch { /* Diagnostics cannot affect playback. */ }
    #endif
  }
}
