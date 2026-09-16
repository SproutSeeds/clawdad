# Selected Codex account in future Terminal shells

## Scope and current checkpoint

Cody authorized the recommended selected-account launcher and continued setup for `doughalchemy@gmail.com`. This work extends the shipped Mac 146 / internal iPhone 95 account controller to future interactive Terminal launches. Existing agents, project drafts, named workspaces and authentication remain unchanged. No global account switch is a test.

The fresh Dough retained-profile sign-in (`connect-doughalchemy-20260916-2`, 15:35:09.755 UTC) expired awaiting Cody's browser completion. Supported verification `verify-doughalchemy-20260916-2` found no retained sign-in. The separate profile remains `needs_sign_in`; the current ordinary CLI's Dough login is a different credential source. No further browser ceremony will be started until Cody is ready.

## Implementation

- Explicit, removable zsh integration sources a private script from ClawDad's internal-drive account directory. It keeps an exact, fsynced backup and checks the startup file again before atomic replacement. An existing unknown alias/function, custom startup location, changed managed script or insecure ownership causes a preserved-file refusal. The existing `features.code_mode_host=true` prefix is retained. Existing shells keep their loaded functions; new interactive shells receive the integration.
- `codex`, `codex resume` and `codex fork` use the verified selected profile. Without a completed selection, the current CLI login is preserved. Help/version, authentication and automation subcommands keep their original CLI route. Explicit `command codex` remains a deliberate bypass. Conflicting account/provider/history overrides require that explicit route rather than silent replacement.
- The launcher uses the actual installed binary with `execve`, preserving PID, TTY, signals, arguments and standard streams. It does not leave an intermediary process or rewrite prompts. No model turn is needed for routing.
- An account-admitted durable receipt closes the gap between reading the selected account and replacing the process. The switch controller reconciles the exact PID lifetime, executable and native random launch marker. Pending or uncertain launches hold a switch; failed execution is never replayed. Receipts retain argument hashes, not prompt text or credential values.
- Selection epoch validation happens before recording accepted work, preventing an orphan admission when the preference changes during launch preparation.
- Assistant guidance describes the integration and its boundaries. The already shipped iPhone 95 release catalog and matching provider fixtures are reconciled from their stale build-94 record. No iPhone UI changes or new phone build are needed for this lane.

## Verified results before packaging

- Initial focused runtime checks: 54/54 passed. This includes actual macOS execve PID preservation, Unicode/multiline arguments, stdin/stdout and exit-code propagation, plus switch holds, epoch races, duplicate IDs and private shell installation/removal.
- Full suite initially: 901/902 passed, with the existing stale phone release catalog mismatch. The following run exposed four matching build-94 provider fixtures; these are being updated to the shipped build 95.
- A real selected-profile CLI fixture reached an unexpected sign-in screen despite a verified retained account (`tui-status-shell-cody-1`, 15:55:28–15:56:04 UTC). A direct CLI control with account options after `resume` passed; the same direct command with account options before `resume` reproduced the sign-in screen (`tui-status-root-options-1`). This establishes an option-scope difference in Codex 0.154.0's resumed TUI, independent of execve or the launcher. The interactive adapter now inserts account settings inside `resume`/`fork` option scope, retaining the exact order of original arguments and preserving `--` and positional prompts.
- Corrected actual TUI launches verified Cody at 15:59:43 UTC and Sun at 16:00:17 UTC, with the same synthetic conversation `01a0a848-cb86-7033-ae6f-ce006f5b51bb`. A third Cody launch at 16:01:33 UTC passed the production Swift process census: same PID 54538, exact executable and native random launch marker, `native_launch_observed`. All fixture processes exited. No model prompt, browser sign-in, real tab or project mutation occurred. The fixture injects only the verified selected-profile projection into a private account journal; it does not pretend to be a production global account switch.
- Final full runtime suite: **903/903 passed**, zero skips (`shell-launch-release-final.tap`). Focused launcher/install/release checks: **26/26**. Node syntax checks and `git diff --check` passed. Actual fork command execution remains untested; argument-scope behavior for both resume and fork is covered automatically.
- Candidate logs live in `native/macos/dist/candidates/codex-account-switch-2026-09-15/`; account fixture transcripts remain private under Application Support. Later verified results and installation evidence will be appended.

## Limits and remaining acceptance

Completing Dough's retained login remains user-owned. Browser account selection, consent and MFA cannot be inferred from the current default CLI login. The supported [Codex authentication documentation](https://learn.chatgpt.com/docs/auth) distinguishes subscription login, Keychain-backed credential storage and separately billed API authentication. This feature does not copy credentials or enable API billing.

Physical iPhone account navigation/VoiceOver and a deliberate whole-workspace account switch remain separate acceptance checks. Installing a launcher cannot prove that a busy or unrecoverable session is safe to switch; existing controller protections remain in effect.

## Workspace classification

Scoped implementation: `bin/clawdad-codex`, `bin/clawdad-codex-launcher-install`, `lib/codex-account-shell-launch.mjs`, `lib/codex-account-shell-install.mjs`, `lib/codex-accounts.mjs`, `lib/server.mjs`, `lib/assistant-coordinator.mjs`, `lib/app-store-connect.mjs`, `test/app-store-connect.test.mjs`, `test/codex-account-shell-launch.test.mjs`, `test/codex-account-shell-install.test.mjs`, `test/fixtures/codex-account-shell-launch.mjs`, `test/fixtures/codex-account-shell-census.mjs`, `test/fixtures/codex-account-tui-status.py`, this report and `reports/codex-account-switch-continuation-2026-09-15.txt`. Commit only these audited paths.

Nine inherited buckets remain preserved: `.agents/skills/clawdad-release/SKILL.md`; `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh`; `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`; `assets/wordmark-explorations/`; `cloud/native/`; `marketing-site/`. Use the existing native build workflow without staging its unrelated edits. No source push, npm/public release, appcast publication or infrastructure change is authorized by this lane.
