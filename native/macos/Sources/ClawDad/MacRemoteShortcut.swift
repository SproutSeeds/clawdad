import Carbon.HIToolbox
import ClawDadRemoteAssistProtocol
import CoreGraphics

enum MacRemoteShortcutDelivery: Equatable {
  case focusedApplication
  case system
}

struct MacRemoteShortcutPlan: Equatable {
  let keyCode: CGKeyCode
  let flags: CGEventFlags
  let delivery: MacRemoteShortcutDelivery
}

struct MacRemoteKeyEventStep: Equatable {
  let keyCode: CGKeyCode
  let keyDown: Bool
  let flags: CGEventFlags
}

private struct MacRemoteModifierKey {
  let flag: CGEventFlags
  let keyCode: CGKeyCode
}

private let macRemoteModifierKeys = [
  MacRemoteModifierKey(
    flag: .maskShift,
    keyCode: CGKeyCode(kVK_Shift)
  ),
  MacRemoteModifierKey(
    flag: .maskControl,
    keyCode: CGKeyCode(kVK_Control)
  ),
  MacRemoteModifierKey(
    flag: .maskAlternate,
    keyCode: CGKeyCode(kVK_Option)
  ),
  MacRemoteModifierKey(
    flag: .maskCommand,
    keyCode: CGKeyCode(kVK_Command)
  ),
]

func macRemoteChordPlan(for chord: RemoteKeyChord) -> MacRemoteShortcutPlan? {
  guard chord.isValid else { return nil }
  let named: [String: CGKeyCode] = [
    "forward_delete": 117, "home": 115, "end": 119, "page_up": 116, "page_down": 121,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
  ]
  guard let stroke = assistantKeyStroke(named[chord.key] == nil ? chord.key : "space",
    modifiers: chord.orderedModifiers.map(\.rawValue)) else { return nil }
  // Match the two existing system shortcuts; all other combinations retain
  // the same authorized focused-input path as existing special keys.
  let system = chord.modifiers == [.command] && ["t", "tab"].contains(chord.key)
  return .init(keyCode: named[chord.key] ?? stroke.keyCode, flags: stroke.flags,
    delivery: system ? .system : .focusedApplication)
}

func macRemoteKeyEventSteps(
  keyCode: CGKeyCode,
  flags: CGEventFlags
) -> [MacRemoteKeyEventStep] {
  let modifiers = macRemoteModifierKeys.filter {
    flags.contains($0.flag)
  }
  var activeFlags: CGEventFlags = []
  var steps: [MacRemoteKeyEventStep] = []
  steps.reserveCapacity((modifiers.count * 2) + 2)

  for modifier in modifiers {
    activeFlags.insert(modifier.flag)
    steps.append(MacRemoteKeyEventStep(
      keyCode: modifier.keyCode,
      keyDown: true,
      flags: activeFlags
    ))
  }

  steps.append(MacRemoteKeyEventStep(
    keyCode: keyCode,
    keyDown: true,
    flags: activeFlags
  ))
  steps.append(MacRemoteKeyEventStep(
    keyCode: keyCode,
    keyDown: false,
    flags: activeFlags
  ))

  for modifier in modifiers.reversed() {
    activeFlags.remove(modifier.flag)
    steps.append(MacRemoteKeyEventStep(
      keyCode: modifier.keyCode,
      keyDown: false,
      flags: activeFlags
    ))
  }

  return steps
}

func macRemoteShortcutEventSteps(
  for shortcut: RemoteShortcut
) -> [MacRemoteKeyEventStep] {
  let plan = macRemoteShortcutPlan(for: shortcut)
  return macRemoteKeyEventSteps(
    keyCode: plan.keyCode,
    flags: plan.flags
  )
}

func macRemoteShortcutPlan(
  for shortcut: RemoteShortcut
) -> MacRemoteShortcutPlan {
  switch shortcut {
  case .controlC:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_ANSI_C),
      flags: .maskControl,
      delivery: .focusedApplication
    )
  case .controlJ:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_ANSI_J),
      flags: .maskControl,
      delivery: .focusedApplication
    )
  case .escape:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_Escape),
      flags: [],
      delivery: .focusedApplication
    )
  case .tab:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_Tab),
      flags: [],
      delivery: .focusedApplication
    )
  case .arrowUp:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_UpArrow),
      flags: [],
      delivery: .focusedApplication
    )
  case .arrowDown:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_DownArrow),
      flags: [],
      delivery: .focusedApplication
    )
  case .arrowLeft:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_LeftArrow),
      flags: [],
      delivery: .focusedApplication
    )
  case .arrowRight:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_RightArrow),
      flags: [],
      delivery: .focusedApplication
    )
  case .controlL:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_ANSI_L),
      flags: .maskControl,
      delivery: .focusedApplication
    )
  case .commandT:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_ANSI_T),
      flags: .maskCommand,
      delivery: .system
    )
  case .commandTab:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_Tab),
      flags: .maskCommand,
      delivery: .system
    )
  }
}
