---
name: clawdad-session-doctor
description: Use when diagnosing Clawdad/Codex project session IDs, imported sessions, stale active pointers, quarantines, and delegate lane bindings.
---

<!-- Managed by Clawdad Codex Integration. -->

Diagnose Clawdad session state with the registry as the source of truth.

Steps:

1. Run or inspect `clawdad sessions-doctor [project] --json`.
2. Check active session IDs, provider metadata, imported Codex sessions, quarantined sessions, and delegate lane bindings.
3. Prefer non-destructive repair with `clawdad sessions-doctor --repair`.
4. Do not reuse quarantined or non-native Codex IDs.
5. After repair, verify the active session points at a real provider session for the project path.
