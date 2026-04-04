# clawdad

<p align="center">
  <img src="assets/clawdad-mascot.jpg" alt="clawdad mascot" width="300">
</p>

Multi-agent orchestration CLI for AI coding agents. Manages persistent spoke agents across your projects from a single hub, using [ORP](https://github.com/open-research-protocol/orp) as the canonical data store.

Provider-agnostic — works with both Claude and Codex.

## Install

```bash
npm install -g clawdad
clawdad init
```

## Quick Start

```bash
# Register a project (adds an ORP tab with a persistent session ID)
clawdad register /path/to/my-project --provider claude

# Dispatch a task to its spoke agent (runs non-interactively in background)
clawdad dispatch my-project "What's the architecture of this project?"

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
| `clawdad status [slug]` | Show status of projects |
| `clawdad list` | List registered projects (from ORP) |
| `clawdad read <slug>` | Read latest response from a spoke |
| `clawdad watch` | Monitor mailboxes for responses |
| `clawdad serve` | Run a secure HTTP listener for remote/iPhone entrypoints |
| `clawdad gen-token --write` | Generate and store a bearer token for the listener |
| `clawdad install-launch-agent` | Install a macOS launchd plist for always-on listening |

## How It Works

1. **Register** a project — clawdad calls `orp workspace add-tab` to store the project path, provider, and session ID in your ORP workspace
2. **Dispatch** a message — clawdad reads the session from ORP, builds the non-interactive CLI command for the right provider, and runs it in the background
3. **Respond** — the spoke agent processes the request and its output is captured to `.clawdad/mailbox/response.md`
4. **Read** — you (or the hub agent) read the response when ready

Each spoke agent accumulates context over time via session resume, so it develops deep knowledge of its project.

## Architecture

```
ORP workspace (source of truth)
  └── tabs[] — project path, resumeTool, resumeSessionId

~/.clawdad/
  └── state.json — dispatch counts, timestamps, status

<project>/.clawdad/
  └── mailbox/
      ├── request.md      # Latest request from hub
      ├── response.md     # Latest response from spoke
      └── status.json     # idle | running | completed | failed
```

## Providers

clawdad dispatches to the right CLI based on the ORP tab's `resumeTool`:

| Provider | Interactive (human) | Non-interactive (clawdad) |
|----------|-------------------|--------------------------|
| Claude | `claude --resume <id>` | `claude -p "msg" --resume <id> --output-format json` |
| Codex | `codex resume <id>` | `codex -q --prompt "msg" --session <id>` |

## Requirements

- zsh
- node >= 18
- jq
- orp CLI (workspace tab management)
- claude CLI and/or codex CLI
- tmux (for watch daemon mode)

## Home Server Listener

For an always-on private entrypoint, run `clawdad` as a small authenticated HTTP service on your home machine.

### 1. Generate a token

```bash
clawdad gen-token --write
```

By default this writes a bearer token to `~/.clawdad/server.token`.

### 2. Install the always-on listener

```bash
clawdad install-launch-agent --default-project my-project
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sproutseeds.clawdad.server.plist
launchctl kickstart -k gui/$(id -u)/com.sproutseeds.clawdad.server
```

That launch agent runs:

```bash
clawdad serve --host 127.0.0.1 --port 4477 --token-file ~/.clawdad/server.token --default-project my-project
```

### 3. Send a message into Clawdad

```bash
curl -X POST http://127.0.0.1:4477/v1/dispatch \
  -H "Authorization: Bearer $(cat ~/.clawdad/server.token)" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What changed in this repo today?",
    "wait": true,
    "timeout": 120
  }'
```

The listener also exposes:

- `GET /healthz`
- `GET /v1/list`
- `GET /v1/status?project=<slug>`
- `GET /v1/read?project=<slug>&raw=1`

### iPhone Shortcut Path

The easiest private MVP is:

1. Run `clawdad serve` on your home machine.
2. Put the machine behind Tailscale or another private network tunnel.
3. Create an iPhone Shortcut that sends `POST /v1/dispatch` with your bearer token.
4. Add that Shortcut to your home screen as your Clawdad app icon.

If you bind the listener to anything other than `127.0.0.1`, treat the bearer token like a password and prefer an encrypted private network path.
