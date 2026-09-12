import Foundation
import CryptoKit
import SwiftUI
import ClawDadRemoteAssistProtocol

struct AssistantRecoveredVoice: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let text: String
  var deliveryUncertain: Bool? = nil
}

struct AssistantChatDraft: Codable, Equatable, Sendable {
  var id = UUID().uuidString.lowercased()
  var text = ""
  var images: [RemoteImageUpload] = []
  // Only unmuted words already displayed before an unexpected capture failure.
  // Separate from typed text, never automatically submitted, and no audio files.
  var recoveredVoice: [AssistantRecoveredVoice]?
  var isEmpty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && images.isEmpty }
}

struct AssistantAcceptedDraft: Codable, Identifiable, Equatable, Sendable {
  let draft: AssistantChatDraft
  var failure: String?
  var awaitingAcceptance: Bool? = nil
  var id: String { draft.id }
}

/// Owned by the persistent controller, not a sheet. Each paired Mac has its own
/// atomic manifest and local image files, including the stable send/retry ID.
@MainActor
final class AssistantChatDraftStore: ObservableObject {
  @Published private(set) var value = AssistantChatDraft()
  @Published private(set) var scope = ""
  @Published var error = ""
  @Published var importing = false
  @Published private(set) var unprocessed: [AssistantAcceptedDraft] = []
  private let root: URL
  private var drafts: [String: AssistantChatDraft] = [:]
  private var bound = false
  private var accepted: [String: [AssistantAcceptedDraft]] = [:]
  private var voiceCheckpoints: [String: [AssistantRecoveredVoice]] = [:]

  init(root: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("ClawDad/AssistantDrafts", isDirectory: true)) { self.root = root }

