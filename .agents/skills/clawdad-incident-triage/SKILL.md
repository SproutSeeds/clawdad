---
name: clawdad-incident-triage
description: Use when Clawdad failures, repeated failed messages, Watchtower pauses, session import issues, or delegate stalls need root-cause triage.
---

<!-- Managed by Clawdad Codex Integration. -->

Triage Clawdad incidents from signals to root cause.

Steps:

1. Capture the exact failed command, project path, session ID, run ID, lane ID, and timestamp.
2. Inspect Clawdad state, delegate status, mailbox status, Watchtower feed, and recent run events.
3. Separate transport/session binding failures from delegate semantic failures.
4. Check whether a soft Watchtower finding was incorrectly treated as a pause.
5. Apply the smallest generalized fix and add regression coverage.
6. Verify the fix with doctor commands and a targeted live or test run.
