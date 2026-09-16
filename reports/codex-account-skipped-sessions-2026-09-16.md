# Deliberately skipped Terminal sessions during account switching

## Incident and authorization

Cody requested the repair and native production release after the pending switch to `codyshanemitchell@gmail.com` was blocked by RoomWave. Request `edb6f08b-2769-4b89-9008-89eb7eb68589` was accepted at **2026-09-16 18:40:44.721 UTC**. Its preflight observation was complete, with no authentication/transition effects. RoomWave was a real Codex process (`87201`, `/dev/ttys003`) with no verified resumable conversation; this ClawDad Terminal agent was working. The earlier request was cancelled before transitions at 18:32:08.239 UTC.

These are separate conditions. A missing conversation ID does not prove no process or unsent work exists. The installed controller correctly refused to restart RoomWave but unnecessarily required it to qualify before any other eligible session could switch. Ordinary shell-only tabs are already excluded by the Codex process inventory.

## Repair

- A pending switch supports **Leave this tab unchanged** in iPhone and desktop account controls. Its exact process is excluded only after an explicit action; opening Settings or installing the release adds no exclusions.
- The exclusion binds the process lifetime, PID, TTY, executable and authorization home. Display title, project name and mutable catalog ID are not routing authority. Rebuilding catalog IDs or establishing first history does not expand authority to a replacement process.
- The exclusion and its stable request receipt are private, durable account-switch state. Lost responses, repeated taps and service restarts reconcile the same request. Exclusions apply to this switch, rather than becoming a permanent project-wide exemption.
- The runner and exclusion action share the same durable lease. Exclusion is allowed only before authentication/transition effects begin, so it cannot race a prepared capture or process restart. A stale process selection is rejected with recovery guidance.
- Excluded owners receive no native capture, status keystroke, stop, launch or draft-restoration request. The native mailbox independently rejects actions for an excluded TTY. The tab, its work and its account remain outside this transition.
- Remaining owners still require complete inventory, idle state, empty accepted queues, exact recoverable drafts, model/configuration compatibility and verified account adoption. Accepted-work receipts still drain; exclusion does not discard uncertain deliveries or authorize interruption.
- Final inventory reconciliation includes excluded live processes and detects replacements or additional owners. A verified exited excluded process stays recorded as exited; the switch does not launch a substitute. An incomplete census retains the exclusion as awaiting verification, blocks transitions, and does not claim that a replacement was observed.
- Session progress distinguishes **Waiting**, **Verifying**, **Switched** and **Skipped**. Completion with exclusions says so explicitly. Skipped accounts are unverified by this switch, so the UI never claims every tab adopted the selected account.
- `skip_codex_account_session` exposes the same authorized service path to the main Assistant. Its guidance requires Cody's current instruction, an exact identity from `codex_accounts`, and a stable request ID. The Assistant should finish its response after accepting the request so its own work can drain.

The existing selected-runtime route still changes only after eligible owner adoption and fresh destination usage verification. Retained account preparation changes the target profile, not the skipped process's credentials. Named workspace snapshots, project files, research permissions/budgets and Terminal drafts are not edited by exclusion.

## Verification

Canonical ignored artifacts: `native/macos/dist/candidates/account-switch-skip-2026-09-16/`.

- `full-runtime.log`: **915/915 runtime checks passed**. Final scope validation and actionable replacement guidance were then checked with **51/51** focused controller/adapter/runtime tests (`scope-final.log`). The additional live-race repair passed **52/52** focused checks; final full-suite results are recorded below.
- The RoomWave reproduction adds an unresolved first-turn owner beside a recoverable agent. Before exclusion no native action occurs. After exclusion, the included exact conversation completes its stop/resume/draft recovery with its original Unicode draft and accepted history. Every native mailbox request addresses the included TTY; the excluded process receives zero actions.
- Actual Assistant MCP → Assistant HTTP → account-controller tests verify explicit user authorization, reject agent-output authority, deduplicate requests and reconcile saved receipts without starting a model.
- Final-inventory tests reject replacement processes, unexpected new owners, wrong resumed conversations and incomplete census. Restart, changed catalog IDs, new first history, expired/stale selection, no authorization, already-started transitions and outstanding accepted-work protections are covered.
- Actual macOS WKWebView → HTTP tests pass account dropdown, lost switch response, duplicate clicks, exclusion, waiting work and eventual completion with a skipped tab. Screenshots at 390- and 980-point widths were inspected; Done remains accessible and controls meet the 44-point minimum.
- iPhone **6 UI tests on each of two simulators, 12 runs, all passed** (`phones.xcresult`): iPhone SE third generation and iPhone 15 Pro Max, iOS 26.5. Includes 44-point tap targets, large accessibility text, named exclusion, status updates, navigation, retained dropdown selection and lost switch acknowledgment. Normal/large-text screenshots were visually inspected. Simulator checks do not prove physical iPhone touch or VoiceOver behavior.

## Scope and preservation

The implementation lane contains the account controller/scope/adapter, Assistant tool guidance, desktop/iPhone account views and focused regressions. Existing dirty buckets remain preserved: release skill files in `.agents` and the integration plugin, plugin metadata, native build/package/storage scripts, `assets/wordmark-explorations/`, `cloud/native/`, and `marketing-site/`. No public npm/CLI release, authentication ceremony, research submission or Terminal window closure is part of this repair.

The already accepted real switch remains under its existing request identity. Cody's authorized RoomWave exclusion was applied through the supported controller after rechecking the current owner. Busy real agents remain protected. The current ClawDad development turn itself must finish before it can become eligible; a completed build is not proof of a completed whole-workspace account transition.

## Release and live checkpoint

