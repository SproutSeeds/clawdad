import Foundation

/// Read-only protection for legacy native sign-in buttons. They must not
/// restart the shared daemon or change authentication during a saved switch.
enum MacCodexAccountAdmission {
  static var checkpoint: URL {
    FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Application Support/ClawDad/Accounts/switch-state.json")
  }

  static func requireNoTransition(at file: URL = checkpoint) throws {
    let data: Data
    do { data = try Data(contentsOf: file) }
    catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError { return }
    catch { throw failure("Account-switch recovery needs attention. Open Codex accounts before signing in again.") }
    struct Operation: Decodable { let fenced: Bool }
    struct State: Decodable {
      let version: Int
      let revision: Int
      let epoch: Int
      let activeOperationId: String?
      let operations: [String: Operation]
    }
    guard let state = try? JSONDecoder().decode(State.self, from: data), state.version == 1,
      state.revision >= 0, state.epoch >= 0 else {
      throw failure("The account-switch checkpoint is incomplete. Open Codex accounts to review recovery before signing in.")
    }
    if let id = state.activeOperationId {
      guard let operation = state.operations[id] else { throw failure("The saved account transition needs recovery before signing in.") }
      guard !operation.fenced else {
        throw failure("An account switch is holding new sign-ins. Open Codex accounts to finish or cancel that transition; current agents are preserved.")
      }
    }
  }

  private static func failure(_ message: String) -> NSError {
    NSError(domain: "ClawDad.CodexAccounts", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
