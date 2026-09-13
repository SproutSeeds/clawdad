# Assistant first-chunk speech audit — September 12, 2026

Status: audit and disposable verification only. Product repairs and another release remain for Cody's review. The existing volume-boost repair is preserved. Evidence was collected September 12–13 in America/Chicago; CDT is UTC−05:00.

## Finding

The evidence points to the **finished-chunk fade defect in iPhone build 90**, already corrected by the volume-boost lane in **build 91**. A completed audio clip can remain the outgoing fade indefinitely, preventing the next clip from consuming any samples. The engine still reports running, so the Assistant waits for a completion callback that never arrives. This is a playback defect, with strong incident attribution; it is not the intended consistent-voice recovery pause.

The paired CodyVerse iPhone currently reports **ClawDad 0.7.0 (90)**. Apple currently reports **91 VALID, IN_BETA_TESTING, assigned to ClawDad Internal**; 90 is no longer assigned. Withdrawing 90 from the group did not uninstall Cody's copy. No phone update was performed in this audit.

The exact NASA reply was fully preserved and synthesized as three Kokoro/Heart chunks. The retained phone attempt completed chunk one, downloaded chunk two, and requested playback. It contains no synthesis failure, download failure, voice mismatch, or recovery-pause event. Reconstructing the documented pre-fix fade predicate reproduces first-chunk success followed by zero second-chunk progress with these exact WAV files. The unchanged production source exported for 91 completes all three.

Limits of attribution: the retained phone event history begins with a later attempt at 9:43:51 PM, not the original automatic attempt around 9:40. Events do not record app build, playback origin, native render progress, epoch or cancellation reason. Chunk two was cancelled 21 seconds after its playback request; its duration is 30.2 seconds, so the missing completion in that interval alone does not prove a stall. Cody's audible report, installed build, the original failed volume-lane regression, and the isolated causal reproduction together support the diagnosis. Frame-level physical-phone proof remains open.

## Exact records and timeline

Conversation: `270cdad6-7e5b-47c7-8f12-52b2c487e1af`.

NASA request: `3da57e05-cee1-47b2-8b9e-9630ec5a217a`.

Final reply: `assistant:3da57e05-cee1-47b2-8b9e-9630ec5a217a:item_0`.

Audio request: `message:assistant:3da57e05-cee1-47b2-8b9e-9630ec5a217a:item_0:0`.

Audio cache: `3a37a36f6e93df56aeb327502900bee24e6222a3`.

Phone message hash: `1cc8e5d1275562781264f501fadef7150038cc2b62f3a50a46716a73f8b748a4`.

| UTC, September 13 | CDT, September 12 | Evidence |
|---|---|---|
| 02:36:07 | 9:36:07 PM | Apple upload timestamp for iPhone 90. The previous 9:31 baseline phone inspection reported 89. Exact phone update time is not retained. |
| 02:38:55–02:39:55 | 9:38:55–9:39:55 PM | Volume lane's complete native-engine test reproduced completed first chunk followed by second-chunk timeout and zero position. |
| 02:40:25.941 | 9:40:25.941 PM | NASA question durably accepted. |
| 02:40:26.086 | 9:40:26.086 PM | Coordinator started; runtime instance `d5f59730-6f6e-46aa-8ce1-bb22f4deb151`. |
| 02:40:39.528 | 9:40:39.528 PM | Exact final reply saved, beginning “Yes, it came back with two findings.” It discusses PR #8443 and issue #8384. |
| 02:40:39.809 | 9:40:39.809 PM | Exact audio manifest created. |
| 02:40:41.298 | 9:40:41.298 PM | Assistant job completed, responseMs 15,212. Stored voice telemetry reports about 1,396 ms from response observation to playback start; this is not an audible-output measurement. |
| 02:40:53.945 | 9:40:53.945 PM | Manifest ready with all three immutable parts, 14.136 seconds after manifest creation. |
| 02:40:58.959 | 9:40:58.959 PM | Volume lane independently verified withdrawal of build 90 from the internal group. |
| 02:42:07.463 | 9:42:07.463 PM | Corrected mobile suite passed 251 tests, two opt-in skips. |
| 02:42:43.394 | 9:42:43.394 PM | Mac 136 installed; previous executable matches Mac 135 baseline. Native readiness followed in 6.831 seconds. |
| 02:43:51 | 9:43:51 PM | Retained phone playback attempt starts for the exact NASA reply. Origin automatic/manual is not recorded. |
| 02:43:52 | 9:43:52 PM | Chunk one downloaded and playback requested. |
| 02:43:55 | 9:43:55 PM | Chunk one completed callback; chunk two downloaded and playback requested, using the same audio ID and Kokoro/Heart identity. |
| 02:44:16 | 9:44:16 PM | Attempt cancelled during chunk two. Cancellation initiator is not recorded. No preceding failed/paused event. |
| 02:45:10.516 | 9:45:10.516 PM | Cody's report saved as request `981b875d-fbe0-4735-a032-ecf523be7965`. This is the verified report time, rather than the approximate 9:44 PM. |
| 02:55:50.651 | 9:55:50.651 PM | Volume lane verified build 91 available in ClawDad Internal. Fresh read-only Apple lookup in this audit confirms it remains available. |
| 03:02:03.478 / 03:23:28.541 | 10:02:03 / 10:23:28 PM | Mac 138, then 139 installed by the completed Terminal release lane, preserving speech commit `3dd73e8`. |

