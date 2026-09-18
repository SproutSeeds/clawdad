# Mac 162 account activation verification

The installed Mac app is now version 0.7.0, build 162. The previously stuck activation completed on the existing operation receipt, and the running app server verified the selected subscription from its ClawDad profile home. The active-account panel displays the verified account and no longer shows the completed request as pending work.

## Cause and change

Project history records successful requests as `answered`, while account activation expected `completed`. A finished project request therefore remained in the activation drain. Both project receipt adapters now normalize that success status. Actual waits name the app request and project; unresolved receipts provide recovery instead of a perpetual finishing message.

The running app-server socket now supplies the active identity and allowance. Previewing a saved account does not select the runtime. Native app work requires an explicit profile, and startup/reuse checks both its account identity and authentication home. Terminal operations bypass the app-account gate.

An expired source subscription can be retired only with the exact process/home identity, stable account descriptor, complete idle-thread evidence, preserved settings/history/drafts, empty queues, and reconciled receipts. The destination must have verified subscription access. No model turn is sent by activation.

## Verification

- All 961 Node tests passed in the isolated release source snapshot: zero failures or skips.
- The native WKWebView account-panel test passed through real HTTP, including mismatched/unavailable runtime identity, account preview, limited allowance, activation, and a lost reply.
- Fixture layouts at 375, 430, and 980 pixels were captured; the installed Mac panel was also visually checked. Escape closes the dialog and restores its opener.
- Apple accepted notarization of both the app and DMG. Stapling, signature validation, and Gatekeeper assessment passed.
- All ten changed runtime files match the audited source manifest in both the installed bundle and the live copied runtime.
- The original pending activation completed at account epoch 1. One Retry activation action recovered a native process-reader timeout during app startup, using the same operation receipt.
- Four pre-install conversation histories have identical turn hashes, models, reasoning effort, and directories afterward. The app restart released their idle subscriptions; the conversations remain saved and readable from the selected runtime.
- Assistant conversation identity, messages, app-server drafts, and delivery receipts are unchanged. All seven observed Terminal Codex processes retain the same PID, parent, TTY, start time, and executable. The shell configuration is unchanged.
- Native bridge is online; the installed account panel confirms the selected profile is active. A different saved account could be previewed while the active runtime remained unchanged.

Machine-readable results are in `installed-verification.json` and `release-verification.json`. `source-manifest.json` records exact build inputs; `baseline.json` records inherited tracked changes. Detailed test/package logs remain local ignored `.log` artifacts in this directory. Raw production snapshots, including account identifiers and conversation content, remain in the private app-support verification directory and are excluded from Git.

## Release and rollback

Release artifacts: `native/macos/dist/releases/0.7.0-beta.20-macos-162-account-activation/`. The DMG SHA-256 is `d58361b5e8216ef9e089cbefffa4d1fed3a1f51568cbeb9c9c5789e02b6686de`.

The exact prior installed build is retained at `native/macos/dist/releases/0.7.0-beta.20-macos-161-app-accounts/installed-before-162.app`. The temporary duplicate in `/Applications` was removed only after every file and symlink matched this rollback copy.

Scope is the installed native Mac app and its embedded server. Public npm/Sparkle publication and TestFlight distribution were not part of this deployment. Physical iPhone acceptance was not performed.

## Classified remaining workspace

The release source was archived from `a2cfc58444b362cac2c2a5337f862ba9b62230a4`, with only the account-fix paths in `source-manifest.json` overlaid. Three inherited native build/storage scripts were used as build tooling and are identified separately in that manifest. They are not part of this source commit. Every inherited tracked change remains byte-identical to the starting baseline.

The remaining work belongs to existing lanes:

- Assistant turn controls: the Assistant modules and tests, `lib/codex-thread-control.mjs`, `lib/codex-account-work-evidence.mjs`, and `lib/codex-app-account-runtime.mjs` listed in `../assistant-turn-control-release-2026-09-17/WORKTREE-HANDOFF.md`. Next action: continue that lane's release acceptance independently.
- Native build/storage tooling: `native/macos/build-app.sh`, `native/macos/package-release.sh`, and `native/macos/storage-workflow.sh`. Next action: owner review and checkpoint of the storage workflow.
- Integration metadata: `.agents/skills/clawdad-release/SKILL.md`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, and `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`. Next action: integration-release owner checkpoint.
- Artwork, cloud, and marketing: `assets/wordmark-explorations/`, `cloud/native/`, and `marketing-site/`. Next action: their existing owners' review; excluded from this release.
- Prior audit reports: `reports/assistant-tool-coverage-2026-09-17/`, `reports/assistant-turn-control-2026-09-17/`, `reports/assistant-turn-control-release-2026-09-17/`, `reports/multi-provider-thread-audit-2026-09-17/`, and `reports/windows-desktop-audit-2026-09-17/`. Next action: retain as evidence and checkpoint with their corresponding lanes.

`git diff --check` passed. ORP hygiene reports classified dirt, zero unclassified paths, and safe expansion. No unrelated paths are included in the account-fix commit.
