# Assistant speech voice consistency — 2026-09-10

Delivered: signed, notarized **Mac build 120** installed at `/Applications/ClawDad.app`; **iPhone build 85** is Apple `VALID`, assigned to **ClawDad Internal**, and `IN_BETA_TESTING`. Update the phone through TestFlight. The phone's physical installation has not been independently verified.

Automatic Assistant replies and both participants' message speaker buttons now use one recovery path that preserves the selected voice for the entire message. Brief failures retry; persistent failures pause with **Resume speech** and **Stop**. Completed chunks stay completed, and an interrupted current clip resumes from its saved player position. The lower-quality device-voice substitution was removed.

## Confirmed cause, and what remains unknown

The installed preference was verified through the authenticated runtime: **Doc Reader on the Mac, Kokoro `kokoro-82m-v1`, Heart `af_heart`, speed 1**, using `http://127.0.0.1:8772`. The selected Assistant path disables the remote fallback URL. The local service was ready with Kokoro loaded. No voice preference was changed for testing.

The exact historical iPhone event that triggered Cody's quality change cannot be established from the available records. The September 10 cache snapshot contained **105 ready manifests**, all using Kokoro/Heart, with no failed or generating entries at collection time. A ready server recording proves generation completed; it does not establish that every chunk reached or played on the phone. There was no corresponding phone playback-event trail in the old implementation.

Several defects were established independently:

| Finding | Evidence | Result |
|---|---|---|
| Any synthesis, download or player error changed to iOS device speech | Pre-patch `MobileAssistant.swift:1250–1295` at commit `4a2df27` catches the error and calls `audio.speakFallback(remaining)`. `AssistantReplyAudio.swift` implemented that through `AVSpeechSynthesizer` with its default voice. Both automatic and manual message playback share this code. | Confirmed mechanism for the reported quality switch. Removed from the Assistant playback path. |
| Voice selection was scoped to a batch | `voiceSelection` was declared inside `playMessageBatch`; messages over the existing 24,000 UTF-8-byte speech batch size resolved it again. | A mid-message settings change could select another voice. Selection and actual manifest identity now stay pinned across all batches. |
| A temporary local failure could prevent recovery for 30 minutes | An authenticated isolated-server reproduction received `local_service_unavailable` and approximately **1,799,952 ms** retry delay after a later chunk failed. The global unavailable cache treated this like a quota/billing failure. | Local failures now get bounded client retry and fresh readiness checks, without entering the 30-minute quota circuit breaker. Billing/authentication protections remain separate. |
| Retrying a partial recording regenerated successful parts | Old `ensureCachedTtsAudio` reset `parts` and started generation from the first chunk. | Recovery now validates the saved prefix and appends only missing parts. |
| Long playback consumed the generation timeout | The previous 180-second wall-clock deadline included time actually spent playing audio. | Generation wait is tracked separately from audible playback. This was a potential contributor, not a confirmed trigger for Cody's event. |
| Player completion did not retain a usable end position | A native `AVAudioPlayer` regression test observed `currentTime` reset on completion. | The wrapper records duration on success and current position on interruption/failure, then seeks the same retained clip on Resume. |

The local Doc Reader source was also inspected read-only. `doc_reader/tts_service.py:154–178` dispatches the requested engine; its Kokoro implementation passes the same voice and speed to every internal segment, and raises on synthesis failure. It does not switch that request to a different engine. No Doc Reader product code was changed in this lane.

## Delivered behavior

`AssistantSpeechPlayback.swift` holds one message's voice, text batches, current batch/chunk, immutable published-part metadata, downloaded current clip, and player offset. `MobileAssistant.swift` owns it across chat navigation and recoverable connection changes.

