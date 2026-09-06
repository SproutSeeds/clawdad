# Remote Assist window groups and shared voice

September 5, 2026. Released: Mac 0.7.0 (51) installed at
`/Applications/ClawDad.app`; iPhone 0.7.0 (43) VALID and assigned to
ClawDad Internal TestFlight. Physical Terminal/iPhone acceptance remains open.

## Resulting behavior

The switcher has expandable groups for physical Terminal windows, with stable
window labels and tab counts. Each group's list follows the native tab strip's
left-to-right order. The active group opens initially; subsequent expansion choices
survive leaving and reopening the picker during the Remote Assist session. The
Back control and Escape return to the controls menu. Native list drag handles
provide within-window reordering, including scroll and accessibility support.

The Mac uses native Accessibility control identities for groups and rows. Repeated
titles and directories remain independent tabs. Focus raises the associated window
and selects the actual control, then waits for confirmation. It never scans by
activating every tab. The selected shell is resolved through Terminal's scripting
catalog between two stable native layout reads. Resolving a previously unknown TTY
does not change the row identity or topology revision. Native activity alerts stay
attached to the corresponding control.

Reordering validates the current control sequence and uses the live handles. The
controller reads back the resulting order and restores the previously selected
tab. It rejects closed or stale targets and unconfirmed moves. Terminal contents,
history and running commands are not read to populate the picker.

Remote Assist now calls the same synthesis path as the main iPhone history view,
with the effective model/voice supplied by the existing host configuration. The
iPhone system-voice implementation was removed. Highlighted Mac text still takes
priority; confirmed empty selection falls back to the focused Terminal tab's latest
completed answer. Preparation stays inline with Stop available, then audio plays
automatically. Retry retains the chosen text. Cancelled or superseded requests
cannot start late playback, including an immediate retry with the same playback
identity. Synthesis polling allows five minutes, with six minutes for the phone's
overall preparation/transfer deadline.

The existing paired-Mac speech service, local cache and authenticated audio delivery
are reused. Remote Assist requests paired-Mac-first processing with remote compute
fallback disabled. Existing transient audio relay remains part of delivery; this
release adds no cloud file store or cloud compute resource.

## Verification and limits

- Runtime: 480 tests passed. All 76 targeted web and release checks passed after
  the final metadata update.
- Shared protocol: 45 tests passed. Window titles are optional for compatibility
  and bounded during decoding.
- Mac: 97 tests executed, one existing live Terminal test skipped, zero failures.
  A native AppKit fixture creates two physical windows with 20 duplicate-named tabs
  in one window. It checks the native tab frames' left-to-right order and stable
  control identity after focus changes. An injected Accessibility attribute reader
  exercises the production catalog against those real native controls and verifies
  group membership and selected-shell resolution.
- Mobile Swift package: 75 tests passed, including grouping, expansion retention,
  exact shared-speech requests, changed sources and cancellation/retry ownership.
- Five distinct iPhone UI scenarios passed across the retained result bundles:
  grouped windows/duplicate rows/drag/Back/reopen; selection-first shared playback;
  empty-selection Terminal fallback; delayed capability/capture startup; and slow
  voice preparation followed by Stop and a rejected late completion. The three
  changed scenarios were rerun on build 43 after removing device speech.
- Grouped-window and inline preparation/playback screenshots were reviewed.
- A real request to the installed host generated a 5.025-second, mono 24 kHz PCM WAV.
  Its manifest reports `doc-reader`, `kokoro`, `af_heart`. The same effective host
  configuration supplies the main app and Remote Assist voice.

Computer Use refused direct inspection of `com.apple.Terminal` with "Computer Use
is not allowed to use the app 'com.apple.Terminal' for safety reasons." No alternate
Terminal UI inspection was attempted. The native fixtures are separate windows
owned by the test process. They do not establish correctness against Cody's actual
Terminal layout, macOS drag behavior in every overflow case, or physical iPhone
audible playback. UI speech fixtures use silent PCM to exercise transfer/playback
state; the real generated voice sample is separate. These hands-on checks remain
open in the plan.

