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

`account-check-sun-1` opened for `playinthesunwithme@gmail.com` at `2026-09-16T03:18:56Z`; at this checkpoint it awaits Cody's browser completion. This process loaded the earlier adapter before the repair, so its receipt may require a read-only fresh-process check as the first account did. Preserve it; do not blindly repeat login.

Next: verify the second identity, reopen both homes without login, compare their entitlement identities, and confirm production-auth metadata and absence of credential-file fallback. Authentication retention remains separate from the unfinished live session-transition adapter. No production switch or release has occurred. Mac build 145 remains the last inspected installed build; physical iPhone build and microphone state were untouched.

The nine inherited unrelated dirty paths retain their prior classification. This checkpoint owns only the managed-login readiness fix, its mock/regressions and this report. Current user-owned step is the second browser sign-in; no further account authorization is required to perform the already approved read-only retention checks.
