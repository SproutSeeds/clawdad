# Retained Codex sign-in and session transition implementation

Latest live checkpoint: [September 15 sign-in verification](codex-account-signin-live-2026-09-15.md). The first account is now verified after process reopening; the second browser ceremony is pending. That check exposed and repaired a login-completion/account-reload race. The earlier timeout below remains historical evidence.

## Current verified baseline

Source checkpoint c87b091 contains the guarded controller and synthetic transitions. Installed Mac build 145 and Codex CLI 0.154.0 are unchanged. The nine inherited dirty paths are classified and preserved. Neither the OpenAI desktop app nor ChatGPT browser sign-in is a prerequisite for running Terminal Codex.

Cody approved investigation followed by implementation, with his participation at decisive steps. The first supported, separate-home Keychain sign-in was opened for codyshanemitchell@gmail.com on September 16 at 00:23 UTC. This does not change production Codex credentials or restart a real agent. The second requested account is playinthesunwithme@gmail.com.

## Concrete sequence

1. Verify retained subscription authorizations using the reviewed account-only disposable processes. Observe exact account/email and fresh allowance; reopen each home without a second login. Never persist URLs, codes, cookies or tokens in ClawDad records.
2. Implement the actual deterministic account-connection path in the existing phone and Mac controls: start supported login, show progress, cancel, reconcile callback loss/service restart, and verify a retained authorization. Only the owned separate-home process may be stopped. Viewing account status starts no sign-in or microphone capture. All actions use stable request IDs and durable, private receipts.
3. Establish the history/configuration boundary using installed schemas, pinned source and disposable fixtures. Codex home selects authentication **and** state; `--profile` is configuration, not an account selector. CLI UUID resume and app-server resume must retain exact history without hidden replacement or a second live owner. Investigate supported `sqlite_home` indexing and rollout-path semantics before choosing a transition strategy. Do not symlink or copy live histories or credentials as a shortcut.
4. Expand the exact consumer preview and native transition only once those observations justify it. Drain accepted work and native queues by default. Preserve window/tab identity, permissions, model/effort, exact recoverable draft/images and receipts separately from manual workspace snapshots. A process with unverified input or ownership remains unchanged with a precise reason.
5. Verify the full transition with disposable sessions under the two authorized accounts, including return to the original account, duplicate clicks, crash boundaries and settings/history identity. Production readiness requires all affected owners to be verified. Authentication success alone never marks a complete switch.
6. Run affected service, desktop and iPhone checks; carry proven behavior through the native release workflow when production transition evidence and installation safety are established. No public CLI publication, API billing, account cycling, real-window closure or unrelated infrastructure change.

## Decisions and gates

- Browser account/workspace selection, consent and MFA/passkeys stay with Cody. Saved passwords can assist that supported flow.
- Existing sessions remain running during account connection. Any later action that must stop a real agent requires a concrete preview and Cody's applicable authorization.
- Unknown workspace names remain unknown; user labels are not verified workspace identity.
- The global 20% reserve stays removed in the implementation. Explicit project limits and latched/manual pauses retain their account attribution. An account change never silently starts supervisors.
- Model allowance is unnecessary for the connection/recovery controller; there is no AI computer-use dependency.

## Acceptance evidence required

Account A then B, fresh account reads after both processes restart, distinct retained entitlement identities, zero production-auth metadata changes, no credential-file fallback, no model RPCs during connection, correct/wrong account, cancelled and interrupted login, duplicate requests, storage/transport errors, and no credential/URL/code material in persisted evidence. Session-transition tests must separately prove exact UUID/latest history, unchanged permission/model settings, unique ownership, preserved drafts/queues and observed account adoption. Unverified stages remain explicit in the delivery report.

## Implementation and verification checkpoint

`lib/codex-account-profile-process.mjs` implements an owned account-only CLI process with a private home, explicit Keychain storage, sanitized environment, bounded transport and a strict RPC allowlist. It cannot start/resume a conversation or supply API credentials. `lib/codex-account-authorizations.mjs` adds atomic private receipts, duplicate-click aliases, cross-controller exclusion, exact email/allowance identity checks, cancellation, deliberate reconnection and recovery after a lost callback or service restart. It stores no credential, browser URL or device code. Connecting an account leaves production owners, account epochs, project budgets and manual snapshots unchanged.

The existing Mac and iPhone account panels now expose Connect account on Mac, Check saved sign-in, Cancel sign-in and deliberate reconnection. Pending status is refreshed while the panel is visible. Main Assistant tools `save_codex_account` and `connect_codex_account` share the same authenticated service path and require Cody's actual current instruction. Full runtime switching remains separate: its production transition adapter is still unimplemented and gated.

The first isolated browser ceremony opened at 2026-09-16T00:23:35Z for codyshanemitchell@gmail.com, emitted awaiting_user, and reached its ten-minute timeout. A later separate account/read returned accountPresent:false without attempting login. The second account was not started. Preserve `Accounts/verification-2026-09-15/cody-check.json` and request `account-check-cody-1`; reconcile before a fresh request. This is a user-step timeout, not evidence that dual Keychain retention works or fails. The failed runner did not persist its initial production-auth metadata baseline, so it is not counted as completed before/after metadata verification. No production account, real agent, draft or snapshot was changed by this experiment.

