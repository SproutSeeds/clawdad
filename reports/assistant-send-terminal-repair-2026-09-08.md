# Assistant voice sending and Terminal draft repair — September 8, 2026

The private release is iPhone **0.7.0 (60)** with Mac **0.7.0 (72)**.
Mac build 72 is installed and healthy. iPhone build 60 is available in
**ClawDad Internal TestFlight**. The existing conversation and all 12 Terminal
tabs were retained.

## Audit and resulting behavior

The reported Terminal failure was reproduced in the Assistant's recorded tool
trace: native `inspect_tab` succeeded for the third tab, then the general
Computer Use plugin rejected `com.apple.Terminal`. The existing `send_to_tab`
tool inserted text and pressed Enter; there was no dedicated insert-only tool.

`insert_in_tab` now uses ClawDad's native Terminal integration. It resolves the
exact tab, checks the owning Codex agent is idle, preserves existing drafts and
modal prompts, and captures the same target identity used by Remote Assist.
It pastes once without Enter, then verifies the complete rendered draft. A
changed target, uncertain paste, or different draft requires inspection instead
of replaying the input. Durable receipt IDs survive retries and restarts.
Insert and submit jobs share FIFO ordering for the same tab. Existing
`send_to_tab` remains the action for inserting and submitting a new task.

The Assistant's MCP descriptions and an owned block in its workspace instructions
explain these native tools. Existing workspace instructions are preserved.
The general Computer Use plugin's restrictions and macOS permissions are
unchanged. Calls continue using the same background conversation.

The black call bar now includes **Send now**. It finishes the current recording,
waits for authoritative transcription, and submits the thought once. Repeated
taps cannot duplicate it. Speech arriving afterward belongs to a separate turn,
even when the earlier transcription or delivery is delayed.

The detector's 0.8-second silence endpoint starts transcription. In automatic
mode, the thought remains open for another 1.2 seconds, allowing transcription
to overlap this pause. Resuming speech during that interval cancels the send
deadline and joins the next segment to the same thought. Send now bypasses the
remaining pause interval. **Wait for Send**, available through the sliders icon
in the Assistant conversation, allows longer pauses and persists on that device.
The conversation shows the pending text as a draft. Replies continue to finish
without microphone interruption; the existing Interject control remains.

Previously, each message called `ensureAssistant`, which fetched state and sent
`start` before delivering the message. An already-confirmed, ready connection now
sends directly. A disconnect, host change, or failed delivery invalidates that
readiness; retries preserve the message ID and recheck the host.

## Timing evidence

The installed Mac transcribed the existing 6.35-second synthetic recording in
**702 ms** round trip, with **657 ms** reported generation time using the selected
local STT model, `base`. The pre-update check took 783 ms. These are loopback
measurements, not a measurement of the user's physical iPhone delay.

New numeric diagnostics attach to the accepted message's `voiceTiming` in the
Mac's existing `Assistant/state.json`. They distinguish detected-speech-to-endpoint
time, deliberate commit wait, local transcription queue, transcription round
trip, Mac queue/service time, model generation time, and message delivery.
The existing agent first-response timing remains separate. The diagnostic
update contains no audio or transcript, runs after acceptance, and cannot replay
the message. Unsupported older hosts simply ignore the optional failed update.
No cloud audio processing, model downloads, or cloud file storage were added.

The physical iPhone's reported 5–7 seconds is not fully attributed yet. Build 60
provides the timing evidence needed from the next real call while removing the
confirmed extra readiness requests and offering explicit Send now control.

## Verification

| Check | Result |
| --- | --- |
| Full runtime suite | 545 passed |
| Mobile Swift suite | 132 passed |
| Mac Swift suite | 177 executed, 171 passed, six opt-in live checks skipped |
| Shared protocol suite | 64 passed |
| Assistant iPhone UI suite | Seven passed; exported screenshots inspected |
| Updated release metadata suite | 11 passed |
| Signed Mac app | Signature, notarization, staple, and Gatekeeper passed |
| Installed Mac | One native process; health, Remote Assist, background Assistant, and 12-tab inventory verified |
| Installed runtime | Five changed JavaScript files match source and signed bundle by SHA-256 |
| iPhone archive | Build, bundle ID, version, and strict deep signature verified |
| TestFlight | VALID, IN_BETA_TESTING, internal group assigned, notes match |

Regressions cover paused speech joining one thought, long manual pauses, flushing
audio on Send, delayed transcription across separate turns, duplicate taps,
uncertain delivery with a stable ID, hangup cancellation, readiness invalidation,
settings persistence, native insertion verification, changed targets, and FIFO
ordering. The earlier tests for full reply playback and explicit Interject pass.

The install finished successfully; its first report write encountered a null
catalog while inventory was warming up. Final verification waited for the live
12-tab catalog, checked every release invariant again, and saved the receipt.
The retained install helper now waits for the catalog before completing.

The remaining hands-on check is build 60 on the physical iPhone: speak across a
pause, use Send now, try Wait for Send, and ask the Assistant to leave a harmless
draft in an empty Terminal agent input. Automated tests do not establish audible
or physical-device acceptance of those interactions.

## Release evidence and workspace

Canonical receipts, logs, screenshots, notarized Mac ZIP, and the signed build-71
rollback app are in the ignored directory
`native/macos/dist/candidates/assistant-send-2026-09-08/`.

- Mac notarization: `ed996211-507b-4199-830a-8842f0b33a0f`.
- Mac executable SHA-256: `8e58d95a67b40b9a76528b1cfe87b440543b7888c8b3fd1d8e2bffd08dc62296`.
- iPhone executable SHA-256: `6480783976f9ace24a18f5d4ec740af3caf29017dfeb4e2e737470114acca72a`.
- Apple build ID: `5262617d-5874-41c7-b235-4329e41b2e58`.
- TestFlight assignment verified at `2026-09-08T06:22:41.777Z`.

No public npm, GitHub release, App Store review, or external beta release was
performed. The existing nine unrelated dirty paths retain their original lane
and next action:

| Existing paths | Next action |
| --- | --- |
| `.agents/skills/clawdad-release/SKILL.md`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Reconcile release-skill revisions. |
| `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Review and commit plugin metadata. |
| `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh` | Audit and checkpoint storage/build workflow changes together. |
| `assets/wordmark-explorations/` | Curate branding artifacts. |
| `cloud/native/` | Review and canonicalize generated material. |
| `marketing-site/` | Review and release marketing work separately. |
