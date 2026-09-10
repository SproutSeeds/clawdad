import SwiftUI

/// Content growth must never be mistaken for the reader scrolling away.
struct AssistantHistoryFollowing {
  private(set) var following = true
  private(set) var showLatest = false
  private var interacting = false
  mutating func interaction(_ value: Bool) { interacting = value }
  mutating func geometry(distanceFromBottom: CGFloat) {
    if distanceFromBottom <= 36 { following = true; showLatest = false }
    else {
      if interacting && distanceFromBottom > 64 { following = false }
      showLatest = !following
    }
  }
  mutating func latest() { following = true; showLatest = false }
}

extension View {
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
