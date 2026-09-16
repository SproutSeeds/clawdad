# Codex subscription switching: runtime integration, September 16, 2026

## Scope and current account state

This continues the authorized account-switching implementation. The third requested entry, `doughalchemy@gmail.com`, is saved alongside `codyshanemitchell@gmail.com` and `playinthesunwithme@gmail.com`. A metadata-only recheck at approximately 09:39 UTC found the first two independently verified and Dough Alchemy still `needs_sign_in`. The Dough browser ceremony expired; its separate verification found no retained authorization. A fresh sign-in waits for Cody's readiness. No current production account switch has been accepted and no working project agent has been stopped by this work.

Installed versions rechecked in this continuation: Mac 0.7.0 (145), Codex CLI 0.154.0. iPhone 94 is the prior release checkpoint, not a fresh physical-device observation. Release/install status is recorded below and must not be inferred from source or fixture results.

## Implemented integration

- The Mac service now constructs the deterministic switch controller, native request mailbox, profile/layout verifier, and shared app-server replacement adapter. Construction starts no switch, sign-in, capture, or process replacement. An explicit selection is required. An unverified new account is rejected before holding work.
- Accepted Assistant messages, tool requests, project sends/queues and supervisor reviews share durable account admission. New work is held; existing accepted work can finish on its original account during preflight. The older project flow now contributes exact request/history receipts, including queued work accepted before this ledger existed. It does not restart queues as an inventory side effect. Other providers retain their existing route.
- Native process discovery separates exact Terminal foreground owners, the configured shared socket, descendant helpers, other applications and unresolved processes. It retries a whole changing census boundedly, rather than treating a read failure as an empty inventory. Fresh agents without resumable IDs, independent history/configuration, separate authentication overrides, active queues and unrecoverable drafts remain blocked with reasons.
- The shared server adapter records each stop, launch, subscription release and resume separately. It verifies actual process lifetime, account, socket, executable, allowed launch options, exact conversation/history/settings and local draft/image hashes. An unsubscribe acknowledgment is not proof of unload. The old owner must be empty and observed exited before replacement. There is no force-kill escalation or replay of submitted work.
- Normal shared-server startup and account replacement use one cross-process gate. Replacement launches have durable intent before spawn and a unique child marker, so service recovery reconciles the original launch. Subsequent Main Assistant, supervisor, model-catalog, usage and in-app project launches use the verified selected profile. New manually launched Codex commands in unrelated shells retain that shell's login; installing a general shell launcher remains a separate pending choice.
- Separate authorization homes retain Keychain identity. Canonical history, writer locks, effective project configuration and permission settings are verified before adoption. Displaced profile resources are kept in recoverable private storage. Named Terminal snapshots are unchanged. Actual retained production profiles have not been adopted into canonical history by a test.
- Cancellation waits for a prepared native status/draft capture to finish restoring its input. After a possible owner replacement, the original transition remains held; an explicit **Continue original switch** resumes reconciliation using its original target and receipts. It never guesses a rollback or repeats a completed replacement.
- Desktop and iPhone account controls poll a held operation, expose recovery, and retain pending UI request IDs. The main Assistant gains `control_codex_account_switch` for check/cancel/continue. Mutating tool calls still require Cody's current instruction.

## Confirmed defects found during integration

1. Native `ps` columns included leading spaces in the executable string. The shared-process verifier correctly refused that malformed path. The census now normalizes column padding before deriving its lifetime hash. Regression coverage includes the real observed padded form.
2. The first production-controller fixture hit a provider 503 during a read-only allowance request, after subscription release and before any owner stop. The original process was preserved. Read-only allowance reads now have three bounded retries, plus at most five seconds of same-client/same-account identity reuse; a new owner invalidates the cache. Final completion still needs fresh destination allowance. Restarting the fixture controller reconciled the original operation.
3. The work drain previously counted old failed read-only inspections as unfinished work. It now excludes read-only receipts and distinguishes proven non-dispatch from inactive uncertain receipts. Original uncertain statuses/results are preserved, displayed as retained receipts and never replayed. Fresh, independent idle/composer/queue proof remains mandatory. Active work still blocks transition.
4. The existing project-send path had only an HTTP admission check, leaving a race before its detached worker or queue was created. Durable admission now precedes that effect. Pre-ledger queues are fingerprinted from immutable accepted request fields and retain their exact history identity through drain/restart. Missing, changed or ambiguous receipts keep recovery held.
5. Explicit null `serviceTier` changed an otherwise preserved value to `default` in the installed protocol. The adapter omits absent tier values, retains explicit ones, and verifies the returned settings.
6. Follow-up testing exposed a zero-byte account-journal lock owner written at 09:36:14.904 UTC. A short-lived reader acquired a write-style claim; process exit during initialization could leave malformed ownership that correctly failed closed. Account controllers now opt into atomically published, complete owner metadata. Pure selected-route reads acquire no claim, and public/non-native server startup retains its original path. The old empty claim was preserved under private `Accounts/Recovery`, after verifying its exact inode, zero bytes, no open file owner, no active switch and no installed account controller. Account/authorization metadata hashes were unchanged. Malformed published locks are never automatically discarded on age alone.
7. Destination preparation now checks authenticated, paginated model availability and supported reasoning effort before profile adoption or owner replacement. Unsupported combinations keep original agents intact and give an explicit recovery message. Both retained real accounts passed the gpt-6-astra/low catalog check at 09:47:58 UTC with zero model turns.

## Observed live evidence

