# Assistant transcription editing and clearing

September 9, 2026. Implemented and released in **iPhone 0.7.0 (74), available in ClawDad Internal TestFlight**, for reviewing a live, unsent voice turn. App-server access and the Terminal/ClawDad destination selector remain paused for discussion.

## Behavior

- The pencil beside the live transcription opens its text editor. It synchronously holds the turn, cancels its automatic deadline and pauses microphone capture while keeping the call connected. **Save edits holds; it does not send.** Back closes the editor first, retaining the correction; reopening Assistant messages restores the same held turn.
- Captured audio from before the tap may finish transcribing until the first correction or Save. From that point the displayed, edited text is authoritative. A delayed final result or partial cannot replace it, append old speech or trigger submission.
- Resume listening returns to the existing two-second interval without new transcribed words, with a fresh interval for the reviewed text. Think aloud remains unchanged. A manually muted microphone remains off when choosing Resume turn; the microphone button explicitly resumes listening/unmutes.
- The trash icon opens **Clear this transcription?** with **Clear** and **Cancel**. The turn is held before showing the confirmation. Cancel preserves it and leaves it held, avoiding immediate submission after an expired deadline. Clear removes only that unsubmitted voice turn, fences late transcription results and readies a fresh turn. A manually muted microphone stays muted.
- The existing chat Send finishes the held voice turn when its typed composer is empty, including while muted. Typed text and images retain their existing separate Send behavior. Already committed earlier voice turns retain their request IDs and delivery retries.
- Clear preserves separate typed drafts, image bytes, accepted messages and history. Ending a call with a held correction saves it through the existing unsent-voice recovery store. Ending a call after Clear does not recover discarded speech. This does not claim survival of an abrupt OS termination before a held turn has been saved through that recovery path.
- Icons have distinct accessible names and 44 × 44 point targets. Editing and Held have text state cues. Settings > Icon glossary explains both controls, the capture pause, Save, Cancel and Resume behavior.

## Implementation and boundaries

`MobileAssistantController` owns the review state so navigation does not own or reset the draft. Native `muteCapture(finishingUtterance:)` closes the audio mailbox at the tap boundary and drains only pre-tap samples. No new listening mode, speech-command recognizer, backend, model or permission changes were introduced.

Pending final transcription is tracked by its exact voice-turn object and a worker generation. Editing and clearing detach only that turn's outstanding work. The global input epoch is preserved so an earlier accepted or reconnecting submission is not discarded. Canceled workers cannot overwrite a replacement worker, remove its queue item or resume a discarded turn.

Further race handling covers opening another review during an unfinished microphone Resume: both the controller operation and native capture restart are invalidated. A failed final transcription during editing leaves its visible partial available for correction, held for review. SwiftUI alert dismissal and Clear/Cancel actions are separate so framework callback ordering cannot release the hold or lose the exact clear target.

This scope changes no Terminal tool, tab draft, native queue, app-server route or Remote Assist menu organization. No call or microphone was activated on Cody's phone for verification.

## Verification

Evidence directory: `native/macos/dist/candidates/assistant-transcription-review-2026-09-09/`.

| Check | Evidence/result |
| --- | --- |
| Full mobile suite | `mobile-tests-final.log`: 204 tests executed, 203 passed, 1 pre-existing opt-in live voice test skipped; zero failures. |
| New review regression tests | 15 tests cover editing at 1.8 seconds before a real two-second deadline; pending final/partial results; late discarded results; empty and multiline corrections; one explicit Send; Clear/Cancel; fresh Resume deadline; muted/Think aloud modes; preserved typed text/images/history; reconnect with original delivery ID; unfinished microphone Resume; empty final STT; held recovery after call end. |
| Existing timing regression | `MUTE_TIMING lastNewTranscriptToSubmitMs=2020.029`: approximately 2.02 seconds in the synthetic transport test. This is controller timing evidence, not a physical microphone/network latency measurement. |
| Release metadata | `release-tests.log`: 11 tests passed. |
| Large iPhone simulator | `transcription-ui-fixed.xcresult`: all 3 initial review flows passed after fixing an inherited accessibility identifier that hid the separate icon identities from automation. |
| Compact iPhone SE (third generation) | `compact-ui.xcresult`: 8 scenarios passed, including all 3 review flows, muted Think aloud Send, live transcription, image-only recovery, photo draft persistence and glossary navigation. |
| Final UI coverage | `final-ui.xcresult`: 4 scenarios passed with explicit accessible icon names/target sizes, editing/held states, Clear/Cancel and the new glossary explanations. `accessibility-controls.xcresult`: the large-text review flow passed again with explicit checks that Send, microphone and hang-up remain hittable. |
| Visual review | Exported `ui-attachments/`, `compact-attachments/`, `final-attachments/` and `accessibility-attachments/`. Reviewed the native editor/keyboard, held text, confirmation and glossary at standard and accessibility text sizes. Small layouts use vertical scrolling; VoiceOver itself remains a physical check. |
| Signed iPhone archive | Release archive 0.7.0 (74), correct bundle ID, `codesign --verify --deep --strict` passed. |

Simulator tests exercise the actual SwiftUI controls, native alert, text editor, Send action and navigation with isolated debug transport/voice fixtures. They do not transcribe a physical microphone or execute Terminal work. Photos tests retain actual image bytes in the fixture delivery path.

## Release status

Build **0.7.0 (74)** archived, signature-verified and uploaded successfully. App Store Connect verification at **2026-09-09 07:26:59 UTC** reports **VALID**, **IN_BETA_TESTING**, assigned to **ClawDad Internal**, with matching test notes (`testflight-verification.json`). The existing WebRTC missing-dSYM warning did not prevent upload or processing. `archive-source-verification.json` records the archived executable hash and functional source hashes; the functional files were rechecked unchanged after upload.

Existing Mac **0.7.0 (84)** is installed and supports this iPhone-only change. Read-only physical device inventory reports iPhone **0.7.0 (73)** currently installed. No Mac restart was performed. Cody should update the phone to **74 in TestFlight**.

## Remaining physical iPhone checks

1. While speaking, tap pencil just before auto-send. Correct the final words and Save; verify silence/room noise cannot append to the correction. Leave/reopen messages, then Send once from the empty composer.
2. Repeat with Think aloud enabled and with the microphone manually muted. Verify Resume turn preserves mute, and explicit microphone Resume restores capture.
3. Open Clear while final transcription is pending. Cancel should retain a held draft; Clear should remove it without later reappearance. Speak a fresh phrase after clearing and verify only that phrase is delivered.
4. Verify microphone capture actually pauses and restarts at the hardware boundary, including route changes/interruption and reconnect; confirm audible reply, keyboard/editing ergonomics, VoiceOver labels and tap targets on Cody's phone.

Typed drafts, images and existing history should remain intact throughout. Physical microphone, OS audio-route, VoiceOver and audible behavior remain unverified by the simulator evidence above.

## Workspace preservation

The pre-existing nine dirty paths remain outside this change: the two release skill copies, native build/package/storage scripts, plugin manifest, `assets/wordmark-explorations/`, `cloud/native/` and `marketing-site/`. Their next action is separate review and verification in their packaging/integration, branding, cloud and marketing lanes before any checkpoint or publication. Only the audited Assistant iPhone implementation, tests, generated project, build metadata and this report belong in this scoped checkpoint. Hygiene is classified with zero unclassified paths; the final checkpoint preserves all nine unrelated entries.
