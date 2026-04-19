# Chimera Local Lane

Clawdad can track sessions that use Chimera instead of Codex. This is the
local-first lane for experimenting with Ollama-backed models while keeping the
same Clawdad project picker, mailbox, history, and mobile dispatch flow.

## Setup

Install Chimera and Ollama:

```bash
npm install -g chimera-sigil
ollama pull qwen3:4b
```

If you are developing Chimera from a sibling checkout at `../Chimera`, Clawdad
auto-detects `target/debug/chimera` when the `chimera` command is not on `PATH`.
You can also point Clawdad at a specific binary:

```bash
export CLAWDAD_CHIMERA=/Volumes/Code_2TB/code/Chimera/target/debug/chimera
```

Clawdad defaults Chimera sessions to the `local` profile. Override that default
when you want a coding model:

```bash
export CLAWDAD_CHIMERA_MODEL=local-coder
```

For a Mac fallback plus 4090 workstation setup, keep the default model small and
add a workstation Ollama endpoint. Clawdad only injects this endpoint for 24 GB,
GPU, workstation, or 4090 profiles:

```bash
export CLAWDAD_CHIMERA_MODEL=local
export CLAWDAD_CHIMERA_LOCAL_OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
export CLAWDAD_CHIMERA_4090_OLLAMA_BASE_URL=http://192.168.1.162:11434/v1
```

Then use `--model local-coder-4090` for coding runs on the workstation and
`--model local` for the Mac Studio fallback.

Run the local-lane doctor before dispatching:

```bash
clawdad chimera-doctor
clawdad chimera-doctor --model local-coder
clawdad chimera-doctor --model local-coder-4090
```

## Register a Chimera Session

```bash
clawdad register ~/code/my-project --provider chimera
clawdad dispatch my-project "Summarize this repo using local models." --wait
```

You can also choose **Chimera local** in the mobile add-project flow. The project
will appear beside Codex-backed projects, but its provider label will be
`chimera`.

## Model Profiles

Useful starting profiles:

- `local`: `qwen3:4b`, the default laptop-friendly model
- `local-tiny`: `llama3.2:1b`, the lowest-memory fallback
- `local-coder-small`: `qwen2.5-coder:3b`, lightweight coding
- `local-coder`: `qwen2.5-coder:7b`, stronger local coding on 16GB+ machines
- `local-balanced`: `qwen3:8b`, stronger general work

Pull the model that a profile resolves to before using it:

```bash
ollama pull qwen2.5-coder:7b
clawdad dispatch my-project "Review this module." --model local-coder
```

## Permission Modes

Clawdad passes Chimera permission modes through directly:

- `plan`: default, conservative prompt-mode behavior
- `approve`: allow workspace writes while denying shell execution
- `full`: allow all Chimera tools

For mobile dispatches, Chimera sessions default to the conservative lane unless
the request explicitly includes a permission mode.

## Current Boundaries

- Chimera-backed ordinary dispatch is supported.
- Chimera-backed project summaries use Chimera when the active session is
  Chimera.
- Autonomous delegate mode is still Codex-first until Chimera has enough local
  harness reliability for long-running work.
- If Ollama is not running or a model is missing, Clawdad surfaces an actionable
  error and points back to `clawdad chimera-doctor`.
