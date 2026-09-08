# Assistant turn taking and conversation access — September 7, 2026

The user confirmed that build 58 captured speech and began responding, then
reported that microphone audio cut the reply short. This patch removes automatic
voice interruption and adds clear access to the conversation from the call bar.
The private iPhone release is **0.7.0 (59)**, paired with Mac build **71**.
Build **59** is available in **ClawDad Internal TestFlight**.

## Behavior

- The Assistant finishes its spoken reply before accepting microphone input
  again. The hold covers preparation, every audio part, and gaps while more
  audio is generated. The audio engine continues receiving buffers throughout.
- **Interject** stops playback, skips later spoken items belonging to that same
  response, and resumes listening. The written response remains in the thread.
  It does not cancel project tasks already running in Terminal.
- Manual mute remains independent. Muting during a reply lets playback finish
  and leaves the microphone muted afterward. Interject explicitly unmutes it.
- The message-bubble button opens the same Assistant conversation from the main
  call bar, Remote Assist, and the Settings, Files, Tools, and project sheets.
  Back closes the conversation while the call continues.
- A provisional **You · Speaking** entry updates as the Mac recognizes speech.
  Previews are requested at most once every three seconds, with at most one
  pending preview. Slow previews are skipped; final transcription takes priority.
  Only final transcription is submitted to the agent. A late preview cannot
  overwrite final text or create a duplicate message.
- Both transcription and speech synthesis use the existing selected local Mac
  models over the paired connection. This repair adds no cloud audio processing
  or cloud file storage.

## Cause and implementation

`MobileAssistantController` called `interruptSpeech()` whenever the voice
detector reported speech onset. A microphone signal, including speaker bleed,
therefore cancelled playback and discarded the queued remainder of the reply.

The controller now owns the reply-wide input hold and exposes an explicit
Interject action. `AssistantListeningInput` excludes held or muted samples from
voice detection, clears partial speech at transitions, and rejects audio captured
during the 350 ms speaker tail. Audio callbacks retain their capture timestamp,
so queued callbacks cannot reintroduce playback audio after the hold ends.
Capture monitoring and build 58's matched audio graph remain in place.

A reply waits for an existing user utterance and its transcription to finish.
Muted audio, partial previews, and acoustic tails cannot cancel a reply. Playback
completion, cancellation, and synthesis failure release the temporary hold;
generation checks prevent late synthesis results from restarting stopped speech.

The shared detector exposes a read-only pending-speech snapshot for previews.
This leaves the existing full recording, endpoint detection, and final
transcription intact. The Mac's wire protocol and runtime require no update.

Audio and transport interfaces let regression tests exercise the real call
controller with delayed synthesis and transcription responses, without opening
Terminal windows, invoking Codex, or capturing a person's microphone.

## Verification

| Check | Result |
| --- | --- |
| Mobile Swift suite | 125 passed |
| Shared protocol suite | 64 passed |
| Assistant UI suite | Six passed |
| Runtime/release suite | 541 passed in the final serial run |
| Visual review | Call bar and live-transcription conversation screenshots inspected |
| Local speech requests | Three-second preview and complete synthetic recording both transcribed successfully |

Regression coverage includes noise during playback, gaps between generated audio
parts, manual mute, explicit Interject, late synthesis after Interject, synthesis
failure, final transcription replacing previews, preview coalescing, and waiting
for an existing utterance. UI checks cover navigation persistence, conversation
access from Settings, visible Interject controls, and transcription updates.

The first full runtime run had four timing-related failures while Swift builds
and simulator startup ran concurrently. These were in unchanged dispatch and
registry tests. The complete suite then passed serially, with no changes to those
tests or their implementation.

The local speech check used the selected Kokoro `kokoro-82m-v1` voice `af_heart`
to prepare a two-part synthetic recording. The existing local STT endpoint
recognized the short preview in 730 ms and the complete recording in 678 ms.
This verifies the speech request path without submitting a message to Codex.

The simulator uses controlled conversation fixtures. A physical iPhone check of
an audible complete reply, followed by automatic listening and a deliberate
Interject, remains required after updating TestFlight. The earlier build-58
physical capture verification remains useful but is not claimed as acceptance
of the new turn-taking behavior.

## Release and workspace

Canonical evidence is in the ignored directory
`native/macos/dist/candidates/assistant-turns-2026-09-07/`: test logs, UI result
bundle and screenshots, signing/archive receipts, and private TestFlight status.

The signed build-59 archive passed strict deep signature verification. Its
executable SHA-256 is
`af317a301f60f52438df654af6c010ff45220b2d5a57788f620f35cc4a76635d`.
Apple accepted the upload and verified build
`675be701-2f7d-4d09-8133-c8083be2033e` at `2026-09-08T04:21:45.169Z` as
`VALID` and `IN_BETA_TESTING`, assigned to **ClawDad Internal**, with matching
testing notes. The existing prebuilt WebRTC dSYM warning remains; no new
warnings were added in the changed Assistant sources.

Mac health and Assistant state both returned HTTP 200, with the native bridge
online and the coordinator ready. The test simulator is shut down.

This patch is limited to iPhone call behavior/UI, the detector's preview accessor,
regressions, iPhone build metadata, and this report. Mac build 71 stays installed.
The existing nine dirty paths are preserved, with their original next actions:

| Existing paths | Next action in their original lane |
| --- | --- |
| `.agents/skills/clawdad-release/SKILL.md`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Reconcile release-skill revisions. |
| `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Review and commit the plugin metadata update. |
| `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh` | Audit and checkpoint storage/build workflow changes together. |
| `assets/wordmark-explorations/` | Curate existing branding artifacts. |
| `cloud/native/` | Review and canonicalize existing generated cloud/native material. |
| `marketing-site/` | Review and release existing marketing work separately. |
