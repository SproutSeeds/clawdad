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
}
