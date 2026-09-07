# ClawDad Assistant

Authorized September 7, 2026. Native Mac and iPhone feature; private application scope.

## Behavior

- One persistent Assistant conversation per paired Mac, available from the main ClawDad screen and Remote Assist's headset button. Visible Back returns to the previous space; leaving a screen does not end a voice conversation.
- Reuse the configured local STT and TTS models and voice selection. Codex supplies reasoning through a visible, dedicated Terminal CLI session. No SignalWire, phone-number provisioning, cloud speech model, or app-server task dispatch.
- Reuse Remote Assist's real window/tab catalog, native identities, ordering, activity signals, focus checks, text insertion, Enter, and response reading. Directory labels are display metadata, never identity.
- The coordinator gets tools for inventory, context, targeted prompt delivery, focus, reorder/close, and desktop interaction. Tasks go to existing Terminal agent prompts. Busy tabs queue work; existing drafts and changed focus stop insertion. Delivery receipts prevent a retry from submitting twice.
- Display exact sent prompts and destinations. Observe actual CLI transcript lifecycle events for progress/completion. Keep discussion and approved execution distinct through the coordinator's visible instructions.
- Local durable conversation, queue, and delivery ledger survive navigation and host restart. Interrupted or uncertain input is surfaced for inspection rather than automatically replayed.
- A separate authenticated WebRTC data connection carries chat and speech without screen capture; existing signed pairing/ICE signaling and TURN budget gates are reused. Mac speech endpoints stay authenticated and local.
- Conversation audio has explicit listening/mute/end controls, utterance detection, interruption, and ownership separate from one-shot dictation/read-aloud.

## Verification and delivery

- Exercise persistence, deduplication, busy queues, stale identities, draft preservation, reconnects, transcript attribution, bounded transport and local-only speech with deterministic tests.
- Build native Mac and iPhone targets; inspect the new navigation visually with fixtures.
- Real Terminal automation and physical iPhone audio are separate acceptance checks; do not label fixture or simulator results as physical-device proof.
- Preserve the eight pre-existing classified dirty groups (release skills/scripts, plugin manifest, artwork exploration and marketing site). Stage only this feature's audited paths.
