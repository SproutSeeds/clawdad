import Foundation
import ClawDadRemoteAssistProtocol

/// Capabilities belong to an observed input, not to a CLI version whitelist.
/// Paste and Tab queue use native readback and the current rendered binding.
/// Ctrl-C clear and a hidden/default Enter binding require a verified adapter:
/// guessing those keys could interrupt or submit the user's work.
struct MacCodexComposerCapabilities {
  let observation: MacAssistantDraftObservation
  let queue: MacAssistantAgentQueueSnapshot?
  let adapter: String?
  let enterAdvertised: Bool
  let tabQueueAdvertised: Bool

  init(screen: String, version: String, viewportRows: Int? = nil, knownCollapsedDraft: String? = nil) {
    observation = assistantObserveDraft(screen, viewportRows: viewportRows)
    queue = MacAssistantAgentQueueSnapshot.read(screen, knownCollapsedDraft: knownCollapsedDraft)
    adapter = Self.keyAdapter(version: version)
    // Inspect only the current composer footer, never a shortcut quoted in history.
    let lines = screen.components(separatedBy: .newlines)
    let prompt = lines.lastIndex { $0.trimmingCharacters(in: .whitespaces).hasPrefix("›") }
    enterAdvertised = prompt.map { lines.dropFirst($0 + 1).contains {
      $0.trimmingCharacters(in: .whitespaces).range(of: #"^enter to (?:send|submit)\b"#, options: .caseInsensitive.union(.regularExpression)) != nil
    }} ?? false
    tabQueueAdvertised = prompt.map { lines.dropFirst($0 + 1).contains {
      $0.trimmingCharacters(in: .whitespaces).range(of: #"^tab to queue message\b"#, options: .regularExpression) != nil
    }} ?? false
  }

  static func keyAdapter(version: String) -> String? {
    // Only the destructive shortcut/default submit contract is versioned.
    // Unknown versions retain independently observable paste, context and queue.
    ["0.153.4", "0.154.0"].contains(version) ? "codex-nonempty-clear-v1" : nil
  }
  var canInsert: Bool { observation.text == "" }
  var canClear: Bool { observation.text != nil && (observation.text == "" || adapter != nil) }
  var canSubmit: Bool { observation.text != nil && (enterAdvertised || adapter != nil) }
  var canQueue: Bool { queue != nil }

  var fields: [String: AssistantValue] {
    ["identify": .bool(true), "readContext": .bool(true),
     "inspectDraft": .bool(observation.text != nil), "insertDraft": .bool(canInsert),
     "clearDraft": .bool(canClear), "replaceDraft": .bool(canClear),
     "submitEnter": .bool(canSubmit), "nativeQueue": .bool(canQueue),
     "tabBindingObserved": .bool(tabQueueAdvertised),
     "queueReason": .string(queue != nil ? "The native queue and current draft are readable." : tabQueueAdvertised ? "The Tab binding is visible, but the complete draft or pending queue cannot be verified. Preserve this input; inspect exact paste provenance or use an explicitly authorized whole-draft replacement." : "The current composer does not advertise Tab queueing. Wait for a working turn and inspect again."),
     "keyAdapter": adapter.map(AssistantValue.string) ?? .null,
     "clearReason": .string(canClear ? observation.reason : observation.text == nil ? observation.reason : Self.clearRecovery),
     "submitReason": .string(canSubmit ? "Enter binding verified by the composer adapter or current footer." : "The Enter submit binding is not verifiable. Keep the draft and submit manually, or update ClawDad's key adapter.")]
  }

  static let clearRecovery = "This composer's nonempty clear shortcut has not been verified. Its draft was preserved. Clear it manually or update ClawDad's clear adapter; context, verified empty-input pasting and observed Tab queuing remain available."
}
