# Terminal Close menu repair

Build 64 did not resolve the physical iPhone report. This follow-up replaces the
ineffective tab-button action with Terminal's native menu command for closing the
selected tab. The iPhone UI and build 52 close protocol remain compatible.

## Evidence

The installed build 64 logged two attempts at 23:57:36 and 23:57:50 on September 6
(America/Chicago). Both native tab-button actions returned AX success, followed by
`close_unconfirmed` after about five seconds. Both observation loops reported zero
layout-read failures and zero sheet-read failures. The screenshot shows the tab
remaining in the picker with the same timeout message.

These observations rule out a failed layout read as the cause of these attempts.
They show that the selected tab's close proxy can acknowledge an action while
leaving the tab open. Increasing the observation deadline would not repair the
ineffective action. A regression graph with an inert tab proxy reproduces the
exact build 64 error; it passes with the new menu action.

Apple documents Command-W as Close Tab, with different modifiers for Close Window,
Close Others, and Close All in its
[Terminal shortcut reference](https://support.apple.com/guide/terminal/keyboard-shortcuts-trmlshtcts/mac).
The installed Terminal main-menu resource binds Command-W to `performClose:`.
Apple's AX headers define modifier zero as Command alone, with separate bits for
Shift, Option, Control, and NoCommand.

## Repair

- Activate Terminal and select the requested stable native tab identity.
- Resolve the unique, enabled direct menu command with W and Command alone.
  Read command metadata independently of the localized menu title. Avoid nested
  Services and profile menus. Missing or ambiguous commands leave the tab open.
- Recheck topology, tab identity, position, selected window, selection, absence
  of an existing dialog, and Terminal's frontmost state after reading the menu.
- Press the resolved menu item once. No tab proxy, whole-window close button,
  synthesized keyboard shortcut, or second close action is used as a fallback.
- Preserve exact native process-warning ownership, phone confirmation, Cancel,
  duplicate-request receipts, and catalog verification before removing the row.
- Log the action source (`tab_menu` or `confirmation_button`) and AX result without
  titles, paths, terminal contents, or prompt text.

## Verification

`swift test --package-path native/macos --disable-sandbox` reports 156 tests,
150 passed, six explicit opt-in live tests skipped, zero failures. New coverage
includes the inert proxy, localized titles and uppercase shortcut metadata,
missing/disabled/duplicate commands, excluding broader close commands, changes
of selection/order/frontmost application during resolution, and the final
standalone tab. Existing confirmation, cancellation, ambiguous response, and
single-action timeout cases pass.

An isolated AppKit menu fixture invokes `performClose:` through a real NSMenu
item. A window delegate can refuse closure; when it permits closure, only the
selected tab disappears and its two neighbors remain. This verifies AppKit menu
behavior, not external Terminal AX delivery or a physical iPhone session.

The computer-control tool rejected direct Terminal access for safety reasons.
No external Terminal automation was used to bypass that restriction, and no user
Terminal tabs were closed by the audit. Physical iPhone acceptance remains
pending: Close and Cancel a disposable tab, handle a running-process warning,
then verify a separate window's final tab and preservation of neighboring tabs.

Evidence is retained in
`native/macos/dist/candidates/terminal-close-menu-repair-2026-09-07/`, including
the build 64 logs, failing regression, complete Mac suite, and release build.

## Release and workspace

The repair is being packaged as private Mac build 65. This is a native Mac-only
update; iPhone build 52 remains compatible and requires no new TestFlight upload.
Installation and host verification will be recorded here after completion.

The scoped change comprises `MacNativeTerminalTabs.swift`,
`MacNativeTerminalCloseTests.swift`, `NativeWindowTabFixtureTests.swift`, and the
two repair reports. The eight pre-existing unrelated dirty groups remain
preserved with their inventory and next actions in the
[original close release report](terminal-close-2026-09-06.md#workspace).
Public npm, GitHub releases, and appcasts are outside this private rollout.
