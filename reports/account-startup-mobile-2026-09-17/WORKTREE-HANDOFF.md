# Classified remaining workspace

The account-recovery checkpoint retains all twenty-seven inherited dirty entries. All fifteen inherited tracked-file hashes still match `baseline.json`. Each path below remains outside this commit.

## Integration release metadata

- `.agents/skills/clawdad-release/SKILL.md`
- `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`
- `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`

Next action: The integration-release owner should review and checkpoint the existing metadata.

## Assistant turn controls

- `lib/assistant-app-server.mjs`
- `lib/assistant-coordinator.mjs`
- `lib/assistant-mcp.mjs`
- `lib/assistant-presentation.mjs`
- `lib/assistant-runtime.mjs`
- `lib/codex-account-work-evidence.mjs`
- `lib/codex-app-account-runtime.mjs`
- `lib/codex-thread-control.mjs`
- `test/assistant-coordinator.test.mjs`
- `test/assistant-presentation.test.mjs`
- `lib/assistant-turn-control-instructions.mjs`
- `lib/assistant-turn-control.mjs`
- `test/assistant-turn-control.test.mjs`

Next action: Continue that lane's release acceptance from `../assistant-turn-control-release-2026-09-17/WORKTREE-HANDOFF.md`; these changes were excluded from the release source.

## Native build and storage tooling

- `native/macos/build-app.sh`
- `native/macos/package-release.sh`
- `native/macos/storage-workflow.sh`

Next action: The native release owner should review and checkpoint these existing changes. They were used only as build tooling and are separately hashed in the source manifest.

## Artwork, cloud and marketing

- `assets/wordmark-explorations/`
- `cloud/native/`
- `marketing-site/`

Next action: Their existing owners should review and checkpoint these surfaces; they were excluded from this release.

## Existing audit and release evidence

- `reports/assistant-tool-coverage-2026-09-17/`
- `reports/assistant-turn-control-2026-09-17/`
- `reports/assistant-turn-control-release-2026-09-17/`
- `reports/multi-provider-thread-audit-2026-09-17/`
- `reports/windows-desktop-audit-2026-09-17/`

Next action: Retain and checkpoint each report with its corresponding lane.

ORP hygiene reports classified dirt, zero unclassified paths, and safe expansion. No unrelated work was reverted or deleted. The task-owned simulator was shut down after verification.