At original synthesis the Mac was **135**, as established by the baseline executable and subsequent install-136 receipt. At the retained phone attempt it was **136**. Current installed Mac is **139**; current checkout `9f220ee` contains the same fixed iOS player/DSP as the volume lane's 91 release export. Current files are not evidence that the phone had loaded the correction.

The Mac 136 replacement happened between the two playback attempts. It may explain a reconnect or loss of earlier diagnostic history, but it cannot explain the retained attempt's missing audio: all parts were already cached, and the phone successfully obtained chunk two after that replacement. The app restart/cancellation relationship is not recorded closely enough to assert a cause.

## Text, synthesis and download evidence

The saved response has 834 characters; removing Markdown emphasis for speech yields 822 characters. The complete speech-text SHA-256 is:

`bc7891c150073f1a87398f325c6471fc1db18e3474d0b19949e78f6acf007aa9`.

It exactly matches the manifest. Re-running the existing chunker with its 600-character setting yields the same three chunk text hashes. Whitespace separators are omitted at chunk boundaries; no following paragraph is absent. One Assistant playback batch owns all three chunks.

| Chunk | Text characters | PCM frames, 24 kHz mono, 16-bit | Duration | Bytes | SHA-256 |
|---|---:|---:|---:|---:|---|
| 1 | 36 | 64,800 | 2.700 s | 129,644 | `ca2d6c9817d71f2104fdc3089fb1110fcdda97d27519fcd1556d071e91396c97` |
| 2 | 461 | 724,800 | 30.200 s | 1,449,644 | `d2d72455552585691f80f5b0f9c90033c4990f2df275ab249d0c82aa2cf4b8ac` |
| 3 | 321 | 498,600 | 20.775 s | 997,244 | `4ffbb0736b1b4dd61bc4523e0010662e1596389b948341d9fe6c7888ea8906b3` |

All three are `doc-reader / kokoro / kokoro-82m-v1 / af_heart / speed 1 / WAV`. Generation identity is `f5f9549caeeb616615dc25866873dadd1c794db73cf0305b7d83637479d25fea`.

Authenticated read-only GETs through the installed server returned HTTP 200 for all three cached files, in 21/3/2 ms during this audit. Every downloaded byte matches the source and manifest hash. This verifies current Mac transport, not the earlier iPhone network timing. No new production synthesis request was issued.

Current Doc Reader is available and loaded on `127.0.0.1:8772`, Kokoro on this Mac's CPU, with one listening process. TTS status is available, not degraded, with an empty fallback URL. The native runtime is healthy. Existing Doc Reader access logs lack usable request IDs/timestamps for this incident; matching searches in native logs produced no incident-correlated errors. We can establish completed synthesis from immutable artifacts, not a precise per-chunk provider request/response timeline or an absence of all historical transient retries.

