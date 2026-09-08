#if os(iOS)
import SwiftUI

/// The complete labeled tile is tappable; labels do not shrink the icon target.
struct RemoteControlCaption<Icon: View>: View {
  let title: String
  let icon: Icon
  init(_ title: String, @ViewBuilder icon: () -> Icon) { self.title = title; self.icon = icon() }
  init(_ title: String, systemImage: String) where Icon == Image {
    self.title = title; self.icon = Image(systemName: systemImage)
  }
  var body: some View {
    VStack(spacing: 4) {
      icon.font(.system(size: 19, weight: .semibold)).frame(height: 28)
      Text(title).font(.caption2.weight(.semibold))
        .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
    }
    .padding(.horizontal, 3).padding(.vertical, 6)
    .frame(maxWidth: .infinity, minHeight: 68)
    .contentShape(RoundedRectangle(cornerRadius: 10))
  }
}
#endif
