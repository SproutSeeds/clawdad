# Account selector and stalled-switch repair — September 16, 2026

## Confirmed incident

Cody's iPhone tap reached the installed Mac 0.7.0 (147). Request `cc500393-9bcb-4912-aeb0-bb81b1f35339` was durably accepted at **16:46:13.292 UTC / 11:46:13 CDT**, targeting the saved `codyshanemitchell@gmail.com` profile. At audit start it was `waiting`, `phase=preflight`, with no authentication or session-transition effects. It was not a lost tap and no account transition had occurred. Internal TestFlight's latest build was 95; the exact physically installed phone build was not independently read in this turn.

The drain ledger held **12 synthetic legacy.dispatch receipts**, all written **09:34:00–09:34:09 UTC** in an earlier test run. Their exact project paths match the checked-in disposable `test/server-project-catalog.test.mjs` cases (dispatch binding, attachments, artifacts, linear/direct/queue behaviors). Their temporary projects have been deleted. The test cases use mock dispatch scripts; these are not Cody's project tasks. `CodexAccountLegacyWork.snapshot` correctly treated missing post-dispatch receipts as uncertain, but these fixture receipts should never have reached canonical application storage.

The server initialized the account controller and Assistant runtime at their global desktop paths even when launched with a separate `CLAWDAD_HOME`. This allowed earlier server test receipts into `~/Library/Application Support/ClawDad/Accounts/ProjectWork`. The installed controller therefore waited indefinitely for abandoned test evidence. Current non-native dispatch already has an account-handoff gate; this repair also isolates the account and Assistant storage themselves, including legacy child-worker routing, instead of depending solely on that gate.

The iPhone screen compounded the problem: every saved account repeated its controls, while the activity indicator, errors and actual switch reason were in a later section below those entries. A transport acknowledgment stopped the short spinner even though the account transition was still waiting. Existing UI tests covered entry/sign-in and an unsupported-switch gate, not a supported waiting switch or a lost acknowledgment.

## Scoped implementation

- iPhone and desktop show one native account dropdown and one selected account's controls. Selecting an entry alone has no authentication or switching effect. The account choice persists; polling does not reset it.
- Switch request feedback appears immediately at the status area. The selected destination and waiting, cancellation, failure and completion information are visible. Another switch is disabled while an operation remains held, with cancellation/recovery still available.
- Durable pending requests retain their original IDs. Status polling reconciles accepted operations/sign-ins after a missing response. A read-only receipt lookup also resolves a second client's same-target request alias without replaying the switch.
- Preflight diagnostics distinguish unresolved receipt count, running accepted work, incomplete inventory and protected sessions. No queue, draft or owner check is bypassed.
- Separate CLI/server homes receive separate account and Assistant storage. The normal native app retains its canonical profiles, Keychain bindings, history and account journal. Native production routing remains unchanged.
- A bounded local reconciliation script verifies the exact 12 fixture IDs, paths, hashes, timestamps and checked-in test provenance; it retains original receipts and the pre-repair journal before marking only those abandoned test receipts retired. This is not a general rule to discard missing or temporary-directory project work.

## Evidence and verification

Canonical ignored artifacts: `native/macos/dist/candidates/account-switch-feedback-2026-09-16/`.

- Initial inventory: `fixture-receipt-inventory.json`; one-off guarded reconciliation: `reconcile-fixture-receipts.mjs` (dry run verified all 12). No global switch is used as a synthetic test.
- Focused runtime suite: 235/235 passed (`runtime-tests-2.tap`), including HTTP server-home isolation, account/draft/owner/receipt regressions and legacy project routes.
- Actual desktop WKWebView + Assistant HTTP fixture passed supported waiting, a lost response after durable acceptance, double taps, status reconciliation and eventual completion without duplicate requests (`desktop-4.log`). Synthetic adapters never started a model or touched real tabs.
- iPhone simulator layout/interaction checks and final full-suite/release results are recorded below when complete. Physical phone touch, VoiceOver and an eventual all-session real account transition remain separate acceptance checks.

