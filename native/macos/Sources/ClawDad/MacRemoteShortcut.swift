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
