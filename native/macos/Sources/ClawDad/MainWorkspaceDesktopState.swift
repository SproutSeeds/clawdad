import Foundation

// The embedded UI's origin includes a changing loopback port. Keep its pending
// request receipt in native preferences, separate from the canonical snapshots.
struct MainWorkspaceDesktopState {
  let defaults: UserDefaults
  static let key = "clawdad.workspace.desktop.v1"
  init(defaults: UserDefaults = .standard) { self.defaults = defaults }
  func read() -> [String: Any] {
    guard let data = defaults.data(forKey: Self.key),
          let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return value
  }
  func save(_ value: [String: Any]) throws {
    let allowed = Set(["selected", "name", "windowId", "pending"])
    guard value.allSatisfy({ allowed.contains($0.key) }),
          ["selected", "windowId"].allSatisfy({ value[$0] == nil || (value[$0] as? String).map { $0.count <= 128 } == true }),
          value["name"] == nil || (value["name"] as? String).map({ $0.count <= 80 }) == true else {
      throw MacAssistantError("The saved workspace view is invalid; no request was sent.")
    }
    if let pending = value["pending"], !(pending is NSNull) {
      guard let request = pending as? [String: Any],
            let id = request["id"] as? String, UUID(uuidString: id) != nil,
            let action = request["action"] as? String,
            ["mainworkspace.windows", "mainworkspace.preview", "mainworkspace.inspect", "mainworkspace.save",
             "mainworkspace.restore", "mainworkspace.remove", "mainworkspace.recover",
             "mainworkspace.close.inspect", "mainworkspace.close"].contains(action),
            request["args"] is [String: Any] else {
        throw MacAssistantError("The pending workspace request is invalid; no request was sent.")
      }
    }
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard data.count <= 65_536 else { throw MacAssistantError("The workspace receipt is too large to save.") }
    defaults.set(data, forKey: Self.key)
    guard defaults.synchronize() else { throw MacAssistantError("The workspace receipt could not be saved. Try again before sending.") }
  }
}
