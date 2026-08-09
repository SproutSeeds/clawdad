import Carbon.HIToolbox
import ClawDadRemoteAssistProtocol
import CoreGraphics
import XCTest
@testable import ClawDad

final class MacRemoteShortcutTests: XCTestCase {
  func testControlShortcutsStayInsideTheFocusedApplication() {
    let expected: [(RemoteShortcut, Int)] = [
      (.controlC, kVK_ANSI_C),
      (.controlJ, kVK_ANSI_J),
      (.controlL, kVK_ANSI_L),
    ]

    for (shortcut, keyCode) in expected {
      XCTAssertEqual(
        macRemoteShortcutPlan(for: shortcut),
        MacRemoteShortcutPlan(
          keyCode: CGKeyCode(keyCode),
          flags: .maskControl,
          delivery: .focusedApplication
        )
      )
    }
  }

  func testNavigationShortcutsStayInsideTheFocusedApplication() {
    let expected: [(RemoteShortcut, Int)] = [
      (.escape, kVK_Escape),
      (.tab, kVK_Tab),
      (.arrowUp, kVK_UpArrow),
      (.arrowDown, kVK_DownArrow),
      (.arrowLeft, kVK_LeftArrow),
      (.arrowRight, kVK_RightArrow),
    ]

    for (shortcut, keyCode) in expected {
      XCTAssertEqual(
        macRemoteShortcutPlan(for: shortcut),
        MacRemoteShortcutPlan(
          keyCode: CGKeyCode(keyCode),
          flags: [],
          delivery: .focusedApplication
        )
      )
    }
  }

  func testCommandTabUsesTheSystemEventStream() {
    XCTAssertEqual(
      macRemoteShortcutPlan(for: .commandTab),
      MacRemoteShortcutPlan(
        keyCode: CGKeyCode(kVK_Tab),
        flags: .maskCommand,
        delivery: .system
      )
    )
  }
}
