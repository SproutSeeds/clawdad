# Terminal close verification repair

Prepared Mac-side source patch for the iPhone report on installed Mac build 63.
The installed app remains build 63; this repair has not been installed or released.
The existing iPhone build 52 and close-message protocol are compatible.

## Audit

The screenshot's exact message, “Terminal has not confirmed that the tab closed
yet,” comes from the Mac native close observation timeout. The iPhone received
that failure and correctly retained the BioSentinel row. The user did not see a
Terminal process-confirmation dialog on the Mac. The screenshot shows a different
Terminal tab selected while BioSentinel is in the picker.

The shipped close operation pressed a tab's close proxy without first activating
Terminal and selecting the requested tab. It accepted an accessibility delivery
acknowledgment, then waited for closure. Apple distinguishes triggering an
accessibility action from successful completion of the underlying action in its
[accessibilityPerformPress documentation](https://developer.apple.com/documentation/appkit/nsaccessibilityprotocol/accessibilityperformpress()).
A background/overflow close control that acknowledges delivery without acting
reproduces the reported timeout in the controlled native graph.

There were also independent gaps in modal handling: the full layout scan ran
before the dialog probe; only direct window children were checked for sheets;
and the default button was assumed to be the destructive decision. A modal can
block selection reads, sit below a container, or make Cancel the default.

Build 63 logs list/focus operations but omits close outcomes and native action
results. Consequently, the exact native response during the BioSentinel attempt
cannot be established from historical logs. The regression evidence covers these
failure modes; physical verification is still needed to confirm that the new
sequence resolves the observed issue.

## Patch behavior

- Activate Terminal, select the requested native tab, and confirm its identity,
  selection, group, and position before closing. Re-resolve the visible window
  and close button after selection. A changed layout cancels the operation.
- Send one close action to that tab's own close control. Keep the existing
  request receipts and final catalog verification. Acknowledged actions that do
  nothing still fail honestly and never trigger another close press.
- Probe the target window's dialogs independently before scanning the full
  layout. Include nested native window containers while avoiding terminal text
  and tab-strip reads in that probe.
- Bind the phone's decision to the exact native sheet and buttons. Identify
  Cancel using its native attribute and the sole other button as the decision.
  Verify tab membership without requiring a full selection scan while a modal
  is open. Leave unrecognized or replaced dialogs untouched.
- Record close outcome, native action status, elapsed time, and failed-read
  counts in the existing local Terminal log category. No titles, directories,
  terminal contents, or confirmation text enter these diagnostics.

Selecting a background tab for closing brings it into view. Terminal determines
the selected neighbor after closure; Cancel keeps the selected target open.

## Verification and release gate

The original implementation fails three new regression cases with the exact
reported timeout: background close delivery without effect, a modal blocking
selection reads, and a nested warning with Cancel as default. All pass with the
repair. Additional cases cover replacement of the visible native window during
selection, a concurrent reorder, a permanently ineffective action, and an
ambiguous action reply after a warning opens. Existing exact-target, cancellation,
disconnect, duplicate-request, and last-tab cases remain covered.

The full Mac suite reports 150 tests, six explicit opt-in live tests skipped,
and zero failures. The arm64 release build compiles successfully. Existing
WebRTC Sendable warnings are unchanged. Logs and the reviewable patch are under
`native/macos/dist/candidates/terminal-close-repair-2026-09-07/`.

No open user Terminal tabs were selected, modified, or closed by this audit.
The native close tests use an injected accessibility graph; the separate AppKit
fixture covers real tab/window lifetime, not external Terminal AX actuation.
Before calling the issue resolved on-device, install a new signed Mac build and
verify Close and Cancel against disposable selected/background/overflow tabs,
including a running-process warning and the last tab in a separate window. Check
that neighboring tabs remain open and that one tap closes only the requested tab.

## Workspace

This patch is limited to `MacNativeTerminalTabs.swift`, `MacTerminalTabs.swift`,
`MacRemotePeer.swift`, `MacNativeTerminalCloseTests.swift`, and this report.
Eight pre-existing dirty groups remain preserved for their owners to review and
checkpoint: the release skill and plugin metadata, `build-app.sh`,
`package-release.sh`, `storage-workflow.sh`, `assets/wordmark-explorations/`, and
`marketing-site/`. Their exact paths and next actions remain recorded in the
[prior release inventory](terminal-close-2026-09-06.md#workspace). Final hygiene
shows zero unclassified paths.
