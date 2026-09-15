# Codex account switching — implementation checkpoint

Status: scoped implementation and offline verification; production switching remains gated. The next live sign-in experiment is prepared in `codex-account-switch-live-plan-2026-09-15.md` and still requires the separate approval specified by the reviewed first-phase proposal. No real account was switched, no production service or working Terminal agent was restarted, and no native release was installed or published for this change.

Implementation commit: **`5359f51`**, 44 scoped files. Final hygiene: **dirty_classified**, nine preserved unrelated paths, zero unclassified; `git diff --check` passed. `checkpoint.json` and `scoped-paths.json` in the candidate evidence directory record the exact commit and audited path set.

## Resumed state

Work resumed after Cody reported changing subscription accounts. The branch remained `codex/hermes-hybrid-supervisor-ui`, based on `e84e6d4` (Mac 145 desktop Save setup release). The previously running desktop tests had passed. Existing account work and unrelated dirty paths were preserved; the large-text tests were continued rather than rebuilding the feature.

A fresh, account-only Codex read during resumption reported `codyshanemitchell@gmail.com`, subscription authentication, 90% weekly allowance remaining, reset timestamp `1789880832`, and `ordinaryUsageAllowed=true`. No usage blocker was observed. This proves the identity serving that fresh account-reader process; it does not establish the cached identity of every already-running process. No authentication was changed to obtain the reading.

Installed Mac app: **145**. Installed CLI: **Codex 0.154.0**. Latest reconciled iPhone release checkpoint: **94**; the physical phone's current installation was not inspected in this turn. Source and simulator builds below are unshipped. The original received prompt remains unchanged, SHA-256 `785bace8cb2ed9d327055c285bdf822566ca450d418a949a0dc6bca91aba98be`.

## Implemented behavior

| Area | Implemented and verified | Boundary |
|---|---|---|
| Account information | Email, subscription plan/method, real weekly reading/reset/refresh, unavailable/stale state, and separate shorter-window evidence in the existing allowance details | Workspace name remains unknown when Codex does not expose it. A user-entered workspace label is visibly unverified |
| Mac/iPhone account controls | Save an account entry, inspect affected consumers, retain a switch selection and request ID, show progress/recovery, retry, and leave/reopen the screen | An entry is a preference, not a saved authorization. The production capability gate returns `needs_setup`; it neither signs in nor holds current work |
| Deterministic controller | Internal-drive revisioned journal, private atomic writes, process leases, operation coalescing, side-effect receipts written before dispatch, reconciliation, account epoch, cancellation and partial progress | Transition adapters are synthetic in tests. Production has no credential-changing or process-transition adapter |
| Service lifetime | Service-owned driver advances/reconciles an accepted operation without UI polling, survives a reconstructed controller, and uses capped backoff for lock/storage errors | The production driver starts nothing while its capability gate is false. Stop ends scheduling while allowing an in-flight receipt to settle |
| Managed login adapter | Supported browser/device-code RPC lifecycle, exact callback matching, early callback handling, wrong-account rejection, account → quota → account verification, cancellation/disconnection recovery | Tested with RPC fixtures. The isolated live runner is prepared but has never started a sign-in |
| Admission integration | Assistant/native preparation, app-server dispatch, direct service dispatch, research review/continuation, and legacy Mac sign-in consult account-transition state | This is groundwork, not certification of every live race. Production enablement still requires a complete consumer inventory and a verified shared transition barrier |
| Accepted Assistant messages | Text/images accepted while fenced remain durable; duplicate request IDs remain one message; old-epoch pending requests require explicit reconciliation after a switch | No automatic reassignment to the new subscription or replay of uncertain deliveries |
| Research allowance policy | Automatic global 20% reserve removed from defaults, admission, UI, tools and instructions. Optional limits target one exact supervisor/account | Existing project limits and bounded grants are preserved. Fresh account/usage and provider-denial checks remain; no subscription/API purchases |
| Historical migration | Full old account defaults retained in the v2 ledger; former global latch retired; default-only budget-paused supervisors become manually paused | Migration does not start or resume any supervisor. Explicit project latches, authorization history and manual stop/pause remain |
| Assistant tools | `codex_accounts`, `preview_codex_account_switch`, `switch_codex_account`; current explicit user-instruction check for mutations; revised `set_research_budget` supports project `none`/`override` | `needs_setup` must never be described as a successful switch. Generic controls cannot bypass the gate |

