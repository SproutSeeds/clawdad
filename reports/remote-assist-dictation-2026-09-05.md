# Remote Assist dictation implementation and release

September 5, 2026 (America/Chicago)

Status: Implemented, tested, and released to internal TestFlight as iPhone build
37. Matching Mac build 45 is installed and healthy. The physical iPhone last
reported build 35; the user has been asked to update and test the two destinations.

## Approved behavior

- The Remote Assist **…** menu has a microphone beside the keyboard control.
- Tap to start, tap Stop to transcribe, and review or edit the resulting text.
- **Use on Mac** first writes the reviewed text to the Mac clipboard, then
  inserts it when the foreground app has a suitable focused text input. With no
  suitable input it reports **Copied to clipboard**. No Enter key is sent.
- **Copy to iPhone** supports pasting into other phone apps.
- Back closes the panel; Back and Cancel both stop active recording or
  transcription. Completed drafts survive panel dismissal and reconnects.
  Failed or interrupted transcriptions retain the recording in memory for an
  explicit retry.

The implementation follows `docs/remote-assist-dictation.md`.

## Implementation

The composer and Remote Assist share the extracted `VoiceRecorder`. Microphone
permission requests have cancellation guards, and recording files/audio sessions
are cleaned up when recording stops or the panel closes. Backgrounding stops
capture and retains the recording for retry.

`RemoteDictationDraft` owns its transcript, retained recording, cancellation
generation, and delivery request ID. The existing CloudSession transcription
path supports an owned completion callback, so Remote Assist results cannot
append to the ordinary composer. Remote dictation uses the host's default project
context rather than depending on a previously selected composer project.

The clipboard protocol adds an acknowledged dictation action and explicit
`inserted`/`copied` results. The Mac checks the current foreground accessibility
element rather than reactivating an old pointer target. Disabled, unfocused,
read-only, secure, or unknown fields fall back to clipboard storage. Terminal's
focused text area has an explicit policy exception because it also exposes
read-only output. The ordinary clipboard copy/paste actions keep their behavior.

Mac delivery receipts suppress duplicate insertions for the same request within
the remote connection. The phone coalesces taps while delivery is pending and
preserves the draft when an acknowledgment is lost. It never automatically
replays an insertion after reconnecting. Old hosts advertise no dictation
capability; transcription and Copy to iPhone remain usable there.

## Verification

| Check | Result |
| --- | --- |
| Full runtime suite | 473 passed |
| iPhone Swift suite | 62 passed, including 6 dictation regressions |
| Native Mac Swift suite | 75 passed, including 4 dictation delivery/policy tests |
| Shared Remote Assist protocol suite | 33 passed, including 3 new compatibility/outcome checks |
| Focused source/release checks | 65 passed |
| iPhone UI test | Passed: edit, copy to iPhone, Back, reopen, retain edited draft |
| Simulator visual review | Dictation panel inspected; transcript and both destination controls readable |
| Live local STT | HTTP 200 using synthetic audio, existing doc-reader/base engine, 962 ms |
| iPhone Release archive/export | Build 37 succeeded, signature verified, IPA exported |
| Apple processing/internal assignment | Build 37 VALID and assigned to ClawDad Internal |
| Mac signature/notarization/Gatekeeper | Passed; build 45 installed |
| Installed Mac process/UI/service | UI loaded; native service healthy on 4487; shared Codex app-server ready |
| Installed executable integrity | SHA-256 matches the tested/signed candidate executable |

The synthetic STT input and actual recognized wording are preserved in
`reports/remote-assist-dictation-stt-smoke-2026-09-05.json`. This verifies the
existing transcription service, not physical microphone capture or perfect
recognition. The editable preview lets the user correct recognition errors.

The UI test uses a DEBUG-only preview fixture and makes no real remote insertion.
The screenshot is in
`apps/ios/ClawDadMobile/build/dictation-ui-review/D3429E33-AEA5-4FEE-BC75-233C42826BCC.png`.
The test result bundle is `apps/ios/ClawDadMobile/build/DictationUITests.xcresult`.

## Release evidence

- iPhone: 0.7.0 (37), Apple build ID `b1f60d8e-9b49-4373-9195-44de4cc1465c`.
- Internal group: ClawDad Internal. The external group remains unassigned.
- Mac: 0.7.0 (45), `/Applications/ClawDad.app`.
- Mac ZIP: `native/macos/dist/candidates/remote-dictation-2026-09-05/ClawDad-0.7.0-45-mac.zip`.
  SHA-256 `aaefbbe31533ed7cd3bb875f68e3f62a0b250444ebe1015d366633467c840fc8`.
- Notarization: `499904ba-4d7a-49de-a98b-477d038b3986`, Accepted;
  receipt `native/macos/dist/candidates/remote-dictation-2026-09-05/notary-app-45.json`.
- iPhone archive: `apps/ios/ClawDadMobile/build/ClawDadMobile-Dictation-37.xcarchive`.
- IPA: `apps/ios/ClawDadMobile/build/Dictation-AppStore-37/ClawDad.ipa`.
  SHA-256 `5bbd1b73e12cd0530ed41e3eb7047712fd5db9322fb25f5cc5430b690a297487`.
- Installed/candidate Mac executable SHA-256:
  `1bddb6e3ed65434cc25252a808bca78afa76ffca2f9c7e7a09da0bc24838dcd8`.

Previous Mac builds remain in the existing App Backups directory. Build 44 was an
intermediate candidate; build 45 is the final Terminal-compatible release. The
native runtime package version remains 0.7.0-beta.20. Public npm, GitHub releases,
appcasts, external beta, and App Store review were not changed.

Apple accepted the iPhone upload with the existing WebRTC dSYM warning. This
limits framework crash symbolication; it did not block processing or distribution.

## Remaining physical acceptance

1. Install TestFlight build 37, retaining the existing pairing.
2. Focus a Terminal prompt or browser input on the Mac. Dictate, edit, and tap Use
   on Mac; verify insertion and separately press Enter when desired.
3. Focus an empty/non-input area. Repeat; verify Copied to clipboard and paste
   the transcript into an input afterward.
4. Verify Copy to iPhone, Back/reopen, cancellation, and reconnect/retry.

## Worktree checkpoint

The scoped commit includes native/iPhone implementation, shared protocol, tests,
generated Xcode project, build 37 release metadata, this evidence, and the plan.
Only the five pre-existing classified paths remain outside the commit:

- `.agents/skills/clawdad-release/SKILL.md`
- `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`
- `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`
- `assets/wordmark-explorations/`
- `marketing-site/`

Those integration, creative, and website changes remain for their owners'
separate review/checkpoints. Generated archives and verification artifacts are in
the ignored native/iPhone build paths above. No unclassified dirty paths remain.