## Second confirmed blocker: cold Terminal catalog

After retiring the fixture receipts, the real request reached the native inventory check and still waited. Build 148 combined incomplete catalog, missing process census and stale evidence into one misleading update-worker message. Added structured diagnostics in build 149 established the actual predicate: **15 unvisited native tab cards had no TTY binding**, while the independent process census was complete and only **14 ms old**. The scan took **5.871 seconds**; a timeout was not the cause of this observation. Evidence: `installed149-first.json`.

`MacNativeTerminalTabs.snapshotCandidate` deliberately learns a physical AX-tab/TTY association only from observed selection. This protects exact input targeting. Restarting ClawDad clears those transient associations. `MacAssistantBridge` incorrectly required every read-only process-inventory row to already have that association, so it rejected a healthy window before the authorized recovery/capture phase could run. The earlier single-tab handoff tests had already visited their target and missed this cold-window case.

Build 150 fixes the distinction:

- `MacTerminalAutomation.readShellTabs` / `MacTerminalTabController.assistantAccountShells` enumerate exact scripting TTYs without changing selection. Duplicate TTYs fail explicitly. Independent process ancestry/open-history inspection still accounts for owners; labels and activity-title candidates establish no ownership.
- The account inventory identifies each actual foreground Codex process/session even when its physical card has not been visited. Unknown physical tab/window IDs remain unknown until verified.
- During an accepted, idle account capture only, `assistantResolveAccountTTY` visits native controls to establish the missing physical mapping. It rechecks the original process and manual-input gate before and after focus; same-named tabs cannot substitute for the requested TTY. It never types or submits while discovering a binding. Existing recovery records with uncertain physical-window ownership continue to fail safely.
- Account inspection gets priority over unrelated automatic workspace/history sweeps, coalesces callers onto one nonce, and has a bounded 90-second deadline. Census freshness remains five seconds. This is resilience hardening, separate from the confirmed missing-binding defect.
- Failure diagnostics now distinguish timeout, catalog permissions, individual TTY/process failures, changed census and stale evidence. They contain identifiers/state, not conversation text or credentials.

Additional verification:

- `full-runtime-final.log`: **908/908 runtime checks passed** after the diagnostic/priority changes.
- `cold-owner-regressions.log`: **5/5 passed**, including an exact process with no invented physical card identity.
- `cold-inventory-tests.log`: **79 native checks, 6 explicit live checks skipped, zero failures**. Covers cold same-title tabs, no-focus inventory, exact native selection, duplicate TTY rejection, changed-owner/manual-control stop, existing tab controls and window-geometry preservation.
- `live-inventory.log`: two explicitly enabled **read-only live checks passed**. Fourteen actual foreground Codex processes were inspected without input. RoomWave's process `87201` on `/dev/ttys003` had no open rollout and no verifiable resumable session; this is a separate protected state, not proof its prior project history is missing. No dummy prompt was submitted to manufacture an ID.
- `phones-final.xcresult`: **four UI tests on each of two simulators (8 runs), all passed**: iPhone SE (375-point width) and iPhone 15 Pro Max, iOS 26.5. Includes large accessibility text, 44-point controls, selected-account persistence, visible progress, lost acknowledgment reconciliation, cancellation and navigation. Exported screenshots were visually inspected.
- `desktop-4.log` and `mac-inventory-regressions.log`: actual WKWebView/HTTP fixture passed again; no real account transition or model request was used as a UI test.

## Live reconciliation and release

At **17:14:24.111 UTC**, the one-off script preserved the exact 12 original fixture receipts and pre-repair journal under `~/Library/Application Support/ClawDad/Accounts/Recovery/test-receipts-2026-09-16`, then retired only those verified abandoned test records. The durable drain subsequently reported complete, ready, pending=[]; unrelated historical uncertain receipts remained retained.

