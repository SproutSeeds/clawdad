# ClawDad Live Runtime Runbook

Use this runbook to inspect and operate a ClawDad runtime. Select the
distribution mode before following a release procedure:

- `native-private` embeds the runtime in the signed Mac app, keeps app services
  on port 4487, and leaves the public npm package, GitHub release assets, and
  public appcast unchanged.
- `public-cli` publishes and globally installs the npm CLI. It requires separate
  release authorization.

## Host Lifecycle

The installed native-private app owns its bundled runtime and cloud connector on
port 4487. Legacy global service labels are disabled in this mode. Locking the
Mac screen leaves the app-managed services and active Codex turns running.

The public CLI lane can instead run the desktop server and cloud host connector
as `launchd` user agents with `RunAtLoad` and `KeepAlive`.

Every active dispatch also owns a macOS idle-sleep assertion through
`caffeinate -i -w <worker-pid>`. The assertion ends with the dispatch and can be
disabled explicitly with `CLAWDAD_PREVENT_IDLE_SLEEP=false`.

Manual sleep, lid-close, shutdown, and loss of power still suspend local work
and networking. After wake, `launchd` restores either service if it exited, and
the cloud host reconnects its outbound WebSocket with backoff. The iPhone should
show `Reconnecting` until the host heartbeat is current; opening the app starts
this connection automatically.

Inspect the native-private runtime first:

```sh
lsof -nP -iTCP:4487 -sTCP:LISTEN
npm run certify:snapshot
```

For the public CLI lane, inspect its legacy agents with:

```sh
launchctl print gui/$(id -u)/com.sproutseeds.clawdad.server
launchctl print gui/$(id -u)/earth.frg.ClawDad.cloud-host
pmset -g assertions
```

## Production Check

Run:

```sh
clawdad prod-doctor --json
```

The production doctor checks the installed binary, package version, service unit, local `/healthz`, served app asset, authenticated projects API, Codex integration, session blockers, and queue worker availability.

Treat failures as release blockers. Warnings are follow-up work unless they involve the selected live project or a broken user-facing flow.

## Native Private Release Gate

Use `docs/paid-beta-runbook.md` and `docs/mac-distribution.md`. Build, sign,
notarize, staple, and install the native Mac artifact locally; upload the iPhone
build only to `ClawDad Internal`. Leave npm, tags, GitHub assets, the public
appcast, the external TestFlight group, and App Store review unchanged.

## Public CLI Release Gate

This section applies only when `public-cli` publication has been separately
authorized.

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

## Local Dispatch Smoke

Use a tiny, no-edit prompt against a known active Codex session:

```sh
curl -sS -X POST http://127.0.0.1:4477/v1/dispatch \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(cat ~/.clawdad/server.token)" \
  -d '{"project":"<project-path>","sessionId":"<session-id>","message":"Health check only: reply with exactly OK. Do not edit files or run tools.","wait":false,"dispatchMode":"direct"}'
```

A successful accepted response must include `requestId`. If `handoffPending` is true, the app should keep the card in `Starting` and reconcile through status/read polling.

## Direct And Queue

`Direct` is the normal send mode. When the selected Codex turn is active,
ClawDad steers the message into that turn after its current tool call and before
the final answer. `Queue` creates a durable FIFO item and starts a new turn only
after the active turn and every earlier queued item have finished.

Queue items live under `<project>/.clawdad/mailbox/queued`. One project pump
owns the queue, one dispatch admission lock prevents concurrent turns, and the
same request ID follows an item from acceptance through mailbox history.
Active queue items survive server restarts and have no wall-clock expiration.

Fresh Codex threads begin with a provisional ClawDad ID. When Codex returns its
real thread ID, the registry records a durable `session_aliases` entry. The
Queue pump resolves this alias immediately before dispatch, so a message queued
during the first turn follows the real thread instead of failing against the
retired provisional ID.

Failed queue items are retained with their error for diagnosis and are never
silently resent after an ambiguous handoff.

## Shared Codex Writer

The production host maintains one local `codex app-server --listen unix://`
process at `~/.codex/app-server-control/app-server-control.sock`. The directory
is mode `0700`; the socket and runtime log are mode `0600`. This is Unix-domain
IPC on the paired Mac and creates no Internet or cellular traffic while idle.

