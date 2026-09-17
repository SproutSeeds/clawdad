# App-only subscription accounts · implementation checkpoint

## Scope and cause

The retired account controller held a global launch fence while recreating a Terminal window. Its uncertain native window-discovery/restore receipt could therefore block an ordinary `codex` launch. Terminal control was coupled to a subscription operation that should have belonged to ClawDad's app-owned runtime. The original failed operation and nine-tab private recovery remain unchanged; this release does not retry them.

`lib/codex-app-accounts.mjs` now owns a separate `Accounts/app-accounts.json` journal. Migration archives the exact legacy journal bytes under `Accounts/Retired/`, imports the account list and only genuinely completed prior selections, and keeps old uncertain deliveries for review without replay. `lib/codex-app-account-runtime.mjs` exposes only supported app-server/OS operations. The Swift bridge supplies read-only process observations. It has no account-switch Terminal worker.

Terminal launch wrapper installation is retired; the compatibility launcher forwards original arguments to the stock CLI without consulting account state. Production packaging excludes the historical Terminal/window/shell switch modules. Swift historical mutators are debug-only. Normal native Terminal tools and manual workspace Save/Restore remain separate.

## Behavior and UI

- One active ClawDad account per connected Mac, reflected on iPhone, desktop and Remote Assist. One email dropdown previews saved allowance; Activate separately changes the app runtime. Last refresh, timezone reset, workspace when exposed, and stale/unavailable explanations stay in the information panel.
- The translucent, rounded account card has a solid Reduce Transparency fallback, accessible names, 44–48 point controls, dynamic text wrapping, scrolling and visible Done/Back navigation.
- Saved subscription authentication remains in Keychain. Preview refresh uses a bounded account-only process; it cannot start model turns or select an active route. The verified selected home is used for app-server projects, the main Assistant and supervisor reviews. Terminal keeps its independent authentication.
- Accepted work drains with its original account. Subsequent app requests may be durably held during activation; their original IDs/text/images survive release. Terminal actions bypass this gate. Activation never starts a supervisor or continuation. Explicit project budget permissions stay associated with their original account; there is no implicit global 20% reserve.
- Exact loaded conversation history/settings/drafts are captured and verified around the shared-server handoff. A runtime change is published only after the destination subscription and authorization home match. Uncertain process/RPC receipts reconcile by observation instead of re-dispatch. Cancel is available before the server transition; later recovery uses the same operation.

## Additional defects caught by actual transport testing

