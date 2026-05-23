# Clawdad Live Runtime Runbook

Use this runbook when source changes need to become the Clawdad app served through Tailscale.

## Production Check

Run:

```sh
clawdad prod-doctor --json
```

The production doctor checks the installed binary, package version, service unit, local `/healthz`, served app asset, authenticated projects API, Codex integration, session blockers, and queue worker availability.

Treat failures as release blockers. Warnings are follow-up work unless they involve the selected live project or a broken user-facing flow.

## Release Gate

Before publishing:

```sh
npm test
git diff --check
npm pack --dry-run --json
```

After publishing and reinstalling:

```sh
npm install -g clawdad@<version>
launchctl kickstart -k gui/$(id -u)/com.sproutseeds.clawdad.server
clawdad --version
curl -fsS http://127.0.0.1:4477/healthz
clawdad prod-doctor --json
```

The installed CLI version and `/healthz` version must match the package just published.

## Session Repair

Run a read-only audit first:

```sh
clawdad sessions-doctor --json
```

If `activeBlockerCount` is nonzero, repair safely:

```sh
clawdad sessions-doctor --repair --json
```

The repair path must stay non-destructive. It may quarantine invalid sessions, clear stale active pointers, reset stale failed mailboxes, or disable lanes pointing at quarantined sessions. It must not reuse quarantined sessions or assign a Codex session from another project.

## Tailscale Dispatch Smoke

Use a tiny, no-edit prompt against a known active Codex session:

```sh
curl -sS -X POST http://127.0.0.1:4477/v1/dispatch \
  -H 'Content-Type: application/json' \
  -H 'Tailscale-User-Login: <allowed-user>' \
  -d '{"project":"<project-path>","sessionId":"<session-id>","message":"Health check only: reply with exactly OK. Do not edit files or run tools.","wait":false,"dispatchMode":"linear"}'
```

A successful accepted response must include `requestId`. If `handoffPending` is true, the app should keep the card in `Starting` and reconcile through status/read polling.

## Common Failure Shapes

- Source tests pass but the app still behaves old: reinstall the package, restart the LaunchAgent, and verify `/healthz`.
- `sessions-doctor` has historical issues but `activeBlockerCount` is zero: the app is not actively blocked, but cleanup is still owed.
- `/v1/dispatch` accepts a message without a request id: this is a release blocker.
- `/v1/projects` fails while `/healthz` passes: check auth headers, Tailscale identity, and the server config allowlist.
