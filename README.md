# clawdad

<p align="center">
  <img src="assets/clawdad-mascot.jpg" alt="clawdad mascot" width="300">
</p>

Multi-agent orchestration CLI for AI coding agents. Manages persistent spoke agents across your projects from a single hub, using [ORP](https://github.com/open-research-protocol/orp) as the canonical data store.

Provider-agnostic — works with both Claude and Codex.

## Install

```bash
ln -sf /Volumes/Code_2TB/code/clawdad/bin/clawdad ~/bin/clawdad
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
- jq
- orp CLI (workspace tab management)
- claude CLI and/or codex CLI
- tmux (for watch daemon mode)
