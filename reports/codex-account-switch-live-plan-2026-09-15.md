# Isolated account authorization check

Status: prepared for Cody's review. No live sign-in has been started. The two emails below are Cody's supplied test accounts; the experiment itself remains awaiting the explicit approval required by the reviewed first-phase prompt.

## Exact first check

- A: `codyshanemitchell@gmail.com`, profile `cody`.
- B: `playinthesunwithme@gmail.com`, profile `sun`.
- Workspace: Cody selects the intended workspace if sign-in offers a choice. The current account/read interface supplies email and plan, while rateLimits supplies an allowance account ID. It does not supply a verified human-readable workspace name; a label alone will not establish one.
- Internal test root: `/Users/codymitchell/Library/Application Support/ClawDad/Accounts/verification-2026-09-15/`.
- Each profile is a separate, private Codex home. No production history/configuration/authentication files are linked or copied. Codex uses explicit `cli_auth_credentials_store="keyring"`; file fallback is not allowed.
- Only owned, disposable `codex app-server --stdio` processes are used. The RPC allowlist permits configuration and account operations only. No thread creation, resume, model requests, Terminal actions, or production service restart.

1. Start A's isolated process, confirm Keychain configuration, and inspect its account. If empty, begin supported browser login and open its returned URL without recording it. Cody completes account selection, consent and any MFA/passkey step.
2. Match the exact login callback, read account → fresh allowance → account again, and verify the selected email and subscription method. Save only nonsecret identity, quota and test-receipt evidence. A browser success page alone is insufficient.
3. Stop only A's owned test process. Run the same procedure for B.
4. Reopen A and then B using account reads only. Verify each retained authorization and distinct allowance identity without new login. Check there is no auth.json fallback and production auth-file metadata is unchanged.
5. Stop on a wrong account, unsupported workspace policy, expired authorization, lost callback, storage failure or any isolation uncertainty. Preserve the receipt. Do not automatically repeat sign-in or overwrite credentials.

The controller needs no model allowance. Browser handoff and account RPCs are deterministic; account/workspace selection, consent, password AutoFill, MFA and passkeys remain user-owned. No AI computer-use fallback is part of this check.

## Reviewed commands

The runner is `test/fixtures/codex-account-login-check.mjs`. It is outside the application runtime and refuses invocation without the explicit isolated-signin flag. These commands must not run until this plan is approved:

```sh
node test/fixtures/codex-account-login-check.mjs signin cody codyshanemitchell@gmail.com account-check-cody-1 --user-approved-isolated-signin
node test/fixtures/codex-account-login-check.mjs signin sun playinthesunwithme@gmail.com account-check-sun-1 --user-approved-isolated-signin
node test/fixtures/codex-account-login-check.mjs verify cody codyshanemitchell@gmail.com account-check-cody-reopen-1 --user-approved-isolated-signin
node test/fixtures/codex-account-login-check.mjs verify sun playinthesunwithme@gmail.com account-check-sun-reopen-1 --user-approved-isolated-signin
```

## Evidence already obtained

Installed runtime: Codex 0.154.0. Its pinned `codex-rs/login/src/auth/storage.rs` derives the direct Keychain account key from the canonical Codex home; the service is Codex Auth. Explicit keyring mode does not use the auto-mode file fallback. Its auth manager caches credentials within each process and restricts unauthorized-recovery reload to the same account ID. These are source findings, not proof that all live Terminal processes hot-switch.

On September 15 at 07:52:33 UTC, the installed runtime's account/read returned no account in separately created empty file and keyring homes. The reported store matched each requested mode, no auth file appeared, and production auth-file metadata was unchanged. Evidence: `native/macos/dist/candidates/codex-account-switch-2026-09-15/account-storage-probe-0154/evidence.json`. This proves empty-profile lookup isolation only. Keychain writes, refresh after expiry and cross-account session resumption are still unverified.

Primary sources: [installed release storage](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/login/src/auth/storage.rs), [authentication manager](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/login/src/auth/manager.rs), [official authentication documentation](https://learn.chatgpt.com/docs/auth).

## Separate next gate

Successful retained sign-in does not yet authorize transitioning real sessions. A second reviewed disposable experiment must establish exact UUID/history/model/effort preservation, recoverable drafts/images, queue reconciliation, cross-account workspace access, account adoption and unique ownership. Separate Codex homes also change history/config/socket paths. No symlinked live history or shared auth-file rotation is proposed. Production switching and release remain gated until those behaviors have evidence.

Manual snapshots, ongoing work, real credentials, current microphone state and current project allowance authorizations remain untouched by this initial check.
