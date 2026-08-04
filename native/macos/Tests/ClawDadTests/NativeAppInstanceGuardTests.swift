import Foundation
import XCTest
@testable import ClawDad

final class NativeAppInstanceGuardTests: XCTestCase {
  private let canonicalURL = URL(fileURLWithPath: "/Applications/ClawDad.app")
  private let repoURL = URL(
    fileURLWithPath: "/Volumes/Code_2TB/code/clawdad/native/macos/dist/ClawDad.app"
  )

  func testNoncanonicalCopyRedirectsToInstalledAppEvenDuringSimultaneousLaunch() {
    XCTAssertEqual(
      resolve(
        currentProcessIdentifier: 101,
        currentBundleURL: repoURL,
        canonicalBundleAvailable: true,
        runningApplications: []
      ),
      .redirectToCanonical(canonicalURL)
    )
  }

  func testCanonicalCopyTerminatesOnlyNoncanonicalClawDadDuplicates() {
    let repoDuplicate = descriptor(processIdentifier: 201, bundleURL: repoURL)
    let unrelatedBundle = NativeAppProcessDescriptor(
      processIdentifier: 202,
      bundleIdentifier: "com.example.OtherApp",
      bundleURL: URL(fileURLWithPath: "/Applications/Other.app")
    )
    let misleadingBundle = NativeAppProcessDescriptor(
      processIdentifier: 203,
      bundleIdentifier: NativeAppInstancePolicy.bundleIdentifier,
      bundleURL: URL(fileURLWithPath: "/Applications/NotClawDad.app")
    )

    XCTAssertEqual(
      resolve(
        currentProcessIdentifier: 100,
        currentBundleURL: canonicalURL,
        canonicalBundleAvailable: true,
        runningApplications: [unrelatedBundle, repoDuplicate, misleadingBundle]
      ),
      .terminateNoncanonicalDuplicates([201])
    )
  }

  func testCanonicalCopyExitsInFavorOfExistingCanonicalInstance() {
    XCTAssertEqual(
      resolve(
        currentProcessIdentifier: 102,
        currentBundleURL: canonicalURL,
        canonicalBundleAvailable: true,
        runningApplications: [
          descriptor(processIdentifier: 100, bundleURL: canonicalURL)
        ]
      ),
      .exitInFavorOfExisting(100)
    )
  }

  func testFirstCanonicalProcessWinsWhenCanonicalLaunchesRace() {
    XCTAssertEqual(
      resolve(
        currentProcessIdentifier: 100,
        currentBundleURL: canonicalURL,
        canonicalBundleAvailable: true,
        runningApplications: [
          descriptor(processIdentifier: 102, bundleURL: canonicalURL)
        ]
      ),
      .continueLaunching
    )
  }

  func testNoncanonicalCopyCanRunWhenNoCanonicalOrOtherCopyExists() {
    XCTAssertEqual(
      resolve(
        currentProcessIdentifier: 101,
        currentBundleURL: repoURL,
        canonicalBundleAvailable: false,
        runningApplications: []
      ),
      .continueLaunching
    )
  }

  func testSecondNoncanonicalCopyExitsInFavorOfExistingCopyWithoutCanonical() {
    XCTAssertEqual(
      resolve(
        currentProcessIdentifier: 102,
        currentBundleURL: repoURL,
        canonicalBundleAvailable: false,
        runningApplications: [
          descriptor(processIdentifier: 101, bundleURL: repoURL)
        ]
      ),
      .exitInFavorOfExisting(101)
    )
  }

  func testFirstNoncanonicalProcessWinsWhenNoncanonicalLaunchesRace() {
    XCTAssertEqual(
      resolve(
        currentProcessIdentifier: 101,
        currentBundleURL: repoURL,
        canonicalBundleAvailable: false,
        runningApplications: [
          descriptor(processIdentifier: 102, bundleURL: repoURL)
        ]
      ),
      .continueLaunching
    )
  }

  func testCanonicalLaunchMustRemainStableBeforeRedirectingCopyExits() {
    var tracker = NativeAppCanonicalLaunchTracker(
      requiredStableObservations: 3
    )

    XCTAssertFalse(tracker.observe(processIdentifier: 100))
    XCTAssertFalse(tracker.observe(processIdentifier: 100))
    XCTAssertTrue(tracker.observe(processIdentifier: 100))
  }

  func testCanonicalLaunchDisappearanceResetsStabilityCheck() {
    var tracker = NativeAppCanonicalLaunchTracker(
      requiredStableObservations: 2
    )

    XCTAssertFalse(tracker.observe(processIdentifier: 100))
    XCTAssertFalse(tracker.observe(processIdentifier: nil))
    XCTAssertFalse(tracker.observe(processIdentifier: 101))
    XCTAssertTrue(tracker.observe(processIdentifier: 101))
  }

  func testDifferentCanonicalProcessRestartsStabilityCheck() {
    var tracker = NativeAppCanonicalLaunchTracker(
      requiredStableObservations: 2
    )

    XCTAssertFalse(tracker.observe(processIdentifier: 100))
    XCTAssertFalse(tracker.observe(processIdentifier: 101))
    XCTAssertTrue(tracker.observe(processIdentifier: 101))
  }

  func testClosingLastWindowKeepsNativeHostAlive() {
    XCTAssertFalse(NativeAppLifecyclePolicy.terminatesAfterLastWindowClosed)
  }

  func testDockReopenRestoresOnlyAHiddenMainWindow() {
    XCTAssertTrue(NativeAppLifecyclePolicy.shouldRestoreMainWindow(isVisible: false))
    XCTAssertFalse(NativeAppLifecyclePolicy.shouldRestoreMainWindow(isVisible: true))
  }

  private func resolve(
    currentProcessIdentifier: pid_t,
    currentBundleURL: URL,
    canonicalBundleAvailable: Bool,
    runningApplications: [NativeAppProcessDescriptor]
  ) -> NativeAppLaunchResolution {
    NativeAppInstancePolicy.resolve(
      currentProcessIdentifier: currentProcessIdentifier,
      currentBundleIdentifier: NativeAppInstancePolicy.bundleIdentifier,
      currentBundleURL: currentBundleURL,
      canonicalBundleURL: canonicalURL,
      canonicalBundleAvailable: canonicalBundleAvailable,
      runningApplications: runningApplications
    )
  }

  private func descriptor(
    processIdentifier: pid_t,
    bundleURL: URL
  ) -> NativeAppProcessDescriptor {
    NativeAppProcessDescriptor(
      processIdentifier: processIdentifier,
      bundleIdentifier: NativeAppInstancePolicy.bundleIdentifier,
      bundleURL: bundleURL
    )
  }
}
