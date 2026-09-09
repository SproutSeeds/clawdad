import AVFoundation
import Foundation

/// Bounded, device-local lifecycle metadata only. No text, samples, levels,
/// utterance IDs, device names, or recognition hypotheses can enter this API.
@MainActor
final class AssistantAudioDiagnostics {
  enum Event: String, Codable {
    case started, stopped, muted, unmuted, routeChanged, interrupted
    case recoveryStarted, recovered, captureFailed
  }
  struct Entry: Codable {
    let at: Date
    let event: Event
    let inputs: [String]
    let outputs: [String]
    let microphonePermission: String
    let sampleRate: Double
  }
  private let file: URL?
  private(set) var entries: [Entry] = []
  init(file: URL? = nil) { self.file = file }
  static func deviceLog() -> AssistantAudioDiagnostics {
    #if os(iOS)
    return .init(file: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("ClawDad/AssistantDiagnostics/audio-events.json"))
    #else
    return .init()
    #endif
  }
  func record(_ event: Event) {
    #if os(iOS)
    let session = AVAudioSession.sharedInstance()
    let entry = Entry(at: Date(), event: event,
      inputs: session.currentRoute.inputs.map { $0.portType.rawValue },
      outputs: session.currentRoute.outputs.map { $0.portType.rawValue },
      microphonePermission: String(describing: AVAudioApplication.shared.recordPermission),
      sampleRate: session.sampleRate)
    #else
    let entry = Entry(at: Date(), event: event, inputs: [], outputs: [], microphonePermission: "test", sampleRate: 0)
    #endif
    entries.append(entry)
    entries = Array(entries.suffix(40))
    guard let file else { return }
    do {
      var directory = file.deletingLastPathComponent()
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700])
      var values = URLResourceValues(); values.isExcludedFromBackup = true
      try directory.setResourceValues(values)
      try JSONEncoder().encode(entries).write(to: file, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    } catch { /* Optional diagnostics never changes capture or submission. */ }
  }
}
