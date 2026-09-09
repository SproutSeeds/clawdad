# Assistant mute preservation and two-second word timer

This follow-up implements Cody's clarified mute behavior and supersedes the earlier discard-on-mute behavior. It also replaces the four-second pause with two seconds measured from newly registered transcription. Scope is the private iPhone app; Mac native Terminal tools and broader Remote Assist icon organization are unchanged.

## Confirmed cause and implementation

A read-only device inspection confirmed the reported phone was running **0.7.0 (70)**. `muteMicrophone` called `discardUnsentVoice`, invalidated the delivery epoch, canceled pending transcription and emptied the turn. Unmute discarded the turn again. The queue independently refused to finish while muted. These paths explain why a visible transcription disappeared when Cody muted immediately after speaking.

- Manual mute now closes the native audio handoff and stops its capture graph immediately. It synchronously drains only pre-tap samples, including bounded frames waiting for the UI actor, and finalizes the existing utterance. The same turn and request ID continue through local STT and delivery while the microphone stays off.
- The handoff closes under a lock, excludes samples at/after the cutoff, rejects subsequent callbacks before copying their samples, and cannot drain a frame twice. Unmute starts a fresh capture graph and timestamp boundary. Accepted pre-mute speech is preserved; speech captured while muted is excluded. No new command recognizer or always-listening mode is added.
- Quick mute/unmute cycles retain the current unsealed thought. If Cody resumes before submission, subsequent captured words join it in order. A completed/submitted turn keeps its identity separately from new speech. Reconnect or uncertain acceptance retries retain the same ID.
- The two-second timer anchors to **when genuinely additional words are registered**, rather than an audio timestamp. Repeated/retracted partials, capitalization, punctuation, volume and repeated speech-onset notifications do not move its deadline. Pending final transcription is allowed to finish; newly registered final words restart the two-second timer. Active speech with stalled STT remains protected from truncation. A fresh unchanged transcription can establish that continuing energy is noise.
- Think aloud stays opt-in and retains the speaking turn until Send. **Send remains usable while muted.** Muting keeps the call and reply playback connected. Typed drafts and selected images remain separate and intact.
- Hardware interruption/failure retains the existing safe recovery behavior: preserve already displayed unsent text for explicit review and pause capture. Ending the call cancels pending delivery. These actions remain separate from Cody deliberately tapping mute.

## Verification

Evidence: `native/macos/dist/candidates/assistant-mute-preserve-2026-09-08/`.

- Mobile Swift suite: **187 discovered, one opt-in live test skipped, zero failures**. The opt-in test then passed against real local services in both ordinary listening and speak-then-mute modes.
- Native audio/controller tests cover pre-mute tail preservation, cutoff trimming, bounded audio handoff, old callbacks after unmute, no copying or delivery of muted sentinel audio, delayed final words, manual Send while muted, rapid cycles, failed unmute, recovery, playback suppression, Think aloud, connection retry with one request ID, call ending, typed text and image bytes.
- Default timer test observed **2.048 seconds** from newly registered words to submission while muted, with an intentionally old audio timestamp. Pure policy tests verify that repeated partials and noise never reset the deadline and that late new words do.
- Initial targeted checks contained one obsolete four-second test expectation; it was updated for the authorized two-second requirement. Initial runtime checks contained two build-70 metadata expectations; these were updated for build 71 and the complete runtime suite rerun.
- Full runtime suite: **578 tests passed**, zero failures. The affected release-metadata file also passed independently.
- iPhone simulator: **all 16 Assistant UI scenarios passed**, including Send while muted, Think aloud, explicit calling, manual mute, playback/navigation, recovered voice, text and image draft persistence after restart/failed send, copying and phone/map links.

### Recorded fixture through installed Mac services

Both runs used the real mobile controller, voice detector, installed Mac STT, existing Assistant/Codex and local TTS. The driver supplied a prepared synthetic recording and decoded the response into PCM; it did not open Cody's microphone or play sound aloud. Diagnostic messages stayed out of normal chat history.

| Measurement | Mute immediately after speaking | Ordinary listening |
| --- | ---: | ---: |
| Last new registered words → submission | 2.029 s | 2.003 s |
| Final audio → final transcript | 1.720 s | 1.167 s |
| Last recorded speech → submission | 3.768 s | 4.412 s |
| Submission → readable response observed | 6.992 s | 8.298 s |
| Response observed → decoded playback-ready PCM | 0.057 s | 0.041 s |
| Submission → decoded playback-ready PCM | 7.049 s | 8.339 s |
| Accepted submissions | 1 | 1 |

Both calls stayed connected and decoded 42,000 response frames. The muted run stayed muted during the response. Muting the synthetic adapter and finalizing its WAV took 19.1 ms; this is **not a measurement of physical iPhone microphone shutdown or haptic latency**. These individual runs are observations, not a latency guarantee. Final STT and response/model generation remain separate from the two-second timer.

## Release checkpoint

- iPhone **0.7.0 (71)** Release archive built and strict code-signature verification passed. Bundle is `earth.frg.clawdad.ios`; microphone consent remains present, and Speech recognition permission remains absent. Background audio support is unchanged.
- Archive executable SHA-256: `ac6e2285e26126b539061ee57e0412554ba30ba79c488e6939cc65c44ab960b5`.
- **iPhone 0.7.0 (71) is VALID, IN_BETA_TESTING, and assigned to the existing ClawDad Internal group**, with matching testing notes. Verified September 9 at 05:03:56 UTC. Build ID: `af4ea760-666b-4f51-b974-e9fb71886429`. The existing third-party WebRTC dSYM warning recurred; export and upload succeeded.
- A final read-only check at 00:04 Central still found **build 70 installed on Cody's phone**. Install build 71 through TestFlight; the phone was not remotely updated or launched.
- A fresh read-only check confirmed installed Mac **0.7.0 (83)** and executable SHA-256 `3820de1784218e7534fa0cb5a05103deb2e0855b298168157cfc4b417187d06d`. This patch requires no host installation or restart.

## Cody's check after updating

Install build 71 from **ClawDad Internal TestFlight**. With Think aloud off, speak a phrase and immediately tap mute. The already captured words should finish and send once, with the microphone still off. The two-second interval starts at the last newly transcribed words. A reply can continue playing while muted. Unmute to start or continue speaking; use Think aloud when a turn should wait until Send.

Physical iPhone checks remain for the actual microphone cutoff in a noisy room, final syllables when tapping mute, Bluetooth/phone-call interruptions, foreground/background recovery, rapid real touch gestures, privacy indicator, haptic/audible output and battery behavior. No physical microphone was activated, microphone preference changed, or voice-reactivation setting enabled remotely.

## Workspace preservation

The pre-existing nine dirty paths remain outside this checkpoint: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, and `marketing-site/`. Their next action remains review/checkpoint by their owning lanes; none were reverted or included in this patch. Build/test evidence is retained in the ignored canonical candidate directory.
