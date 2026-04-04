# .clawdad

This directory is managed by [clawdad](https://github.com/SproutSeeds/clawdad) — a multi-agent orchestration CLI for Claude Code.

## What's here

- `mailbox/request.md` — The latest request dispatched to this project's spoke agent
- `mailbox/response.md` — The latest response from this project's spoke agent
- `mailbox/status.json` — Machine-readable dispatch state (idle, running, completed, failed)

## Should I commit this?

Generally no. Add `.clawdad/` to your `.gitignore`. The mailbox is ephemeral coordination state, not source code.
