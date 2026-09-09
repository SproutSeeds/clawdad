# Assistant voice and Terminal draft repair

Scope: Cody's latest request removes voice mute/unmute recognition while repairing ordinary Assistant voice delivery and native Terminal draft editing. Broader Remote Assist icon changes remain outside this patch. Private native release only; no public npm, GitHub release, or tag publication.

## Confirmed findings

- The installed Mac was 0.7.0 (81), and the paired iPhone was 0.7.0 (69). A read-only preferences audit found all three retired command preferences false at inspection. The earlier reported unavailable state therefore cannot explain every subsequent voice failure by itself. No live microphone setting was changed for testing.
- Build 69 retained the enabled preference after local command recognition failed. Its failure and finalization-timeout paths fully muted capture and discarded the pending voice turn. Background handling with commands enabled could do the same. The adapter discarded the underlying recognition error category, so the exact historical Apple recognizer failure cannot be recovered from diagnostics. No private recording was collected to reconstruct it.
- Separately, the normal voice path replaced a visible preview with finalized-only text as final transcription began. The preview could disappear while the final request was still pending. Capture recovery also counted two attempts across the entire call, including successful earlier recoveries, allowing later independent interruptions to exhaust recovery.
- Retained diagnostic inspections show the expanded Erdos draft had sixteen lines; the old composer parser rejected eight or more lines regardless of the actual 48-row Terminal viewport. The ClawDad failure was a different case: a collapsed paste whose hidden text was intentionally unavailable to the old editor. Both real project inputs were empty during the new read-only audit; destructive checks use a separate disposable tab.
- The live fixture exposed another existing inconsistency: Send searched only the last twelve captured rows, so a correctly cleared input followed by Terminal's blank viewport padding was reported as an existing draft. Send now uses the same complete composer observation as inspection. This additional repair is included in the final Mac build 83.

## Implemented behavior

### Voice

- Removed the command recognizer, command settings, and Apple Speech recognition permission from the iPhone app. Retired preference keys are ignored. There is no command-only microphone mode or command recognition cloud fallback.
- Manual mute fully stops capture while keeping the call connected. Unmute is an explicit user action and starts a fresh capture boundary. Previously buffered speech is never replayed across that boundary.
- Keep the current transcription preview visible until final transcription finishes. Retry an unexpectedly empty final result once; if it remains empty, preserve already visible words separately as **Unsent voice · Review**, and continue the conversation. Hardware capture failure also preserves already visible, unsent words before pausing the microphone. Potentially accepted requests are excluded from recovery to prevent duplicate delivery.
- Recovered voice text survives conversation closure and app restart without replacing typed text or images. **Use in message** explicitly appends it to the typed draft; **Discard** explicitly removes it. No audio recording is persisted by this recovery feature.
- Reset consecutive capture recovery failures after ten seconds of healthy input. Route and interruption diagnostics contain only a bounded set of lifecycle events, permission state, sample rate, and audio-port types. They contain no speech, transcript, audio samples, device names, or utterance identifiers, and remain locally stored with backup excluded.
- Existing four-second turn ending, Think aloud, manual Send, reply playback, typed drafts, attachments, and request deduplication remain in place.

### Native Terminal drafts

- Inspect the actual TTY dimensions, complete composer, foreground process identity, exact native tab identity, and Codex session. Return specific reasons for clipping, overlays, attachments, unsupported paste representations, or stale inspection.
- Fully visible multiline drafts receive an editing token. Collapsed text receives a token for its visible representation plus `requiresWholeDraftAuthorization=true`; hidden content is never guessed from an earlier insertion receipt.
- `clear_tab_input` and `replace_tab_input` accept `allowWholeDraft=true` only for Cody's explicit authorization to discard the entire opaque draft. Supported nonempty Codex drafts use the verified native clear control once, observe an empty composer, and optionally paste the exact replacement once. These operations send neither Enter nor Tab.
- Tokens expire, bind to the current tab/session/foreground process, and are invalidated by native mutations and observed user interaction. Restarted hosts and changed catalog identities fail closed. Native clipboard delivery verifies the exact replacement together with the rendered composer or collapsed character count. A failed or uncertain receipt never automatically repeats a mutation.
- Attachments, unresolved prompts, and clipped composers remain protected. Accepted agent queue entries are separate from draft clearing. Stable request IDs replay the existing receipt and reject changed payloads or authorization.
- Updated the Assistant's native tool schemas and Terminal instructions with multiline/whole-draft authorization and useful recovery guidance.

## Verification and release checkpoint

Evidence directory: `native/macos/dist/candidates/assistant-voice-drafts-repair-2026-09-08/`.

Automated checks:

- Runtime: **578 passed**, no failures or skips. The initial broad run had six failures in unrelated approval/registry timing and temporary-directory teardown under concurrent build load; the complete serial recheck passed without changing those unrelated tests or implementation. Both logs are retained.
- Mac: **219 discovered, 211 passed, 8 opt-in live checks skipped**, no failures. Includes the actual viewport-padding Send regression, expanded and collapsed drafts, changed text, uncertain clear/paste, and existing native queue and permission protections.
- Mobile: **182 discovered, 181 passed, 1 opt-in live check skipped**, no failures. The recorded-service voice check was then explicitly run and passed separately.
- iPhone simulator: **16 distinct Assistant UI scenarios verified**. Fourteen passed in the full run; the two affected cases passed on recheck after fixing inherited accessibility identifiers on recovered-voice buttons and a Paste-menu timing race in the test. Covers explicit calling, full manual mute, recovered voice after relaunch, typed/image drafts, copying, links, task history, and existing navigation.

