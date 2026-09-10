import Foundation
import ClawDadRemoteAssistProtocol

/// Compare the composer, never Terminal's shifting scrollback prefix. An opaque
/// representation is not recovered text; ownership and input-generation fences
/// must also remain current for the lifetime of this observation.
struct MacAssistantSubmissionDraft: Equatable {
  let representation: String
  let collapsed: Bool
  init?(_ screen: String, rows: Int? = nil) {
    let observed = assistantObserveDraft(screen, viewportRows: rows)
    guard let text = observed.text else { return nil }
    representation = text
    collapsed = observed.requiresWholeDraftAuthorization
  }
  func represents(_ accepted: String) -> Bool {
    if !collapsed { return assistantEditableDraftMatches(accepted, expected: representation) }
    // Only the complete known placeholder is supported. Never interpret mixed
    // opaque fragments, attachments or their lengths as recovered payloads.
    return representation == "[Pasted Content \(accepted.unicodeScalars.count) chars]"
  }
}

struct MacAssistantSubmissionFailure: LocalizedError {
  let message: String
  let fields: [String: AssistantValue]
  var errorDescription: String? { message }
}

/// A cursor into the exact owning rollout. Only complete, newly appended native
/// user/turn events establish acceptance; key dispatch or an empty input cannot.
struct MacAssistantSubmissionLog {
  struct Accepted: Equatable {
    let turnId: String
    let text: String
    let completed: Bool
  }
  let path: URL
  let fileIdentity: String
  let offset: UInt64
  static func capture(_ path: URL) throws -> Self {
    let attributes = try FileManager.default.attributesOfItem(atPath: path.path)
    let handle = try FileHandle(forReadingFrom: path); defer { try? handle.close() }
    let end = try handle.seekToEnd()
    if end > 0 {
      try handle.seek(toOffset: end - 1)
      guard try handle.read(upToCount: 1) == Data([10]) else {
        throw MacAssistantError("Codex is finishing a transcript write. Inspect this same draft again; Enter was not sent.")
      }
    }
    return Self(path: path, fileIdentity: identity(attributes), offset: end)
  }
  static func identity(_ attributes: [FileAttributeKey: Any]) -> String {
    "\(attributes[.systemNumber] ?? "")/\(attributes[.systemFileNumber] ?? "")"
  }
  func read(expected: MacAssistantSubmissionDraft? = nil) throws -> Accepted? {
    let attributes = try FileManager.default.attributesOfItem(atPath: path.path)
    guard Self.identity(attributes) == fileIdentity else { throw MacAssistantError("The owning transcript changed. Review this receipt before any retry.") }
    let handle = try FileHandle(forReadingFrom: path); defer { try? handle.close() }
    let end = try handle.seekToEnd()
    guard end >= offset, end - offset <= 4 * 1024 * 1024 else {
      throw MacAssistantError("The new transcript range is unavailable. Review this receipt before any retry.")
    }
    try handle.seek(toOffset: offset)
    return Self.parse(try handle.readToEnd() ?? Data(), expected:expected)
  }
  static func parse(_ data: Data, expected: MacAssistantSubmissionDraft? = nil) -> Accepted? {
    var turn: String?, candidates:[String]=[], complete = false
    for line in data.split(separator: 10, omittingEmptySubsequences: false).dropLast() {
      guard let row = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
        let p = row["payload"] as? [String: Any] else { continue }
      if row["type"] as? String == "response_item",p["role"] as? String == "user",turn != nil,
        let items=p["content"] as? [[String:Any]],items.allSatisfy({$0["type"] as? String == "input_text"}) {
        let text=items.compactMap{$0["text"] as? String}.joined(separator:"\n")
        if !candidates.contains(text) { candidates.append(text) }
      }
      guard row["type"] as? String == "event_msg" else { continue }
      switch p["type"] as? String {
      case "task_started":
        // More than one new turn is ambiguous, including a rapid manual submit.
        guard turn == nil, let id = p["turn_id"] as? String, !id.isEmpty else { return nil }
        turn = id
      case "user_message":
        guard turn != nil, let message = p["message"] as? String else { return nil }
        if !candidates.contains(message) { candidates.append(message) }
      case "task_complete": if p["turn_id"] as? String == turn { complete = true }
      case "turn_aborted": if p["turn_id"] as? String == turn { return nil }
      default: break
      }
    }
    let matching=expected.map{draft in candidates.filter{draft.represents($0)}} ?? candidates
    guard let turn,matching.count==1,let text=matching.first else { return nil }
    return Accepted(turnId: turn, text: text, completed: complete)
  }
}

@MainActor
func assistantSubmitExistingDraft(_ expected: MacAssistantSubmissionDraft,
  read: () async throws -> MacAssistantSubmissionDraft?,
  prepare: () async throws -> Void,
  dispatch: () -> Bool,
  accepted: () async throws -> MacAssistantSubmissionLog.Accepted?,
  wait: () async throws -> Void = { try await Task.sleep(nanoseconds: 200_000_000) }
) async throws -> [String: AssistantValue] {
  var sent = false
  do {
    guard !expected.representation.isEmpty, try await read() == expected else {
      throw MacAssistantError("The inspected composer changed or is empty. Its draft was preserved; Enter was not sent.")
    }
    try await prepare()
    guard try await read() == expected else { throw MacAssistantError("The inspected composer changed. Its draft was preserved; Enter was not sent.") }
    guard dispatch() else { throw MacAssistantError("Terminal did not accept the Enter event.") }
    sent = true
    for attempt in 0..<25 {
      try Task.checkCancellation()
      if let observed = try await accepted() {
        guard expected.represents(observed.text) else {
          throw MacAssistantError("A new turn was observed, but it does not match the inspected composer. Review this receipt; input will not be repeated.")
        }
        return ["agentSubmission": .bool(true), "keySent": .bool(true), "turnAccepted": .bool(true),
          "turnId": .string(observed.turnId), "acceptedText": .string(observed.text),
          "taskCompletionVerified": .bool(observed.completed), "submitted": .bool(true),
          "hiddenDraftIndependentlyRead": .bool(!expected.collapsed),
          "draftRepresentation": .string(expected.representation),
          "verification": .string("native-owning-rollout-new-user-turn")]
      }
      if attempt < 24 { try await wait() }
    }
    throw MacAssistantError("Enter was sent once, but a matching new agent turn has not been observed. Inspect this receipt and the tab before retrying. Native commands may not create a conversation turn.")
  } catch {
    throw MacAssistantSubmissionFailure(message: error.localizedDescription,
      fields: ["agentSubmission": .bool(true), "keySent": .bool(sent), "turnAccepted": .bool(false),
        "submitted": .bool(false), "taskCompletionVerified": .bool(false),
        "draftRepresentation": .string(expected.representation),
        "verification": .string(sent ? "enter-dispatched-acceptance-unverified" : "enter-not-dispatched")])
  }
}
