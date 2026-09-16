# Retained account sign-in: live checkpoint

Cody returned to the Mac and authorized continuing the already approved account-only check. No real agent, Terminal window, production service or credential store was restarted or switched.

## First account

Request `account-check-cody-2` reconciled the expired `account-check-cody-1` in the same private home, found no retained account, and opened supported browser login at `2026-09-16T03:12:59Z`. Cody completed sign-in. The immediate callback check returned `selected_account_mismatch`; a fresh account-only process subsequently read the exact expected `codyshanemitchell@gmail.com` subscription and 43% weekly remaining. Keychain authorization survived this process reopening, no auth.json fallback existed, and the recorded production auth-file metadata remained unchanged. No model was called.

The safe receipts are under `~/Library/Application Support/ClawDad/Accounts/verification-2026-09-15/`: `account-check-cody-2.json` and `account-check-cody-2-reconcile.json`. The reconciliation writer initially used an unconditional “different authorized account” result label even though actualEmail matched expectedEmail; the receipt records that labeling correction. No provider identity was changed.

## Confirmed readiness race and repair

Installed Codex CLI remains 0.154.0. Its [account processor](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/request_processors/account_processor.rs#L907) sends account/login/completed before AuthManager.reload, then sends account/updated after the reload. ClawDad previously queried account/read immediately on the first notification. This ordering explains why the immediate observation can fail while the correctly retained authorization works in a new process. The failed live receipt did not retain the immediate account payload, so whether that particular response was null or stale is unresolved.

`CodexManagedLogin` now waits for a subsequent ChatGPT account/updated notification before exact account → allowance → account verification. Earlier updates cannot satisfy this boundary. The wait is bounded; interruption/cancel/timeout remains recoverable and never restarts login automatically. A missing account now receives `account_state_pending`, while an actually different principal keeps `selected_account_mismatch`. This uses the supported [account notifications](https://learn.chatgpt.com/docs/app-server#auth-endpoints), with no token export, forced refresh or model request.

Targeted managed-login and authorization regressions passed, including delayed/missing readiness, early callbacks, unrelated callbacks, wrong principal, cancellation, service interruption, duplicate requests and actual Assistant transport. Artifact: `native/macos/dist/candidates/codex-account-switch-2026-09-15/login-readiness-fix.tap`. The desktop mock now emits the same readiness notification as the installed protocol. No UI or native build changed.

## Second account and remaining proof

`account-check-sun-1` opened for `playinthesunwithme@gmail.com` at `2026-09-16T03:18:56Z`. Cody completed it; the process had loaded the earlier adapter and ended with the same immediate verification failure. The original receipt remains preserved. Four subsequent fresh account-only processes, ordered Cody → Sun → Cody → Sun, verified both exact emails and two distinct, stable allowance identities without another login. Neither home contains an auth.json fallback; production auth-file metadata remained unchanged from before the first sign-in. Evidence: `account-retention-pair-1.json` in the private verification root.

The current reading is 42% for Cody and exactly 0% for Sun. Sun additionally reports `ordinaryUsageAllowed=false`, `rateLimitReachedType=rate_limit_reached`, and reset `Saturday, September 19, 2026 at 7:57:20 AM CDT`. This is an actual provider-denied reading, not merely a rounded display. Evidence: `account-check-sun-allowance-1.json`. No model request was used to obtain these readings.

The account-readiness change passed the complete runtime suite: **770/770**, `runtime-login-readiness.tap`.

## Bounded next continuity experiment

Within the existing authorization for implementation and the named two-account disposable test, `test/fixtures/codex-account-thread-continuity.mjs` will create one new synthetic conversation under the available Cody account and ask for a single short marker response. It will fork that disposable paginated history, release its owned source process, reopen the exact source and fork IDs under Sun without any model turn, and read the exact messages/settings. A final fresh Cody process will check the same history. Only the fixture's own IDs are accepted; ambiguous or timed-out mutations are journaled and never blindly retried.

The fixture creates its own project, SQLite index and history under the private verification root. It links only those new disposable history directories into the two otherwise empty verification homes. It does not link, copy, migrate or edit production histories, settings, credentials, drafts, queues or snapshots. Keychain homes retain their existing canonical paths. Read-only sandboxing and text-only fixture instructions apply; any unexpected server permission/tool request is rejected. Each owned process exits before the next opens. The second account's 0% allowance prevents proving actual model execution under that account; local history access is reported separately. Terminal process replacement, real configuration, images and queued drafts remain outside this experiment.

Authentication retention is now verified; it remains separate from the unfinished live session-transition adapter. No production switch or release has occurred. Mac build 145 remains the last inspected installed build; physical iPhone build and microphone state were untouched.

## Observed continuity results

The source account completed one synthetic turn in 4.703 seconds, `2026-09-16T03:35:38.203Z` → `03:35:42.906Z`. Source thread `01a0a848-cb86-7033-ae6f-ce006f5b51bb` and its real paginated fork `01a0a848-de93-75e3-b69d-8158ebb54973` both retained accepted turn `01a0a848-cbd2-7e92-8288-0c920cd858d6`. The second account reopened the original idle thread with the correct directory, gpt-6-astra/low, user text and Assistant text.

The first experiment correctly stopped at its stricter fork-settings assertion. A separate inspection under **both** accounts showed the fork's reasoning effort as null, while the original remained low. Thus this is a fixture assumption about fork inheritance, not evidence that changing accounts lost a setting. The failed receipt remains intact. The fork's initial settings response was not captured in that first run; the fixture now records it before later checks.

`--reconcile-existing` cannot create threads, fork or submit a turn. It reused the exact accepted IDs, explicitly selected the fixture's intended gpt-6-astra/low on resume, and verified complete message text under Sun and then Cody. Original and fork hashes matched the original source text projection: `4c4f269ea1d1b6ec81dcf3e147eec8ea0692fdd80cfd8aac769ef6d15800b0e5`. Each previous owned process exited before the next began. Every verified resumed thread was idle. There was **one model turn total**, under Cody; the reconciliation pass and Sun made **zero** model requests. No prompt was replayed.

Receipts under the private verification root: `thread-continuity-1/evidence.json` (initial failure retained), `inspection-1.json` (both accounts' actual settings), and `reconciliation-1.json` (successful explicit-setting/local-history proof). Only synthetic fixture history was linked. The retained account homes must stay at their canonical paths; moving them would change their Keychain namespace. Product registration should refer to an approved verified home rather than copying credentials or asking the user to repeat a completed sign-in.

This now establishes complete real paginated/fork text lookup and idle resume across the two retained authorizations on the installed CLI. It does **not** establish a model response under the exhausted Sun account, real Terminal owner replacement, configuration/hooks/permission migration, draft/image/queue preservation or refresh after token expiry. Production switching remains gated while those implementation/acceptance items remain. Capturing effective per-owner settings and applying them explicitly is required; a saved thread ID alone is insufficient.

The nine inherited unrelated dirty paths retain their prior classification. This checkpoint owns the managed-login readiness repair and its regressions, the bounded continuity fixture, and these reports. Both browser sign-ins are complete; no further login action is needed from Cody now. The exact provider blocker for a second-account execution test is `ordinaryUsageAllowed=false` at 0% weekly remaining until the reported reset. Independent transition-controller implementation can continue without changing that account or its subscription.

## Registered retained homes

Both exact homes are now registered in ClawDad's saved-account records, after account-only email and entitlement verification. This internal registration accepts only an existing private canonical directory inside Accounts, rejects symlinks, missing/external homes and conflicting ownership, and adopts the path only after identity verification. The ordinary UI/MCP cannot supply arbitrary paths. Credentials remain managed by Codex in Keychain; nothing was copied or moved.

`registered-retained-homes-1.json` completed at `2026-09-16T03:44:53.216Z`. A fresh authorization controller reopened both entries using their registered paths and verified them again. The account epoch and active switch were unchanged; no login ceremony or model call ran. Saved entries are `76de8088-2e6c-4fb7-9628-74bd667e88df` (Cody) and `59fafeed-9c08-4911-8f72-f0608e18e1db` (Sun). This is durable connection registration, not production runtime adoption.

Final checks for this checkpoint: **18/18** focused authorization/transport tests and **772/772** complete runtime tests (`retained-home-registration.tap`, `runtime-retained-home-final.tap`). Actual local-history verification is the bounded fixture above; physical iPhone switching and real Terminal process replacement remain unverified. Installed Mac build 145 remains unchanged.
