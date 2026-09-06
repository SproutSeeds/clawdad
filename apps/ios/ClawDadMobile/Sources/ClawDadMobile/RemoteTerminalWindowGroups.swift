import ClawDadRemoteAssistProtocol
import Foundation

struct RemoteTerminalWindowGroup: Identifiable, Equatable {
  let id: String
  let title: String
  var tabs: [RemoteTerminalTabDescriptor]

  static func make(_ tabs: [RemoteTerminalTabDescriptor]) -> [Self] {
    var groups: [Self] = []
    for tab in tabs {
      let id = tab.windowGroupId ?? "legacy-terminal-tabs"
      if let index = groups.firstIndex(where: { $0.id == id }) { groups[index].tabs.append(tab) }
      else { groups.append(Self(id: id, title: tab.windowTitle ?? (tab.windowGroupId == nil ? "Terminal tabs" : "Terminal Window \(groups.count + 1)"), tabs: [tab])) }
    }
    for index in groups.indices {
      groups[index].tabs = groups[index].tabs.enumerated().sorted {
        let left = $0.element.tabPosition ?? ($0.offset + 1), right = $1.element.tabPosition ?? ($1.offset + 1)
        return left == right ? $0.offset < $1.offset : left < right
      }.map(\.element)
    }
    return groups
  }
}

struct RemoteTerminalWindowExpansion {
  private var values: [String: Bool] = [:]
  func isExpanded(_ id: String) -> Bool { values[id] == true }
  mutating func toggle(_ id: String) { values[id] = !isExpanded(id) }
  mutating func reconcile(_ groups: [RemoteTerminalWindowGroup], selected: String) {
    let active = groups.first { $0.tabs.contains { $0.id == selected } }?.id ?? groups.first?.id
    for group in groups where values[group.id] == nil { values[group.id] = group.id == active }
    values = values.filter { id, _ in groups.contains { $0.id == id } }
  }
}

#if os(iOS)
import SwiftUI

struct RemoteTerminalWindowPicker: View {
  @ObservedObject var controller: RemoteAssistController
  @Binding var expansion: RemoteTerminalWindowExpansion
  private var groups: [RemoteTerminalWindowGroup] { RemoteTerminalWindowGroup.make(controller.remoteTerminalTabs) }

  var body: some View {
    RemoteTerminalTabList(controller: controller, groups: groups,
      expanded: Set(groups.filter { expansion.isExpanded($0.id) }.map(\.id)),
      onToggleGroup: { expansion.toggle($0) })
    .frame(height: 300)
    .onAppear { reconcile() }
    .onChange(of: controller.remoteTerminalTabs) { _, _ in reconcile() }
  }

  private func reconcile() { expansion.reconcile(groups, selected: controller.selectedRemoteTerminalTabId) }
}
#endif
