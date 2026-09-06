# Terminal switcher audit after Mac 51 / iPhone 43

The released switcher has reproducible identity and selection defects. An isolated
run of the production code changed one unchanged window from **Terminal Window 1**
to **2** to **3** after failed Accessibility reads. All three tabs remained open.
An outstanding tap then failed with "That Terminal tab has closed." The source also
confirms raw path labels and incomplete timeout coverage. The actual left-to-right
mapping and native focus/reorder behavior remain unverified against Cody's Terminal.

This is an audit and repair recommendation. Product code, installed apps, Terminal
sessions and release assignments were not changed during this audit.

## Verified scope

- Source: `5160ec5fba630972a83bcaa8d6b4e68dae07d8bc`.
- Installed Mac: 0.7.0 (51), executable SHA-256
  `998db586693f223ba0acfa4a508d9e348ae4da65698e44e5d3ab57c2653860b6`.
- Bundled runtime: `70228781699a4572bc03dec00523cfd736316ec4810d11bb6764ced5fe4bade7`.
- Port 4487 health: `ok: true`, Codex app server ready. This confirms the deployed
  host, not Terminal picker correctness. Physical iPhone build was not reread here.
- Inspected Mac catalog, focus, reorder, request scheduling and speech-target
  coupling; phone grouping, selection state, polling, drag and shared speech route;
  relevant tests; and the installed Terminal scripting dictionary.

## Findings, in repair order

### P1 — Incomplete reads destroy stable identities before validation

[MacNativeTerminalTabs.swift:30](/Volumes/Code_2TB/code/clawdad/native/macos/Sources/ClawDad/MacNativeTerminalTabs.swift:30)
converts every failed attribute read to nil; array reads become empty arrays. Capture
then removes unseen controls, groups and known shells at lines 84–86. The before/
after checks at lines 91–98 run after those mutations. A failed catalog can therefore
invalidate the identities in the last successful catalog, which the phone still uses.

Confirmed reproduction: keep the same window object and the same three shell rows;
make the window-list attribute temporarily unreadable; restore it. Repeating this
produces Window 1, Window 2, Window 3, new IDs for unchanged tabs, and a rejected tap
to a still-open tab. No UI action or physical window creation is involved.