## Pipeline and state audit

| Stage | Actual implementation | Incident / test evidence |
|---|---|---|
| Saved message → speech text | `AssistantMessagePlaybackText.spoken` strips presentation formatting, batches at 24,000 UTF-8 bytes | Full exact NASA text hash matches cache; one batch. |
| Automatic / speaker entry | `MobileAssistant.speakNext` and `playMessage` converge on `AssistantSpeechPlayback` | Both use the same native player and recovery controller. |
| Phone request → Mac | `AssistantConnection.request`; `.synthesize` timeout 12 s, `.audio` timeout 15 s | Slow speech requests fail independently of the whole connection. Requests have transport IDs; those specific wire IDs are not retained in the phone event log. |
| Mac native bridge | `MacAssistantRuntime` maps synthesis to `/v1/tts/message`, pins voice selection, uses paired Mac first, disables remote fallback; `.audio` accepts only the local TTS route | Saved request/audio ID links full reply to cache; both retained downloads passed phone validation. |
| Generation / cache | `ttsPrepareJobs` deduplicates generation; `ensureCachedTtsAudio` synthesizes sequentially, atomically publishes hashed parts, appends only a failed suffix on retry | Three-part ready manifest. Reopening cache and immutable-prefix recovery covered with disposable server tests. |
| Metadata / downloads | `AssistantSpeechPlayback.inspect/verify` pins model/voice/speed/cache ID and previously published part signatures, checks byte hashes | Retained phone attempt stays on Kokoro Heart; no mismatch/failure event. |
| Native playback | `AssistantReplyAudio` awaits `SpeechOutputPlayer.onCompletion`, guarded by its own epoch | First callback observed on phone; second playback requested. Reconstructed old predicate leaves second native clip at zero progress. |
| Next chunk | `playMessageBatch` increments the cursor only after awaited playback completion | Starved callback prevents increment; later data existing on disk does not advance this await. |
| Retry / recovery | Synthesis polling bound 12 s; errors get two short retries (350/700 ms), then a visible pause; interruption/integrity mismatch pauses immediately | No failed/paused event in the retained NASA attempt. Running-but-stalled playback has no progress deadline, so these recovery branches are never reached. |
| Cancellation / replacement | Playback epoch, audio epoch and task cancellation discard superseded work; Stop resolves pending continuation | Retained cancellation occurs later. Tests check stopped/late audio and replacement callbacks. No evidence a newer chunk was itself mistaken for a cancellation. |
| Background / foreground | `applicationForegroundChanged` updates foreground state and pending notification routing; it does not cancel current playback | Controller transitions tested separately from physical iOS suspension, route changes and lock-screen behavior. |

Relevant source entry points: [SpeechOutputPlayer.swift](../apps/ios/ClawDadMobile/Sources/ClawDadMobile/SpeechOutputPlayer.swift), [AssistantReplyAudio.swift](../apps/ios/ClawDadMobile/Sources/ClawDadMobile/AssistantReplyAudio.swift), [AssistantSpeechPlayback.swift](../apps/ios/ClawDadMobile/Sources/ClawDadMobile/AssistantSpeechPlayback.swift), [MobileAssistant.swift](../apps/ios/ClawDadMobile/Sources/ClawDadMobile/MobileAssistant.swift), [AssistantConnection.swift](../apps/ios/ClawDadMobile/Sources/ClawDadMobile/AssistantConnection.swift), [MacAssistantRuntime.swift](../native/macos/Sources/ClawDad/MacAssistantRuntime.swift), [tts-cache.mjs](../lib/tts-cache.mjs), [server.mjs](../lib/server.mjs). Paths in this report are relative to `reports/`; see the evidence index for exact artifacts.

## Why build 90 sticks, and what 91 already fixes

