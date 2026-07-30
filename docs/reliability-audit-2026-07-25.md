# ClawDad Reliability Audit - 2026-07-25

## Scope

This audit covered Mac lock and sleep behavior, local and cloud host lifecycle,
iPhone reconnect state, Direct and Queue dispatch semantics, long-running Codex
turns, app-server approvals and connector calls, fresh-thread session rekeys,
production git and deployment workflows, package contents, and physical-device
transport.

## Root Causes

1. App-server messages containing both `id` and `method` were treated only as
   client responses. Server-initiated approval and connector requests could be
   dropped, leaving an otherwise healthy Codex turn waiting indefinitely.
2. Queue used detached per-item workers and a shared lock. Concurrent items
   could race, queued work could be treated as stale after elapsed time, and a
   fresh provisional session ID could survive after Direct created the real
   Codex thread.
3. The cloud host expected relay heartbeats that the deployed worker did not
   answer. The connection therefore recycled roughly every 45 seconds.
4. LaunchAgents survive screen lock, but macOS sleep suspends their processes
   and network sockets. Active dispatches did not hold an idle-sleep assertion.
5. Generated Swift and Xcode build caches were included through package
   subdirectories, expanding the npm package to hundreds of megabytes.

## Remediation

- App-server RPC is bidirectional, including explicit Repo scoped approvals.
- Queue is durable FIFO with one pump per project, stable request IDs, restart
  recovery, serialized admission, and no elapsed-time expiration.
- Provisional Codex sessions record durable aliases that Queue resolves
  immediately before dispatch.
- The relay and host exchange heartbeats; iPhone and host reconnect state is
  based on live transport and host presence.
- Each active dispatch holds `caffeinate -i -w <worker-pid>` on macOS and
  releases the assertion when the worker exits.
- Production work can use Full access while normal work remains Repo scoped.
- Nested npm ignore files exclude generated iOS and macOS build caches.

## Live Evidence

- `npm test`: 330 passed, 0 failed.
- Signed physical iPhone UI smoke: passed on CodyVerse.
- Phone message request `8ac78fd9-becd-42f4-a073-62b50704d990`
  completed in native Codex session
  `019f9bac-f1d9-7ee3-b173-dc81addf0c34` with `IPHONE_CLOUD_DONE`.
- Fresh-thread Direct and Queue smoke completed in order on one rekeyed Codex
  session.
- Active worker exposed a live `PreventUserIdleSystemSleep` assertion and
  released it after completion.
- Cloud and local health endpoints returned healthy; both LaunchAgents were
  running with `KeepAlive` and `RunAtLoad`.
- Casa Turco production recovery merged PR 1 at commit
  `d71c8ad145dea080c004ead6e369f556881178fb`; the Vercel production URL
  returned HTTP 200.
- npm dry-run package: 12,641,741 bytes compressed, 15,514,850 bytes unpacked,
  164 files, and zero `.build` cache entries.
- `git diff --check`: clean.
- Targeted Session Doctor: zero issues for ClawDad and go-to-market.

## Worktree Checkpoint

The checkout was already broadly dirty before this audit. It remains
intentionally dirty and fully classified by `orp hygiene --json`.

Reliability implementation:

- `lib/codex-app-server-dispatch.mjs`
- `lib/dispatch-admission-lock.mjs`
- `lib/dispatch-queue-worker.mjs`
- `lib/dispatch.sh`
- `lib/registry.sh`
- `lib/server.mjs`
- `lib/cloud-host-connector.mjs`
- `lib/cloud-protocol.mjs`
- `cloud/`
- `apps/ios/ClawDadMobile/`

Reliability verification and release boundaries:

- `test/codex-app-server-dispatch.test.mjs`
- `test/registry-local-session.test.mjs`
- `test/server-project-catalog.test.mjs`
- `test/cloud-host-connector.test.mjs`
- `test/cloud-protocol.test.mjs`
- `test/cloud-worker.test.mjs`
- `test/package-assets.test.mjs`
- `apps/ios/ClawDadMobile/.npmignore`
- `native/macos/.npmignore`
- `docs/live-runtime-runbook.md`
- `docs/iphone-companion.md`
- `docs/reliability-audit-2026-07-25.md`

Other modified desktop UI, speech, delegate, metadata, and plugin files were
present in the shared product worktree and must be reviewed as their own
buckets before a release commit. The next checkpoint should stage only an
explicitly audited release path set.

## Residual Inventory

Global Session Doctor still lists four missing historical project directories:
`ai-shorts-studio`, `campus-ready`, `gw2-companion`, and `richboy-tyria`.
They require a user decision to restore or remove their registry entries. They
do not affect the current ClawDad or go-to-market sessions.
