# clawdad

<p align="center">
  <img src="assets/clawdad-readme-carousel.gif" alt="Clawdad carousel" width="420">
</p>

Multi-agent orchestration CLI for AI coding agents. Manages persistent spoke agents across your projects from a single hub, using [ORP](https://orp.earth) as the canonical data store.

Provider-agnostic — works with Claude, Codex, and Chimera.

## Install

```bash
npm install -g clawdad
clawdad init
```

## Quick Start

```bash
# Register a project bucket with an initial tracked session
clawdad register /path/to/my-project --provider claude

# Dispatch to the active session inside that project bucket
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
| Claude | `claude --resume <id>` | `claude -p "msg" --resume <id> --output-format json` |
| Codex | `codex resume <id>` | `codex exec "msg"` on first dispatch, then `codex exec resume <id> "msg"` |
| Chimera | `chimera --resume <id>` | `chimera --prompt "msg" --resume <id> --json` after Clawdad seeds and maintains the session file |

## Requirements

- zsh
- node >= 18
- jq
- orp CLI (workspace tab management)
- claude CLI and/or codex CLI and/or chimera CLI
- tmux (for watch daemon mode)

## Secure Self-Hosted Setup

The recommended deployment is:

1. `clawdad serve` listens on `127.0.0.1` only.
2. `tailscale serve` exposes a private HTTPS URL to your tailnet.
3. `clawdad` trusts Tailscale identity headers only on loopback requests.
4. Your iPhone Shortcut calls the private tailnet URL instead of a public endpoint.

That keeps the listener off the public internet and avoids a shared bearer token in the main path.

### 1. Bootstrap the secure listener

```bash
clawdad secure-bootstrap --default-project my-project --apply-serve
```

That command:

- writes `~/.clawdad/server.json`
- writes an iPhone Shortcut request template
- writes a macOS launch agent on macOS
- writes a systemd user unit on Linux
- optionally runs `tailscale serve --bg` for you when `--apply-serve` is set

If you want to allow more than one Tailscale user:

```bash
clawdad secure-bootstrap \
  --default-project my-project \
  --allow-user alice@example.com \
  --allow-user bob@example.com \
  --apply-serve
```

If you want an extra application-layer permission gate, require a Tailscale app capability:

```bash
clawdad secure-bootstrap \
  --default-project my-project \
  --require-capability example.com/cap/clawdad-dispatch \
  --apply-serve
```

### 2. Start the always-on listener

On macOS, bootstrap writes a launch agent. Start it with:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sproutseeds.clawdad.server.plist
launchctl kickstart -k gui/$(id -u)/com.sproutseeds.clawdad.server
```

On Linux, bootstrap writes a user unit. Start it with:

```bash
systemctl --user daemon-reload
systemctl --user enable --now clawdad-server.service
```

If you do not use `--apply-serve`, `secure-bootstrap` prints the exact `tailscale serve` command to run.

### 3. Verify the deployment

```bash
clawdad secure-doctor
```

The doctor checks:

- localhost-only binding
- auth mode
- Tailscale status
- Tailscale Serve forwarding
- shortcut template presence
- local listener health

### 4. Wire up the iPhone Shortcut

`secure-bootstrap` writes a request template to `~/.clawdad/shortcuts/dispatch-request.json` with the private tailnet URL, request body, and follow-up endpoints.

The secure request flow is:

```bash
curl -X POST https://YOUR-DEVICE.YOUR-TAILNET.ts.net/v1/dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "project": "my-project",
    "message": "What changed in this repo today?",
    "wait": true
  }'
```

No bearer token is required in the recommended Tailscale path. Authentication comes from your tailnet identity and optional app capabilities.

For remote Codex dispatches, Clawdad now defaults to `permissionMode=approve` unless you override it in the request body. That keeps mobile/server Codex sessions in workspace-write mode with network access instead of silently falling back to read-only planning mode.

The listener exposes:

- `GET /` mobile web app for iPhone/home-screen use
- `GET /healthz`
- `GET /v1/whoami`
- `GET /v1/projects`
- `GET /v1/project-roots`
- `POST /v1/projects`
- `POST /v1/active-session`
- `POST /v1/dispatch`
- `GET /v1/list`
- `GET /v1/status?project=<path-or-slug>`
- `GET /v1/read?project=<path-or-slug>&raw=1`

### 5. Open the built-in front end

Once `tailscale serve` is active, open your private tailnet URL in Safari:

```text
https://YOUR-DEVICE.YOUR-TAILNET.ts.net/
```

The root URL now serves a mobile-first Clawdad web app with:

- project picker
- add-project flow for choosing an existing repo under an allowed root or creating a new repo inside that root
- plain-language message composer
- session switching inside the selected project bucket
- chat-thread viewer for the selected session with lazy-loaded history
- collapsible cross-project work queue
- a manifest/apple-touch-icon path so you can add it to your iPhone home screen

The API routes still remain available underneath the same origin for Shortcuts and automation.

## Legacy Token Listener

The original token-based listener still works for local-only or transitional setups:

```bash
clawdad gen-token --write
clawdad serve --auth-mode token --host 127.0.0.1 --port 4477
```

If you use token auth remotely, keep the listener on `127.0.0.1` and place it behind an encrypted private tunnel.

## Codex Session Notes

Clawdad now treats each directory as a project bucket with one active tracked session:

- Claude is usually a single-session-per-directory experience.
- Codex can expose multiple tracked sessions inside the same directory.
- Chimera follows the same bucket/session model as it matures.

The main mobile flow stays simple: pick the project bucket, write the message, send. Session switching is a secondary control.

For mobile project setup, Clawdad now supports two safe paths under allowed top-level roots:

- choose an existing repo that already lives under an allowed root
- create a new repo directory under an allowed root, then attach a fresh tracked session

If the chosen repo is already tracked, Clawdad adds a new session to that project bucket instead of creating a duplicate project entry.

For Codex-backed projects, the first `clawdad dispatch` starts with `codex exec`, captures the real Codex thread id from the CLI output, and writes that id back into the tracked ORP tab. After that, later dispatches resume the same Codex thread automatically with `codex exec resume <id>`.

Permission modes map to Codex sandbox behavior like this:

- `plan` -> `sandbox_mode="read-only"` with no network access
- `approve` -> `sandbox_mode="workspace-write"` with network access enabled for unattended remote work
- `full` -> `sandbox_mode="danger-full-access"`

## Chimera Session Notes

For Chimera-backed projects, Clawdad seeds a real Chimera session on first use, then dispatches future requests through `chimera --prompt --resume <id> --json`. Because Chimera does not yet expose a noninteractive middle approval mode, `approve` and `full` currently map to `--auto-approve`, while `plan` runs without auto-approve and relies on Chimera denying gated tools when stdin is closed.
