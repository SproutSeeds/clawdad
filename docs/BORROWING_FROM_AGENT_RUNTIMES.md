# Borrowing From Agent Runtimes

Clawdad's core product stance is one front door for agent-operated work.
The operator should not need to remember which model, gateway, terminal,
messaging app, or hosted runner owns a task. They enter through Clawdad,
choose the project/session, dispatch the request, and read or steer the result.

Hermes Agent, OpenClaw, and similar always-on personal-agent runtimes are useful
reference systems, but they should not become parallel sources of truth. Borrow
their good ideas only when the result still collapses back into the Clawdad and
ORP model:

```text
Clawdad = entry point and operator surface
ORP = workspace ledger, routing state, agenda, governance, and checkpoints
Codex / Hermes / Claude / OpenCode / other agents = replaceable execution backends
Telegram / iMessage / web / CLI = replaceable transports into Clawdad
```

## Ideas Worth Studying

- Gateway setup: make mobile and messaging access easy without forcing users to
  understand daemons, tunnels, webhooks, or service files.
- Messaging transports: support Telegram, iMessage, Discord, Slack, or similar
  surfaces as ways to reach Clawdad, not as separate work queues.
- Skills: use small, documented capability packs for safe Clawdad and ORP
  operations such as listing projects, dispatching, reading status, and
  inspecting agendas.
- Background notifications: report long-running task completion, failure, or
  "still working" state without manual polling.
- Provider abstraction: let a project session use the right backend while the
  operator still sees one project/session model.
- Subagent delegation: study isolated worker patterns for research, review, or
  implementation, while preserving Clawdad's project bucket and ORP routing
  records.
- Local dashboards: borrow clarity from web dashboards, but keep Clawdad as the
  canonical surface instead of adding a competing app identity.
- Backup and migration: make it easy to move Clawdad state, project summaries,
  and ORP-linked session metadata between machines.
- Security defaults: preserve allowlists, private tunnels, scoped credentials,
  sandboxed backends, and explicit approval boundaries for anything reachable
  from a phone or public messaging service.

## Non-Goals

- Do not make Hermes, OpenClaw, or any other runtime the canonical workspace.
- Do not let a messaging platform own durable project state.
- Do not create a second agenda, project ledger, or session registry outside ORP.
- Do not expose broad shell or filesystem access through a remote chat surface
  without a narrow trust boundary and clear operator approval model.

## Investigation Shape

The best first experiment is a read-first adapter:

1. Route a message from a mobile or messaging surface into Clawdad.
2. Let Clawdad read ORP-backed project/session state.
3. Dispatch to one existing repo-attached agent session.
4. Return status and final output through the same Clawdad queue.

Only after that loop works should we evaluate deeper borrowing, such as
multi-provider dispatch, skill installation, background process notifications,
or Hermes/OpenClaw-style gateway setup flows.