### Additional live timing defect caught before final handoff

Mac 151 was installed as an intermediate checkpoint. The native inventory verified the same RoomWave process lifetime before accepting exclusion `leave-roomwave-edb6f08b-20260916` at **19:04:46.697 UTC**. Its initial response briefly showed the previous observation, despite the durable exclusion being present. Subsequent read-only receipt reconciliation confirmed the accepted exclusion and RoomWave's **Skipped** state.

The account delivery-lock primitive keys claims by **both** thread ID and request ID. The first exclusion implementation reused the runner thread ID but supplied a different request ID. That allowed an in-flight preflight observation to overwrite the fresh display projection. The excluded process was preserved and no authentication/restart effect occurred, but the overlap also weakened capture serialization. The final controller uses the runner's exact lock pair.

`installed151-race-reproduction.log` reproduces this defect using the installed 151 module with isolated temporary journals: two inventory reads overlap where only one should run. `live-race-regressions.log` verifies the corrected cross-controller interleaving, along with the existing 51 cases. The fixture uses no live credentials, model call or Terminal input. Final Mac build **152** includes the repair; build 151 is an intermediate checkpoint.

iPhone **0.7.0 (97)** became **VALID / IN_BETA_TESTING** in **ClawDad Internal** at **19:08:03.994 UTC**, build ID `92cc0599-940d-433b-b7ca-46d15284d678`. Its binary and dSYM match UUID `D9BE93D6-D009-311A-B691-862EC214487B`. Apple's pre-existing third-party WebRTC dSYM warning did not prevent upload. Release notes specify Mac 152 or later. Physical installation is not yet verified.

### Live inventory changes during final verification

Mac **152** was signed, notarized and installed; all eight changed runtime/web modules matched the source. The installed-module cross-controller race regression passed (`installed152-race-verification.log`), and the full suite at that checkpoint passed **916/916** (`full-runtime-release.log`). Both app and DMG notarization were accepted. The existing skip receipt remained accepted across the update.

Between the preinstall snapshot and 19:16 UTC, the live process lineup changed: RoomWave PID 87201 was absent, as were several other prior owners, and a new YouTube agent appeared. The independent Terminal inventory no longer contained `/dev/ttys003`; its earlier screen hash therefore could not be compared after installation. This was not an account-controller transition: the operation still had `effects: {}`, and no native-account request journal existed. The cause of those separate exits was not established by this audit. No claim that every original process remained alive is made. All **12 named snapshots** retained the exact same digest.

The changing census temporarily exposed misleading scope guidance: an absent excluded owner plus an incomplete inventory was called a changed process. The final scope now records **verification_pending**, retains the original exclusion, deduplicates adapter/controller guidance, and continues to block all transitions. Only a complete census can establish exit; an actual new occupant or conflicting owner still requires review. Three additional regressions cover pending-to-exited recovery, zero transition calls before a complete census, and ambiguous multiple owners on an excluded TTY.

By the next complete live observation, the original operation had reconciled RoomWave as **Skipped / exited**, with no replacement launched. Other busy owners remained waiting. Mac **153** contains this final diagnostic refinement in addition to the 152 serialization repair; iPhone 97 supports both. The signed final installation and current status are recorded below. No completed real whole-workspace account transition is claimed while working agents remain.

### Final installed/released checkpoint

- **Mac 0.7.0 (153)** installed at `/Applications/ClawDad.app`, signed and notarized. App notarization `840ee9ff-41c5-4bb3-8cbe-cc8961286f74`; DMG notarization `8e60f2b2-b2d3-4438-9c54-afe0f494c90c`; both Accepted. Runtime health returned HTTP 200 / `ok: true`. All eight changed installed runtime/web modules match source. Final release artifacts are in `native/macos/dist/releases/0.7.0-beta.20-macos-153-account-skip/`.
- **iPhone 0.7.0 (97)** remained VALID / IN_BETA_TESTING and assigned to **ClawDad Internal**, independently rechecked at **19:25:04.872 UTC**. The iPhone can update through TestFlight; installation on Cody's phone remains unverified.
- **919/919 final runtime tests passed**, zero failures (`full-runtime-final153.log`). Four additional installed-module regressions passed against `/Applications/ClawDad.app`, including the exact cross-controller race and incomplete/exited census recovery (`installed153-verification.log`). The previously completed native desktop UI test and **12/12 iPhone simulator runs** remain applicable; final 153 changes affect scope/state diagnostics, not UI layout.
- At **19:24:24.214 UTC**, the original request and accepted RoomWave exclusion were intact (`final153.json`). RoomWave was **Skipped / exited**. Resume Job Search, this ClawDad agent and Ran the Credit Man were reported busy. The switch was waiting in preflight with `effects: {}`. No real account transition or native-account request was dispatched. This is an honest pending state, not a claim that every live agent now uses the selected account.
- All **12 saved named-workspace snapshots** kept the same canonical digest as before installation. Stable build 150's rollback ZIP passed archive integrity verification; versioned signed release archives remain available. Only task-created temporary backup apps were removed from `/Applications` after installed-build verification.

Remaining checks: update the physical iPhone to 97 and verify touch/VoiceOver presentation; observe the existing real switch after busy agents finish, including final per-session account adoption. No second switch request is necessary. If Cody deliberately wants a working tab to remain on its current account, the new **Leave this tab unchanged** action can exclude that exact process before transitions begin. The feature does not automatically skip or stop other working agents.

Handoff scope: implementation/tests/release metadata and this report are checkpointed together. The nine inherited dirty path groups listed above remain classified and preserved for their original lanes. No npm publication, public Git release/appcast publication, real Terminal closure, account login or research submission was performed by this repair.
