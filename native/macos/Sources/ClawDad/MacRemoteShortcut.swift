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
  case .commandTab:
    return MacRemoteShortcutPlan(
      keyCode: CGKeyCode(kVK_Tab),
      flags: .maskCommand,
      delivery: .system
    )
  }
}
