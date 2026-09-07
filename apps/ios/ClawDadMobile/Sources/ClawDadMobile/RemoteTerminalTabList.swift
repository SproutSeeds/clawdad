#if os(iOS)
import ClawDadRemoteAssistProtocol
import SwiftUI
import UIKit

// UIKit owns scrolling and interactive movement. The reorder recognizer accepts
// touches only on our handle, leaving the hosted card's tap and scroll arbitration
// alone. Public movement callbacks also give cancellation a definite end point.
struct RemoteTerminalTabList: UIViewRepresentable {
  let controller: RemoteAssistController
  let groups: [RemoteTerminalWindowGroup]
  let expanded: Set<String>
  let onToggleGroup: (String) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> UICollectionView {
    var layout = UICollectionLayoutListConfiguration(appearance: .plain)
    layout.showsSeparators = false
    layout.backgroundColor = .clear
    layout.trailingSwipeActionsConfigurationProvider = { [weak coordinator = context.coordinator] path in
      coordinator?.closeActions(at: path)
    }
    let view = UICollectionView(frame: .zero, collectionViewLayout: UICollectionViewCompositionalLayout.list(using: layout))
    view.backgroundColor = .clear
    view.contentInsetAdjustmentBehavior = .never
    view.alwaysBounceVertical = true
    view.allowsSelection = false
    view.register(UICollectionViewListCell.self, forCellWithReuseIdentifier: "terminal")
    view.dataSource = context.coordinator
    view.delegate = context.coordinator
    view.accessibilityIdentifier = "clawdad.remote.terminal-list"
    context.coordinator.collectionView = view
    let hold = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.reorder(_:)))
    hold.minimumPressDuration = 0.35
    hold.allowableMovement = 10
    hold.delegate = context.coordinator
    view.addGestureRecognizer(hold)
    return view
  }

  func updateUIView(_ uiView: UICollectionView, context: Context) { context.coordinator.update(self) }

  static func dismantleUIView(_ uiView: UICollectionView, coordinator: Coordinator) {
    coordinator.cancelMovement()
    uiView.dataSource = nil
    uiView.delegate = nil
  }

  @MainActor final class Coordinator: NSObject, UICollectionViewDataSource, UICollectionViewDelegate, UIGestureRecognizerDelegate {
    private struct Presentation: Equatable {
      var groups: [RemoteTerminalWindowGroup]
      let expanded: Set<String>
      let selected: String
      let pending: String?
      let enabled: Bool
      let terminalName: String
      let computerName: String
      let canClose: Bool

      @MainActor init(_ parent: RemoteTerminalTabList) {
        groups = parent.groups
        expanded = parent.expanded
        selected = parent.controller.selectedRemoteTerminalTabId
        pending = parent.controller.pendingRemoteTerminalTabId
        enabled = parent.controller.phase == .connected && !parent.controller.remoteScreenLocked && parent.controller.closingTerminalTabId == nil
        canClose = parent.controller.canCloseTerminalTabs
        terminalName = parent.controller.remoteTerminalName
        computerName = parent.controller.remoteComputerName
      }
    }

    private var parent: RemoteTerminalTabList
    private var presentation: Presentation
    weak var collectionView: UICollectionView?
    private var touchedTabID: String?
    private var movingTabID: String?
    private var centerOffset = CGPoint.zero

    init(_ parent: RemoteTerminalTabList) {
      self.parent = parent
      presentation = Presentation(parent)
      super.init()
      NotificationCenter.default.addObserver(self, selector: #selector(cancelMovement),
        name: UIApplication.willResignActiveNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    func update(_ parent: RemoteTerminalTabList) {
      self.parent = parent
      let next = Presentation(parent)
      if movingTabID != nil {
        if !next.enabled { cancelMovement() }
        else { return }
      }
      guard next != presentation else { return }
      // Keep a revealed Close action steady while status polls arrive. UIKit
      // owns the swipe state; updates resume as soon as the card slides back.
      if next.enabled, collectionView?.visibleCells.contains(where: { $0.configurationState.isSwiped }) == true { return }
      presentation = next
      collectionView?.reloadData()
    }

    func numberOfSections(in collectionView: UICollectionView) -> Int { presentation.groups.count }

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
      let group = presentation.groups[section]
      return 1 + (presentation.expanded.contains(group.id) ? group.tabs.count : 0)
    }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
      let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "terminal", for: indexPath) as! UICollectionViewListCell
      cell.backgroundConfiguration = .clear()
      cell.accessories = []
      cell.configurationUpdateHandler = { [weak self] _, state in
        if !state.isSwiped { DispatchQueue.main.async { [weak self] in
          guard let self else { return }; self.update(self.parent)
        } }
      }
      let group = presentation.groups[indexPath.section]
      if indexPath.item == 0 {
        let expanded = presentation.expanded.contains(group.id)
        let active = group.tabs.contains { $0.id == presentation.selected }
        cell.contentConfiguration = UIHostingConfiguration {
          Button { [weak self] in self?.parent.onToggleGroup(group.id) } label: {
            HStack(spacing: 8) {
              Image(systemName: expanded ? "chevron.down" : "chevron.right")
              VStack(alignment: .leading, spacing: 3) {
                Text(group.title).font(.subheadline.weight(.bold))
                Text("\(group.tabs.count) \(group.tabs.count == 1 ? "tab" : "tabs")").font(.caption)
              }
              Spacer(minLength: 0)
              if active { Image(systemName: "checkmark.circle.fill").accessibilityLabel("Active window") }
            }.foregroundStyle(ClawDadTheme.cream).contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("clawdad.remote.window.\(group.id)")
          .accessibilityValue(expanded ? "Expanded" : "Collapsed")
          .padding(.vertical, 8).padding(.horizontal, 2)
        }.margins(.all, 0)
      } else {
        let tab = group.tabs[indexPath.item - 1]
        let state = presentation
        let canMove = state.enabled && state.pending == nil && tab.canReorder
        cell.contentConfiguration = UIHostingConfiguration {
          HStack(spacing: 12) {
            RemoteTerminalTabButton(tab: tab, isSelected: state.selected == tab.id,
              isPending: state.pending == tab.id, isEnabled: state.enabled && state.pending != tab.id,
              terminalName: state.terminalName, computerName: state.computerName,
              onSelect: { [weak self] in self?.parent.controller.focusRemoteTerminalTab(tab.id) })
              .accessibilityActions {
                if state.canClose {
                  Button("Close Tab") { [weak self] in self?.parent.controller.requestCloseTerminalTab(tab.id) }
                }
              }
            RemoteTerminalReorderHandle(tab: tab, enabled: canMove,
              moveUp: { [weak self] in self?.moveAccessible(tab.id, delta: -1) ?? false },
              moveDown: { [weak self] in self?.moveAccessible(tab.id, delta: 1) ?? false })
              .frame(width: 44, height: 44)
          }.padding(.vertical, 3).padding(.trailing, 4)
        }.margins(.all, 0)
      }
      return cell
    }

    private func indexPath(for id: String) -> IndexPath? {
      for (section, group) in presentation.groups.enumerated() where presentation.expanded.contains(group.id) {
        if let index = group.tabs.firstIndex(where: { $0.id == id }) { return IndexPath(item: index + 1, section: section) }
      }
      return nil
    }

    func closeActions(at path: IndexPath) -> UISwipeActionsConfiguration? {
      guard movingTabID == nil, presentation.canClose, presentation.groups.indices.contains(path.section),
            path.item > 0, presentation.groups[path.section].tabs.indices.contains(path.item - 1) else { return nil }
      let id = presentation.groups[path.section].tabs[path.item - 1].id
      let close = UIContextualAction(style: .destructive, title: "Close") { [weak self] _, _, finish in
        finish(true)
        self?.parent.controller.requestCloseTerminalTab(id)
      }
      close.image = UIImage(systemName: "xmark")
      let configuration = UISwipeActionsConfiguration(actions: [close])
      configuration.performsFirstActionWithFullSwipe = false
      return configuration
    }

    func collectionView(_ collectionView: UICollectionView, canMoveItemAt indexPath: IndexPath) -> Bool {
      presentation.enabled && presentation.pending == nil && indexPath.item > 0 &&
        presentation.groups[indexPath.section].tabs[indexPath.item - 1].canReorder
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
      var view = touch.view
      while let candidate = view, candidate !== collectionView {
        if let handle = candidate as? RemoteTerminalReorderHandle.HandleView {
          touchedTabID = handle.tabID
          return handle.isUserInteractionEnabled
        }
        view = candidate.superview
      }
      return false
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
      guard let view = collectionView, !view.isDragging, let id = touchedTabID, let path = indexPath(for: id) else { return false }
      return collectionView(view, canMoveItemAt: path)
    }

    @objc func reorder(_ gesture: UILongPressGestureRecognizer) {
      guard let view = collectionView else { return }
      switch gesture.state {
      case .began:
        guard let id = touchedTabID, let path = indexPath(for: id),
              let attributes = view.layoutAttributesForItem(at: path), view.beginInteractiveMovementForItem(at: path) else { return }
        movingTabID = id
        let location = gesture.location(in: view)
        centerOffset = CGPoint(x: attributes.center.x - location.x, y: attributes.center.y - location.y)
        parent.controller.beginTerminalTabDrag()
        view.accessibilityValue = "Reordering"
      case .changed:
        guard movingTabID != nil else { return }
        let location = gesture.location(in: view)
        view.updateInteractiveMovementTargetPosition(CGPoint(x: location.x + centerOffset.x, y: location.y + centerOffset.y))
      case .ended:
        guard movingTabID != nil else { return }
        if view.bounds.contains(gesture.location(in: view)) { view.endInteractiveMovement() }
        else { view.cancelInteractiveMovement() }
        finishMovement()
      case .cancelled, .failed:
        cancelMovement()
      default: break
      }
    }

    func collectionView(_ collectionView: UICollectionView, targetIndexPathForMoveFromItemAt original: IndexPath,
                        toProposedIndexPath proposed: IndexPath) -> IndexPath {
      let count = presentation.groups[original.section].tabs.count
      let item = proposed.section < original.section ? 1 : proposed.section > original.section ? count : proposed.item
      return IndexPath(item: max(1, min(item, count)), section: original.section)
    }

    func collectionView(_ collectionView: UICollectionView, moveItemAt source: IndexPath, to destination: IndexPath) {
      guard movingTabID != nil, source.section == destination.section, source.item != destination.item,
            source.item > 0, destination.item > 0 else { return }
      let group = presentation.groups[source.section]
      let tab = group.tabs[source.item - 1], neighbor = group.tabs[destination.item - 1]
      presentation.groups[source.section].tabs.remove(at: source.item - 1)
      presentation.groups[source.section].tabs.insert(tab, at: destination.item - 1)
      parent.controller.moveRemoteTerminalTab(tab.id, relativeTo: neighbor.id, before: destination.item < source.item, dragged: true)
    }

    private func moveAccessible(_ id: String, delta: Int) -> Bool {
      guard let view = collectionView, movingTabID == nil, let source = indexPath(for: id),
            collectionView(view, canMoveItemAt: source) else { return false }
      let tabs = presentation.groups[source.section].tabs, target = source.item - 1 + delta
      guard tabs.indices.contains(target) else { return false }
      parent.controller.moveRemoteTerminalTab(id, relativeTo: tabs[target].id, before: delta < 0)
      return true
    }

    @objc func cancelMovement() {
      guard movingTabID != nil else { return }
      collectionView?.cancelInteractiveMovement()
      finishMovement()
    }

    private func finishMovement() {
      movingTabID = nil
      touchedTabID = nil
      parent.controller.endTerminalTabDrag()
      collectionView?.accessibilityValue = nil
      update(parent)
    }
  }
}