The real native Terminal fixture `native-handoff-16` is documented in [the preceding checkpoint](codex-account-terminal-handoff-2026-09-16.md). It verified Cody → Sun → Cody in the same disposable window/TTY, exact forked thread, model/effort and a 2,179-byte Unicode unsent draft. No prompts, Enter/Tab submissions or sign-ins were generated. Its one exact QA window was cleaned up; production windows were preserved.

The production OS + shared-protocol fixture `shared-process-3` finished **09:19:50.143 UTC** after recovery from the recorded 503. It verified Cody → Sun → Cody for thread `01a0a848-de93-75e3-b69d-8158ebb54973`. Destination PIDs were 47660 and 57978, each verified through the actual Swift process census, independent process lifetime and supported server diagnostics. The state projection SHA-256 stayed `f064b3d8140412d6846d8e855f305307fd4d386b3ba955236662a14e0fc2fccc`. This covers history, captured settings and the app-owned unsent draft; it is not a claim of a new model response at exhausted allowance. **Zero model turns and zero login actions** occurred.

The recovered Sun step took 8,057 ms after its earlier unload had already completed; the return to Cody took 85,489 ms including normal release waits and observations. These are fixture timings, not an immediate-switch promise. The original failure remains in the evidence record. The final private server was unloaded and stopped through its exact identity, and its census bridge exited successfully.

Canonical private evidence: `~/Library/Application Support/ClawDad/Accounts/verification-2026-09-15/thread-continuity-1/shared-process-3/`. Public-safe candidate logs live under `native/macos/dist/candidates/codex-account-switch-2026-09-15/`. Earlier failed fixtures are retained: path-canonicalization guard, padded executable guard, temporary 503 and the earlier fixture-only subscription cleanup error. They were not overwritten with successful results.

## Capability and limitation matrix

| Surface | Implemented behavior | Recovery boundary |
|---|---|---|
| Saved accounts | Separate supported sign-in; multiple retained Keychain authorizations; deliberate selection | User completes account choice/consent/MFA; Dough sign-in remains pending |
| Established Terminal Codex | Same exact tab, shell, directory, UUID, model/effort, permissions and recoverable draft | Busy turns/queues drain; attachments, opaque/oversized drafts and changed identity defer transition |
| Shared in-app threads | Enumerated exact idle threads, history/settings/local drafts; verified empty old owner before replacement | Loaded/busy/queued or conflicting ownership blocks; no transport migration |
| Main Assistant / research reviews | Accepted work drains; subsequent launches use selected profile | Paused/stopped supervisors stay paused/stopped; account-scoped project budgets stay separate |
| Project Send and legacy queue | Atomic accepted-work admission, exact history identity and original-account drain | Unknown receipts block; accepted uncertain messages are never reconstructed or replayed |
| Shell-only tabs / other apps | Preserved | No account replacement of a shell or foreign application's runtime |
| Manual future CLI commands | Existing shell environment retained | Optional selected-account launcher is still a pending decision |
| Zero allowance | Controller, local recovery, supported login/account reads require no model turn | Provider/network availability and user authentication are still required; no model execution at zero is claimed |

## Verification and release checkpoint

- Full runtime suite: **883/883 passed** (`runtime-final-connected.tap`). This includes actual Assistant HTTP/MCP transport checks, admission races, restarted journals, shared startup, profile layout, drafts, queue/identity and three-account controller tests.
- Focused native suite: **26 total, 23 passed, 3 explicit live-fixture skips, zero failures** (`native-final-connected.log`). The desktop WKWebView account controls passed; live fixtures were run separately as described above.
- A follow-up direct Node invocation omitted the repository's isolated app-server test environment: 212/214 passed, with a shared-server expectation failure and a temporary fixture cleanup race. Preserve `account-server-final.tap`. The corrected invocation uses the repository's `CLAWDAD_CODEX_APP_SERVER_MODE=isolated` convention; its result is recorded at final handoff.
- Later scoped checks, current phone layout evidence, signing/install and final hygiene results are appended below.

### Final verification before packaging

- Full runtime after atomic lock/routing repair: **888/888 passed** (`runtime-release-final.tap`).
- Account/claim regressions: **152/152 passed** (`account-atomic-claims.tap`), including published-owner completeness, killed-owner recovery, preserved malformed metadata, cancellation with pending capture, and three-account transitions.
- Model availability plus authorization/controller tests after the final guard: **55/55 passed** (`selected-model-final.tap`). Actual retained account catalog checks are in `retained-model-capabilities.json`.
- The focused Terminal-open regression passed after isolating the native account route (`terminal-open-gate-fixed.tap`). The intermediate isolated run was **214/215**, still blocked by the malformed global claim; its cause is now established, rather than attributed solely to test environment. The earlier fixture cleanup race did not recur.
- iPhone UI: **4/4 passed**, normal and accessibility text on compact and 6.9-inch simulators (`accounts-connected-phones.xcresult`). Screenshots were exported and visually checked for readable wrapping, 44-point controls and reachable Back navigation. These fixtures exercise saved-account/connection controls, not a real phone authentication or whole-workspace switch.

Physical iPhone sign-in, account-selection navigation, VoiceOver, Keychain prompts/MFA and real whole-workspace transition remain distinct from automated fixtures. No reboot, power-loss test, global credential replacement or live project interruption has been performed. Cody's active work must not become a destructive test fixture.

## Workspace classification

This bounded lane contains account runtime/controller/native-discovery changes, its tests, account UI recovery controls and these reports. Nine inherited unrelated buckets remain untouched: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`. Use the inherited build workflow without staging its unrelated edits. The 09:34 UTC hygiene run reported `dirty_classified`, zero unclassified paths.
