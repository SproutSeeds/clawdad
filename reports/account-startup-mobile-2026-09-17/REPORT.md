# Mac 163 and iPhone 103 account activation recovery

Mac 0.7.0 (163) is installed and running. iPhone 0.7.0 (103) is processed by Apple and available to the existing ClawDad Internal TestFlight group. The account selected before installation is still verified by the running app server from the same isolated profile home. On September 18, build 103 was installed through TestFlight on the physical iPhone 15 Pro Max, and account preview, activation in both directions, and reconnection passed. Cody confirmed the separate Terminal closure, resolving the remaining process-lifetime question.

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
| Terminal preservation during Mac installation | All 7 observed Codex processes retain PID, parent, TTY, start time and executable; shell configuration unchanged |
| TestFlight | Build 103 VALID, assigned to ClawDad Internal, IN_BETA_TESTING; release notes read back |
| Physical iPhone | Build 103 installed; account preview, activation round trip, restored identity and reconnection passed |

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

## Physical acceptance on September 18

The iPhone was reached over USB, updated from build 102 to 103 through TestFlight, and operated through iPhone Mirroring. Existing access was restored after Cody completed sign-in. Previewing another saved account changed its allowance display while the Mac's selected runtime and activation receipt stayed unchanged.

Two phone-originated activations completed: the alternate account, then the original account. Each retained one original operation receipt, and the app-server protocol verified the selected identity and authorization home. The account epoch advanced from 1 to 3. The phone showed Activating, an unavailable active identity during the server transition, and the verified active account after completion.

The phone's Disconnect and Connect controls were exercised. After reconnection it showed the original active account and a fresh allowance, with no repeated activation. Done returned to the workspace. Mirroring's automated scrolling did not move the Settings view, so Cody scrolled to the connection controls; this was an automation limitation, not a claimed failure of physical touch scrolling.

All four saved full-history hashes, models, reasoning settings and directories matched the pre-check snapshot. Assistant conversation identity, messages, drafts, delivery receipts, and shell configuration were unchanged. Five of the seven initial Terminal process identities also matched. The two other processes in `ttys003` exited at 00:09:11 CDT, after both switch handoffs had verified. Asked whether he had closed a Terminal tab or window around that time, Cody confirmed, "Yes, I closed one." Their exit attribution is therefore resolved by user confirmation; the OS logs establish the exit time. Switch receipts targeted only app-server PIDs 84171 and 28009. The installed process-control module matches the reviewed source and signals only the exact verified positive PID with SIGINT.

Mac Wi-Fi was enabled with Cody's permission for Mirroring, then restored to off. Ethernet remained connected. The Mac's original account and profile were restored. Physical checks sent no model turns. Raw device metadata, production state, and OS logs remain private; sanitized results are in `physical-iphone-verification.json`.

## Workspace handoff

All fifteen inherited tracked changes remain byte-identical to `baseline.json`. The twenty-seven inherited dirty entries are retained for their existing lanes and listed with next actions in `WORKTREE-HANDOFF.md`. Scoped account-recovery changes and sanitized evidence are the only paths included in this checkpoint. `git diff --check` passes; ORP hygiene reports zero unclassified paths and safe expansion.