Use these checks during an incident or rollout:

```sh
clawdad codex-runtime status --json
clawdad codex-runtime ensure
clawdad prod-doctor --json
```

Clawdad dispatch and Clawdad-opened Terminal sessions use the shared endpoint.
The `clawdad codex-cli` wrapper forces it for manual Terminal use. A legacy
Codex process opened before this runtime was enabled can retain the old writer
lock; close that Codex session once and reopen it through the shared endpoint.
Never delete or bypass a Codex writer lock.

`CLAWDAD_CODEX_APP_SERVER_MODE=auto` is the default. A supported shared runtime
keeps Codex dispatch fail-closed if startup fails, because silently spawning an
isolated writer would recreate the collision. The rest of the Clawdad host
starts in a degraded state so Remote Assist, pairing, history, health, and
diagnostics remain available while the local health loop retries. `isolated` is
the explicit rollback mode.

Clawdad's existing durable queue remains the ordering authority. Once the
shared thread is idle, the queued worker uses `turn/start` with the Clawdad
working directory, permission sandbox, model, effort, attachments, and stable
request ID. Direct delivery uses `turn/steer` only when the current turn accepts
it; review, compaction, and tool-boundary states defer safely to an idle
fully-configured turn. A per-thread/request atomic delivery claim is held for
the dispatcher lifetime, so a duplicate worker waits and a dead worker is
reconciled through `thread/read` before a retry can send.

## Long-Running Turns

ClawDad has no default wall-clock, turn-idle, tool-idle, heartbeat-age, or native `thread/resume` cutoff for Codex turns. The dispatch worker writes a mailbox heartbeat while its process is alive, and the app-server bridge performs non-prompt `thread/read` liveness probes after a turn starts. If a shared client connection drops, Clawdad reconnects once, resumes the thread, and reconciles the stable request ID before deciding whether the turn completed. A turn fails automatically after a terminal Codex error, an unrecoverable shared-runtime failure, or confirmed worker death. Timeout environment variables remain available for controlled smoke tests, including `CLAWDAD_CODEX_RESUME_TIMEOUT_MS` when a bounded resume is explicitly required.

Provider history reads use a bounded recent transcript window controlled by `CLAWDAD_HISTORY_PROVIDER_TAIL_BYTES` (32 MB by default). This keeps image-heavy Codex compaction records from forcing the server to decode an entire multi-hundred-megabyte JSONL transcript for a phone history page.

## Cloud Connection Check

```sh
clawdad cloud-host --json
curl -fsS https://clawdad-cloud.frg.earth/healthz
tail -f ~/.clawdad/logs/cloud-host.stdout.log
```

The relay sends protocol ping frames and requires matching pong frames instead
of treating an open socket as proof of life. The Mac connector sends host
heartbeats, reconnects after network changes, and remains connected across
screen lock. A phone command is complete only when its request ID reaches a
terminal local mailbox state.

## Access Modes

`Repo scoped` maps to Codex `workspace-write`. It can edit project files, while
Git metadata remains protected by the Codex sandbox. Use `Full access` for
explicit git commit, push, pull-request, release, and production deployment
workflows. App-server approval requests remain bidirectional: ClawDad either
auto-approves according to the selected mode or exposes the pending approval in
the app instead of dropping the request.

## Common Failure Shapes

- Source tests pass but the app still behaves old: reinstall the package, restart the LaunchAgent, and verify `/healthz`.
- `sessions-doctor` has historical issues but `activeBlockerCount` is zero: the app is not actively blocked, but cleanup is still owed.
- `/v1/dispatch` accepts a message without a request id: this is a release blocker.
- `/v1/projects` fails while `/healthz` passes: check the local bearer token or the signed cloud device identity.
- A Queue item fails only on a thread's first turn: inspect `session_aliases` and verify the queued item resolves to the real Codex thread ID.
- The phone says connected but projects are empty: inspect the host heartbeat and signed catalog response before refreshing the UI.
- A casual message receives stale task text: verify the selected project session, then switch away from old delegate/task threads before testing transport.