### History architecture findings

The installed CLI accepts `sqlite_home` separately from `CODEX_HOME`. UUID resume uses thread/read, and state-database rollout paths are verified against session metadata. Sources: [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), [pinned UUID lookup](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/tui/src/lib.rs#L689), [pinned rollout lookup](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/rollout/src/list.rs#L1358).

The new `test/fixtures/codex-account-history-probe.mjs` uses synthetic history, ephemeral unauthenticated processes, serialized ownership and no model-turn RPCs. All artifacts are under the canonical account-switch candidate folder.

| Experiment | Observed evidence | Limit |
|---|---|---|
| `account-history-probe-0154` | Same UUID `d8679289-e400-4c14-97df-0eac1794475b` across A→B→A homes; exact directory; retained Unicode/end marker; B resumed idle with gpt-6-astra/low; original history hash unchanged | Local legacy-format fixture only; no authenticated account transition |
| `account-history-probe-linked-resume-0154` | Linked paginated UUID `b1446b73-61e8-42df-b26a-41e1683a8d4d` resumed idle in A; B failed with missing source rollout when only SQLite was shared | Confirmed limitation of index-only sharing |
| `account-history-probe-linked-shared-0154` | A sessions-directory link wholly inside the disposable fixture allowed both homes to resume UUID `e39d4bce-5e4b-4ba5-b044-4d58e3f99b9b`; original hash unchanged | Potential layout only; no production link or configuration change |

The paginated fixture projects zero local turns: it proves reference lookup/idle resume behavior, not full inherited-turn rendering or model context fidelity. Earlier partial fixtures remain preserved. A real Codex-generated paginated/fork/revert fixture with complete known text is required before production layout selection. No production histories/configuration were linked or copied. The previous no-symlinked-live-history plan remains in force; the synthetic alternative needs deliberate review and stronger evidence before adoption.

The revised direction is one canonical history store plus separate authorization homes and exact per-owner transitions. Sharing only the index is insufficient. Configuration, permissions, skills/hooks, archived history, images, write destinations and native catalog lookups must all be established under that layout. Do not rotate auth.json, duplicate refresh tokens or silently migrate work as a shortcut.

### Test receipts

- `authorizations-stage-two-transport-final.tap`: **32/32 passed**, including actual Assistant MCP → HTTP → runtime account control, authorization rejection, duplicate delivery, restart/cancel recovery, wrong principal/workspace and concurrent controllers. Account-provider responses are synthetic.
- `accounts-stage-two-mac.log` and `accounts-stage-two-mac-visual.log`: **2/2 passed** in each; actual WKWebView/service controls and native admission. 390/980-point layouts and navigation were checked.
- `accounts-stage-two-compact.xcresult`: **2/2 passed**, normal and accessibility-extra-large text. Large accessibility passed in `accounts-stage-two-large.xcresult`; normal failed only because XCTest measured 44 points as 43.99999999999994. A 0.01-point test tolerance retains the 44-point product target. `accounts-stage-two-large-normal-final.xcresult`: **1/1 passed**. Screenshots reviewed; these are simulator checks.
- `runtime-stage-two.tap`: **765/766 passed**, with the previously documented delegate timing failure during concurrent simulator work. Its focused rerun passed **1/1**. After the final account regressions and simulator completion, `runtime-stage-two-final.tap` passed **768/768**. Earlier failure evidence is retained.

Keychain writes, retained A/B authorizations, refresh after expiry, actual cross-account turns, native owner replacement and physical iPhone sign-in remain unverified. Mac **145** remains installed. **94** is the last reconciled iPhone release checkpoint; its current physical installation was not inspected. No native release, production restart or public CLI publication occurred. Full one-click switching remains unfinished: complete capture/drain/adoption and the live transition adapter still need implementation and authenticated acceptance.

### Classification and continuation

This stage owns the two new account modules, integration in existing controls/service/Assistant tools, phone/desktop views and tests, history probe and reports. The global 20% reserve removal remains in unshipped first-phase source; explicit project limits and manual pauses are retained.

Nine inherited unrelated paths remain preserved: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`. Their existing lanes retain ownership and next actions. Candidate artifacts are ignored under `native/macos/dist/candidates/codex-account-switch-2026-09-15/`.

Next user-owned step: complete both browser sign-ins when Cody is at the Mac. The first ceremony expired and needs a fresh reconciled request. Then verify both retained identities after process restart, choose and verify the history/config layout, complete disposable owner-transition tests, and only then enable the production switcher and native release. A sign-in alone never proves all consumers switched.

Final hygiene: dirty_classified, zero unclassified; `git diff --check` passed. The original full received prompt remains unchanged with SHA-256 `785bace8cb2ed9d327055c285bdf822566ca450d418a949a0dc6bca91aba98be`. Scoped source paths and commit identity are recorded in `stage-two-checkpoint.json` beside candidate evidence; unrelated paths are excluded from staging.