At the end of a clip, the separate playback envelope can still be positive even though all samples plus DSP latency have been consumed. The old `fading` predicate considered that envelope alone. Installing the next clip retained the finished clip in `SpeechRenderSlot.departing`. Every audio callback rendered that tail and returned before rendering the new clip. A finished clip cannot advance its envelope further, so it remained the departing clip forever.

The current predicate also requires unconsumed frames:

```swift
playbackEnvelope > 0 && processed < count - startFrame + dsp.latencyFrames
```

The volume lane already made this correction before archiving 91 and added `testCompletedChunkCannotLeaveAFadeBlockingTheNextChunk`. Preserve that change and its limiter/gain behavior. We did not overwrite any audio code.

There is a separate resilience gap: the native completion monitor checks finished/interrupted/engine-stopped, but never notices that a running engine's clip position has stopped moving. The controller's generation timeout does not cover the awaiting native player. This explains indefinite “Speaking” without the intentional “Speech paused” recovery action.

## Disposable verification

Current source was tested; historical artifacts are identified separately.

* **Actual cached NASA audio, native output:** current 91-equivalent player and DSP completed all three clips at full duration, in 2.806 / 30.279 / 20.842 s wall time. Output was muted. Source byte hashes were unchanged.
* **Causal counterfactual:** a disposable copy of that player with only the documented old `fading` predicate restored completed chunk one in 2.805 s. Chunk two started but had zero progress, zero progressing samples and no callback during a 3.014 s observation, then the test stopped it. This is a source reconstruction, not execution or decompilation of the signed 90 binary.
* **Original pre-fix evidence:** the volume lane's `native-engines-complete.log` recorded the same zero-position second-chunk failure at 9:38–9:39 PM. Its later fixed full suite and released 91 source are separate artifacts, not retroactive proof that 90 passed.
* **Focused mobile checks:** 41 tests, two deliberate opt-in skips, zero failures. Includes message switching, delayed startup, failed second download, same-voice suffix recovery, interruption position, cancellation/backoff, cache/voice mismatch, long-message replay, notification foreground/reconnect state, native player replacement and completion. The skipped optional offline/engine matrices belong to the other lane; the actual NASA native probe supplies incident-specific coverage here.
* **Runtime speech checks:** 33/33 passed. Includes authenticated server second-chunk failure/retry, immutable prefix, cached replay with synthesis offline, first-ready streaming, timeout and temporary service readiness recovery. Provider outages are disposable HTTP fixtures; the real speech service was not restarted.
* **Controller-to-native NASA verification:** **2/2 passed**, 108.935 s total. Automatic speech completed all three exact source hashes in 53.969 s while simulated background/foreground transitions preserved playback, muted-call state, Think aloud and the typed draft. Speaker-button readback encountered three injected failures downloading chunk two, reached the visible paused state, then resumed after simulated reconnect and completed only the remaining two clips; 54.966 s total. There was no duplicate first clip, no microphone start in text-only playback, no new Assistant submission and no voice change. This uses the actual controller, immutable NASA audio and native output, with simulated paired transport/capture; no physical microphone is opened. Detailed output is in `controller-native-audit-tests.log`.

## Proposed repair and acceptance plan — review first

1. **Use the existing correction.** Cody should update this phone to available internal build 91 (or a later verified build preserving the fix), confirm its installed version, and replay the exact NASA message. No duplicate build or second implementation of the fade correction is warranted by this audit.
2. **Add a native progress watchdog after approval.** Measure monotonic sample/position progress while playback is supposed to be running. Allow measured startup/output-latency grace; distinguish an intentional pause, route interruption and app suspension from a stuck engine. Do not use a short total-duration timeout that rejects a legitimate 30-second chunk. A genuine stall must resolve the owning await exactly once with its last observed position.
3. **Make recovery safe for this failure.** Reset/retire the failed output slot in a scoped way so retry cannot reuse the same stuck departing clip. Retain the exact cached bytes, current part, offset, remaining text and selected voice. Attempt only bounded recovery; otherwise expose the existing Resume/Stop controls with a concise reason. Stop, newer playback or hang-up must win over a late watchdog/retry callback. Never advance a chunk from dispatch alone or replay a completed prefix.
4. **Improve bounded diagnostics.** Record build, attempt/epoch identifiers, automatic/manual origin, engine-running state, duration, position/progress milestones, callback result and enumerated cancellation/pause cause. Preserve a bounded previous-run ring. Store hashes/metadata only, excluding message text, audio, tokens, network URLs and microphone material. Surface detailed diagnostics outside the ordinary conversation.
5. **Require meaningful release evidence.** Make three consecutive same-rate native chunks mandatory before internal distribution, including a long second chunk and the real controller continuation. Test zero-progress startup and mid-clip stalls, failed second download/synthesis, interruption/resume, foreground transitions, cancellation at a chunk boundary, repeated replay, and consistent gain/voice. Validate the actual phone build before calling the incident fixed on-device.