Mac 148 and 149 were intermediate installed checkpoints. The final Mac 150 includes the cold-catalog repair. Each update replaced only ClawDad, retaining the real user-requested operation ID, Terminal/Codex processes, and all 12 saved snapshots. Final installed-state evidence follows below.

iPhone **0.7.0 (96)** uploaded successfully and became **VALID / IN_BETA_TESTING** in the existing **ClawDad Internal** group at **17:30:13.929 UTC** (`testflight96-release.json`). The archive's ClawDad binary and dSYM UUID match (`C9C0FE52-2C4E-313F-AED5-D46F4C7015E4`). Apple reported the pre-existing third-party WebRTC dSYM omission; upload still succeeded. The physical phone's installation and real touch/VoiceOver behavior have not been verified in this turn.

No real account-switch success is inferred from these tests. An actual all-session transition must still satisfy live busy-state, resumable-session, draft, queue and ownership checks. The original operation is reconciled read-only below; no second switch request was issued.

### Final installed observation

At **17:40:45.896 UTC**, installed **Mac 0.7.0 (150)** returned a **complete** inventory of **14 exact Terminal Codex owners plus one shared app-server owner**, immediately after a ClawDad restart without visiting the project tabs. The stale-fixture drain remained ready. `installed150-first.json` records this through the real Assistant HTTP/account-controller/native-worker path, with the same original request ID. The before/after Terminal/Codex owner list and saved-snapshot digest match exactly (`pre150-preservation.json`). Bundled controller, runtime, storage isolation and web UI sources match the checked-in candidate files. Both signed app and DMG passed notarization and Gatekeeper.

The requested global switch is honestly **waiting**, `phase=preflight`, effects={}; no new account adoption or Codex restart was performed. Current blockers include this working ClawDad turn and RoomWave (`/dev/ttys003`, process 87201), for which no open rollout/resumable identity is available. A bounded read-only Terminal screen inspection found a usage-limit warning and idle composer, no trust/sign-in screen; the warning alone does not establish which account is cached or prove all historical RoomWave conversations are missing. A per-window script read initially hit Terminal's known stale scripting alias and failed without changes; bulk scripting read with before/after TTY validation succeeded. Only marker booleans, not screen/private text, were retained in `roomwave-readonly-markers.json`.

RoomWave is preserved for deliberate recovery/identity review. The account screen provides **Review affected sessions** and **Cancel switch**; cancellation releases held new work while retaining existing sessions. Do not manufacture a thread ID with an unsolicited prompt, infer a same-directory history, or restart this unresolved session as a test.

Remaining hands-on checks: update the physical iPhone to build 96; exercise the selector, touch feedback and VoiceOver; verify the eventual complete account transition after legitimate session blockers are resolved. No full-workspace account-transition success is claimed. The new cold-focus capture path has deterministic native regression coverage; its actual multi-tab account handoff still needs a controlled live acceptance check once work is safely eligible. The prior isolated same-thread account handoffs remain earlier evidence, not proof of this entire current workspace.

Final recheck: an intervening Terminal `layout_unavailable` observation failed safely and exposed its specific reason (`final-check.json`). The normal controller recovered without another user request: **17:45:26.546 UTC**, complete inventory, all 15 consumers, no inventory errors, RoomWave unknown/resume-protected and ClawDad working (`final-recheck.json`). Authentication effects remained empty. Scoped implementation committed as `b31588d`; final hygiene retained only the nine inherited buckets, zero unclassified paths, safe to expand. Temporary retired application copies were removed only after verifying matching canonical rollback binaries/archives.

## Preservation and release checkpoint

All three saved subscription sign-ins were already verified before this task. No login was repeated. The real user-requested switch is preserved under its original ID; this repair does not issue a new switch request. Busy turns, drafts, native queues and uncertain real receipts continue to gate transitions.

Nine inherited dirty buckets remain preserved: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`. New edits are limited to account UI/controller/storage isolation, associated tests, iPhone build/catalog metadata and this report. Native release only; no public source, npm, public GitHub release, infrastructure or appcast publication.
