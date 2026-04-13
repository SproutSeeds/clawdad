# Clawdad Release Packet

Prepared: 2026-04-13

## Release

- Package: `clawdad`
- Version: `0.6.4`
- Tag: `v0.6.4`

## Scope

- Dispatch workers now have Codex turn/request timeouts.
- Stale or abandoned mailbox dispatches are repaired to failed state instead of hanging the mobile app indefinitely.
- Malformed mailbox status files are quarantined and replaced with a failed status so `/v1/status` stays responsive.
- Mailbox shell writes JSON-safe multiline errors.
- Delegate run state and mobile UI updates from the prior hardening work are included.

## Keep Out

- `.playwright-mcp/`
- root-level screenshot scratch files
- generated mascot/cutout/contact-sheet candidates under `assets/`
- local walkthrough recordings

## Verification

- `npm test`
- `node --check lib/server.mjs`
- `node --check lib/codex-app-server-dispatch.mjs`
- `zsh -n bin/clawdad`
- `npm pack --dry-run --json`
- live `/v1/status` smoke check after service restart
