# Assistant iPhone microphone repair — September 7, 2026

The iPhone Assistant now waits for microphone buffers before showing
“Listening…”, detects quieter speech across brief syllable gaps, and submits an
utterance when the speaker pauses. The compact microphone control reacts to
input, and detected speech changes the call status to “Hearing you…”.

This is an iPhone build **57** repair. The existing Mac build **71** supplies
local transcription, local speech playback generation, and the background Codex
coordinator. Apple accepted the upload, and build 57 is available in
**ClawDad Internal TestFlight** with matching build-specific testing notes.

## Findings

The user confirmed the built-in iPhone microphone. The paired physical iPhone
was running build 56. The live Mac received the Assistant start requests and
reported a ready background coordinator, current Terminal inventory, and no
conversation messages. This located the observed stall before message delivery;
it did not establish that microphone samples were reaching the phone detector.

Three defects were reproduced with failing regression tests:

- The fixed RMS threshold of `0.012` rejected quieter processed speech.
- Speech onset required 120 ms of uninterrupted energy above that threshold.
  Brief unvoiced consonants or syllable gaps repeatedly cleared the onset,
  discarding a complete sentence.
- After a long utterance was divided into upload segments, a short final tail
  could be discarded when recording finished.

The old “Listening…” state followed `AVAudioEngine.start()` without confirming
that the input tap delivered any buffers. There was no recovery for a running
engine with a stalled tap or a stopped engine after a route change. Playback
also disconnected and reconnected the call graph for each TTS clip.

An initial investigation suspected inherited mute state. Source review found
that the controller already reset mute after startup; that was not the cause.
The new microphone state centralizes the reset and readiness bookkeeping.

## Repair

- An adaptive energy threshold follows quiet input. Speech onset accumulates
  across short gaps; the existing 800 ms pause ends an utterance. Pre-roll and
  18-second upload segments remain, with the final short tail preserved.
- Capture startup waits for actual buffers and retries once if startup fails.
  A call monitor checks buffer freshness and engine state. It preserves the
  current utterance and rebuilds capture when it stalls, with bounded retries.
  Recovery only reactivates the owning conversation's audio session.
- TTS audio is converted to the established mono call format. Successive clips
  use the existing playback connection, preserving the microphone graph.
- Input activity is throttled for the compact call control. Recovering capture
  has a distinct status, and an unrecoverable microphone error remains visible
  instead of being overwritten by routine workspace refreshes.
- Existing call cancellation, mute, end, navigation, and local transcription
  routing are retained. No Terminal window launch or cloud resource change is
  part of this repair.

## Verification

| Check | Result |
| --- | --- |
| New detector regressions against old implementation | Three failures reproduced |
| Final shared protocol suite | 64 passed |
| Final mobile Swift suite | 111 passed |
| Runtime and release metadata suite | 541 passed |
| Assistant simulator UI | Three passed; two screenshots reviewed |
| Release archive and strict deep signature verification | Passed, iPhone build 57 |
| Actual Mac local transcription | HTTP 200; full test phrase recognized |
| Quiet spoken-audio detector to local transcription | Full phrase retained; both requests HTTP 200 |

The spoken probe used a locally generated recording of “This is a test of the
ClawDad assistant. Please tell me which terminal tabs are open.” Its peak was
reduced to `0.01`, below the old fixed RMS gate, then passed through the actual
Swift detector. Both sentences survived endpoint detection and were transcribed
by the running Mac service in 724 ms and 641 ms. The service reported model
`base`; no speech model or preference was changed. These are transcription
timings for a local probe, excluding phone transport and conversational/TTS
latency.

The final mobile suite includes capture readiness, stalled input, stopped
engines, expired audio ownership, invalid playback, and conversion of 16/24/48
kHz TTS clips to one call format. An intermediate test fixture wrote an
unfinalized WAV; its duration assertions failed. The fixture was corrected and
the complete final suite passed. Final Assistant sources add no compiler
warnings. Existing file-transfer Sendable and audio-category deprecation
warnings remain outside this patch. Upload retains the existing prebuilt
WebRTC dSYM warning, which limits symbolication for that framework.

Evidence is in the ignored canonical directory
`native/macos/dist/candidates/assistant-listening-2026-09-07/`: before/after
regression logs, final package logs, runtime log, simulator result bundle and
screenshots, speech probe and transcripts, archive verification, and Apple
upload/distribution receipts. The simulator started for this check was shut
down afterward.

## Private release and remaining physical check

The archive is version `0.7.0 (57)`, bundle `earth.frg.clawdad.ios`. Its executable
SHA-256 is
`d50299a278d5b41180f2f85288efd36a176772dc4d14c960f826c2b7ed86ba6e`.
App Store Connect build `a96a6467-fba6-4d7a-906c-c7a37e8affcc` is `VALID` and
`IN_BETA_TESTING`. Membership in **ClawDad Internal** and the saved build notes
were verified at `2026-09-08T02:42:39Z` (September 7 locally). The Mac's final
health and Assistant checks returned HTTP 200, with the native bridge online
and the background coordinator ready. No external beta or public release was
submitted.

Physical microphone buffers from the reported incident were unavailable.
The quiet/gapped speech failures are confirmed defects matching the symptom;
the precise trigger on this user's phone remains unconfirmed until retest.

Update the iPhone to build 57, tap the headset, and speak a short request at
normal phone distance. The microphone should react and show “Hearing you…”,
followed after a brief pause by transcription and a response. Check a second
spoken turn after playback, then mute, end, and start another call. This physical
round trip and audible playback remain the acceptance check; simulator and
local speech tests do not replace it.

## Preserved workspace changes

This patch is scoped to the iPhone Assistant, shared speech detector, regression
coverage, build metadata, and this report. The nine existing dirty path groups
remain preserved:

| Paths | Existing lane and next action |
| --- | --- |
| `.agents/skills/clawdad-release/SKILL.md`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Reconcile release-skill revisions in the plugin/release lane. |
| `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Review and commit with the plugin update. |
| `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh` | Audit and checkpoint the storage/build workflow together. |
| `assets/wordmark-explorations/` | Curate the existing branding artifacts. |
| `cloud/native/` | Review and canonicalize existing generated cloud/native material in its original lane. |
| `marketing-site/` | Review and release the existing marketing work separately. |

ORP hygiene reports classified changes with zero unclassified paths. This
private iPhone update preserves the Mac installation and cloud deployment.