Apple documents separate unavailable, invalid-element and messaging-error results.
They must not all mean a window closed. See
[Apple's attribute-read contract](https://developer.apple.com/documentation/applicationservices/1462085-axuielementcopyattributevalue?changes=_9).

Repair: collect a candidate snapshot without changing the last accepted registry;
preserve read errors; commit identities and removals only after a complete, validated
snapshot. Distinguish confirmed closure from temporary unavailability.

### P1 — Window/tab identity depends on replaceable UI controls

[MacNativeTerminalTabs.swift:49](/Volumes/Code_2TB/code/clawdad/native/macos/Sources/ClawDad/MacNativeTerminalTabs.swift:49)
assigns identities solely through `CFEqual` on Accessibility handles. The physical
group is keyed by the tab-strip element at line 70. The controller deliberately
ignores window ID and TTY whenever a native ID exists
([MacTerminalTabs.swift:358](/Volumes/Code_2TB/code/clawdad/native/macos/Sources/ClawDad/MacTerminalTabs.swift:358)).

Confirmed reproduction: replace only the strip/control objects, keeping the same
window and shell catalog, and the same physical window gets another number. This
demonstrates the fragility; an actual Terminal trace is still needed to establish
whether control replacement or a failed read triggered Cody's particular attempt.

Focus also depends on that identity surviving another capture, raising the window,
pressing the control and subsequent confirmation
([MacNativeTerminalTabs.swift:115](/Volumes/Code_2TB/code/clawdad/native/macos/Sources/ClawDad/MacNativeTerminalTabs.swift:115)).
It cannot recover a still-open target whose control was recreated.

Repair: maintain persistent tab identity from verified Terminal/shell metadata and
separate it from a replaceable control handle. Prove the mapping from Terminal's
scripting window IDs and TTYs to physical groups before using it for selection.
Preserve a group's identity across selected-window/control changes. A title or
directory is display metadata, never an identifier.

### P1 — The short timeout does not cover the descendant controls

[MacNativeTerminalTabs.swift:58](/Volumes/Code_2TB/code/clawdad/native/macos/Sources/ClawDad/MacNativeTerminalTabs.swift:58)
sets 0.25 seconds on the application element only. Reads and actions on windows,
strips and radio controls do not receive that timeout. Apple's API specifies that
a timeout on one object applies only to that object; a process-wide setting uses
the system-wide object. See
[Apple's timeout contract](https://developer.apple.com/documentation/applicationservices/1459345-axuielementsetmessagingtimeout).

The 0.6-second focus deadline also starts after the initial capture and UI actions,
and a synchronous capture can overrun it. The phone gives the request eight seconds.
Queued foreground work cannot interrupt the synchronous read already running on
the serial queue. This is a confirmed timing-design defect; no live tap latency
was measured in this audit.

Repair: apply explicit timeouts to every queried/actioned element, enforce an
overall operation budget, and preserve the latest foreground intent while deferring
polling. Record bounded local timing/error diagnostics without Terminal contents.

### P1 acceptance gap — Real Terminal order and native actuation were not proved

[MacNativeTerminalTabs.swift:64](/Volumes/Code_2TB/code/clawdad/native/macos/Sources/ClawDad/MacNativeTerminalTabs.swift:64)
uses the first tab group, trusts `AXTabs`/child enumeration order, and numbers that
array. There is no frame/order reconciliation or Terminal-specific verification of
hidden tabs. The phone then correctly sorts the supplied positions; it cannot repair
an incorrect host position.

Confirmed synthetic case: provide controls whose frames remain left/middle/right
but whose Accessibility array is right/left/middle. The picker reports
right/left/middle. This proves reliance on enumeration, not that Cody's actual
Terminal returns that exact permutation.

The native fixture supplies only its chosen visible windows, converts in-process
AppKit objects to stable fake RPC handles, and changes selection through
`NSWindowTabGroup.selectedWindow`
([NativeWindowTabFixtureTests.swift:47](/Volumes/Code_2TB/code/clawdad/native/macos/Tests/ClawDadTests/NativeWindowTabFixtureTests.swift:47)).
It never exercises real Terminal `AXRaise`/`AXPress` or dragging. Its frame assertion
also permits an empty frame list. Phone fixtures supply group IDs and positions and
make focus succeed by assigning the requested ID
([RemoteSpeechPreviewHost.swift:72](/Volumes/Code_2TB/code/clawdad/apps/ios/ClawDadMobile/Sources/ClawDadMobile/RemoteSpeechPreviewHost.swift:72)).

Repair: verify physical grouping, left-to-right positions and selected TTY against
two actual Terminal windows, including 20 tabs and duplicates. Add error/control-
replacement cases alongside those real integration checks. The earlier passing
fixture tests establish narrower behavior than the requested end-to-end acceptance.

### P2 — Directory names are never derived

The raw Accessibility title becomes `customTitle`, overriding the scripting title.
[macTerminalTabTitle:369](/Volumes/Code_2TB/code/clawdad/native/macos/Sources/ClawDad/MacTerminalTabs.swift:369)
only cleans control characters, collapses whitespace and truncates bytes.
`/Volumes/Code_2TB/code/leftmost` therefore stays that full path in the picker.

Repair: use the verified working directory's last component as the primary label,
with a tab number and optional parent-path detail for duplicates. Resolve directory
metadata passively through the owning shell/agent when available. Do not run `pwd`
or inject commands into an active agent to obtain a label. Define a fallback for
tabs where a directory cannot be resolved; do not interpret arbitrary titles as paths.

### P2 — Stale selection cannot always be reasserted by tapping

[RemoteAssist.swift:238](/Volumes/Code_2TB/code/clawdad/apps/ios/ClawDadMobile/Sources/ClawDadMobile/RemoteAssist.swift:238)
returns without sending a request when the phone believes that row is already
selected. Confirmed in the harness. If a failed update leaves the highlight stale,
tapping that row cannot reassert it on the Mac.

The reproduced lost-identity error carries no refreshed state. Only `stale_catalog`
triggers the specific automatic focus retry at
[RemoteAssist.swift:1975](/Volumes/Code_2TB/code/clawdad/apps/ios/ClawDadMobile/Sources/ClawDadMobile/RemoteAssist.swift:1975);
the native reader emits `layout_unavailable`. The user must wait for a later poll or
refresh, and any subsequent polling success can clear the visible error.

Repair: let an explicit tap verify/reassert the requested target; reconcile a failed
selection immediately; retry only after recovering the same persistent identity.

### P2 — Drag availability and cancellation exceed the evidence

[MacTerminalTabs.swift:417](/Volumes/Code_2TB/code/clawdad/native/macos/Sources/ClawDad/MacTerminalTabs.swift:417)
advertises reordering whenever Accessibility permission exists. Actual execution
requires matching controls, usable frames and a strip found at a shallower depth
than catalog discovery. Overflow moves and real Terminal dragging remain unverified.

On the phone, any row long-press pauses polling for 20 seconds. Cancellation or a
no-op drop does not clear that pause; the reset happens only inside the dispatched
move function
([RemoteTerminalWindowGroups.swift:79](/Volumes/Code_2TB/code/clawdad/apps/ios/ClawDadMobile/Sources/ClawDadMobile/RemoteTerminalWindowGroups.swift:79)).
This is an additional route to a stale-looking picker after holding a row.

Repair: advertise capability only for a verified group/layout, freeze a validated
drag snapshot, and release the polling pause on every end/cancel/no-op path. Confirm
the same running tab moved and that the previous selection was preserved.

## Custom scripting and speech implications

We already have a custom AppleScript catalog and a TTY-based selection script at
[MacTerminalTabs.swift:593](/Volumes/Code_2TB/code/clawdad/native/macos/Sources/ClawDad/MacTerminalTabs.swift:593).
The build 51 native-ID path selects by Accessibility instead of using that script.
The installed Terminal dictionary exposes window IDs, front-to-back window index,
tab TTY and selection; it does not provide a writable tab-position property. An
AppleScript adapter is useful, but scripting indexes alone do not establish physical
left-to-right grouping. The repair needs one validated mapping shared by discovery,
focus, reorder and speech ownership.

The higher-quality speech route remains shared with the main app
([CloudClient.swift:1422](/Volumes/Code_2TB/code/clawdad/apps/ios/ClawDadMobile/Sources/ClawDadMobile/CloudClient.swift:1422)).
However, identity churn can invalidate latest-response lookup and cause dictation
to fall back to clipboard: both depend on this catalog's selected tab identity
([MacRemotePeer.swift:679](/Volumes/Code_2TB/code/clawdad/native/macos/Sources/ClawDad/MacRemotePeer.swift:679)).
Changing the voice model would not repair that dependency.

## Reproduction and remaining verification

The isolated executable compiles the production Mac reader/controller/response
reader and phone grouping helper directly. It uses an extracted, unchanged phone
selection state and an injected three-tab Accessibility graph. The graph uses
nonexistent application handles; no Terminal UI, shell command, focus action or
window creation is executed. It exits successfully after asserting the defects above.

Artifacts: `native/macos/.build/audits/terminal-window-audit-2026-09-05/` contains
`Harness.swift`, `PhoneSelection.swift`, `compile.log`, `terminal-audit`, and
`results.json`. Preserve these for conversion into regression tests in the repair.

The prior Computer Use refusal for `com.apple.Terminal` still prevents a direct
live UI comparison through that tool. This audit did not use another route to
inspect or operate the forbidden Terminal UI. The exact native control/read event
behind Cody's attempt remains unobserved. A clarification was requested on whether
the window labels replace one another or accumulate together; the reproducer proves
renumbering while the phone still has one group.

Before the next release: compare Mac/phone side by side through repeated first,
middle and last tab selection; verify two physical windows, 20+ tabs, duplicates,
overflow, tab-bar hide/show, open/close, drag/cancel and transient read failures;
confirm unchanged shell count/TTYs, stable numbering and input/speech ownership.

The five pre-existing dirty groups remain preserved: `.agents/skills/clawdad-release/SKILL.md`,
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`,
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`,
`assets/wordmark-explorations/`, and `marketing-site/`. Their next action remains
separate owner review and scoped checkpoints. This audit report is a separate
documentation checkpoint; its reproduction artifacts remain in the ignored audit directory.