## Artifacts and release identity

- Mac candidate: `native/macos/dist/candidates/window-groups-speech-2026-09-05/build51/ClawDad.app`.
- Notarization: `d20c9c5f-e429-4809-aff3-1d37e48a0aeb`, Accepted. The ticket is
  stapled and validated; Gatekeeper accepts the Notarized Developer ID signature.
- Mac executable SHA-256: `998db586693f223ba0acfa4a508d9e348ae4da65698e44e5d3ab57c2653860b6`.
- Stapled ZIP SHA-256: `cd2f07d21afc12244bf5f8305b161d54f51acff946a0e9e63ded0923c468230f`.
- Bundled runtime marker: `70228781699a4572bc03dec00523cfd736316ec4810d11bb6764ced5fe4bade7`.
- iPhone archive: `apps/ios/ClawDadMobile/build/WindowGroups43.xcarchive`.
- Final export: `apps/ios/ClawDadMobile/build/WindowGroups43-IPA-final/ClawDad.ipa`.
- IPA SHA-256: `6bba5654e58a55f88dd9fac6751e68e619913f6b50cc1f9d7afc46dc61859574`.
- Apple build/upload ID: `25b189ec-3785-47c1-a964-b4060b68572e`, build 43, VALID.
  Assignment to `bbba6b69-7ac4-4d56-bc41-e9456d56b02e` (ClawDad Internal) and
  the build's test instructions were read back. External assignment is false.
  `ops/app-store-release.json` records the verified status.
- The Release executable excludes the speech-preview flags and the old
  `AppleMobileSpeechEngine`. The archive has the production cloud URL and
  `ClawDadFoundingBetaAccess=NO`.
- UI bundles: `WindowGroupsUITests.xcresult`, `WindowGroupsReorderUITests.xcresult`
  and `WindowGroups43UITests.xcresult` in the iPhone build directory. The first
  grouped-window run used the wrong Back label in its test; the corrected test
  passed, including drag and expansion retention.
- Reviewed images: `apps/ios/ClawDadMobile/build/window-groups-ui-review/`.
- Actual voice sample/manifest: `native/macos/dist/candidates/window-groups-speech-2026-09-05/voice-check-0.wav`
  and `voice-check.json`.
- Installed Mac 51's executable hash and bundled runtime marker match the notarized
  candidate. The active runtime marker also matches. The installed signature
  verifies and the running executable is `/Applications/ClawDad.app/Contents/MacOS/ClawDad`.
  Port 4487 `/healthz` returns `ok: true` with the Codex app server ready.
- Mac 50 was stopped normally and retained at
  `~/Library/Application Support/ClawDad/App Backups/ClawDad-0.7.0-build50.app`.
  Existing backups were preserved. The restart waited for the old service port
  to become bindable before launching build 51.
- Installed-host and Apple readbacks are retained as `mac51-installed-status.json`
  and `testflight43-status.json` in the candidate directory, alongside release logs.
  The earlier `WindowGroups43-IPA/` export was superseded by the final export and
  was not uploaded.

Update the iPhone through TestFlight to build 43, then reconnect Remote Assist.
The paired physical iPhone was visible to CoreDevice during this release, but its
TestFlight installation and audible playback were not verified in this run.

## Workspace and release scope

The native apps and existing embedded runtime are the scope. Installed Mac and
ClawDad Internal TestFlight are the established distribution channels. Public npm,
GitHub releases/tags, appcasts, external TestFlight and App Store submission remain
separate channels.

Five pre-existing groups are preserved for separate review and excluded from this
checkpoint: `.agents/skills/clawdad-release/SKILL.md`,
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`,
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`,
`assets/wordmark-explorations/`, and `marketing-site/`. Their next action is a
separate owner review and scoped checkpoint before publication. Build and UI
artifacts are in ignored canonical build directories. The release checkpoint
preserves those five groups; ORP reports classified dirt with zero unclassified
paths. `git diff --check` passes.
