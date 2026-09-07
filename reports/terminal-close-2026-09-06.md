# Close Terminal tabs from iPhone

iPhone 0.7.0 build 52 is available in ClawDad Internal TestFlight. Mac 0.7.0
build 63 is signed, notarized, and ready for installation; the installed Mac
remains on build 62 while Finder is in use. Both new builds are needed for Close.

## Behavior

Swipe left on a Terminal tab card and tap Close. A full swipe only reveals the
action. The confirmation names the directory, physical window, and tab position.
It mentions a working agent when that state is verified and warns when the last
tab will close its window. VoiceOver exposes Close Tab as an accessibility action.

The card stays in the picker until the Mac verifies closure. The refreshed
catalog preserves the remaining native order and follows Terminal's selected
tab. An emptied window group disappears. Vertical scrolling and the separate
hold-and-drag reorder handle remain available; background status updates preserve
a revealed swipe action until it is dismissed.

If Terminal opens a process warning, its text and confirmation button appear on
the phone. Cancel preserves the tab. A timeout, disconnect, or Mac lock attempts
to cancel only the warning opened by this close operation.

## Targeting and transport

Close uses the existing encrypted Remote Assist control channel and introduces
an optional host capability. Older hosts do not expose the action. No cloud
storage, compute service, or paid transfer path is added.

The Mac refreshes the catalog, checks its revision, and resolves a stable native
tab identity before acting. It presses that tab's own native close control. Only
a standalone tab can use the window's [native close-button attribute](https://developer.apple.com/documentation/applicationservices/kaxclosebuttonattribute).
There is no global Command-W fallback or directory-name targeting.

Native process confirmations use a single-use token bound to the exact tab,
window, newly attached sheet, buttons, and prompt text. Existing or replaced
dialogs cannot receive the destructive decision. Remote input is suppressed
while closing or confirming. A delayed response retries the same request ID;
retained receipts prevent another close, including after the selected neighbor
changes. Native layout observation can retry after a close without pressing Close
again. Both native control disappearance with a reduced tab count and the final
catalog must confirm the target is gone before reporting success.

## Verification

- Runtime: all 501 tests pass. The first pass identified two release-metadata
  fixtures still naming build 51; those fixtures were updated and all 501 passed
  on the complete rerun.
- Shared protocol: 54 tests pass, including payload validation, old-host
  compatibility, native confirmation tokens, and rejecting success while the
  target remains in the returned catalog.
- Mobile models: 100 tests pass, including confirmation details and rejecting a
  late catalog that would restore a closed row.
- Mac: 143 tests execute with zero failures; six existing permission/hardware
  checks are skipped. New cases cover duplicate directory names, stale topology,
  repeated or altered requests, delayed confirmation, unrelated dialogs, cancel,
  disconnect, unconfirmed closure, and the last tab. The local WebRTC handshake
  test confirms the production advertisement includes the close capability.
- iPhone UI: seven tests pass for close, cancel, process warnings, last-window
  removal, scrolling, grouping, and reordering. Five affected cases pass again on
  final UI code, including a status update while Close is revealed and recovery
  from a lost close receipt. The resulting picker screenshot was visually reviewed.

The native AppKit fixture verifies twenty duplicate tabs, identity across focus,
and native tab/window lifetime after direct closure. Native AX action targeting
and sheet handling use an injected accessibility graph. Attempts to exercise the
external accessibility action bridge inside the AppKit test process were not a
valid physical test. These checks do not constitute a physical iPhone-to-Terminal
acceptance pass. Remaining hands-on check: close/cancel a disposable tab, then
verify Terminal's running-process confirmation and a separate window's last tab.

## Release evidence

Artifacts, logs, screenshots, and the build 62 rollback app are retained under
`native/macos/dist/candidates/terminal-close-2026-09-06/`. Native compilation uses
the development drive. Build 63 packages the new binary with the verified build
62 resources and updated release metadata, then receives a new signature and
Apple notarization. The storage guard in the existing build wrapper is unchanged.

- Notarization: `d6236f56-8e04-43d5-b8ed-23d8bd261bff`, Accepted; stapled app passes
  strict signature and Gatekeeper verification.
- Executable SHA-256: `01a8b1335b1e44db4d70d9b249a1b59a4db1fdf2577c8f3fc94898b75e10cf85`.
- Stapled ZIP SHA-256: `2bfaa645648306bb9c1fe495d0425109c29d7f6c400c84b12e7908144f2e9bdd`.
- Runtime fingerprint: `05cc15e94b79da25d113c55c8dba0cffac8ffba4e5e58ee7384bb1f43a9cd66b`.
- App Store Connect build: `a0359cda-98a2-4f61-b2a6-d0defdbaa06f`, `VALID`,
  `IN_BETA_TESTING`, assigned only to ClawDad Internal with build-specific notes.
- The iPhone upload succeeded with the existing third-party WebRTC dSYM warning;
  this limits symbolication for that framework and did not block distribution.

macOS rejected direct filesystem replacement of the installed app. Finder's
foreground window changed during the GUI installation attempts; no replacement
was confirmed. The existing signed build 62 was verified intact and reopened.
Finish the normal Finder replacement with the ready build 63 app when Finder is
available, then verify installed hashes, native capabilities, and service health.

## Workspace

The scoped checkpoint preserves these eight pre-existing groups for their owners
to review and checkpoint separately: `.agents/skills/clawdad-release/SKILL.md`,
`native/macos/build-app.sh`, `native/macos/package-release.sh`,
`native/macos/storage-workflow.sh`,
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`,
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`,
`assets/wordmark-explorations/`, and `marketing-site/`.

Public npm, GitHub release assets, the public Mac appcast, external TestFlight,
and App Store submission are outside this private native rollout.