1. A cold launch recorded `/opt/homebrew/bin/codex` while the native census observed its resolved installed executable. Initial activation now resolves that path before dispatch, retaining exact process ownership checks.
2. Canonical configuration files can be atomically replaced during normal use. A saved inode unnecessarily invalidated a correct canonical symlink. Verification now permits file-inode renewal at the identical owned canonical path; changed directories, resource sets, symlink targets and permissions remain guarded. Effective configuration is still compared before activation.
3. Codex can unload an unsubscribed idle thread between two read-only inventory observations. This now gets up to three observation retries, preserving the same durable operation. It never retries an uncertain side effect blindly.
4. iPhone request IDs were being replaced by the settings transport's default ID. The new controls pass their retained ID explicitly and reconcile lost acknowledgments on reopening.
5. An installed Codex 0.154.0 thread before its first message is not materialized; `thread/turns/list` rejects it. This is an explicit `shared_thread_not_persisted` recovery state, preserving the draft and owner. ClawDad does not submit a dummy message or substitute a new conversation. The actual installed-runtime test received this protocol error. Separately, the [official app-server documentation](https://learn.chatgpt.com/docs/app-server) describes unsubscribe followed by an inactivity grace period; documentation and installed timing are distinguished here.

## Evidence

- Node full suite: 946 checks, 945 passed on the broad run; the unrelated cross-process registry stress test lost one fixture update under parallel build load. Its isolated rerun passed all 13 checks. No registry product code was changed. Subsequent focused account/layout/supervisor/native-transport checks: 83/83, followed by 70/70 with the new controls/recovery cases. The final focused additions passed 77/77; the complete lower-concurrency run and installed evidence are recorded below.
- Native workspace regression: 40 checks, one opt-in skip, no failures. iOS weekly-usage/account package checks: 11/11.
- Actual WKWebView/HTTP UI test passed at 375, 430 and 980 point widths, including preview without activation, a dropped activation reply, one accepted operation and accessible dismissal. Final test: zero failures.
- iPhone SE (3rd generation) and large iPhone simulators: two UI tests per device passed, including Accessibility Extra Large text, preview/activation and lost-acknowledgment recovery. Screenshots were visually reviewed. Candidate evidence is in `native/macos/dist/candidates/app-accounts-2026-09-17/`.
- Real account fixture uses the actual Assistant HTTP endpoint, Swift process census, new app controller and production shared-server adapter on a separate socket. It reuses a previously created synthetic conversation, with exact draft/history/settings fingerprints and no new model turns or login actions. Its private evidence is under `~/Library/Application Support/ClawDad/Accounts/verification-2026-09-17/`. Failed setup observations were preserved; no real Terminal input or research task was used.
- Initial fixture runs exposed cold-launch alias and empty-thread handling. An old synthetic rollout lived outside the canonical history index; both exact synthetic QA rollouts were copied into canonical history with exclusive writes for the retained-history test. Real project files were not changed. The final saved-account round trip passed at 11:06:39 UTC with exact synthetic thread `01a0a848-cb86-7033-ae6f-ce006f5b51bb` and unchanged thread/history/settings/draft fingerprint. Cold activation took 5.665 seconds; recovery into the second account took 7.863 seconds; return activation took 93.194 seconds including idle-thread unloading. These are measured app-server timings, not an instant-switch promise. The exact original request was recovered after an inventory race; no second operation or model turn was created. The final fixture server was stopped only after verified idle ownership, and the native census exited 0.

## Workspace classification

This lane owns the new app account controller/adapters, account routing/admission and research review receipts, native worker retirement, shared handoff reconciliation, glass web/iOS picker, version 102 release metadata, focused tests/fixtures and this report/release note. `native/macos/build-app.sh` additionally contains this lane's production exclusion list; its pre-existing storage-workflow edits remain a separate bucket.

Inherited and preserved: `.agents/skills/clawdad-release/SKILL.md`, the mirrored plugin release skill, plugin manifest version, prior build/package storage integration and `native/macos/storage-workflow.sh`, `assets/wordmark-explorations/`, `cloud/native/`, and `marketing-site/`. No npm publication, infrastructure provisioning, actual account login, Terminal recreation, or live research mutation belongs to this release.

## Remaining acceptance checks

Physical iPhone: update from TestFlight, preview another account without activation, activate while connected to the intended Mac, confirm desktop selection/allowance, and make an intended real request. Check VoiceOver, menu readability, and reconnect/cold-launch behavior on the phone. Simulator/UI mocks are not proof of an audible call or physical-device interaction. Mac sleep/reboot and identity-provider reauthentication were not tested by disrupting this machine.

## Release checkpoint

iPhone 0.7.0 (102) uploaded and validated; assigned to the existing ClawDad Internal group, `IN_BETA_TESTING`, at 2026-09-17 11:02:47 UTC. Mac **0.7.0 (161)** is signed, notarized, stapled and installed. Both app and DMG passed Gatekeeper. Notary app `ccca670f-3d3d-42c2-b053-22a460722c34` and DMG `29136022-dbdb-41fa-b088-41afe1045794` are Accepted. Installation and installed HTTP verification confirmed unchanged Terminal windows/TTYs/agent PIDs, original switch/private-window recovery bytes and `.zshrc`; four saved accounts; `scope=clawdad-app`; `appOnly=true`; `windowRebuild=false`; ten retired runtime modules absent. The selected production account was not changed to demonstrate the feature. Artifact: `native/macos/dist/releases/0.7.0-beta.20-macos-161-app-accounts/`.

Final full lower-concurrency suite: **950/950 passed**, zero failures. Final account admission/recovery checks: **9/9**; routing/shared/account consumer checks: **20/20**. The installed runtime import graph resolves 63 modules with no missing relative dependencies. A held Assistant message remains queued during activation; retired uncertain work alone moves to attention, preventing both premature failure and replay. The app and test artifacts are private native releases; public Sparkle, GitHub release assets and npm are unchanged.