The switch recovery journal is independent of named Terminal workspace snapshots. Its fixture recovery projection retains exact process/session/directory, model/effort, Unicode draft bytes and hashes, image references/hashes and pending receipts. It never serializes arbitrary process state, credentials, OAuth URLs, browser cookies or device codes.

Explicit project limits remain stopping points in the account's shared weekly allowance, not private allocations. Removing a limit never enables a stopped supervisor. Old bounded grants retain their original exact threads, expiry, account and shared review count. Legacy receipt retries reconcile their previous result without authorizing a new app-wide grant. The independent general 5%/0% notices are preserved.

## Evidence and implementation references

- `lib/codex-accounts.mjs`: production gate, private journal, service runner, stable operation IDs, receipts and epoch handling.
- `lib/codex-account-consumers.mjs`: read-only process/TTY/session projection; reports incomplete account and draft evidence rather than inventing an owner.
- `lib/codex-managed-login.mjs`: supported login/cancel/account RPCs with transient browser handoff.
- `lib/codex-weekly-usage.mjs`: authoritative subscription identity and weekly/short-window normalization.
- `lib/assistant-runtime.mjs`, `lib/assistant-app-server.mjs`, `lib/assistant-mcp.mjs`, `lib/server.mjs`, `lib/research-supervisor.mjs`: shared request paths and admission checks.
- `native/macos/Sources/ClawDad/MacCodexAccountAdmission.swift` and `MacSystemReadiness.swift`: legacy native sign-in checks the same durable transition before acting.
- `lib/research-budget.mjs`: v2 migration and exact-project policy; `web/research-budget.js`, `ResearchBudgetEditor.swift`, `RemoteAssistIconGlossary.swift`: matching UI/help.
- `web/codex-accounts.js`, `weekly-usage.js`, `index.html`, `app.css`, and iPhone `CodexAccountsView.swift`/`WeeklyUsage.swift`: account controls, accessible targets, persistent pending request, keyboard Done, large-text scrolling and navigation.

Pinned 0.154.0 source places credential storage at `codex-rs/login/src/auth/storage.rs`; the older audit's obsolete auth source path returned 404. The direct Keychain implementation uses service `Codex Auth` and a key derived from the canonical Codex home. Explicit keyring configuration fails rather than taking auto-mode's file fallback. The auth manager caches credentials per process and restricts unauthorized-recovery reload to the same account ID. These facts establish a candidate isolation mechanism, not a supported universal running-process account switch. [Installed-release storage](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/login/src/auth/storage.rs), [auth manager](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/login/src/auth/manager.rs).