  private func directory(_ scope: String) -> URL {
    let hash = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
    return root.appendingPathComponent(hash, isDirectory: true)
  }
  private func imageURL(_ image: RemoteImageUpload, scope: String) throws -> URL {
    try image.validate()
    return directory(scope).appendingPathComponent(image.id)
  }
  private func read(_ scope: String) throws -> AssistantChatDraft {
    if let draft = drafts[scope] { return draft }
    let file = directory(scope).appendingPathComponent("draft.json")
    guard FileManager.default.fileExists(atPath: file.path) else { return AssistantChatDraft() }
    let draft = try JSONDecoder().decode(AssistantChatDraft.self, from: Data(contentsOf: file))
    guard UUID(uuidString: draft.id) != nil else { throw AssistantProtocolError.invalid }
    for image in draft.images { try image.validate() }
    return draft
  }
  private func write(_ draft: AssistantChatDraft, scope: String) throws {
    var folder = directory(scope)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try folder.setResourceValues(values)
    try JSONEncoder().encode(draft).write(to: folder.appendingPathComponent("draft.json"), options: .atomic)
    drafts[scope] = draft
  }
  private func readAccepted(_ target: String) throws -> [AssistantAcceptedDraft] {
    if let saved = accepted[target] { return saved }
    let file = directory(target).appendingPathComponent("accepted.json")
    let saved = FileManager.default.fileExists(atPath: file.path)
      ? try JSONDecoder().decode([AssistantAcceptedDraft].self, from: Data(contentsOf: file)) : []
    accepted[target] = saved
    return saved
  }
  private func writeAccepted(_ saved: [AssistantAcceptedDraft], scope target: String) throws {
    try FileManager.default.createDirectory(at: directory(target), withIntermediateDirectories: true)
    try JSONEncoder().encode(saved).write(to: directory(target).appendingPathComponent("accepted.json"), options: .atomic)
    accepted[target] = saved
    if scope == target { unprocessed = saved.filter { $0.failure != nil } }
  }
  private func removeUnusedImage(_ image: RemoteImageUpload, scope target: String) {
    // Recovery drafts retain their bytes until completion or explicit deletion.
    guard let current = try? read(target), !current.images.contains(where: { $0.id == image.id }),
      let saved = try? readAccepted(target), !saved.contains(where: { $0.draft.images.contains(where: { $0.id == image.id }) }) else { return }
    if let url = try? imageURL(image, scope: target) { try? FileManager.default.removeItem(at: url) }
  }
  func bind(_ next: String) {
    guard !bound || scope != next else { return }
    bound = true
    scope = next
    do {
      value = try read(next); drafts[next] = value
      error = ""
    }
    catch { value = AssistantChatDraft(); self.error = "The saved Assistant draft could not be opened: \(error.localizedDescription)" }
    do { unprocessed = try readAccepted(next).filter { $0.failure != nil } }
    catch { unprocessed = []; self.error = "The saved recovery messages could not be opened. Your current draft is kept." }
    let voiceFile = directory(next).appendingPathComponent("voice-turns.json")
    if let data = try? Data(contentsOf: voiceFile), let voice = try? JSONDecoder().decode([AssistantRecoveredVoice].self, from: data) {
      voiceCheckpoints[next] = voice
      for turn in voice { recoverVoice(turn.text, id: turn.id, deliveryUncertain: turn.deliveryUncertain == true) }
    }
  }
  func checkpointVoice(_ turns: [AssistantRecoveredVoice]) {
    guard voiceCheckpoints[scope] != turns else { return }
    do {
      try FileManager.default.createDirectory(at: directory(scope), withIntermediateDirectories: true)
      try JSONEncoder().encode(turns).write(to: directory(scope).appendingPathComponent("voice-turns.json"), options: .atomic)
      voiceCheckpoints[scope] = turns
    } catch { self.error = "Your displayed words could not be saved on this device. Keep the conversation open until sending finishes." }
  }
  func setText(_ text: String) {
    guard value.text != text else { return }
    value.text = text
    value.id = UUID().uuidString.lowercased()
    // Retain typed text in memory even if the device cannot save it right now.
    drafts[scope] = value
    do { try write(value, scope: scope); error = "" }
    catch { self.error = "Your draft could not be saved on this device: \(error.localizedDescription)" }
  }
  func recoverVoice(_ text: String, id: String, deliveryUncertain: Bool = false) {
    guard !text.isEmpty else { return }
    let turn = AssistantRecoveredVoice(id: id, text: text, deliveryUncertain: deliveryUncertain)
    if let index = value.recoveredVoice?.firstIndex(where: { $0.id == id }) {
      guard value.recoveredVoice?[index] != turn else { return }
      value.recoveredVoice?[index] = turn
    } else { value.recoveredVoice = (value.recoveredVoice ?? []) + [turn] }
    saveRecovery()
  }
  func discardRecoveredVoice(_ id: String) {
    value.recoveredVoice?.removeAll { $0.id == id }
    checkpointVoice((voiceCheckpoints[scope] ?? []).filter { $0.id != id })
    saveRecovery()
  }
  func useRecoveredVoice(_ id: String) {
    guard let voice = value.recoveredVoice?.first(where: { $0.id == id }) else { return }
    if voice.deliveryUncertain == true {
      guard value.isEmpty else { error = "Keep this unsent voice message separate until its original Mac receipt is checked. Your typed draft is preserved."; return }
      value.text = voice.text; value.id = voice.id
      discardRecoveredVoice(id)
      return
    }
    value.text = [value.text, voice.text].filter { !$0.isEmpty }.joined(separator: "\n\n")
    value.id = UUID().uuidString.lowercased()
    discardRecoveredVoice(id)
  }
  private func saveRecovery() {
    drafts[scope] = value
    do { try write(value, scope: scope); error = "" }
    catch { self.error = "Your unsent words are retained here, but could not be saved on this device." }
  }
  func add(_ images: [PreparedRemoteImage], to target: String) throws {
    var draft = try read(target)
    guard draft.images.count + images.count <= 4,
      draft.images.reduce(0, { $0 + $1.size }) + images.reduce(0, { $0 + $1.data.count }) <= 20 * 1024 * 1024
    else { throw RemoteImagePreparation.failure("Choose up to four images totaling 20 MB.") }
    // A selected photo becomes a draft attachment only after its bytes are saved.
    try write(draft, scope: target)
    var created: [URL] = []
    do {
      for image in images {
        let file = try imageURL(image.upload, scope: target)
        try image.data.write(to: file, options: .atomic)
        created.append(file)
        draft.images.append(image.upload)
      }
      draft.id = UUID().uuidString.lowercased()
      try write(draft, scope: target)
    } catch {
      for file in created { try? FileManager.default.removeItem(at: file) }
      throw error
    }
    if target == scope { value = draft; error = "" }
  }
  func bytes(_ image: RemoteImageUpload, scope: String) throws -> Data {
    let data = try Data(contentsOf: imageURL(image, scope: scope))
    guard data.count == image.size,
      SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == image.sha256
    else { throw RemoteImagePreparation.failure("This draft image could not be read. Remove it and select it again.") }
    return data
  }
  func remove(_ image: RemoteImageUpload) {
    var next = value
    next.images.removeAll { $0.id == image.id }
    next.id = UUID().uuidString.lowercased()
    do {
      try write(next, scope: scope)
      value = next; error = ""
      removeUnusedImage(image, scope: scope)
    } catch { self.error = error.localizedDescription }
  }
  func clear() {
    do { try complete(value, scope: scope) } catch { self.error = error.localizedDescription }
  }
  func stageAttempt(_ draft: AssistantChatDraft, scope target: String) throws {
    var saved = try readAccepted(target)
    if let existing = saved.first(where: { $0.id == draft.id }) {
      guard existing.draft.text == draft.text, existing.draft.images == draft.images else { throw AssistantProtocolError.invalid }
    } else {
      saved.append(AssistantAcceptedDraft(draft: draft, failure: "Waiting for Mac acceptance. Reconnect and retry with this saved message; its original ID prevents duplicate delivery.", awaitingAcceptance: true))
      try writeAccepted(saved, scope: target)
    }
  }
  func accept(_ sent: AssistantChatDraft, scope target: String) throws {
    var saved = try readAccepted(target)
    if !saved.contains(where: { $0.id == sent.id }) {
      saved.append(AssistantAcceptedDraft(draft: sent))
      // Save before clearing the composer: a queued receipt is not proof that
      // model generation succeeded. Keep exact text, retry ID and image bytes.
      try writeAccepted(saved, scope: target)
    }
    if let index = saved.firstIndex(where: { $0.id == sent.id }), saved[index].failure != nil {
      saved[index].failure = nil; saved[index].awaitingAcceptance = false; try writeAccepted(saved, scope: target)
    }
    try complete(sent, scope: target)
  }
  func reconcile(_ receipts: [AssistantMessageReceipt]) {
    do {
      let known = Set(receipts.map(\.id))
      if let checkpoint = voiceCheckpoints[scope], checkpoint.contains(where: { known.contains($0.id) }) {
        checkpointVoice(checkpoint.filter { !known.contains($0.id) })
      }
      if value.recoveredVoice?.contains(where: { known.contains($0.id) }) == true {
        value.recoveredVoice?.removeAll { known.contains($0.id) }; saveRecovery()
      }
      let original = try readAccepted(scope)
      guard !original.isEmpty else { return }
      var finished: [AssistantAcceptedDraft] = []
      let saved = original.compactMap { item -> AssistantAcceptedDraft? in
        guard let receipt = receipts.first(where: { $0.id == item.id }) else { return item }
        if receipt.status == "completed" { finished.append(item); return nil }
        var next = item
        next.awaitingAcceptance = false
        if ["queued", "running"].contains(receipt.status) { next.failure = nil }
        if ["attention", "interrupted", "cancelled"].contains(receipt.status) {
          next.failure = receipt.error ?? "The Assistant did not finish this message. Review its saved draft before retrying."
        }
        return next
      }
      guard saved != original else { return }
      try writeAccepted(saved, scope: scope)
      for item in original where receipts.contains(where: { $0.id == item.id && ["queued", "running", "completed"].contains($0.status) }) {
        try complete(item.draft, scope: scope)
      }
      for item in finished { for image in item.draft.images { removeUnusedImage(image, scope: scope) } }
    } catch { self.error = "An unprocessed message could not be updated on this device. Its saved copy is kept." }
  }
  func recoverAccepted(_ id: String) {
    guard value.isEmpty else { return }
    do {
      let saved = try readAccepted(scope)
      guard let item = saved.first(where: { $0.id == id }), item.failure != nil else { return }
      var next = item.draft
      next.recoveredVoice = value.recoveredVoice
      try write(next, scope: scope)
      value = next
      // Keep the original receipt record if the phone lost its acknowledgment.
      // Editing produces a separate draft; it cannot erase uncertain delivery.
      if item.awaitingAcceptance != true { try writeAccepted(saved.filter { $0.id != id }, scope: scope) }
      error = item.failure ?? ""
    } catch { self.error = error.localizedDescription }
  }
  func complete(_ sent: AssistantChatDraft, scope target: String) throws {
    // A late receipt cannot clear edits made after Send or another Mac's draft.
    guard try read(target).id == sent.id else { return }
    var empty = AssistantChatDraft()
    // Sending a typed message never discards a separate voice recovery draft.
    empty.recoveredVoice = try read(target).recoveredVoice
    try write(empty, scope: target)
    if target == scope { value = empty; error = "" }
    for image in sent.images {
      removeUnusedImage(image, scope: target)
    }
  }
}
