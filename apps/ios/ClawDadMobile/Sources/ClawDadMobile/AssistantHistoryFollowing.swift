import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Content growth must never be mistaken for the reader scrolling away.
struct AssistantHistoryFollowing {
  private(set) var following = true
  private(set) var showLatest = false
  private var interacting = false
  private(set) var openingExact = false
  mutating func interaction(_ value: Bool) { interacting = value; if value { openingExact = false } }
  mutating func geometry(distanceFromBottom: CGFloat) {
    guard !openingExact else { return }
    if distanceFromBottom <= 36 { following = true; showLatest = false }
    else {
      if interacting && distanceFromBottom > 64 { following = false }
      showLatest = !following
    }
  }
  mutating func latest() { openingExact = false; following = true; showLatest = false }
  mutating func openExactMessage() { openingExact = true; following = false; showLatest = true }
  mutating func cancelExactOpening() { openingExact = false }
}

extension View {
  @ViewBuilder func assistantReplyScrollAnchor(active: Bool, revision: Int) -> some View {
    #if os(iOS)
    background(AssistantReplyScrollAnchor(active: active, revision: revision).allowsHitTesting(false).accessibilityHidden(true))
    #else
    self
    #endif
  }
  @ViewBuilder func assistantHistoryTracking(_ state: Binding<AssistantHistoryFollowing>) -> some View {
    #if os(iOS)
    self.onScrollGeometryChange(for: CGFloat.self) { geometry in
      geometry.contentSize.height + geometry.contentInsets.bottom - geometry.contentOffset.y - geometry.containerSize.height
    } action: { _, distance in state.wrappedValue.geometry(distanceFromBottom: distance) }
      .onScrollPhaseChange { _, phase in
        state.wrappedValue.interaction(phase == .tracking || phase == .interacting || phase == .decelerating)
      }
      .defaultScrollAnchor(.bottom, for: .initialOffset)
    #else
    self
    #endif
  }
}

#if os(iOS)
/// ScrollViewReader first materializes the lazy message. UIKit then aligns the
/// actual selectable text after its measured height and Dynamic Type settle.
/// This short-lived request never competes with the reader's own scrolling.
private struct AssistantReplyScrollAnchor: UIViewRepresentable {
  let active: Bool
  let revision: Int
  func makeUIView(context: Context) -> Anchor { Anchor() }
  func updateUIView(_ view: Anchor, context: Context) { view.request(active ? revision : nil) }
  final class Anchor: UIView {
    private var revision: Int?
    private var deadline: TimeInterval = 0
    private var pending: DispatchWorkItem?
    func request(_ value: Int?) {
      guard revision != value else { return }
      revision = value; pending?.cancel(); pending = nil
      guard value != nil else { return }
      deadline = ProcessInfo.processInfo.systemUptime + 3
      schedule()
    }
    override func didMoveToWindow() { super.didMoveToWindow(); schedule() }
    override func layoutSubviews() { super.layoutSubviews(); schedule() }
    private func schedule() {
      guard revision != nil, window != nil, pending == nil,
        ProcessInfo.processInfo.systemUptime < deadline else { return }
      let work = DispatchWorkItem { [weak self] in
        guard let self else { return }
        pending = nil
        var ancestor = superview
        while let current = ancestor, !(current is UIScrollView) { ancestor = current.superview }
        guard let scroll = ancestor as? UIScrollView else { schedule(); return }
        guard !scroll.isTracking, !scroll.isDragging, !scroll.isDecelerating else { deadline = 0; return }
        if bounds.height > 0, scroll.bounds.height > 0 {
          let rect = convert(bounds, to: scroll)
          let minimum = -scroll.adjustedContentInset.top
          let maximum = max(minimum, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
          let y = min(maximum, max(minimum, rect.minY - scroll.adjustedContentInset.top))
          if abs(scroll.contentOffset.y - y) > 1 { scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: y), animated: false) }
        }
        schedule()
      }
      pending = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
    }
  }
}
#endif
