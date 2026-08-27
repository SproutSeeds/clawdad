# ClawDad

<p align="center">
  <img src="assets/clawdad-readme-carousel.gif" alt="ClawDad carousel" width="420">
</p>

Multi-agent orchestration CLI for AI coding agents. Manages persistent spoke agents across your projects from a single hub, using [ORP](https://orp.earth) as the canonical data store.

Codex-first orchestration for OpenAI-powered coding work, with Chimera still available as an experimental path.

ClawDad's product line is one front door for agent-operated work. Hermes Agent,
OpenClaw, and other always-on agent runtimes are useful systems to study, but
ClawDad should borrow their gateway, skills, notification, and backend ideas
without letting them become parallel sources of truth. See
[Borrowing From Agent Runtimes](docs/BORROWING_FROM_AGENT_RUNTIMES.md).

<p align="center">
  <img src="assets/clawdad-mobile-demo.gif" alt="ClawDad mobile app selecting a project and dispatching a message" width="340">
</p>

## Native Mac Shell

ClawDad is moving to a local-first native Mac shell. The current Swift/AppKit
shell lives in `native/macos`: it supervises a loopback `clawdad serve`
process, loads the web UI in `WKWebView`, stores the native app token in
Keychain, and exposes the macOS folder picker to the web UI.

```bash
npm run native:build
npm run native:run
npm run native:release
```

Customer builds are signed with Developer ID, notarized and stapled by Apple,
and updated through an EdDSA-signed Sparkle feed. See
[Mac Distribution](docs/mac-distribution.md) for install, permission, update,
diagnostic, and release verification details.

Desktop usage is local-first. The native iPhone companion uses ClawDad Cloud;
Tailscale remains an optional legacy/development transport.

## iPhone Companion

ClawDad now has an iPhone-first companion lane under
`apps/ios/ClawDadMobile`. The app talks to ClawDad Cloud over HTTPS/WebSocket,
while the Mac stays the execution authority through `clawdad cloud-host`.

```bash
npm run ios:generate
npm run ios:build
npm run cloud:deploy:staging
clawdad cloud-host
```

For the current internal TestFlight lane, use bundle id
`earth.frg.clawdad.ios`, product name `ClawDad`, version `0.7.0`, build `16`.
The iPhone app pairs by scanning the Pair iPhone QR from desktop Settings, then
sends signed messages through the cloud relay back to the Mac host.

## Install

Before you start:

- install [ORP](https://orp.earth) >= 0.4.27, `jq`, `sqlite3`, and the `codex` CLI
- install [Tailscale](https://tailscale.com/download) on your Mac and phone if you want the private mobile app

```bash
npm install -g clawdad
clawdad init
```

## Fastest Secure Setup

1. Sign into Tailscale on your Mac and your phone.
2. Register a repo with the provider you want to use.
3. Bootstrap the private listener.
4. Start the service once.
5. Open the private tailnet URL on your phone.

```bash
# Register a project bucket with its first tracked session
clawdad register ~/code/my-project --provider codex

# Write the secure listener config, shortcut template, and service file
clawdad secure-bootstrap --default-project my-project --apply-serve

# Start it once on macOS
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sproutseeds.clawdad.server.plist
launchctl kickstart -k gui/$(id -u)/com.sproutseeds.clawdad.server

# Or start it once on Linux
systemctl --user daemon-reload
systemctl --user enable --now clawdad-server.service

# Verify the deployment
clawdad secure-doctor
```

Then open:

```text
https://YOUR-DEVICE.YOUR-TAILNET.ts.net/
```

`secure-bootstrap` usually infers your current Tailscale login automatically. Add the app to your iPhone home screen if you want it to feel native.

For a small single-host setup, the device URL is enough. For a team or hosted
setup that should keep a stable phone URL, use a durable Tailscale Service URL
such as:

```text
https://clawdad.YOUR-TAILNET.ts.net/
```

That durable route still stays private to your tailnet. Team members only need
Tailscale connected on their phone and the Clawdad URL; the host/admin owns the
service process and routing setup. See
[Tailscale Live Services](docs/tailscale-live-services.md) for the tagged
service-host pattern.

If you ever just want the local CLI and not the phone app yet, you can stop after `clawdad register`.

## What You Get

- project picker
- session picker
- add-project flow for existing repos or new repos under allowed roots
- per-session thread viewer with lazy-loaded history
- cross-project queue for in-flight and completed work
- saved project summary snapshots with manual refresh
- server-backed quick prompts that append reusable text into the composer
- ClawDad local speech, with speaker, pause, stop playback, and composer dictation controls
- Codex delegate mode with semantic hard stops and a weekly compute reserve guard

Tap the summary icon beside the project picker to open the latest saved snapshot or request a fresh one.

The quick prompt button beside Send opens editable preset prompts. Selecting a
prompt appends its text to the current composer message instead of replacing it;
custom prompts are saved in Clawdad state and can be edited later.

Completed agent responses and sent message cards prepare local text-to-speech
audio in the background. The speaker icon plays the prepared WAV immediately
when audio is ready, switches to pause during playback, and shows a stop control
beside it. If audio is still being prepared, the same control keeps polling the
ClawDad speech status and starts playback when the audio becomes ready. By
default ClawDad uses the local speech sidecar directly for Kokoro TTS and Whisper
STT, while preserving the older Doc Reader library route as a compatibility
source:
`CLAWDAD_TTS_PROVIDER=doc-reader`,
`CLAWDAD_DOC_READER_URL=http://127.0.0.1:8766`,
`CLAWDAD_DOC_READER_TTS_ENGINE=kokoro`,
`CLAWDAD_DOC_READER_TTS_FALLBACK_URL=http://127.0.0.1:8772`,
`CLAWDAD_STT_PROVIDER=doc-reader`, and
`CLAWDAD_DOC_READER_STT_URL=http://127.0.0.1:8772`, with
`CLAWDAD_DOC_READER_STT_FALLBACK_URL=http://127.0.0.1:8766` for older local
web installs.
The `doc-reader` provider token is still accepted for existing configs, but the
desktop experience treats speech as ClawDad local speech. Legacy generated WAV
parts under `.clawdad/audio/messages/` remain playable for old history entries.
OpenAI speech helpers are retained only for legacy cached audio and low-level
compatibility tests.

## CLI Quick Start

```bash
# Dispatch to the active session inside a tracked project bucket
clawdad dispatch my-project "What's the architecture of this project?"

# Inspect or switch tracked sessions for that directory
clawdad sessions my-project
clawdad use-session my-project "my-project (2)"

# Check status
clawdad status

# Read the response
clawdad read my-project
```

## Commands

| Command | Description |
|---------|-------------|
| `clawdad init` | Initialize ~/.clawdad and verify ORP |
| `clawdad register <path>` | Register a project (writes ORP tab) |
| `clawdad add-session <project>` | Add another tracked session to an existing project bucket |
| `clawdad rename-session <project> <session> <title>` | Rename one tracked session for easier organization |
| `clawdad remove-session <project> <session>` | Remove one tracked session while keeping the project bucket |
| `clawdad unregister <slug>` | Remove a project (removes ORP tab) |
| `clawdad dispatch <slug> "msg"` | Send a message to a spoke agent |
| `clawdad sessions <slug>` | List tracked sessions for a project bucket |
| `clawdad use-session <project> <session>` | Switch the active tracked session for a project bucket |
| `clawdad status [slug]` | Show status of projects |
| `clawdad list` | List registered projects (from ORP) |
| `clawdad read <slug>` | Read latest response from a spoke |
| `clawdad delegate <slug>` | Show the saved delegate brief, plan, status, and guardrails |
| `clawdad delegate-set <slug> ...` | Update the delegate brief or guardrails such as `--compute-reserve-percent 10`, `--direction-check-mode enforce`, or opt-in Watchtower with `--watchtower-review-mode log` |
| `clawdad go <slug>` | Friendly autonomous delegation entrypoint after ORP confirms a safe continuation |
| `clawdad delegate-run <slug>` | Start autonomous Codex delegate mode for a project |
| `clawdad supervise <slug> --lane <laneId>` | Opt into continuity orchestration that restarts bounded delegate runs only after ORP, compute, and direction gates pass |
| `clawdad delegate-pause <slug>` | Pause autonomous delegate mode after the current step |
| `clawdad sessions-doctor [slug]` | Audit stale/quarantined sessions and delegate lanes; add `--repair` for non-destructive cleanup |
| `clawdad codex install [slug|path]` | Install the project-local Codex hooks, skills, plugin, marketplace entry, and AGENTS guidance |
| `clawdad codex doctor [slug|path]` | Audit the Codex integration pack for drift |
| `clawdad watchtower <slug>` | Run the read-only delegation observer sidecar |
| `clawdad watch <slug>` | Friendly alias for `watchtower` when a project is supplied |
| `clawdad feed tail <slug>` | Show recent Watchtower feed events |
| `clawdad feed search <slug> "query"` | Search the local SQLite/FTS delegation feed |
| `clawdad feed review <slug>` | Show queued Watchtower review cards |
| `clawdad watch` | Monitor mailboxes for responses |
| `clawdad serve` | Run a secure HTTP listener for remote/iPhone entrypoints |
| `clawdad secure-bootstrap` | Write the recommended Tailscale-first self-hosted setup |
| `clawdad secure-doctor` | Verify the secure self-hosted deployment end-to-end |
| `clawdad prod-doctor` | Verify the installed live runtime, app asset, Codex integration, and session health |
| `clawdad chimera-doctor` | Verify the local Chimera/Ollama provider lane |
| `clawdad gen-token --write` | Generate and store a bearer token for the listener |
| `clawdad install-launch-agent` | Install a macOS launchd plist for always-on listening |
| `clawdad install-systemd-unit` | Install a Linux systemd user unit for always-on listening |

## How It Works

1. **Register** a project bucket — clawdad stores one ORP tab per tracked session, grouped by project path
2. **Select** an active session — each project bucket keeps one active tracked session at a time
3. **Dispatch** a message — clawdad reads the active session from ORP/state, builds the non-interactive CLI command for the right provider, and runs it in the background
4. **Respond** — the spoke agent processes the request and its output is captured to `.clawdad/mailbox/response.md`
5. **Read** — you (or the hub agent) read the response when ready

Each spoke agent accumulates context over time via session resume, so it develops deep knowledge of its project.

Delegate mode is Codex-first and runs on the same machine as the Clawdad server.
`clawdad go` and `clawdad delegate-run` start one bounded delegate run. That run
may have no step cap and may continue until semantic completion, pause, hard
stop, or compute reserve, but the CLI invocation itself is still a bounded run:
when it returns `completed` with a `nextAction`, continuity is not running unless
a supervisor is active. The default compute reserve is 10%, and you can change it
per project:

```bash
clawdad delegate-set my-project --compute-reserve-percent 10
clawdad go my-project
```

`clawdad go` and `clawdad delegate-run` both ask ORP whether autonomous work is
safe before the delegate loop starts. Clawdad runs `orp hygiene --json`, `orp
project refresh --json`, and `orp frontier preflight-delegate --json` from the
project directory. If ORP reports missing research-system/frontier state,
bootstrap the repo first:

```bash
orp init --research-system --project-startup --current-codex --json
```

If ORP reports unclassified dirty state, no active safe continuation, paid or
human-gated work, or another hard stop, Clawdad prints the ORP reason and leaves
the delegate loop stopped.

`clawdad supervise <slug> --lane <laneId>` is the continuity loop, not
Watchtower and not a replacement for bounded delegate runs. It watches the target
lane status, consumes a completed run's `nextAction`, refreshes the lane
objective, reruns the ORP and compute gates, checks whether the proposed
continuation still matches the lane objective and latest readback, and starts
exactly one new bounded delegate run when safe. Use `--once` for a single
supervisor tick, `--daemon` for a background supervisor, `--interval <seconds>`
for polling, `--max-runs <n>` for a per-invocation cap, and `--dry-run` to
inspect the next decision without starting a worker.

Operational rule: when the desired behavior is "keep working," "run while I am
away," or "continue this ecosystem," use `clawdad supervise <slug> --lane
<laneId> --daemon`, optionally with `CLAWDAD_CODEX_GOALS=required`. Do not report
that a lane is running merely because a bounded `delegate-run` completed. Verify
lane `enabled:true`, lane state `running`, supervisor live, an active request ID,
mailbox state `running`, fresh mailbox heartbeat, a live dispatch worker or
`codex app-server`, and active/synced Codex goal state when goal sync is
required.

The direction check is the first Hermes-inspired supervisor layer. It uses a
compact readback of objective, latest outcome, previous `nextAction`, proposed
`nextAction`, and gate state instead of hydrating another full project transcript.
The default mode is `observe`, which records aligned/caution/pause decisions
without blocking. Set `--direction-check-mode enforce` on a lane when a pause
decision should block restart, or `--direction-check-mode off` when the lane does
not need this readback.

The web app exposes the same control path as **Auto-Claw**. Open a project, click
Auto-Claw, preview the launch checks, then start or stop the supervisor loop from
the project lane. The modal keeps Clawdad as the control plane: launch checks show
the ORP and compute gates before work starts, runtime checks update from worker
status and supervisor events, and the Loop tab shows continuity transitions such
as restart, wait, stop, blocker, and completion.

Watchtower is an optional read-only delegation review sidecar. It watches
delegate run events, ORP continuation/hygiene state, and git status, then appends
structured updates and review cards to `.clawdad/feed/watchtower.sqlite`. It does
not edit, approve, or advance the project unless a delegate lane explicitly opts
into `--watchtower-review-mode enforce`.

In enforce mode, Watchtower hard stops still block the lane, including
credentials, paid/live-order boundaries, patient data, medical advice, outreach,
legal/regulatory gates, explicit human approval, and compute exhaustion. Softer
findings such as failing validation, ORP/catalog drift, hygiene repair, and large
diff checkpoints are converted into the supervisor's next delegate prompt so the
same delegate session repairs or checkpoints the work instead of pausing.

`clawdad codex install <project>` makes the Codex side of a project explicit and
repairable. It writes project-local Codex lifecycle hooks, a small hook runner,
repo-scoped Clawdad skills, a local `clawdad-codex-integration` plugin package,
a repo marketplace entry, and a managed Clawdad block in `AGENTS.md`.

The generated hooks are intentionally narrow: they add compact Clawdad context
on session start, annotate release/publish/privilege actions for review, log
compact tool signals to `.clawdad/codex-hooks/events.jsonl`, and deny only
hard-risk commands such as destructive resets or credential exposure. The
generated skills cover delegate, supervisor, Watchtower review, session doctor,
release, and incident triage workflows so Codex can load those instructions only
when the task calls for them.

Run `clawdad codex doctor <project> --json` to verify hooks, skills, plugin
packaging, marketplace state, `AGENTS.md`, and whether project-local Codex
configuration may still need trust in the user Codex config. On Codex 0.128.0
or newer, delegate lanes also sync a concise app-server thread goal by default;
set `CLAWDAD_CODEX_GOALS=off` to fall back to prompt-only behavior or
`CLAWDAD_CODEX_GOALS=required` to fail dispatch when goal sync is unavailable.
The web app exposes the same check/install flow from the project Codex action.

```bash
clawdad watchtower my-project --once
clawdad feed tail my-project
clawdad feed search my-project "paper fills"
clawdad feed review my-project
```

Review cards are queued for important changes such as active ORP item changes,
checkpoint commits, failing tests, dirty unclassified hygiene, sensitive
broker/payment/credential/live-order file boundaries, readiness claims, paper
results, paid/API entitlement mentions, large diffs, and blocked or paused runs.
The first store is local SQLite with FTS search; embeddings can be layered on
later without changing the observer contract.

If a project uses ORP Frontier additional items, Clawdad checks that queue whenever a delegate marks a run complete. A queued item is activated and becomes the next delegate action instead of ending the run:

```bash
orp frontier additional add-list --id additional-1 --label "Follow-up work"
orp frontier additional add-item --list additional-1 --id item-1 --label "Polish reports"
clawdad delegate-run my-project
```

## Architecture

```
ORP workspace (source of truth)
  └── tabs[] — one tracked session per tab:
      path, title, resumeTool, resumeSessionId

~/.clawdad/
  └── state.json — project-bucket status + active session + per-session stats

<project>/.clawdad/
  └── mailbox/
      ├── request.md      # Latest request from hub
      ├── response.md     # Latest response from spoke
      └── status.json     # idle | running | completed | failed
```

## Providers

clawdad dispatches to the right CLI based on the active session's `resumeTool`:

| Provider | Interactive (human) | Non-interactive (clawdad) |
|----------|-------------------|--------------------------|
| Codex | `codex`, `codex resume <id>`, or the explicit `clawdad codex-cli ...` wrapper | Terminal and Clawdad share one private local app-server writer and the same saved thread |
| Claude Code | `claude` or `claude --resume <id>` | `claude -p --session-id <id>` creates the session on first dispatch, then `claude -p --resume <id>` continues the same session |
| Chimera | `chimera --resume <id>` | `chimera --model local --prompt "msg" --resume <id> --json` after Clawdad seeds and maintains the session file |

Chimera is Clawdad's local-first provider lane. Install `chimera-sigil` or keep a
sibling `../Chimera` checkout, pull an Ollama model, then register or add a
project session with `--provider chimera`. Run `clawdad chimera-doctor` when the
local lane needs a quick health check. See [Chimera Local Lane](docs/chimera-local-lane.md).

## Requirements

- zsh
- node >= 18
- jq
- sqlite3 with FTS5
- orp CLI >= 0.4.27 (workspace tab management and delegate preflight)
- codex CLI
- claude CLI from Claude Code (optional Anthropic provider)
- chimera CLI from `chimera-sigil` (optional local-first provider)
- tmux (for watch daemon mode)

## Secure Setup Notes

- `clawdad serve` stays on `127.0.0.1`.
- `tailscale serve` gives you a private HTTPS URL on your tailnet.
- the recommended path does not need a bearer token
- `secure-bootstrap` writes `~/.clawdad/server.json`, the iPhone Shortcut template, and the OS service file for you
- if you want multiple Tailscale users, add `--allow-user <login>` more than once
- if you skip `--apply-serve`, `secure-bootstrap` prints the exact `tailscale serve` command to run
- durable team URLs can use a tagged Tailscale Service host, for example `svc:clawdad` behind `https://clawdad.YOUR-TAILNET.ts.net`
- do not enable public Funnel unless you explicitly want a public internet surface
- `secure-doctor` also checks node key expiry, local Tailscale CLI/daemon drift, public Funnel exposure, tagged Service readiness, and any sibling app health URLs configured under `tailscale.liveApps`
- `secure-doctor --ensure` runs the shared tailnet startup orchestration check and starts configured dependencies such as Doc Reader before reporting readiness
- `prod-doctor` is the quick production check before or after a release; see [Live Runtime Runbook](docs/live-runtime-runbook.md)
- Project creation initializes local git and makes an initial commit by default through `projectGitAutoInit`.
- Private GitHub remotes for new project creation are enabled with `projectGithubRemote: true`; set `projectGithubOwner` for an organization/user owner and `projectGithubVisibility` when you want to override the default `private` visibility.

The mobile app and automation routes live under the same origin:

- `GET /`
- `GET /v1/whoami`
- `GET /v1/projects`
- `GET /v1/project-roots`
- `GET /v1/project-summary`
- `GET /v1/delegate/feed`
- `GET /v1/delegate/run-log`
- `GET /v1/history`
- `POST /v1/projects`
- `POST /v1/active-session`
- `POST /v1/project-summary`
- `POST /v1/dispatch`
- `GET /v1/status`
- `GET /v1/read`

If you want a local-only or transitional listener instead, token auth still works:

```bash
clawdad gen-token --write
clawdad serve --auth-mode token --host 127.0.0.1 --port 4477
```

If you use token auth remotely, keep the listener on `127.0.0.1` and place it behind an encrypted private tunnel.

## Codex Session Notes

Clawdad now treats each directory as a project bucket with one active tracked session:

- Codex can expose multiple tracked sessions inside the same directory.
- Chimera follows the same bucket/session model as it matures.

The main mobile flow stays simple: pick the project bucket, write the message, send. Session switching is a secondary control.

If a Codex transport or delegate worker dies mid-dispatch, Clawdad quarantines the bad session instead of reusing it. `clawdad sessions-doctor --json` audits every tracked project for stale active pointers, quarantined session bindings, and orphaned delegate lanes; `clawdad sessions-doctor --repair` clears those pointers and marks orphaned delegate runs failed without deleting project files or unknown state.

For mobile project setup, Clawdad now supports two safe paths under allowed top-level roots:

- choose an existing repo that already lives under an allowed root
- create a new repo directory under an allowed root, then attach a fresh tracked session

If the chosen repo is already tracked, Clawdad adds a new session to that project bucket instead of creating a duplicate project entry.

For Codex-backed projects, Clawdad now prefers native repo-attached Codex threads:

- if a repo already has a native saved Codex thread, Clawdad adopts that thread id when you register or add a session
- if a repo has no saved Codex thread yet, the first `clawdad dispatch` creates a real native Codex thread for that repo and writes that thread id back into ORP
- after that, later Clawdad dispatches resume the same saved Codex thread automatically

Clawdad keeps one Codex app-server on the private Unix socket at
`~/.codex/app-server-control/app-server-control.sock`. Terminal Codex and phone
dispatches connect as clients of that one writer, so a phone message appears in
an open Terminal thread and the full exchange remains visible after either
client reconnects. An idle thread starts a normal turn, Direct delivery steers
the active turn when Codex reports that it is steerable, and Queue delivery
stays in Clawdad's durable FIFO until the shared thread is idle. Clawdad then
starts a fully configured turn with its requested working directory, sandbox,
model, effort, attachments, and stable request ID. Atomic local delivery claims
reconcile retries and crashed workers before any message is sent again. Image
attachments stay as local paths on the paired Mac and are consumed by that same
app-server.

The Clawdad listener starts and health-checks this local runtime. Ordinary
`codex` commands discover the default socket; `clawdad codex-cli resume <id>`
forces the shared endpoint when a shell profile or custom Codex option would
otherwise select an embedded server. Inspect it with
`clawdad codex-runtime status --json` or start it on demand with
`clawdad codex-runtime ensure`.

If the Codex runtime cannot start, the Clawdad host stays available for Remote
Assist, pairing, history, and diagnostics while Codex dispatch reports the
runtime fault and the health loop retries locally. The shared WebSocket client
is isolated behind this compatibility mode because Codex currently labels that
transport experimental.

After upgrading from an older Clawdad build, close each already-open legacy
Codex CLI session once and reopen it. Its saved history remains in place, and
the reopened client joins the shared writer. Set
`CLAWDAD_CODEX_APP_SERVER_MODE=isolated` only as an explicit rollback; `auto`
is the default and falls back only when the installed Codex CLI conclusively
lacks Unix-socket app-server support.

Permission modes map to Codex sandbox behavior like this:

- `plan` -> read-only sandbox with no network access
- `approve` -> workspace-write sandbox with network access enabled for unattended remote work
- `full` -> danger-full-access

## Claude Session Notes

For Claude Code-backed projects, Clawdad pre-generates a session UUID at
register time and creates the real Claude session on first dispatch with
`claude -p --session-id <id>`. Later dispatches resume that same session with
`claude -p --resume <id>`. Claude session ids stay stable across resumes, so
the session you drive from your phone is the same one `claude --resume <id>`
opens in a terminal inside that repo.

```bash
clawdad register ~/code/my-project --provider claude
clawdad dispatch my-project "Summarize this repo." --wait
```

Claude sessions are stored by Claude Code under `~/.claude/projects/`, and
ORP tracks them natively with `resumeTool: claude`. Headless dispatches use
your existing Claude Code login and share the same subscription usage pool as
interactive Claude Code work. If the Clawdad service cannot reach your
keychain credentials, mint a token with `claude setup-token` and set
`CLAUDE_CODE_OAUTH_TOKEN` in the service environment.

Permission modes map to Claude Code like this:

- `plan` -> `--permission-mode plan` (read-only analysis)
- `approve` -> `--permission-mode bypassPermissions` for unattended remote work
- `full` -> `--permission-mode bypassPermissions`

Claude Code PreToolUse hooks (such as damage-control allow/deny rules) still
run in every permission mode, so hook-based guardrails remain active even in
`bypassPermissions`. Set `CLAWDAD_CLAUDE_MODEL` to pin a model; by default
dispatches use the account's configured default model.

## Chimera Session Notes

For Chimera-backed projects, Clawdad seeds a real Chimera session on first use,
then dispatches future requests through `chimera --model local --prompt --resume
<id> --json`. `CLAWDAD_CHIMERA_MODEL` defaults to `local`, and one-off dispatches
can still pass `--model local-coder` or any other Chimera/Ollama profile.

Large workstation profiles route to a separate Ollama endpoint when configured.
Set `CLAWDAD_CHIMERA_4090_OLLAMA_BASE_URL` to the OpenAI-compatible Ollama URL on
the 4090 host, preferably through its Tailscale MagicDNS name, then dispatch
with `--model local-coder-4090` or `--model local-4090`. Regular profiles such
as `local` keep using the Mac/local Ollama endpoint.

Permission modes pass through to Chimera: `plan` stays conservative, `approve`
allows workspace writes while denying shell execution, and `full` allows all
Chimera tools.

## Support

Everything here is released for public use. If Clawdad saved you time or you want to keep the work moving, you can [support public FRG releases](https://frg.earth/support?utm_source=readme&utm_medium=repo&utm_campaign=public_work_support&package=clawdad).
