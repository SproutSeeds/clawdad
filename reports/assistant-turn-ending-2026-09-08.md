# Assistant voice turn ending — September 8, 2026

Mac **0.7.0 (79)** is installed, notarized, and healthy. iPhone **0.7.0 (67)**
is available in **ClawDad Internal TestFlight**. Apple reports VALID and
IN_BETA_TESTING; the internal assignment and testing notes were verified.

## Diagnosis and resulting behavior

The previous automatic-send timer depended on the audio detector reporting an
utterance ending. Background sound could keep that detector active while live
transcription was already visible. Repeated partial text did not provide an
independent way to finish the turn. The older persisted “Wait for Send” setting
could also keep a turn open. The two retained physical-phone timing records were
manual sends, with approximately 0.465–0.689 seconds from final audio to sending;
they did not record the last spoken word or playback start. They cannot establish
where Cody's entire reported ten-second wait occurred.

Automatic mode now uses a **four-second pause** measured from captured speech
that extends the recognized words. Case, punctuation, repeated partial text,
and retracted partial hypotheses do not restart that deadline. New speech gets
a bounded recognition grace period. If the detector still reports speech at the
deadline, the controller asks for a fresh transcription checkpoint before
treating unchanged words as background sound. A pending or stalled transcription
does not authorize cutting off active speech.

The controller flushes the recording and incorporates final STT before sealing
the turn. Late final words use their audio capture time; they do not acquire an
extra four-second delay simply because transcription arrived late. Finalization
can extend submission beyond four seconds when recognition itself is delayed.
Previews remain provisional. The accepted message keeps one stable request ID
through connection recovery, and finishing a turn leaves the call connected.

**Think aloud** is a visible toggle above the Assistant chat composer during a
call. It starts off, including for an installation carrying the older pause
preference. Explicitly turning it on keeps the speaking turn open through long
pauses until Send is tapped. The existing call-bar Send, mute, hangup, Interject,
text/image drafts, and connection recovery remain available. The Remote Assist
icon layout was not changed in this patch.

Numeric diagnostics now distinguish last words, final transcription, submission,
response observation, and playback startup. Later timing reports merge into the
accepted task without replacing earlier stages. Playback timing belongs to the
matching voice request, so another queued reply cannot satisfy its measurement.

## Measured pipeline

The opt-in live test fed a synthetic recording in real time through the actual
mobile controller and audio detector. It used the installed Mac's local STT,
existing Codex Assistant conversation, and selected local TTS. The transport was
authenticated localhost HTTP; the output was decoded PCM ready for playback.
These figures exclude the physical iPhone microphone, phone-to-Mac transfer,
speaker rendering, and cellular network conditions.

| Stage | Warm reply recording | Fresh uncached reply recording |
| --- | ---: | ---: |
| Last detected speech → utterance endpoint | 0.981 s | 0.991 s |
| Endpoint → final transcript | 0.751 s | 0.666 s |
| Last detected speech → final transcript | 1.732 s | 1.657 s |
| Last recognized word capture → final transcript | 1.732 s | 1.801 s |
| Final transcript → submission | 2.330 s | 2.295 s |
| Last recognized word capture → submission | **4.061 s** | **4.096 s** |
| Last detected speech → submission | 4.062 s | 3.954 s |
| Submission receipt round trip | 0.009 s | 0.024 s |
| Waiting in the existing coordinator queue | 0.007 s | 0.017 s |
| Coordinator start → first response | 12.994 s | 7.510 s |
| Submission → response observed by controller | **13.016 s** | **7.749 s** |
| Response observed → decoded audio ready | **0.043 s** | **0.774 s** |
| Submission → decoded audio ready | 13.059 s | 8.523 s |

The last-word metric uses the captured audio timestamp associated with lexical
progress, with the detector's final voiced audio frame as the measurement
reference; this is not forced alignment of each individual spoken word. A word
may be recognized in a preview before its voiced tail ends. The live check
therefore verifies both a four-second lexical deadline and the requested
three-to-five-second audio pause, instead of treating those timestamps as
identical. An earlier check's 3.9-second lower bound on voiced-tail timing was
too strict: that recording submitted 4.090 seconds after word progress and
3.843 seconds after the final voiced frame. Both timestamps are retained in the
evidence. The corrected live check also asserts the four-second lexical bound.

An earlier probe submitted in 4.053 seconds but waited **42.748 seconds** behind
existing Assistant work before its own generation started. Its first response
took another 25.737 seconds. That queue was preserved. The first version of the
test observed a different reply during that wait; its playback number was
discarded and the test was corrected to correlate the delivered request ID.
The four-second setting controls turn submission, not Codex generation time or
the completion of work already ahead of it.

