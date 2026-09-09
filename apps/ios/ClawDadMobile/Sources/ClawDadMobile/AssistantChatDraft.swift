import Foundation
import CryptoKit
import SwiftUI
import ClawDadRemoteAssistProtocol

struct AssistantRecoveredVoice: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let text: String
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

/// Owned by the persistent controller, not a sheet. Each paired Mac has its own
/// atomic manifest and local image files, including the stable send/retry ID.
@MainActor
final class AssistantChatDraftStore: ObservableObject {
  @Published private(set) var value = AssistantChatDraft()
  @Published private(set) var scope = ""
  @Published var error = ""
  @Published var importing = false
  private let root: URL
  private var drafts: [String: AssistantChatDraft] = [:]
  private var bound = false

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
  func bind(_ next: String) {
    guard !bound || scope != next else { return }
    bound = true
    scope = next
    do { value = try read(next); drafts[next] = value; error = "" }
    catch { value = AssistantChatDraft(); self.error = "The saved Assistant draft could not be opened: \(error.localizedDescription)" }
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
  func recoverVoice(_ text: String, id: String) {
    guard !text.isEmpty, !(value.recoveredVoice ?? []).contains(where: { $0.id == id }) else { return }
    value.recoveredVoice = (value.recoveredVoice ?? []) + [AssistantRecoveredVoice(id: id, text: text)]
    saveRecovery()
  }
  func discardRecoveredVoice(_ id: String) {
    value.recoveredVoice?.removeAll { $0.id == id }
    saveRecovery()
  }
  func useRecoveredVoice(_ id: String) {
    guard let voice = value.recoveredVoice?.first(where: { $0.id == id }) else { return }
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
      if let url = try? imageURL(image, scope: scope) { try? FileManager.default.removeItem(at: url) }
    } catch { self.error = error.localizedDescription }
  }
  func clear() {
    do { try complete(value, scope: scope) } catch { self.error = error.localizedDescription }
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
      if let url = try? imageURL(image, scope: target) { try? FileManager.default.removeItem(at: url) }
    }
  }
}
