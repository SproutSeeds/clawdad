# clawdad

Multi-agent orchestration CLI for managing AI coding agent sessions across projects.
Uses ORP (Open Research Protocol) as the canonical data store.

## Architecture

Hub-and-spoke model:
- Hub: the user or a top-level Claude/Codex session
- Spokes: per-project AI agent sessions with persistent session IDs
- Registry: ORP workspace tabs (source of truth for projects, sessions, providers)
- State: `~/.clawdad/state.json` (local dispatch stats — counts, timestamps, status)
- Communication: file-based mailboxes at `<project>/.clawdad/mailbox/`

## Language and Tools

- Primary: zsh scripts
- JSON manipulation: jq
- Registry backend: orp CLI (`orp workspace tabs/add-tab/remove-tab`)
- Agent providers: claude CLI, codex CLI (provider-agnostic dispatch)
- Background processes: tmux (for watch daemon)
- Locking: mkdir-based lockfiles
- Logging: ~/Library/Logs/clawdad.log

## File Layout

- `bin/clawdad` — Main CLI entrypoint. Sources lib/*.sh files.
- `lib/common.sh` — Constants, ORP integration, path resolution, validation.
- `lib/log.sh` — Timestamped logging helpers.
- `lib/registry.sh` — ORP-backed registry with local dispatch state (state.json).
- `lib/mailbox.sh` — Per-project mailbox init, read, write.
- `lib/dispatch.sh` — Provider-agnostic dispatch (Claude + Codex).
- `lib/watch.sh` — Polling watcher loop + tmux daemon.

## Key Patterns

- ORP workspace tabs are the single source of truth for project registration
- All subcommands accept slug (tab title) or full path for project identification
- Dispatch uses `--session-id` on first call, `--resume` on subsequent calls
- Provider is read from ORP tab's `resumeTool` field (claude or codex)
- Background dispatch runs as a subshell, not a tmux session per dispatch
- Watch daemon runs as a single tmux session "clawdad-watch"
- Default `--permission-mode plan` (spokes plan, hub reviews)

## Provider Dispatch

| | Claude | Codex |
|---|---|---|
| Non-interactive | `claude -p "msg" --resume <id>` | `codex -q --prompt "msg" --session <id>` |
| Permission | `--permission-mode plan` | `--approval-mode suggest` |
| Output | JSON (parsed with jq) | Plain text |
