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

  func testCommandTUsesTheSystemEventStream() {
    XCTAssertEqual(
      macRemoteShortcutPlan(for: .commandT),
      MacRemoteShortcutPlan(
        keyCode: CGKeyCode(kVK_ANSI_T),
        flags: .maskCommand,
        delivery: .system
      )
    )
  }

  func testCommandTUsesBalancedModifierLifecycle() {
    XCTAssertEqual(
      macRemoteShortcutEventSteps(for: .commandT),
      [
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Command),
          keyDown: true,
          flags: .maskCommand
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_ANSI_T),
          keyDown: true,
          flags: .maskCommand
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_ANSI_T),
          keyDown: false,
          flags: .maskCommand
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Command),
          keyDown: false,
          flags: []
        ),
      ]
    )
  }

  func testCommandTabUsesBalancedModifierLifecycle() {
    XCTAssertEqual(
      macRemoteShortcutEventSteps(for: .commandTab),
      [
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Command),
          keyDown: true,
          flags: .maskCommand
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Tab),
          keyDown: true,
          flags: .maskCommand
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Tab),
          keyDown: false,
          flags: .maskCommand
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Command),
          keyDown: false,
          flags: []
        ),
      ]
    )
  }

  func testControlShortcutEndsWithNeutralModifierState() {
    let steps = macRemoteShortcutEventSteps(for: .controlC)

    XCTAssertEqual(steps.first, MacRemoteKeyEventStep(
      keyCode: CGKeyCode(kVK_Control),
      keyDown: true,
      flags: .maskControl
    ))
    XCTAssertEqual(steps.last, MacRemoteKeyEventStep(
      keyCode: CGKeyCode(kVK_Control),
      keyDown: false,
      flags: []
    ))
  }

  func testCompoundModifierLifecycleReleasesInReverseOrder() {
    XCTAssertEqual(
      macRemoteKeyEventSteps(
        keyCode: CGKeyCode(kVK_ANSI_A),
        flags: [.maskShift, .maskAlternate]
      ),
      [
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Shift),
          keyDown: true,
          flags: .maskShift
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Option),
          keyDown: true,
          flags: [.maskShift, .maskAlternate]
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_ANSI_A),
          keyDown: true,
          flags: [.maskShift, .maskAlternate]
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_ANSI_A),
          keyDown: false,
          flags: [.maskShift, .maskAlternate]
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Option),
          keyDown: false,
          flags: .maskShift
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Shift),
          keyDown: false,
          flags: []
        ),
      ]
    )
  }

  func testUnmodifiedNavigationKeyUsesNeutralFlags() {
    XCTAssertEqual(
      macRemoteShortcutEventSteps(for: .escape),
      [
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Escape),
          keyDown: true,
          flags: []
        ),
        MacRemoteKeyEventStep(
          keyCode: CGKeyCode(kVK_Escape),
          keyDown: false,
          flags: []
        ),
      ]
    )
  }
}
