---
name: clawdad-release
description: Use when building, distributing, installing, and verifying either a private native Clawdad release or a separately authorized public CLI release.
---

<!-- Managed by Clawdad Codex Integration. -->

Select exactly one distribution mode before any mutating release action.

## Native Private

1. Confirm the worktree diff and version bump.
2. Run syntax checks and the full test suite.
3. Confirm the iOS build, Mac build, and embedded runtime version as separate
   release identities.
4. Upload the iOS archive to the authorized internal TestFlight group and verify
   its processing and assignment state.
5. Build, sign, notarize, staple, and checksum the native Mac app, then install
   the local notarized artifact.
6. Verify the installed app identity, embedded runtime, native service topology,
   and required physical-device gates.
7. Leave npm publication, git tags, GitHub release assets, the public appcast,
   external TestFlight, Beta App Review, and App Store submission unchanged
   unless each surface is separately authorized.

## Public CLI

Use this mode only when public npm and GitHub distribution are explicitly
authorized.

1. Confirm the worktree diff and package version bump.
2. Run syntax checks, the full test suite, and package-content verification.
3. Update package metadata and public release documentation.
4. Commit, tag, and push the branch and tag.
5. Publish the npm package and create or update the GitHub release.
6. Install the published package globally.
7. Restart the public CLI service and verify `clawdad version`, `clawdad
   sessions-doctor --json`, and service health.
