import ClawDadRemoteAssistProtocol
import Foundation

func assistantCreatedTerminalTab(before: RemoteTerminalTabState, after: RemoteTerminalTabState,
  anchorId: String) throws -> RemoteTerminalTabDescriptor {
  let existing = Set(before.tabs.map(\.id))
  let added = after.tabs.filter { !existing.contains($0.id) }
  guard let anchor = before.tabs.first(where: { $0.id == anchorId }), let group = anchor.windowGroupId,
    added.count == 1, let created = added.first, created.windowGroupId == group,
    after.selectedTabId == created.id, after.tabs.count == before.tabs.count + 1,
    Set(before.tabs.compactMap(\.windowGroupId)) == Set(after.tabs.compactMap(\.windowGroupId)),
    before.tabs.allSatisfy({ old in after.tabs.contains { $0.id == old.id && $0.windowGroupId == old.windowGroupId } }),
    Dictionary(grouping: before.tabs, by: \.windowGroupId).allSatisfy({ key, tabs in
      after.tabs.filter { $0.windowGroupId == key && existing.contains($0.id) }.map(\.id) == tabs.map(\.id)
    }) else {
    throw MacAssistantError("New Tab was requested once, but the intended window or new identity could not be verified. Inspect the inventory; the action will not be repeated.")
  }
  return created
}
