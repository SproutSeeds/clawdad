<!-- BEGIN CLAWDAD CODEX INTEGRATION -->
## Clawdad + Codex

- Treat Clawdad as the orchestration layer: one supervisor process steers one delegate session, while Watchtower supplies review signals.
- Use `clawdad delegate-run <project>` or `clawdad go <project>` for one bounded run; use `clawdad supervise <project> --lane <laneId> --daemon` for continuous delegation that restarts from completed `nextAction` values.
- Before saying a lane is running, verify lane enabled/running state, live supervisor, active request id, running mailbox with a fresh heartbeat, live worker/app-server process, and active/synced Codex goal when goal sync is required.
- Use Clawdad skills for Clawdad-specific workflows instead of packing long workflow rules into every prompt.
- Use hooks as deterministic guardrails and telemetry. They should record context, enrich approvals, and block only hard-risk tool actions.
- Soft Watchtower findings should become corrective next-step prompts. Only hard stops should pause the work: patient data, medical advice, outreach, money, credentials, legal/regulatory/human gates, and compute exhaustion.
- When Clawdad state looks wrong, run `clawdad codex doctor .` and `clawdad sessions-doctor --repair` before inventing a new session model.
<!-- END CLAWDAD CODEX INTEGRATION -->