private struct RemoteTerminalReorderHandle: UIViewRepresentable {
  let tab: RemoteTerminalTabDescriptor
  let enabled: Bool
  let moveUp: () -> Bool
  let moveDown: () -> Bool

  func makeUIView(context: Context) -> HandleView { HandleView() }
  func updateUIView(_ view: HandleView, context: Context) {
    view.tabID = tab.id
    view.isUserInteractionEnabled = enabled
    view.alpha = enabled ? 1 : 0.3
    view.accessibilityIdentifier = "clawdad.remote.reorder.\(tab.id)"
    view.accessibilityLabel = "Reorder \(tab.title)"
    view.accessibilityHint = "Hold and drag to move within this window"
    view.accessibilityTraits = enabled ? .button : [.button, .notEnabled]
    view.accessibilityCustomActions = enabled ? [
      UIAccessibilityCustomAction(name: "Move up") { _ in moveUp() },
      UIAccessibilityCustomAction(name: "Move down") { _ in moveDown() }
    ] : []
  }

  final class HandleView: UIView {
    var tabID = ""
    override init(frame: CGRect) {
      super.init(frame: frame)
      isAccessibilityElement = true
      let image = UIImageView(image: UIImage(systemName: "line.3.horizontal", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)))
      image.tintColor = UIColor(ClawDadTheme.cream.opacity(0.7))
      image.translatesAutoresizingMaskIntoConstraints = false
      addSubview(image)
      NSLayoutConstraint.activate([image.centerXAnchor.constraint(equalTo: centerXAnchor), image.centerYAnchor.constraint(equalTo: centerYAnchor)])
      addInteraction(UIPointerInteraction(delegate: nil))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  }
}
#endif
