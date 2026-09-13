import Foundation
import SwiftUI
import ClawDadRemoteAssistProtocol

/// One preference per app installation on this playback device, across paired
/// accounts/hosts. It is never copied from another device or applied to capture.
@MainActor
final class SpeechOutputPreference: ObservableObject {
  static let shared = SpeechOutputPreference()
  struct Receipt: Codable { let id: String; let fingerprint: String; let revision: Int; let boostDB: Double }
  struct Record: Codable { var boostDB = 0.0; var revision = 0; var receipts: [Receipt] = [] }
  @Published private(set) var boostDB = 0.0
  @Published private(set) var revision = 0
  @Published private(set) var error = ""
  private var record = Record()
  private let url: URL
  init(url: URL? = nil) {
    self.url = url ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("ClawDad/Speech/output.json")
    do {
      if FileManager.default.fileExists(atPath: self.url.path) {
        let saved = try JSONDecoder().decode(Record.self, from: Data(contentsOf: self.url))
        guard saved.boostDB.isFinite, (0...20).contains(saved.boostDB), saved.revision >= 0 else { throw SpeechPreferenceError.invalid }
        record = saved; boostDB = saved.boostDB; revision = saved.revision
      }
    } catch { self.error = "Saved speech boost could not be read. Using 0 dB; reset to repair it." }
  }
  @discardableResult
  func set(_ db: Double, requestID: String = UUID().uuidString.lowercased(), expectedRevision: Int? = nil) throws -> Receipt {
    guard db.isFinite, (0...20).contains(db), db.rounded() == db,
      !requestID.isEmpty, requestID.utf8.count <= 128 else { throw SpeechPreferenceError.invalid }
    let fingerprint = "\(db)/\(expectedRevision.map(String.init) ?? "local")"
    if let existing = record.receipts.first(where: { $0.id == requestID }) {
      guard existing.fingerprint == fingerprint else { throw SpeechPreferenceError.conflict }
      return existing
    }
    if let expectedRevision, expectedRevision != revision { throw SpeechPreferenceError.conflict }
    var next = record
    next.boostDB = db; next.revision += 1
    let receipt = Receipt(id: requestID, fingerprint: fingerprint, revision: next.revision, boostDB: db)
    next.receipts.append(receipt); next.receipts = Array(next.receipts.suffix(128))
    do {
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(next).write(to: url, options: .atomic)
      let verified = try JSONDecoder().decode(Record.self, from: Data(contentsOf: url))
      guard verified.revision == next.revision, verified.boostDB == db else { throw SpeechPreferenceError.persistence }
    } catch { self.error = "Speech boost could not be saved. Try again."; throw error }
    record = next; boostDB = next.boostDB; revision = next.revision; error = ""
    return receipt
  }
  var wireState: [String: AssistantValue] {
    ["boostDB": .number(boostDB), "revision": .number(Double(revision)), "policy": .string("speech-output-v1"),
     "scope": .string("playback-device-installation"), "supported": .bool(error.isEmpty),
     "error": .string(error)]
  }
  func applyRemote(_ request: [String: AssistantValue]) -> [String: AssistantValue] {
    guard let id = request["requestId"]?.string, let db = request["boostDB"]?.number,
      let expected = request["expectedRevision"]?.number, expected.isFinite,
      expected >= 0, expected <= Double(Int32.max), expected.rounded() == expected else {
      return ["status": .string("rejected"), "error": .string("Invalid speech control request.")]
    }
    do {
      let receipt = try set(db, requestID: id, expectedRevision: Int(expected))
      return ["requestId": .string(id), "status": .string("applied"),
        "appliedRevision": .number(Double(receipt.revision)), "appliedBoostDB": .number(receipt.boostDB)]
    } catch {
      return ["requestId": .string(id), "status": .string("rejected"), "error": .string(error.localizedDescription)]
    }
  }
}

enum SpeechPreferenceError: LocalizedError {
  case invalid, conflict, persistence
  var errorDescription: String? {
    switch self {
    case .invalid: "Choose a whole-number speech boost from 0 to +20 dB."
    case .conflict: "Speech boost changed since this request. Read its current value before trying again."
    case .persistence: "Speech boost could not be verified on this device."
    }
  }
}
