import Foundation

/// A paste acknowledgement is not proof that the intended composer changed.
/// Observe its rendered draft, while making at most one insertion attempt.
@MainActor
func assistantInsertVerifiedDraft(_ text: String,
  insert: () async -> Bool, read: () async throws -> String,
  wait: () async throws -> Void = { try await Task.sleep(nanoseconds: 150_000_000) }
) async throws {
  guard !Task.isCancelled, await insert() else {
    throw MacAssistantError("The draft could not be inserted. Inspect the intended tab before trying again.")
  }
  for attempt in 0..<8 {
    try Task.checkCancellation()
    if assistantDraftMatches(try await read(), expected: text) { return }
    if attempt < 7 { try await wait() }
  }
  throw MacAssistantError("The paste was requested, but the draft could not be verified. Inspect the tab before trying again; Enter was not sent.")
}

func assistantDraftMatches(_ screen: String, expected: String, viewportRows: Int? = nil) -> Bool {
  let view = assistantObserveDraft(screen, viewportRows: viewportRows)
  guard !expected.isEmpty, !view.requiresWholeDraftAuthorization, let draft = view.text else { return false }
  return assistantEditableDraftMatches(draft, expected: expected)
}

/// This is a rendering receipt, not expanded text readback. It is valid only
/// immediately after our sole paste into a verified empty composer, while the
/// exact payload is still held on the clipboard and the target stays unchanged.
func assistantCollapsedPasteMatches(_ screen: String, payload: String) -> Bool {
  guard payload.unicodeScalars.count > 1000,
    let draft = assistantEditableDraft(screen, allowQueueFooter: true, allowCollapsedPaste: true) else { return false }
  return draft == "[Pasted Content \(payload.unicodeScalars.count) chars]"
}
