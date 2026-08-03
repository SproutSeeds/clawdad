import AppKit
import Darwin
import Foundation

struct NativeAppProcessDescriptor: Equatable {
  let processIdentifier: pid_t
  let bundleIdentifier: String
  let bundleURL: URL
}

enum NativeAppLaunchResolution: Equatable {
  case continueLaunching
  case redirectToCanonical(URL)
  case exitInFavorOfExisting(pid_t)
  case terminateNoncanonicalDuplicates([pid_t])
}

enum NativeAppInstancePolicy {
  static let bundleIdentifier = "earth.frg.ClawDad"
  static let canonicalBundleURL = URL(
    fileURLWithPath: "/Applications/ClawDad.app",
    isDirectory: true
  )

  static func resolve(
    currentProcessIdentifier: pid_t,
    currentBundleIdentifier: String,
    currentBundleURL: URL,
    canonicalBundleURL: URL = canonicalBundleURL,
    canonicalBundleAvailable: Bool,
    runningApplications: [NativeAppProcessDescriptor]
  ) -> NativeAppLaunchResolution {
    guard currentBundleIdentifier == bundleIdentifier,
          isManagedClawDadBundle(currentBundleURL, canonicalBundleURL: canonicalBundleURL) else {
      return .continueLaunching
    }

    let currentIsCanonical = urlsMatch(currentBundleURL, canonicalBundleURL)
    let duplicates = runningApplications
      .filter { $0.processIdentifier != currentProcessIdentifier }
      .filter {
        $0.bundleIdentifier == bundleIdentifier
          && isManagedClawDadBundle($0.bundleURL, canonicalBundleURL: canonicalBundleURL)
      }

    let runningCanonicalApplications = duplicates
      .filter { urlsMatch($0.bundleURL, canonicalBundleURL) }
      .sorted { $0.processIdentifier < $1.processIdentifier }
    let runningCanonical = runningCanonicalApplications.first

    if !currentIsCanonical, canonicalBundleAvailable || runningCanonical != nil {
      return .redirectToCanonical(canonicalBundleURL)
    }

    if currentIsCanonical {
      let canonicalWinner = (
        runningCanonicalApplications.map(\.processIdentifier)
          + [currentProcessIdentifier]
      ).min()
      if let canonicalWinner, canonicalWinner != currentProcessIdentifier {
        return .exitInFavorOfExisting(canonicalWinner)
      }
      let noncanonicalProcessIdentifiers = duplicates
        .filter { !urlsMatch($0.bundleURL, canonicalBundleURL) }
        .map(\.processIdentifier)
        .sorted()
      if !noncanonicalProcessIdentifiers.isEmpty {
        return .terminateNoncanonicalDuplicates(noncanonicalProcessIdentifiers)
      }
      return .continueLaunching
    }

    let noncanonicalWinner = (
      duplicates.map(\.processIdentifier) + [currentProcessIdentifier]
    ).min()
    if let noncanonicalWinner, noncanonicalWinner != currentProcessIdentifier {
      return .exitInFavorOfExisting(noncanonicalWinner)
    }
    return .continueLaunching
  }

  static func isManagedClawDadBundle(
    _ bundleURL: URL,
    canonicalBundleURL: URL = canonicalBundleURL
  ) -> Bool {
    bundleURL.pathExtension.lowercased() == "app"
      && bundleURL.lastPathComponent == canonicalBundleURL.lastPathComponent
  }

  static func urlsMatch(_ lhs: URL, _ rhs: URL) -> Bool {
    lhs.standardizedFileURL.path == rhs.standardizedFileURL.path
  }
}

enum NativeAppLifecyclePolicy {
  static let terminatesAfterLastWindowClosed = false

  static func shouldRestoreMainWindow(isVisible: Bool) -> Bool {
    !isVisible
  }
}

enum NativeAppInstanceGuardOutcome {
  case launch
  case exit
  case blocked(String)
}

@MainActor
final class NativeAppInstanceGuard {
  private let currentProcessIdentifier: pid_t
  private let currentBundleIdentifier: String
  private let currentBundleURL: URL
  private let canonicalBundleURL: URL
  private let gracefulTerminationTimeout: TimeInterval
  private let forcedTerminationTimeout: TimeInterval
  private let pollInterval: TimeInterval

  init(
    currentProcessIdentifier: pid_t = getpid(),
    currentBundleIdentifier: String = Bundle.main.bundleIdentifier
      ?? NativeAppInstancePolicy.bundleIdentifier,
    currentBundleURL: URL = Bundle.main.bundleURL,
    canonicalBundleURL: URL = NativeAppInstancePolicy.canonicalBundleURL,
    gracefulTerminationTimeout: TimeInterval = 2,
    forcedTerminationTimeout: TimeInterval = 1,
    pollInterval: TimeInterval = 0.1
  ) {
    self.currentProcessIdentifier = currentProcessIdentifier
    self.currentBundleIdentifier = currentBundleIdentifier
    self.currentBundleURL = currentBundleURL
    self.canonicalBundleURL = canonicalBundleURL
    self.gracefulTerminationTimeout = gracefulTerminationTimeout
    self.forcedTerminationTimeout = forcedTerminationTimeout
    self.pollInterval = pollInterval
  }

  func acquire(completion: @escaping (NativeAppInstanceGuardOutcome) -> Void) {
    resolve(completion: completion)
  }

