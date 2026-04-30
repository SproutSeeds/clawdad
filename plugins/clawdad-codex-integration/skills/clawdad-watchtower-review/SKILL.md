---
name: clawdad-watchtower-review
description: Use when interpreting Clawdad Watchtower review cards, especially soft versus hard findings in enforce mode.
---

<!-- Managed by Clawdad Codex Integration. -->

Review Watchtower output as policy signal.

Classify findings this way:

1. Hard stop: patient data, medical advice, outreach, money, credentials, legal/regulatory/human gate, or compute exhaustion.
2. Corrective soft finding: validation failure, hygiene repair, unknown review card, unvalidated large diff, or state drift.
3. Informational finding: healthy progress, validated checkpoint, summary-only event.

For hard stops, preserve the pause and explain the gate.
For soft findings, produce the next corrective prompt for the delegate.
