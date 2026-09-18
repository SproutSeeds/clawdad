# Mac 163 and iPhone 103 account activation recovery

Mac 0.7.0 (163) is installed and running. iPhone 0.7.0 (103) is processed by Apple and available to the existing ClawDad Internal TestFlight group. The account selected before installation is still verified by the running app server from the same isolated profile home. Physical iPhone acceptance remains pending because both paired devices are unavailable to device tools; iPhone Mirroring also reports that Mac Wi-Fi is off.

## Behavior

- A transient native process-reader failure now waits and retries automatically, retaining the accepted activation and its original operation receipt across restart. Backoff starts at three seconds and caps at thirty seconds. Persisted build-162 startup timeouts recover through the same path.
- Transition receipts still reconcile completed effects. A timeout after transition retries verification without repeating the transition. Cancellation stops retries. Delivery uncertainty and changed ownership retain explicit recovery.
- Mac and iPhone distinguish Waiting for Mac, Waiting for app work, Checking app state, and Needs attention. The iPhone reports unavailable active-account identity honestly, refreshes it after reconnection, and retains pending requests and account preview. Done, Cancel activation, and the applicable recovery controls remain accessible.
- Ordinary Terminal authentication and live Terminal agents remain independent. This release sends no model turns as part of activation or verification.

## Verification

| Check | Result |
| --- | --- |
| Full Node suite in the isolated release source | 965 passed, zero failed/skipped |
| Focused account activation/handoff suite | 27 passed |
| Swift account presentation/request recovery unit tests | 6 passed |
| Native Mac WKWebView account test through real HTTP | 1 passed |
| iPhone simulator account UI tests | 6 passed |
| Apple notarization, signature, stapling and Gatekeeper | Passed for Mac app and installer |
| Installed bundle and live copied runtime | All 3 changed runtime files match source hashes |
| Release inputs | All 16 scoped files and 3 separately classified build tools match the source manifest |
| Installed Mac readback | Native bridge online, selected account verified, activation complete |
| Saved conversations | All 4 full turn-history hashes, models, reasoning settings and directories unchanged |
| Assistant state | Conversation identity, messages, drafts and delivery receipts unchanged |
| Terminal preservation | All 7 observed Codex processes retain PID, parent, TTY, start time and executable; shell configuration unchanged |
| TestFlight | Build 103 VALID, assigned to ClawDad Internal, IN_BETA_TESTING; release notes read back |
| Physical iPhone | Pending: paired device unavailable |

The native Mac test proves a startup timeout clears automatically with zero manual retry requests. The simulator cases cover account preview/activation, lost acknowledgement and large text, waiting for Mac, waiting for app work, explicit recovery, and unavailable identity. Final fixture screenshots are in `ios-ui-final/`. Simulator proof does not establish physical-device behavior.

The first complete test attempt caught two release-metadata expectations that still named build 102; those were updated to 103. One unchanged approval fixture also hit its timing deadline during concurrent builds. The final complete suite passed after build contention ended. The history comparison explicitly requests `itemsView: full`, matching the pre-install snapshots.

Raw production snapshots remain under the private app-support verification directory with restricted permissions. This report contains only sanitized results. Detailed test and package logs remain local ignored `.log` files. `VERIFICATION.json` records their hashes and test totals.

## Release and rollback

- Source base: `35e6e68f0745784413520317d3af6daa49ad8a93`, branch `codex/hermes-hybrid-supervisor-ui`. The candidate was archived from that commit with only the account-recovery paths in `source-manifest.json` overlaid. Uncommitted Assistant turn-control changes were excluded.
- Installed Mac: `/Applications/ClawDad.app`, version 0.7.0, build 163.
- Mac artifacts: `native/macos/dist/releases/0.7.0-beta.20-macos-163-account-recovery/`. DMG SHA-256: `aa49902ec544a45c915ee2256fa8e1099dafcef3f058c8af724e464fd446200f`.
- Exact prior installed Mac: `native/macos/dist/releases/0.7.0-beta.20-macos-162-account-activation/installed-before-163.app`. Every file and symlink matched the retired installation before its temporary duplicate in `/Applications` was removed.
- iPhone archive: `apps/ios/ClawDadMobile/build/releases/0.7.0-103-account-recovery/ClawDadMobile.xcarchive`.
- Apple build ID: `28fa1a64-ead5-4da8-99a9-f81d3c51af1a`. The existing internal TestFlight group is the distribution destination. Public App Store review, external TestFlight review, npm, and Sparkle were outside this deployment.

## Remaining acceptance

Install build 103 from TestFlight on the physical iPhone, connect it to this Mac, preview an account without activating it, and verify that the reported active account stays unchanged. Then exercise an authorized account activation, reconnect, and confirm the active identity and original receipt. The automated coverage already exercises startup recovery, pending work, cancellation, lost acknowledgement, and explicit recovery; those results do not replace this phone check.

## Workspace handoff

All fifteen inherited tracked changes remain byte-identical to `baseline.json`. The twenty-seven inherited dirty entries are retained for their existing lanes and listed with next actions in `WORKTREE-HANDOFF.md`. Scoped account-recovery changes and sanitized evidence are the only paths included in this checkpoint. `git diff --check` passes; ORP hygiene reports zero unclassified paths and safe expansion.
