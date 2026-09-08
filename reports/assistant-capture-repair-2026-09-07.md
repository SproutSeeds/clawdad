# Assistant microphone startup repair — September 7, 2026

iPhone build **58** fixes the microphone startup failure reported in build 57.
The repair has been exercised on the user's physical iPhone 15 Pro Max with its
built-in microphone and speaker. Release archive and private TestFlight checks
passed; build **58** is available in **ClawDad Internal TestFlight**. Mac build
**71** remains installed.

## Confirmed causes

The user ruled out iPhone Mirroring. The Mac remained healthy and connected,
with the background Assistant ready. The failure occurred before transcription.

**Mismatched voice-processing formats stopped the audio engine.** On the phone,
the microphone format was mono Float32 at 48 kHz. The implicit main-mixer output
retained stereo Float32 at 44.1 kHz. With voice processing enabled, this setup
stopped and delivered zero microphone buffers. Explicitly connecting the mixer
to the output with the microphone's format kept the engine running and captured
speech. Apple requires matching input/output client formats for voice processing;
its [reference sample](https://developer.apple.com/documentation/avfaudio/using-voice-processing)
also makes this connection explicitly.

**The input callback inherited MainActor isolation.** `AVAudioNodeTapBlock` lacks
a Sendable annotation. Constructing it inside a MainActor method caused Swift 6
to assert when AVFAudio invoked it on its audio thread. Recovered build-56 crash
reports and the first diagnostic crash contain `_dispatch_assert_queue_fail`,
Swift's executor check, and `AVAudioNodeTap::TapMessage::RealtimeMessenger_Perform`.
Symbolication with the matching build-56 UUID locates the input-tap closure in
`AssistantAudio.start()`. Build 57 retained that callback construction in
`configureCapture()`.

The later production crash file was originally labeled as build 57 during
collection because of its timestamp. Its embedded build number and UUID show
build 56; the retained evidence was renamed accordingly. No build-57 crash is
claimed from that file. The new physical diagnostic independently reproduced
the same callback crash.

The prior detector tests covered sample processing, and simulator UI tests used
a microphone preview. Those checks could pass while hardware delivered no
buffers or crashed at the callback boundary. Build 57's startup check correctly
exposed the failure, but rebuilding the same graph did not repair it.

## Changes

- Connect the main mixer to the output using the current microphone format
  before starting voice processing capture. The existing per-clip conversion
  keeps playback in the established call format.
- Construct input and playback callbacks in explicit nonisolated, Sendable
  factories. Copy input samples on the audio callback, then deliver the copied
  values to MainActor. Playback completion similarly returns to MainActor.
- Label microphone startup failures **Microphone unavailable** and offer
  **Retry microphone**. Transport failures retain their connection message.
- Retain the existing speech detector, local STT/TTS selection, call controls,
  generation checks, and cancellation behavior.

## Physical verification

A temporary development app, `earth.frg.clawdad.audiocheck`, was installed
separately from ClawDad. Its test loop retained only format, buffer-count,
timing, and level diagnostics. Audio was discarded; it submitted no speech,
Codex messages, or Terminal actions. The user confirmed running the check.

| Configuration | Observed result on the physical phone |
| --- | --- |
| Original voice-processing graph, repeated three times | Engine stopped; zero buffers and zero frames |
| Matched voice-processing graph, repeated three times | Engine running; 50/50/53 buffers, 240000/240000/254400 frames; nonzero voice input |
| Standard capture without voice processing | Engine running with readable microphone input |

A final diagnostic compiled the **actual repaired repository files** for
`AssistantAudio`, `AssistantMicrophoneState`, and `MobileAudioSession`, with the
real shared speech detector. It verified:

- First microphone input and startup completed in **937 ms**.
- Speech detection fired twice and produced one completed utterance.
- Two silent playback clips completed through the real playback callback.
- Capture continued after playback, with 19 further input-level updates.
- Ending while muted and starting again restored unmuted capture.
- No capture failure or exception occurred.

Silent clips verify playback completion and continued capture; this check does
not establish audible TTS quality or a complete spoken Codex round trip. That
last product check remains on the updated TestFlight app.

## Automated verification and release

| Check | Result |
| --- | --- |
| Mobile Swift suite | 113 passed |
| Runtime/release suite | 541 passed |
| Assistant simulator UI | Three passed |
| New audio-thread regressions | Passed within the mobile suite; input samples and playback completion arrive on MainActor |
| Actual repaired capture code on physical iPhone | Passed, including playback completion and restart |

The signed archive is version `0.7.0 (58)`, bundle `earth.frg.clawdad.ios`.
Strict deep signature verification passed. Executable SHA-256:
`3b968869a5cbad5f800977045a2c0f6f9a0d44cfdf6c328fe471b1ef9d868397`.
Apple upload succeeded. The existing prebuilt WebRTC framework dSYM warning
remains; it limits symbolication for that framework. Final Assistant audio
sources add no compiler warnings. Internal TestFlight processing and assignment
passed. Apple build `86fee70e-b527-4399-b732-f4723668b846` was verified at
`2026-09-08T03:41:34.537Z` as `VALID` and `IN_BETA_TESTING`, assigned to
**ClawDad Internal**, with the matching build-58 testing notes.

The Mac's final health and Assistant checks returned HTTP 200, with the native
bridge online and coordinator ready. No Mac or cloud deployment is required
for this repair.

Canonical evidence is under the ignored directory
`native/macos/dist/candidates/assistant-capture-2026-09-07/`: physical probe
sources/build logs, original and fixed capture results, production-source
results, matching crash symbolication, final test logs, and release receipts.
The temporary diagnostic app was uninstalled after its results were retrieved,
and this task's simulator was shut down. The normal ClawDad app and its pairing
data are preserved.

## Workspace handoff

Only the Assistant audio implementation, error presentation, regressions,
iPhone build metadata, and this report belong to this patch. The nine existing
dirty groups remain preserved and classified:

| Existing paths | Next action in their original lane |
| --- | --- |
| `.agents/skills/clawdad-release/SKILL.md`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Reconcile release-skill revisions. |
| `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Review and commit the plugin metadata update. |
| `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh` | Audit and checkpoint storage/build workflow changes together. |
| `assets/wordmark-explorations/` | Curate existing branding artifacts. |
| `cloud/native/` | Review and canonicalize existing generated cloud/native material. |
| `marketing-site/` | Review and release existing marketing work separately. |

The prior release's report remains as historical evidence. This report records
the physical failure and the additional repair required afterward.
