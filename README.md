# clawdad

<p align="center">
  <img src="assets/clawdad-readme-carousel.gif" alt="Clawdad carousel" width="420">
</p>

Multi-agent orchestration CLI for AI coding agents. Manages persistent spoke agents across your projects from a single hub, using [ORP](https://orp.earth) as the canonical data store.

Codex-first orchestration for OpenAI-powered coding work, with Chimera still available as an experimental path.

## Install

Before you start:

- install [ORP](https://orp.earth), `jq`, and the `codex` CLI
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

If you ever just want the local CLI and not the phone app yet, you can stop after `clawdad register`.

## What You Get

- project picker
- session picker
- add-project flow for existing repos or new repos under allowed roots
- per-session thread viewer with lazy-loaded history
- cross-project queue for in-flight and completed work
- saved project summary snapshots with manual refresh

Tap the summary icon beside the project picker to open the latest saved snapshot or request a fresh one.

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
| `clawdad watch` | Monitor mailboxes for responses |
| `clawdad serve` | Run a secure HTTP listener for remote/iPhone entrypoints |
| `clawdad secure-bootstrap` | Write the recommended Tailscale-first self-hosted setup |
| `clawdad secure-doctor` | Verify the secure self-hosted deployment end-to-end |
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
| Codex | `codex` or `codex resume <id>` | Native saved Codex thread created or adopted per repo, then Clawdad resumes that same thread programmatically |
| Chimera | `chimera --resume <id>` | `chimera --prompt "msg" --resume <id> --json` after Clawdad seeds and maintains the session file |

## Requirements

- zsh
- node >= 18
- jq
- orp CLI (workspace tab management)
- codex CLI
- chimera CLI (optional / experimental)
- tmux (for watch daemon mode)

## Secure Setup Notes

- `clawdad serve` stays on `127.0.0.1`.
- `tailscale serve` gives you a private HTTPS URL on your tailnet.
- the recommended path does not need a bearer token
- `secure-bootstrap` writes `~/.clawdad/server.json`, the iPhone Shortcut template, and the OS service file for you
- if you want multiple Tailscale users, add `--allow-user <login>` more than once
- if you skip `--apply-serve`, `secure-bootstrap` prints the exact `tailscale serve` command to run

The mobile app and automation routes live under the same origin:

- `GET /`
- `GET /v1/whoami`
- `GET /v1/projects`
- `GET /v1/project-roots`
- `GET /v1/project-summary`
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

For mobile project setup, Clawdad now supports two safe paths under allowed top-level roots:

- choose an existing repo that already lives under an allowed root
- create a new repo directory under an allowed root, then attach a fresh tracked session

If the chosen repo is already tracked, Clawdad adds a new session to that project bucket instead of creating a duplicate project entry.

For Codex-backed projects, Clawdad now prefers native repo-attached Codex threads:

- if a repo already has a native saved Codex thread, Clawdad adopts that thread id when you register or add a session
- if a repo has no saved Codex thread yet, the first `clawdad dispatch` creates a real native Codex thread for that repo and writes that thread id back into ORP
- after that, later Clawdad dispatches resume the same saved Codex thread automatically

That means later terminal use lines up much better with normal Codex behavior: when you return to that repo and use Codex there, you are looking at the same saved thread world instead of a separate Clawdad-only exec session type.

Permission modes map to Codex sandbox behavior like this:

- `plan` -> read-only sandbox with no network access
- `approve` -> workspace-write sandbox with network access enabled for unattended remote work
- `full` -> danger-full-access

## Chimera Session Notes

For Chimera-backed projects, Clawdad seeds a real Chimera session on first use, then dispatches future requests through `chimera --prompt --resume <id> --json`. Because Chimera does not yet expose a noninteractive middle approval mode, `approve` and `full` currently map to `--auto-approve`, while `plan` runs without auto-approve and relies on Chimera denying gated tools when stdin is closed.
