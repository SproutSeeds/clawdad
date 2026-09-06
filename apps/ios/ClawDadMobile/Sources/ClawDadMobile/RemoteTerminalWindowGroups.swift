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
  @GestureState private var dragging = false
  private var groups: [RemoteTerminalWindowGroup] { RemoteTerminalWindowGroup.make(controller.remoteTerminalTabs) }

  var body: some View {
    List {
      ForEach(groups) { group in
        Section {
          Button { expansion.toggle(group.id) } label: {
            HStack(spacing: 8) {
              Image(systemName: expansion.isExpanded(group.id) ? "chevron.down" : "chevron.right")
              VStack(alignment: .leading, spacing: 3) {
                Text(group.title).font(.subheadline.weight(.bold))
                Text("\(group.tabs.count) \(group.tabs.count == 1 ? "tab" : "tabs")").font(.caption)
              }
              Spacer(minLength: 0)
              if group.tabs.contains(where: { $0.id == controller.selectedRemoteTerminalTabId }) {
                Image(systemName: "checkmark.circle.fill").accessibilityLabel("Active window")
              }
            }.foregroundStyle(ClawDadTheme.cream).contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("clawdad.remote.window.\(group.id)")
          .accessibilityValue(expansion.isExpanded(group.id) ? "Expanded" : "Collapsed")
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets(top: 8, leading: 2, bottom: 8, trailing: 2))

          if expansion.isExpanded(group.id) {
            ForEach(group.tabs, id: \.id) { tab in
              RemoteTerminalTabButton(tab: tab,
                isSelected: controller.selectedRemoteTerminalTabId == tab.id,
                isPending: controller.pendingRemoteTerminalTabId == tab.id,
                isEnabled: controller.phase == .connected && !controller.remoteScreenLocked && controller.pendingRemoteTerminalTabId != tab.id,
                terminalName: controller.remoteTerminalName, computerName: controller.remoteComputerName,
                onSelect: { controller.focusRemoteTerminalTab(tab.id) })
              .listRowInsets(EdgeInsets(top: 3, leading: 0, bottom: 3, trailing: 0))
              .listRowBackground(Color.clear)
              .moveDisabled(!tab.canReorder || controller.remoteScreenLocked || controller.pendingRemoteTerminalTabId != nil)
              .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.3)
                  .sequenced(before: DragGesture(minimumDistance: 0))
                  .updating($dragging) { value, active, _ in
                    if case .second(true, _) = value { active = true }
                  }
              )
            }
            .onMove { offsets, destination in move(group, offsets: offsets, destination: destination) }
          }
        }
        .listSectionSeparator(.hidden)
      }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .environment(\.editMode, .constant(.active))
    .frame(height: 300)
    .onAppear { reconcile() }
    .onChange(of: controller.remoteTerminalTabs) { _, _ in reconcile() }
    .onChange(of: dragging) { _, active in
      if active { controller.beginTerminalTabDrag() }
      else { controller.endTerminalTabDrag() }
    }
    .onDisappear { controller.endTerminalTabDrag() }
  }

  private func reconcile() { expansion.reconcile(groups, selected: controller.selectedRemoteTerminalTabId) }
  private func move(_ group: RemoteTerminalWindowGroup, offsets: IndexSet, destination: Int) {
    defer { controller.endTerminalTabDrag() }
    guard offsets.count == 1, let source = offsets.first, group.tabs.indices.contains(source),
          (0...group.tabs.count).contains(destination), destination != source, destination != source + 1,
          let current = groups.first(where: { $0.id == group.id }), current.tabs.map(\.id) == group.tabs.map(\.id) else { return }
    let neighbor = destination > source ? destination - 1 : destination
    controller.moveRemoteTerminalTab(group.tabs[source].id, relativeTo: group.tabs[neighbor].id, before: destination < source, dragged: true)
  }
}
#endif