Recorded voice through the real controller, installed Mac STT, existing Codex Assistant, and local TTS:

| Measurement | Observed |
| --- | ---: |
| Last spoken word to one submission | 4.123 s |
| Final audio segment to final transcript | 0.954 s |
| Submission to readable response observed | 9.706 s |
| Response observed to decoded playback-ready PCM | 1.519 s |
| Submission to decoded playback-ready PCM | 11.225 s |
| Assistant coordination queue | 0.047 s |

The call remained connected, exactly one request was delivered, and 42,000 reply frames decoded. The Mac test driver supplied an existing synthetic recording; it did not open Cody's microphone or play sound aloud. This timing was measured on installed Mac build 82; build 83 changes only the native Terminal empty-composer check, and its identical voice runtime is verified by hashes. This is service/controller evidence, not physical iPhone latency or an acoustic privacy test.

Live native verification, through the installed app's authenticated Assistant tools:

- Empty clear performed no clear keystroke. Short and multiline replacement, sixteen-line expanded input, collapsed clear, and long Unicode replacement all returned verified receipts with `submitted=false`. A collapsed paste was preserved when whole-draft authorization was omitted.
- History-recalled collapsed input could be cleared after fresh inspection and explicit whole-draft authorization. Earlier tokens were rejected after native history/cursor changes. A changed-text test using the same authorized native Backspace control preserved the edited draft; conflicting request payloads could not reuse a completed request ID.
- The same disposable TTY and Codex session survived both host upgrades. Old catalog IDs and tokens were rejected. Exiting and relaunching the disposable CLI in the same TTY produced a new verified session identity; an insertion carrying the old session ID was rejected with an empty new input preserved.
- While a disposable Codex **0.153.4** agent ran one `sleep 240`, short and collapsed draft clear/replacement left the task working and its accepted queue entry intact. A second follow-up was then queued. The original and both queued messages completed once, in order, with distinct turn IDs and exact expected responses. Repeated queue request IDs returned their original receipts. The sleep exited successfully; edited drafts were never submitted or queued.
- A real image was attached through `attach_images_in_tab` without submission. Inspection returned `attachments_present`, and whole-draft editing was refused with the image preserved.
- Cleanup closed the disposable tab through native close/confirmation controls. **All thirteen original tabs, their draft hashes, left-to-right layout, and the selected ClawDad tab were preserved.** The single fixture README was removed; diagnostic receipts and test transcripts remain available.

Limits observed during the checks: one read-only inspection timed out and recovered on fresh inspection without repeating a mutation. A deliberately inserted `/exit` opened Codex's slash-command menu; ordinary draft verification correctly refused the unresolved menu. Its exact visible command was then confirmed through the explicitly authorized native Enter tool once. The cleanup harness initially stopped on the expected confirmation state, allowing that token to expire; the native app kept the tab open, and a fresh verified close completed with its confirmation handled immediately. These diagnostic receipts remain in the evidence directory.

Release receipts:

- **Mac 0.7.0 (83): signed, Apple notarization Accepted, stapled, installed, and healthy.** Installed executable SHA-256: `3820de1784218e7534fa0cb5a05103deb2e0855b298168157cfc4b417187d06d`. Native control, runtime source hashes, existing Assistant workspace instructions outside the managed tool block, and Terminal layout verified. Build 82 was an intermediate installed checkpoint superseded by 83.
- **iPhone 0.7.0 (70): uploaded, VALID, IN_BETA_TESTING, assigned to the existing ClawDad Internal group**, with matching testing notes. Final archive excludes the Speech-recognition permission and includes the revised recovery controls. Apple reported the existing missing third-party WebRTC dSYM warning; upload and internal distribution succeeded.
- A final read-only device check still found **build 69 on Cody's iPhone**. The TestFlight update remains Cody's action. No microphone preference, listening state, or speech consent was remotely enabled for verification.

## Setup and physical-device checks

After the new iPhone build is available, install it from ClawDad Internal TestFlight. Open Assistant text chat or explicitly choose **Call Assistant**. Use the microphone button for full mute/unmute; there is no Voice controls setup or spoken reactivation in this build. **Think aloud** remains optional. If a route interruption pauses capture, tap the microphone button when ready; already visible unsent words are available under **Unsent voice · Review**.

Physical iPhone checks remain necessary for real microphone routing, acoustic/background noise behavior, Bluetooth and phone-call interruptions, long background sessions, haptic/audible behavior, microphone-off privacy verification, and battery consumption. Simulator assertions and recorded-fixture service timing do not establish those results. Removing the parallel recognizer removes its processing path; this patch does not claim a measured battery improvement.

For Terminal, inspect the exact tab immediately before editing. Explicitly authorize whole-draft clearing/replacement for collapsed text. If the composer is clipped, enlarge the Terminal window and inspect again; if images or a prompt are present, resolve those in Terminal before text editing. No generic Computer Use fallback is used to bypass a refusal.

## Workspace hygiene

The following pre-existing work is preserved and excluded from this implementation's commit:

- `.agents/skills/clawdad-release/SKILL.md`
- `native/macos/build-app.sh`
- `native/macos/package-release.sh`
- `native/macos/storage-workflow.sh`
- `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`
- `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`
- `assets/wordmark-explorations/`
- `cloud/native/`
- `marketing-site/`

Next action for these existing buckets remains their owning release-workflow, plugin, branding, and marketing work; this repair does not incorporate or revert them. Pre-commit hygiene reports `dirty_classified`, zero unclassified paths, and `safeToExpand=true`. Final diff, commit, and hygiene receipts are recorded in the evidence directory.
