import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

@main
struct ClawDadMobileApp: App {
  @StateObject private var session: CloudSession
  @StateObject private var subscription: SubscriptionManager

  init() {
#if DEBUG
    if let scenario = ClawDadAppStorePreviewScenario.current {
#if canImport(UIKit)
      UIView.setAnimationsEnabled(false)
#endif
      let fixture = ClawDadAppStorePreviewFixture.make(scenario: scenario)
      _session = StateObject(wrappedValue: CloudSession(appStorePreview: fixture))
      _subscription = StateObject(wrappedValue: SubscriptionManager(previewAccess: true))
    } else {
      _session = StateObject(wrappedValue: CloudSession())
      _subscription = StateObject(wrappedValue: SubscriptionManager())
    }
#else
    _session = StateObject(wrappedValue: CloudSession())
    _subscription = StateObject(wrappedValue: SubscriptionManager())
#endif
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(session)
        .environmentObject(subscription)
        .task {
          subscription.start()
        }
        .onChange(of: subscription.revision) { _, _ in
          session.syncEntitlement(
            subscription.entitlement,
            foundingBetaAccess: subscription.foundingBetaAccess
          )
        }
        .onChange(of: session.ready) { _, ready in
          if ready {
            session.syncEntitlement(
              subscription.entitlement,
              foundingBetaAccess: subscription.foundingBetaAccess
            )
          }
        }
    }
  }
}