- The first voice selection is retained throughout the message. Before playback, provider, engine, model, voice and speed are checked against the selected preference and subsequent manifest parts. A changed voice, cache identity or previously published part pauses before playing different audio.
- Each transient failure gets up to **two automatic retries**, with **350 ms and 700 ms** backoff. Preparation has a **12-second per-gap wait**, independent of audio duration; underlying transport/service requests retain their own bounded timeouts. These are separate bounds, not a guarantee that every network failure resolves in 12 seconds.
- Resume uses the retained text and exact current audio bytes. A completed part is not downloaded or played again. A failed current clip retains its playback offset. A stopped or superseded message cannot resume from a late request result.
- An operating-system audio interruption pauses for deliberate Resume. A changed cache/voice identity also pauses immediately. Stop releases the playback gate and preserves the existing manual microphone state.
- Automatic speech cannot overlap manual readback or bypass a paused message. Starting another message replaces the previous playback. Replay after completion starts at the beginning using the saved recording.
- Playback continues across ordinary view navigation. Paused recovery controls are available in text-only chat and in the shared call controls outside chat. The message's speaker control changes to Resume when paused. Buttons have accessible names and 44-point targets; the icon glossary explains playback, Stop and Resume.
- The conversation input remains gated during playback and a recovery pause so audio cannot become a new user turn. Existing mute, Think aloud, captured-word recovery, typed drafts and images are preserved. Stop/Interject deliberately releases the gate; no microphone preference is remotely enabled.

`lib/tts-cache.mjs` now records a generation identity, full chunk plan, text hashes and audio hashes in version-2 manifests. Retrying independently verifies the successful prefix, then appends the missing suffix. The server exposes these hashes to the phone, which checks downloaded bytes before playback. Complete compatible cached recordings can be replayed without synthesis. The selected voice must still resolve; this does not promise fully offline catalog recovery after an application restart.

Complete older caches remain supported, including null/missing optional metadata during a Mac upgrade. An incomplete older cache without exact generation provenance, a changed chunk plan, or corrupt audio is preserved and rejected for continuation. Resume cannot repair corrupt files by guessing or regenerating an already-heard prefix. Such an integrity failure needs deliberate cache repair or a new recording after diagnosis. No corruption was found in Cody's inspected ready manifests.

New bounded phone diagnostics record message hash, event time, stage, batch/chunk, audio identity, voice identity, offset and an error category/code. They exclude message text, raw errors/URLs, microphone samples and recognized speech. The last 160 events are saved locally under `ClawDad/AssistantDiagnostics/playback-events.json`, excluded from backups, for diagnosing a future physical-phone occurrence.

## Complete recording and transport evidence

The synthetic workshop recording is **164.9 seconds (2:45)**, seven chunks, 24 kHz mono WAV. Generation used the actual local Kokoro/Heart service. A fixture injected HTTP 500 after the first two successful chunks. Recovery generated only the remaining five; the original two audio hashes stayed identical. Every request used Kokoro/Heart/speed 1. Replaying reused all seven cached files.

- First actual synthesis: **484.4 ms**.
- Total generation, including fixture failure and recovery: **16.384 seconds**.
- Complete WAV: **7,915,278 bytes**.
- A subsequent local Whisper pass processed the complete recording in **5.58 seconds**. All seven sections appeared in order, including the opening, recovery section and final sentence. It had ordinary ASR differences in the ClawDad name and a few words, so it is supporting continuity evidence rather than a byte-exact speech transcript or proof of voice quality.

The opt-in `MacAssistantSpeechRecoveryLiveTests` passed through real `AssistantWireRequest` encoding/decoding, `MacAssistantRuntime.respond`, authenticated local HTTP synthesis, and actual audio downloads. The isolated service used those recorded Kokoro chunks and injected a later failure. **Seven chunks arrived in order with matching hashes after two failed native synthesis requests. Zero microphone captures and zero conversation turns were submitted.**

After installation, the running Mac 120 service generated a second synthetic two-part message in **4.400 seconds**. Both downloaded WAVs matched their published hashes, the selected voice stayed Kokoro/Heart, a second request was a cache hit, and the Assistant conversation hash was unchanged. This verifies code loaded in the installed runtime, separately from compiled fixtures.

**Audible verification remains open.** The complete WAV was produced and offered to Cody for listening. The tool session could not consume audio input, so no claim is made that the full recording was personally heard or judged for voice consistency. Hashes, voice parameters, ASR and player-completion tests do not replace listening.

## Verification results

