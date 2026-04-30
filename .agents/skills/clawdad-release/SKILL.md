---
name: clawdad-release
description: Use when cutting, publishing, installing, and verifying a Clawdad release across npm, git tags, GitHub releases, and the local service.
---

<!-- Managed by Clawdad Codex Integration. -->

Use the Clawdad release path deliberately.

Checklist:

1. Confirm the worktree diff and version bump.
2. Run syntax checks and the full test suite.
3. Update package metadata and docs when needed.
4. Commit, tag, push branch and tag.
5. Publish the npm package and create/update the GitHub release.
6. Install the published package globally.
7. Restart the Clawdad service and verify `clawdad version`, `clawdad sessions-doctor --json`, and service health.
