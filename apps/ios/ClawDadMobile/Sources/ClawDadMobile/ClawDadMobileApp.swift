import SwiftUI

@main
struct ClawDadMobileApp: App {
  @StateObject private var session = CloudSession()
  @StateObject private var subscription = SubscriptionManager()

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
