import Foundation

/// An exited Assistant can leave a TTY that macOS later reuses. Require the
/// coordinator's own directory and, once known, its exact conversation ID.
func macAssistantConversationMatches(
  _ conversation: MacCodexConversation, directory: URL, expectedSessionID: String?
) -> Bool {
  guard expectedSessionID == nil || expectedSessionID == conversation.sessionId,
        let file = try? FileHandle(forReadingFrom: conversation.path) else { return false }
  defer { try? file.close() }
  guard let data = try? file.read(upToCount: 256 * 1024), let end = data.firstIndex(of: 10),
        let record = try? JSONSerialization.jsonObject(with: data[..<end]) as? [String: Any],
        record["type"] as? String == "session_meta", let payload = record["payload"] as? [String: Any],
        payload["id"] as? String == conversation.sessionId, payload["source"] as? String == "cli",
        let cwd = payload["cwd"] as? String, cwd.hasPrefix("/") else { return false }
  return URL(fileURLWithPath: cwd).resolvingSymlinksInPath().standardizedFileURL.path ==
    directory.resolvingSymlinksInPath().standardizedFileURL.path
}
