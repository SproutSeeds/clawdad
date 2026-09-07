# Terminal Close menu repair

Build 64 did not resolve the physical iPhone report. This follow-up replaces the
ineffective tab-button action with Terminal's native menu command for closing the
selected tab. Mac build 65 is signed, notarized, installed, and running with
healthy host checks. The iPhone UI and build 52 close protocol remain compatible.

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

The repair is installed as private Mac version 0.7.0, build 65. This is a native
Mac-only update; iPhone build 52 requires no new TestFlight upload. Reconnect
Remote Assist after the host restart.

- Source commit: `c0b7738d05cf6eb7db9519680faf2ec5575449e3`.
- Notarization: `Accepted`, submission
  `229caaf8-caf4-4d24-88ae-dfbd00ab68e7`; the ticket is stapled and strict signature
  and Gatekeeper verification pass on `/Applications/ClawDad.app`.
- Installed executable SHA-256:
  `9bad94251c028ce2e1d555d2679cf2f8f64c15f950ea4a77ee5d53e2e4d4f21d`.
- Stapled archive SHA-256:
  `b4a06549a845a2d3b92ad81a058616c23adbab46a3cfb50bddd6c380b37c493d`.
- One installed ClawDad process is running from the canonical Applications path.
  Authenticated `/healthz` returns HTTP 200, `ok: true`, and Codex ready.
  `/v1/native/capabilities` returns HTTP 200 with the matching runtime fingerprint.
- Bundle, active runtime, and capability fingerprint:
  `05cc15e94b79da25d113c55c8dba0cffac8ffba4e5e58ee7384bb1f43a9cd66b`.
  Native packaging preserves the verified runtime and framework resources from
  build 64. Source, installed, and active copies of `lib/server.mjs`,
  `lib/cloud-host-connector.mjs`, and `lib/app-store-connect.mjs` match by SHA-256.
- Installation evidence: `mac-install-verification.json`, checked at
  `2026-09-07T05:12:33.635Z` in the candidate directory. The signed build 64 rollback
  app and the build 65 package/signature/notary evidence remain alongside it.

The repair is deployed; physical iPhone-to-Terminal acceptance remains pending.

The scoped change comprises `MacNativeTerminalTabs.swift`,
`MacNativeTerminalCloseTests.swift`, `NativeWindowTabFixtureTests.swift`, and the
two repair reports. The eight pre-existing unrelated dirty groups remain
preserved with their inventory and next actions in the
[original close release report](terminal-close-2026-09-06.md#workspace).
Public npm, GitHub releases, and appcasts are outside this private rollout.
Final worktree hygiene has zero unclassified paths; the eight unrelated groups
remain preserved for their separate owners and checkpoints.