Browser and device-code login remain user-owned for account/workspace selection, consent and MFA/passkeys. The application performs deterministic RPCs and browser handoff; it does not need a model to authenticate. A saved password may assist that interaction but is not a retained Codex authorization. [Official authentication documentation](https://learn.chatgpt.com/docs/auth).

Read-only installed-runtime probe on September 15 at 07:52:33 UTC: separate empty file/keyring Codex homes returned no account; configured store matched; no auth file appeared; production auth-file metadata stayed unchanged. `account-storage-probe-0154/evidence.json` records the check. This proves empty-profile lookup isolation only. Keychain writes, retained refresh and A→B→A are unverified.

## Verification ledger

Artifacts are under `native/macos/dist/candidates/codex-account-switch-2026-09-15/`.

| Check | Evidence/result |
|---|---|
| Focused account, managed-login, quota and research tests | `account-and-budget-final.tap`: **83/83 passed**, including service-owned continuation/restart, duplicate clicks/controllers, uncertain auth/transition reconciliation, exact draft/image preservation, cancellation evidence, wrong account/API rejection, migration, project limits, and actual Assistant HTTP/MCP paths without model startup |
| Full runtime after resumption | `runtime-resumed.tap`: **755/755 passed** |
| Full runtime after adding two controller-driver tests | `runtime-final-verified.tap`: **756/757 passed**; unrelated timing-sensitive `default delegate-run stays on default delegate storage and leaves shared mailbox alone` observed `running` before `completed`. `runtime-final-delegate-focused.tap`: **1/1 passed** on the final source. The earlier failure is retained; this full run is not described as clean |
| Mac native account admission and actual WKWebView UI | `mac-accounts-acceptance.log`: **2/2 passed**; actual production dialog/module via disposable authenticated Assistant HTTP fixture, double-click creates one entry, no model jobs, recovery gate, 390/980 widths, ≥44-point targets, sticky Done, close/cancel handler and focus restoration |
| Mobile package tests | `mobile-account-unit-verified.log`: **9/9 passed**; older-host decoding, subscription metadata, weekly/shorter windows, percentage/reset/local-time interpretation, stale readings, host routing, notification acknowledgement and optional project budget input |
| Small iPhone UI | `accounts-compact-resumed.xcresult`: **2/2 passed**; account entry, guarded selection, reopening, normal and accessibility-extra-large text. `compact-ui.xcresult`: **2/2 project-budget UI tests passed** |
| Large iPhone UI | `accounts-large-acceptance.xcresult`: **2/2 passed** on the final source, normal and accessibility-extra-large text, including selection, status, reopening and return navigation |
| Simulator build | `ios-build.log`: successful generic iOS simulator build; UI runs build the current source |
| Syntax/storage inspection | Managed-login runner syntax checked; installed storage probe read-only; no live login or transition action |

Preserved earlier unsuccessful runs explain the test evolution: the account Form needed borderless button style to prevent neighboring row actions firing together; a keyboard Done control made large-text email entry navigable; iOS keyboard modifiers needed a platform guard for the Mac package target. XCTest then exposed test-only problems: a downward swipe dismissed a reopened sheet, static text has no reliable activation point, and querying a not-yet-existing element's type resolves it too early. The tests now distinguish visible text from actionable controls. One attempted Xcode invocation selected package-only test targets and exited before any tests; those tests subsequently passed through Swift Package Manager.

Visual review inspected the exported small/large iPhone screenshots in both text sizes and final `accounts-web-390.png` / `accounts-web-980.png`. Text wrapped, controls remained reachable, the iPhone Back control persisted, and desktop Done remained visible while scrolling. These are simulator/WKWebView observations, not physical VoiceOver or iPhone sign-in evidence.

## Remaining live work and release boundary

The live gate is intentional and still required. No retained dual-account authorization, real account change, per-process account adoption or cross-account resumption has been claimed. The read-only consumer list is deliberately incomplete: full window order/selection, latest history identity, process start identity, model/effort, hidden drafts, images, native queues and per-consumer account attribution need verified capture adapters. Separate Codex homes also change history/config/socket scope, so they cannot be installed as live account profiles merely because empty Keychain lookups are isolated.

Before enabling production switching, complete the reviewed isolated login plan, then a separately reviewed disposable transition plan. Verify exact account/workspace policy, retained authorization and refresh, model availability, same-thread history, unique ownership and supported draft/image recovery. Establish a shared admission/transition barrier that drains already-accepted work while holding new work, covers app-server jobs and all native launch paths, invalidates manual edits, and reconciles every pending receipt. Synthetic driver and admission tests do not prove these live conditions. Unrecoverable drafts/queues or unknown consumers must continue to block destructive transitions.

No real Terminal window, agent, draft, accepted queue or manual snapshot was changed to test this feature. Physical iPhone VoiceOver, keyboard/large-text usability, browser handoff, Keychain permission, MFA/passkeys and live account navigation remain unverified. Release/install follows the established signed Mac/internal TestFlight workflow after the agreed acceptance gates; Mac 145 and the reconciled iPhone 94 release checkpoint remain unchanged.

## Workspace classification and continuation

Implementation files are in the account controller/login/inventory, usage/research migration, shared Assistant admission/tool, Mac sign-in guard, desktop/iPhone UI, focused tests and disposable fixtures listed above. Audit reports and this checkpoint are canonical local artifacts. Test logs/screenshots/results remain in the ignored candidate directory; they are evidence, not release packages.

Preserved unrelated paths: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`. Their next action remains with their existing lanes; do not stage them into this checkpoint.

The next agent should start from `codex-account-switch-continuation-2026-09-15.txt`, read final test receipts, and reconcile Git/hygiene before acting. Do not rerun completed login actions: none have been started. The supplied test account emails identify the intended accounts; the exact isolated live plan still awaits its requested approval.

Final pre-commit hygiene: `hygiene-checkpoint.json`, **dirty_classified**, 53 paths, zero unclassified, safe to expand. `git diff --check` passed. The scoped commit path manifest is recorded with candidate evidence; the unrelated paths above are excluded. No release/version bump is included.
