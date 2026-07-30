import Foundation
import Sparkle

@MainActor
final class ClawDadUpdateController: NSObject {
  let controller: SPUStandardUpdaterController

  override init() {
    controller = SPUStandardUpdaterController(
      startingUpdater: true,
      updaterDelegate: nil,
      userDriverDelegate: nil
    )
    super.init()
  }

  @objc func checkForUpdates(_ sender: Any?) {
    controller.checkForUpdates(sender)
  }

  var statusDictionary: [String: Any] {
    let updater = controller.updater
    var status: [String: Any] = [
      "available": true,
      "canCheckForUpdates": updater.canCheckForUpdates,
      "automaticallyChecksForUpdates": updater.automaticallyChecksForUpdates
    ]
    if let lastCheck = updater.lastUpdateCheckDate {
      status["lastUpdateCheckAt"] = ISO8601DateFormatter().string(from: lastCheck)
    }
    return status
  }
}