Success criteria: one completion per played part, exact part ordering and source hashes, native progress reaches duration, full 822-character speech text remains represented, explicit recoverable state within the chosen measured stall bound, no silently substituted voice, no duplicate/skipped chunk on retry, and unchanged microphone consent, call state, typed/image drafts and conversation.

The next implementation prompt is saved separately as [assistant-first-chunk-next-implementation-2026-09-12.txt](assistant-first-chunk-next-implementation-2026-09-12.txt). It requires review before execution.

## Physical checks still required

No audible listening, physical iPhone playback test, microphone test, route/lock-screen check or phone installation was performed. Muted native rendering and simulated lifecycle tests establish code behavior, not what came from Cody's speaker. On verified 91+, replay the exact NASA message and a fresh automatic multi-paragraph reply; hear every paragraph in Heart, then test Stop/Resume, headphones/speaker changes, background/foreground and lock/unlock. Confirm the microphone and drafts stay in their prior state. If the symptom remains on 91+, collect the new attempt's metadata before proposing another root cause.

## Evidence and workspace preservation

Audit artifacts: `native/macos/dist/candidates/assistant-first-chunk-audit-2026-09-12/` (ignored canonical candidate directory).

* `exact-conversation-evidence.json`, `nasa-reply.txt`, `nasa-spoken.txt`: exact saved reply/report/job and hashes, limited to the identified incident.
* `original-manifest.json`, `part-001.wav` through `part-003.wav`, `audio-format.json`, `chunk-plan-verification.json`, `actual-http-downloads.json`.
* `phone-playback-events.json`, `phone-copy-receipt.json`, `installed-iphone.json`: read-only device evidence. Production diagnostic format contains no message/audio content.
* `current-service-health.json`, `installed-mac-and-source.json`, `archive-identities.json`, `apple-build-status-readonly.json`.
* `NativeChunkAudit.swift`, exact fixed/DSP copies, reconstructed old-predicate copy, `native-*-results.log`, `AssistantFirstChunkAuditTests.swift`, and test logs. The native runner's preference stub keeps test gain at zero and avoids touching user settings.
* `gather-evidence.mjs` performs exact local record reads, cached GETs and read-only Apple queries; credentials remain in memory. `relevant-service-log-matches.txt` is empty and does not establish that every historical service request succeeded.

Related source/history: [volume-boost report](speech-boost-2026-09-12.md), commit `3dd73e8`; `native/macos/dist/candidates/speech-boost-2026-09-12/` retained failed 90 archive/test and successful 91 receipts/export; `native/macos/dist/candidates/assistant-terminal-coverage-2026-09-12/install-{136,138,139}-verification.json` documents Mac installations.

This audit changed no product behavior, released no build, restarted no app/service, and did not alter the user's microphone, voice/gain selection, actual drafts, queues, research or workspace membership. Disposable tests were copied into the test discovery path only for execution, then removed after checking against their retained audit source.

Unrelated buckets remain preserved: release/storage skill and build/package wrapper edits plus `native/macos/storage-workflow.sh`; plugin manifest/release-skill edits; `assets/wordmark-explorations/`; `cloud/native/`; `marketing-site/`. Their next action is separate owner review/checkpoint. Audit documents are the only intended tracked addition.
