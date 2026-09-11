import Carbon.HIToolbox
import AppKit
import ClawDadRemoteAssistProtocol
import CoreGraphics
import XCTest
@testable import ClawDad

final class MacRemoteShortcutTests: XCTestCase {
  @MainActor
  func testShiftLeftSelectsOnlyPreviousCharacterInDisposableNativeEditor() throws {
    _ = NSApplication.shared
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 120),
      styleMask: [.borderless], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    let editor = NSTextView(frame: window.contentView!.bounds)
    window.contentView?.addSubview(editor)
    editor.string = "ABCDE"; editor.setSelectedRange(NSRange(location: 5, length: 0))
    window.makeFirstResponder(editor)
    // The real wire codec and native key plan feed AppKit's normal text-input
    // interpretation. This isolated window is never shown or made key.
    let request = try RemoteInputCodec.decode(RemoteInputCodec.encode(
      .chordRequest(chord: .init(key: "left", modifiers: [.shift]), requestId: "native-editor")))
    let plan = try XCTUnwrap(macRemoteChordPlan(for: try XCTUnwrap(request.chord)))
    // The window server normally supplies function-key characters when posted
    // CGEvents become NSEvents. Supply that translation for this unshown editor.
    let character = String(UnicodeScalar(NSLeftArrowFunctionKey)!)
    let event = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero,
      modifierFlags: NSEvent.ModifierFlags(rawValue: UInt(plan.flags.rawValue)), timestamp: 0,
      windowNumber: window.windowNumber, context: nil, characters: character,
      charactersIgnoringModifiers: character, isARepeat: false, keyCode: plan.keyCode))
    editor.keyDown(with: event)
    XCTAssertEqual(editor.selectedRange(), NSRange(location: 4, length: 1))
    XCTAssertEqual(editor.string, "ABCDE")
    window.close()
  }

  func testShiftLeftAndCustomModifiersUseBalancedExistingNativeEvents() throws {
    let plan = try XCTUnwrap(macRemoteChordPlan(for: .init(key: "left", modifiers: [.shift])))
    XCTAssertEqual(plan, .init(keyCode: 123, flags: .maskShift, delivery: .focusedApplication))
    let steps = macRemoteKeyEventSteps(keyCode: plan.keyCode, flags: plan.flags)
    XCTAssertEqual(steps.map(\.keyCode), [56, 123, 123, 56])
    XCTAssertEqual(steps.map(\.keyDown), [true, true, false, false])
    XCTAssertEqual(steps.last?.flags, [])
    let custom = try XCTUnwrap(macRemoteChordPlan(for: .init(key: "right", modifiers: [.shift, .option])))
    XCTAssertEqual(custom.flags, [.maskShift, .maskAlternate])
    XCTAssertEqual(custom.keyCode, 124)
    XCTAssertEqual(custom.delivery, .focusedApplication)
    for key in RemoteKeyChord.namedKeys { XCTAssertNotNil(macRemoteChordPlan(for: .init(key: key))) }
    XCTAssertNil(macRemoteChordPlan(for: .init(key: "unsupported")))
  }
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