Both verified runs retained a connected call and one submission. The fresh run
used installed Mac 79 and ended with its own completed Assistant request. Local
speech selection remained **Kokoro 82M / af_heart / speed 1**, with existing local
STT. The desktop harness decoded 52,800 PCM frames from the fresh reply. Actual
iPhone playback telemetry marks the audio player's start request, not a measured
acoustic onset at the speaker.

## Verification

| Check | Result |
| --- | --- |
| Mobile Swift suite | 164 executed: 163 passed; the opt-in live test skipped in the ordinary suite. |
| Four-second real controller test | No submission at 3.7 seconds; one submission between 4.0 and 4.5 seconds; call stayed connected. |
| Normal pauses and resumed speech | Segments stay in the same thought; new words move the deadline. |
| Repeated partials and background noise | Fresh unchanged checkpoints allow automatic finalization; authoritative final words are sent once. |
| Delayed transcription | Active speech stays recorded; final words are retained; late partials cannot overwrite or duplicate the submission. |
| Think aloud | Long simulated pauses retain the draft until manual Send; the new preference is off by default. |
| Real recorded-speech pipeline | Warm and uncached runs passed: one accepted message, one delivery ID, response from that request, valid decoded local TTS, and call still connected. |
| iPhone Assistant UI suite | 12 passed, including Think aloud interaction, existing manual Send, image draft retention, failed sends, navigation, and explicit Chat/Call controls. Exported Think aloud and call-bar screenshots were inspected. |
| Mac Swift suite | 200 executed: 194 passed; six existing opt-in checks skipped. |
| Runtime suite | 559 passed on the final run. An existing owned-approval fixture failed under concurrent build load, then passed its focused check and the full rerun. |
| Final release configuration | 11 passed for build 67. |
| Installed Mac | Signature, notarization, staple, Gatekeeper, native health, Assistant availability, and bundled/runtime source hashes verified. All 12 tabs, their titles/positions, and the single window grouping were retained. |
| TestFlight | Build 67 VALID, IN_BETA_TESTING, assigned to ClawDad Internal, testing notes matched. |

Pre-release testing found and fixed an additional deadline edge case: delayed
final STT could otherwise use the initial speech-onset timestamp and submit too
early. A regression now verifies that the deadline follows the final words.
The simulator also exposed a toggle label hit area that did not toggle on tap;
the switch now has its own tested control area. Uploaded iPhone candidate 66 was
withheld from the internal group; the corrected archive is 67.

Physical iPhone acceptance remains: install 67, speak a sentence and pause,
resume before four seconds, try steady room noise, test a deliberately slow
recognition/network response, and turn Think aloud on for a long pause followed
by Send. Confirm one message, complete final words, an audible full reply, and a
connected call afterward. Microphone capture, acoustic noise discrimination,
real phone transport, and audible playback cannot be certified by these desktop
and simulator checks.

## Release evidence

Private logs, test results, recordings, timing JSON, exported UI images, native
archives, and retained Mac rollback bundles are under
`native/macos/dist/candidates/assistant-turn-ending-2026-09-08/`.

- Mac notarization: `8ba50704-fb7c-4545-b59f-17f3531042c0`.
- Mac executable SHA-256: `b3992a027e7398f3978502a60a7585977b26415faaafb6224238713baaa4e52b`.
- Installed runtime bundle: `8a539db808ac728a6abad08f154fb4068f224da8ab69a2fc95d5231293c6b8b5`.
- iPhone executable SHA-256: `0d2afa9c896e642a6ea659414d41dec7965562f534e41f37e43cc365137418df`.
- Apple build ID: `60f73f7c-9aec-47f7-a3df-08d96829449a`.
- Internal TestFlight assignment verified at `2026-09-08T19:02:46.391Z`.

This follows the private native release lane. The public Git remote has 47
earlier local commits ahead of its upstream. This work is checkpointed locally;
publishing the accumulated private native history, npm, external beta, or an App
Store release is outside this repair.

## Preserved work

ORP hygiene reports no unclassified paths. The following nine pre-existing dirty
paths remain outside this patch and retain their own next actions.

| Existing paths | Next action |
| --- | --- |
| `.agents/skills/clawdad-release/SKILL.md`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Reconcile release-skill revisions. |
| `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Review and commit plugin metadata. |
| `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh` | Audit and checkpoint storage/build workflow changes together. |
| `assets/wordmark-explorations/` | Curate branding artifacts. |
| `cloud/native/` | Review and canonicalize generated material. |
| `marketing-site/` | Review and release marketing work separately. |
