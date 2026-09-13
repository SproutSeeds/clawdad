import Foundation
#if os(iOS)
import MetricKit
import UIKit
#endif

/// Local, bounded system evidence. Never accepts message text, URLs, audio,
/// transcripts or arbitrary application errors, and never uploads diagnostics.
final class MobileCrashDiagnostics: NSObject, @unchecked Sendable {
  static let shared = MobileCrashDiagnostics()
  enum Event: String { case launch, foreground, background, memoryWarning, termination, playbackStart, playbackPart, playbackPause, playbackStop }
  private let queue = DispatchQueue(label: "earth.frg.clawdad.local-diagnostics", qos: .utility)
  private var events: [[String: Any]] = []
  private var started = false
  private var observers: [NSObjectProtocol] = []
  private let folder: URL
  init(folder: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("ClawDad/AssistantDiagnostics")) { self.folder = folder; super.init() }

  @MainActor func start() {
    guard !started else { return }; started = true
    event(.launch)
    #if os(iOS)
    MXMetricManager.shared.add(self)
    for (name, event) in [(UIApplication.didBecomeActiveNotification, Event.foreground),
      (UIApplication.didEnterBackgroundNotification, .background),
      (UIApplication.didReceiveMemoryWarningNotification, .memoryWarning),
      (UIApplication.willTerminateNotification, .termination)] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in self?.event(event) })
    }
    #endif
  }
  func event(_ event: Event) {
    queue.async { [self] in
      let url = folder.appendingPathComponent("lifecycle-events.json")
      if events.isEmpty, let data = try? Data(contentsOf: url), data.count < 256_000,
        let previous = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] { events = previous }
      events.append(["at": ISO8601DateFormatter().string(from: Date()), "event": event.rawValue,
        "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "test",
        "os": ProcessInfo.processInfo.operatingSystemVersionString])
      events = Array(events.suffix(160)); write(events, to: url)
    }
  }
  private func write(_ object: Any, to url: URL) {
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      var directory = folder, values = URLResourceValues(); values.isExcludedFromBackup = true; try directory.setResourceValues(values)
      let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
      guard data.count <= 2_000_000 else { return }
      try data.write(to: url, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    } catch { /* Evidence collection never changes application behavior. */ }
  }
  /// Retain symbolication addresses/UUIDs and numeric termination information;
  /// discard free-form exception reasons, names, paths and diagnostic text.
  static func sanitized(_ value: Any, depth: Int = 0) -> Any? {
    guard depth < 64 else { return nil }
    if let array = value as? [Any] { return array.prefix(256).compactMap { sanitized($0, depth: depth + 1) } }
    if let dictionary = value as? [String: Any] {
      let containers: Set<String> = ["crashDiagnostics", "hangDiagnostics", "cpuExceptionDiagnostics", "diskWriteExceptionDiagnostics", "diagnosticMetaData", "callStackTree", "callStacks", "callStackRootFrames", "subFrames"]
      let numbers: Set<String> = ["exceptionType", "exceptionCode", "signal", "sampleCount", "offsetIntoBinaryTextSegment", "address", "threadAttributed", "virtualMemoryRegionInfo"]
      var result: [String: Any] = [:]
      for (key, item) in dictionary {
        if containers.contains(key) { result[key] = sanitized(item, depth: depth + 1) }
        else if numbers.contains(key), item is NSNumber { result[key] = item }
        else if key == "binaryUUID", let text = item as? String, UUID(uuidString: text) != nil { result[key] = text }
        else if ["appBuildVersion", "appVersion"].contains(key), let version = item as? String,
          version.range(of: "^[0-9]{1,8}(\\.[0-9]{1,8}){0,3}$", options: .regularExpression) != nil { result[key] = version }
      }
      return result
    }
    return nil
  }
}

#if os(iOS)
extension MobileCrashDiagnostics: MXMetricManagerSubscriber {
  func didReceive(_ payloads: [MXDiagnosticPayload]) {
    for payload in payloads.suffix(12) {
      let data = payload.jsonRepresentation()
      guard data.count <= 8_000_000,
        let object = try? JSONSerialization.jsonObject(with: data), let safe = Self.sanitized(object) else { continue }
      let record: [String: Any] = ["receivedAt": ISO8601DateFormatter().string(from: Date()),
        "begin": ISO8601DateFormatter().string(from: payload.timeStampBegin),
        "end": ISO8601DateFormatter().string(from: payload.timeStampEnd), "systemDiagnostics": safe]
      queue.async { [self] in
        let name = "system-diagnostic-\(UUID().uuidString).json"
        write(record, to: folder.appendingPathComponent(name))
        let files = ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [])
          .filter { $0.lastPathComponent.hasPrefix("system-diagnostic-") }
          .sorted { ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) > ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
        for old in files.dropFirst(12) { try? FileManager.default.removeItem(at: old) }
      }
    }
  }
}
#endif
