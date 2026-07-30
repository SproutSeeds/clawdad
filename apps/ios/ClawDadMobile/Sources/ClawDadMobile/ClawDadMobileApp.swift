import SwiftUI

@main
struct ClawDadMobileApp: App {
  @StateObject private var session = CloudSession()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(session)
    }
  }
}
