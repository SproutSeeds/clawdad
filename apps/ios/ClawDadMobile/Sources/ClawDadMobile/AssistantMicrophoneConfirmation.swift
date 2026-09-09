import SwiftUI

@MainActor
func assistantMicrophoneConfirmation() {
  #if os(iOS)
  UINotificationFeedbackGenerator().notificationOccurred(.success)
  #endif
}