| Check | Evidence/result |
|---|---|
| Complete Node/runtime suite | **692 passed**, zero failures, serialized run |
| Speech service/cache subset | **40 passed**, including delayed readiness, temporary local failure, bounded stalled response, partial recovery and cached replay with the fixture service offline |
| Mac native package | **270 tests**, 12 opt-in skips, zero failures; the isolated native speech test was then enabled separately and passed |
| Mobile package | **230 tests**, one opt-in skip, zero failures |
| Mobile recovery regressions | Download failure after an initial successful chunk; same-voice reconnect/resume; exact current-clip seek; wrong initial voice; later voice/cache changes; legacy metadata; long Unicode batches; replay; startup delay; cancellation during backoff; late audio; mute and Think aloud preservation |
| Actual native player | WAV decoding/completion at different rates, cancellation isolation, invalid clip, stop/seek/resume without replaying the prefix |
| Small iPhone simulator, 375 × 667 | Text-only recovery, Resume/Stop, muted-call recovery and navigation to the shared bar passed; screenshots visually inspected |
| Large iPhone simulator, Accessibility XL | Same recovery flow passed; screenshots visually inspected for readable recovery text and buttons |
| Controlled native service fixture | Existing crash/recovery test passed with **1.060-second** recovery; no actual Mac shutdown, logout or Doc Reader restart was required |
| Installed Mac 120 | Signed/notarized/stapled and Gatekeeper accepted; one host process; bundled and loaded server/cache hashes match source; native bridge and primary speech ready |
| iPhone 85 release | Signed archive uploaded; Apple `VALID`, ClawDad Internal assigned, `IN_BETA_TESTING` |

The first parallel full Node run had two unrelated timing-sensitive failures in shared-dispatch/delegate-lane tests. Both passed individually and the complete serialized 692-test rerun passed. Those product paths were unchanged. Earlier fixture cleanup races and a UI parent accessibility identifier collision were corrected or isolated before the final relevant runs. The old fallback-oriented tests were replaced by assertions for primary-voice recovery and zero fallback calls.

## Release, preservation and remaining checks

Mac 120 was installed at **2026-09-11 00:14:33 UTC** (September 10, 7:14:33 PM CDT). Native readiness took **10.118 seconds** after launch. Guarded installation checked for an idle conversational coordinator, no pending native dispatch, and no current synthesis before replacing the app. All **nine** Terminal Codex processes, Assistant conversation, user instructions, supervisor state and account-budget preferences were verified unchanged. No Terminal tab, draft, native queue or research task was used as a speech fixture.

Apple reported the existing nonblocking missing dSYM warning for the bundled WebRTC framework; upload and internal distribution succeeded. No npm publication, public appcast publication, cloud provisioning, subscription change or broad branch push was performed.

Physical iPhone checks still needed with build 85: listen to the full generated recording and long automatic/readback messages; interrupt Wi-Fi/cellular after the first audible part and verify Resume; exercise Bluetooth/headphones and an OS audio interruption; stop or choose another message during recovery; confirm actual mute, echo suppression and VoiceOver behavior. Player offsets and synthetic state tests verify the implementation, while perceptual seams, phone audio routes and audible no-repeat/no-skip behavior require the device. Recovery position is retained in the active controller; force-quitting the phone app ends playback rather than promising cross-relaunch audio resume.

The separate [Terminal audit](assistant-terminal-control-audit-2026-09-10.md) remains at its review boundary. Its proposed input/queue/trust fixes were not implemented in this speech release.

Detailed local evidence is in `native/macos/dist/candidates/assistant-voice-consistency-2026-09-10/`:

- `historical-voice-manifests.json`, `recording-proof.json`, `recording-text.txt`, `complete-recovered-heart.wav`, `complete-recording-transcription.json`
- `native-wire-proof.json`, `native-wire-tests.log`, `native-fixture-summary.json`, `installed120-speech-proof.json`
- `full-node-serial.log`, `full-speech-server-tests.log`, `native-full-tests.log`, `mobile-full-final-tests.log`
- `ios-small-2.xcresult`, `ios-large.xcresult`, `small-final-screenshots/`, `large-screenshots/`
- `install-120-verification.json`, `testflight85-release.json`, `mac120-package.log`, `ios85-archive.log`, `ios85-upload.log`

## Preserved unrelated workspace buckets

These nine pre-existing dirty entries are excluded from this scoped checkpoint:

| Bucket | Exact paths | Next action |
|---|---|---|
| Release workflow | `.agents/skills/clawdad-release/SKILL.md`; `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh` | Review/checkpoint the existing workflow/storage lane separately; scripts were used as found |
| Plugin workflow | `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Keep for the plugin lane's review |
| Brand exploration | `assets/wordmark-explorations/` | Keep for design review |
| Cloud/site work | `cloud/native/`; `marketing-site/` | Keep for their separate lanes |

`git diff --check` passes. ORP hygiene classifies all dirty paths with zero unclassified entries. The speech implementation, regressions, native release metadata and this report are one scoped local checkpoint.
