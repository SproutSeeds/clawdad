import Foundation
import XCTest
@testable import ClawDad

final class MacSystemReadinessTests: XCTestCase {
  func testControllerCanCompleteWithoutLocalCodex() {
    XCTAssertTrue(
      MacSystemReadinessPolicy.canComplete(
        role: .controller,
        codexInstalled: false,
        codexLoggedIn: false
      )
    )
  }

  func testExecutionRolesRequireInstalledAuthenticatedCodex() {
    for role in [ClawDadComputerRole.host, .both] {
      XCTAssertFalse(
        MacSystemReadinessPolicy.canComplete(
          role: role,
          codexInstalled: false,
          codexLoggedIn: false
        )
      )
      XCTAssertFalse(
        MacSystemReadinessPolicy.canComplete(
          role: role,
          codexInstalled: true,
          codexLoggedIn: false
        )
      )
      XCTAssertTrue(
        MacSystemReadinessPolicy.canComplete(
          role: role,
          codexInstalled: true,
          codexLoggedIn: true
        )
      )
    }
  }

  func testCodexCandidatesPreferExplicitOverrideThenUserStandaloneInstall() {
    let home = URL(fileURLWithPath: "/Users/example", isDirectory: true)
    XCTAssertEqual(
      macCodexCandidatePaths(
        homeDirectory: home,
        environment: ["CLAWDAD_CODEX": "/custom/bin/codex"]
      ),
      [
        "/custom/bin/codex",
        "/Users/example/.local/bin/codex",
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex"
      ]
    )
  }

  func testBareCodexOverrideDoesNotHideKnownStandaloneLocations() {
    let candidates = macCodexCandidatePaths(
      homeDirectory: URL(fileURLWithPath: "/Users/example", isDirectory: true),
      environment: ["CLAWDAD_CODEX": "codex"]
    )

    XCTAssertEqual(candidates.first, "/Users/example/.local/bin/codex")
    XCTAssertFalse(candidates.contains("codex"))
  }

  func testCodexVersionNormalizationHandlesCLIOutputAndReleaseTags() {
    XCTAssertEqual(macCodexNormalizedVersion("codex-cli 0.125.0"), "0.125.0")
    XCTAssertEqual(macCodexNormalizedVersion("rust-v0.152.1"), "0.152.1")
    XCTAssertEqual(
      macCodexNormalizedVersion("codex-cli 0.153.0-beta.2"),
      "0.153.0-beta.2"
    )
    XCTAssertNil(macCodexNormalizedVersion("codex-cli unknown"))
  }

  func testCodexUpdateComparisonDistinguishesAvailableAndCurrent() {
    XCTAssertEqual(
      macCodexUpdateAvailable(
        installedVersion: "codex-cli 0.125.0",
        latestReleaseTag: "rust-v0.152.1"
      ),
      true
    )
    XCTAssertEqual(
      macCodexUpdateAvailable(
        installedVersion: "codex-cli 0.152.1",
        latestReleaseTag: "rust-v0.152.1"
      ),
      false
    )
    XCTAssertEqual(
      macCodexUpdateAvailable(
        installedVersion: "codex-cli 0.153.0-beta.1",
        latestReleaseTag: "rust-v0.153.0"
      ),
      true
    )
    XCTAssertNil(
      macCodexUpdateAvailable(
        installedVersion: "unknown",
        latestReleaseTag: "rust-v0.152.1"
      )
    )
  }

  func testCodexLatestReleaseMetadataUsesOfficialReleaseTag() throws {
    let data = try XCTUnwrap(
      #"{"tag_name":"rust-v0.152.1","assets":[]}"#.data(using: .utf8)
    )

    XCTAssertEqual(macCodexLatestVersion(from: data), "0.152.1")
    XCTAssertNil(macCodexLatestVersion(from: Data("{}".utf8)))
  }

  func testCodexAuthenticationClassifierRecognizesRefreshTokenReuse() {
    XCTAssertTrue(
      macCodexAuthenticationNeedsSignIn(
        status: 1,
        output: "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again."
      )
    )
    XCTAssertTrue(
      macCodexAuthenticationNeedsSignIn(
        status: 0,
        output: "authentication required"
      )
    )
  }

  func testCodexAuthenticationClassifierAcceptsHealthyLoginStatus() {
    XCTAssertFalse(
      macCodexAuthenticationNeedsSignIn(
        status: 0,
        output: "Logged in using ChatGPT"
      )
    )
  }
}