  private func resolve(completion: @escaping (NativeAppInstanceGuardOutcome) -> Void) {
    switch currentResolution() {
    case .continueLaunching:
      completion(.launch)
    case .redirectToCanonical(let canonicalURL):
      redirectToCanonical(canonicalURL, completion: completion)
    case .exitInFavorOfExisting(let processIdentifier):
      NSRunningApplication(processIdentifier: processIdentifier)?.activate(
        options: [.activateAllWindows]
      )
      completion(.exit)
    case .terminateNoncanonicalDuplicates(let processIdentifiers):
      requestTermination(of: processIdentifiers, force: false)
      waitForCanonicalOwnership(
        gracefulDeadline: Date().addingTimeInterval(gracefulTerminationTimeout),
        forcedDeadline: Date().addingTimeInterval(
          gracefulTerminationTimeout + forcedTerminationTimeout
        ),
        didForce: false,
        completion: completion
      )
    }
  }

  private func currentResolution() -> NativeAppLaunchResolution {
    NativeAppInstancePolicy.resolve(
      currentProcessIdentifier: currentProcessIdentifier,
      currentBundleIdentifier: currentBundleIdentifier,
      currentBundleURL: currentBundleURL,
      canonicalBundleURL: canonicalBundleURL,
      canonicalBundleAvailable: canonicalBundleIsAvailable,
      runningApplications: runningApplications()
    )
  }

  private var canonicalBundleIsAvailable: Bool {
    guard let canonicalBundle = Bundle(url: canonicalBundleURL),
          canonicalBundle.bundleIdentifier == NativeAppInstancePolicy.bundleIdentifier,
          let executableURL = canonicalBundle.executableURL else {
      return false
    }
    return FileManager.default.isExecutableFile(atPath: executableURL.path)
  }

  private func runningApplications() -> [NativeAppProcessDescriptor] {
    NSRunningApplication.runningApplications(
      withBundleIdentifier: NativeAppInstancePolicy.bundleIdentifier
    ).compactMap { application in
      guard let bundleIdentifier = application.bundleIdentifier,
            let bundleURL = application.bundleURL else {
        return nil
      }
      return NativeAppProcessDescriptor(
        processIdentifier: application.processIdentifier,
        bundleIdentifier: bundleIdentifier,
        bundleURL: bundleURL
      )
    }
  }

  private func redirectToCanonical(
    _ canonicalURL: URL,
    completion: @escaping (NativeAppInstanceGuardOutcome) -> Void
  ) {
    if let runningCanonical = NSRunningApplication.runningApplications(
      withBundleIdentifier: NativeAppInstancePolicy.bundleIdentifier
    ).first(where: {
      guard let bundleURL = $0.bundleURL else {
        return false
      }
      return NativeAppInstancePolicy.urlsMatch(bundleURL, canonicalURL)
    }) {
      runningCanonical.activate(options: [.activateAllWindows])
      completion(.exit)
      return
    }

    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    NSWorkspace.shared.openApplication(
      at: canonicalURL,
      configuration: configuration
    ) { _, error in
      DispatchQueue.main.async {
        if let error {
          completion(.blocked(
            "ClawDad could not open its canonical app at \(canonicalURL.path): "
              + error.localizedDescription
          ))
        } else {
          completion(.exit)
        }
      }
    }
  }

  private func waitForCanonicalOwnership(
    gracefulDeadline: Date,
    forcedDeadline: Date,
    didForce: Bool,
    completion: @escaping (NativeAppInstanceGuardOutcome) -> Void
  ) {
    let resolution = currentResolution()
    guard case .terminateNoncanonicalDuplicates(let processIdentifiers) = resolution else {
      switch resolution {
      case .continueLaunching:
        completion(.launch)
      case .redirectToCanonical(let canonicalURL):
        redirectToCanonical(canonicalURL, completion: completion)
      case .exitInFavorOfExisting(let processIdentifier):
        NSRunningApplication(processIdentifier: processIdentifier)?.activate(
          options: [.activateAllWindows]
        )
        completion(.exit)
      case .terminateNoncanonicalDuplicates:
        break
      }
      return
    }

    let now = Date()
    var nextDidForce = didForce
    if now >= gracefulDeadline, !didForce {
      requestTermination(of: processIdentifiers, force: true)
      nextDidForce = true
    } else if now < gracefulDeadline {
      requestTermination(of: processIdentifiers, force: false)
    }

    guard now < forcedDeadline else {
      completion(.blocked(
        "Another ClawDad copy is still running. Quit every other ClawDad app, then reopen "
          + canonicalBundleURL.path + "."
      ))
      return
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + pollInterval) { [weak self] in
      self?.waitForCanonicalOwnership(
        gracefulDeadline: gracefulDeadline,
        forcedDeadline: forcedDeadline,
        didForce: nextDidForce,
        completion: completion
      )
    }
  }

  private func requestTermination(of processIdentifiers: [pid_t], force: Bool) {
    for processIdentifier in processIdentifiers {
      guard let application = NSRunningApplication(processIdentifier: processIdentifier),
            let bundleIdentifier = application.bundleIdentifier,
            let bundleURL = application.bundleURL else {
        continue
      }
      let descriptor = NativeAppProcessDescriptor(
        processIdentifier: processIdentifier,
        bundleIdentifier: bundleIdentifier,
        bundleURL: bundleURL
      )
      guard descriptor.bundleIdentifier == NativeAppInstancePolicy.bundleIdentifier,
            NativeAppInstancePolicy.isManagedClawDadBundle(
              descriptor.bundleURL,
              canonicalBundleURL: canonicalBundleURL
            ),
            !NativeAppInstancePolicy.urlsMatch(
              descriptor.bundleURL,
              canonicalBundleURL
            ) else {
        continue
      }
      if force {
        application.forceTerminate()
      } else {
        application.terminate()
      }
    }
  }
}
