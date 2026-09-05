# Remote Assist inline speech release

September 5, 2026. Released: Mac 0.7.0 build 50 installed at
`/Applications/ClawDad.app`; iPhone 0.7.0 build 42 VALID and assigned to
ClawDad Internal. Physical iPhone acceptance remains pending.

## Problem and resulting behavior

Cody's iPhone screenshots showed both speech controls saying the Mac needed an
update while build 48 was installed. The Mac sent capabilities when the data
channel opened and on lock changes. The iPhone installed its receiver asynchronously
and had no state request, so a lost startup advertisement could leave both controls
disabled. Missing optional capability fields were also treated as false. The
screenshots are consistent with this gap; the failed physical handshake was not
captured. The new request/reply path is exercised after deliberate message loss.

The microphone now records inside the existing Remote Assist menu and becomes a
Stop button. Stopping transcribes through the existing paired-Mac STT path and
automatically delivers text. There is no dictation sheet or Use on Mac button.

Opening the menu captures the current editable Mac element, window, caret/selection,
application launch identity and, for Terminal, its native tab identity. Captures are
bounded, expire after 20 minutes, and belong to one Remote Assist connection. A
capture with no editable target remains clipboard-only. Input, tab and display
changes invalidate it. Delivery validates the original target; stale, closed,
unknown or locked targets fall back to the Mac clipboard. Terminal responses can
continue updating without turning their output into a new dictation destination.
Enter remains a separate control. A second recording in the same open menu captures
a fresh caret. Receipts coalesce in-flight retries and prevent duplicate insertion.

Successful transcription also updates the iPhone clipboard, which the existing
Paste button imports. Thus both clipboard paths contain the newly dictated text.
Failures retain the transcript or recording for Retry/Discard. Backgrounding or
leaving Remote Assist stops capture and cancels automatic delivery; an old permission
or connection attempt cannot take ownership of a newer recording.

The speaker checks highlighted text in the foreground Mac app first. Only a
successful empty selection falls back to the focused Terminal tab's latest completed
Codex answer. Failed selection reads do not play unrelated text. Accessibility
selection reads leave the clipboard untouched; the Copy fallback snapshots and
restores pasteboard contents and serializes other Remote Assist clipboard actions.
A Copy timeout or non-text clipboard produces an error; it never counts as an empty
selection or authorizes Terminal fallback.
The phone speaks with its native speech engine. The speaker becomes Stop and keeps
source/loading/error feedback inline. There is no Read Aloud sheet. If a later agent
turn is running, the last completed answer plays with that status indicated.

Capability checks start after the receiver is installed, retry with the same request
ID, reject stale correlated replies, and distinguish no reply from known support.
Lock-only messages preserve known capabilities. A mic/speaker tap waits for startup
capabilities; speaker selection also waits for menu target capture, avoiding a second
tap when those requests overlap. Text limits account for JSON escaping in selected
code. No new cloud storage, speech provider or cloud resource was added.

## Verification

- Runtime: all 480 tests passed. Release metadata/source-routing assertions were
  updated for the new build and shared control receive path; targeted release/web
  regressions also pass after the final metadata change.
- Shared protocol: 45 tests pass, including unknown/stale capabilities, lock-only
  updates, empty versus failed selections, explicit clipboard-only capture and a
  full 64 KB selection requiring JSON escaping.
- Mac: 96 tests executed, one existing live Terminal automation test skipped,
  zero failures.
  Target registry tests cover no input, changed/closed/expired targets, reconnection
  and different Terminal tabs sharing an Accessibility element. A real pair of
  WebRTC data channels recovers after losing the initial advertisement and first
  response using the production Mac state message.
- Mobile Swift package: 72 tests pass, including exact local playback, stale source
  rejection, retained transcripts and completed-answer playback during a newer turn.
- iPhone UI: seven distinct scenarios pass: automatic insertion twice in one menu;
  clipboard fallback followed by Paste; selected text priority; empty-selection
  Terminal fallback; selection error with no fallback; one tap with delayed
  capabilities/capture; and microphone shutdown when the app backgrounds.
- Recording and playback screenshots were visually reviewed. Both controls stay in
  the black Remote Assist menu with compact feedback and no red speech sheet.
- UI tests use an encoded fixture host and deterministic transcription replies.
  AVAudioRecorder is exercised, but these tests do not establish real Mac field
  insertion, physical iPhone playback, or actual highlighted text extraction.

## Distribution and artifacts

Final Mac candidate: `native/macos/dist/candidates/inline-speech-2026-09-05/build50/`.
Final iPhone archive: `apps/ios/ClawDadMobile/build/InlineSpeech-42.xcarchive`.
Final IPA: `apps/ios/ClawDadMobile/build/InlineSpeech-IPA-42/ClawDad.ipa`.

UI results are retained in `InlineSpeech42UITests.xcresult` and
`InlineSpeech42CaptureUITests.xcresult` under the iPhone build directory. Reviewed
screenshots are in `build/inline-speech-ui-review/`. Intermediate Mac 49 and iPhone
41 artifacts are retained as superseded candidates; build 41 was verified VALID
but unassigned to ClawDad Internal before the corrected build was distributed.

The iPhone was unavailable to CoreDevice during verification. Cody was asked to
connect it while the release continued; physical installation, actual typing,
highlight selection and audible playback remain explicit acceptance checks.

The authorized production surface is the installed Mac app and ClawDad Internal
TestFlight. Public npm, GitHub releases/tags, appcasts, external TestFlight and App
Store submission are separate channels and are unchanged by this native release.

## Verified release identities

- Apple build: `8c759a30-0c4a-4469-9612-8f4edb33af60`, 0.7.0 (42), VALID.
- Internal group: `bbba6b69-7ac4-4d56-bc41-e9456d56b02e`, ClawDad Internal;
  assignment and test instructions read back, external assignment false.
- IPA SHA-256: `2a9adc966641ef6fa2aa7bc00172817ff99c19608018d3e06a24923609bf40ae`.
- Archive/IPA production URL: `https://clawdad-cloud.frg.earth`; founding beta
  access override NO. Deterministic speech fixture flags are absent from the
  Release executable.
- Mac notarization: `c3dc0047-fa15-4d13-a832-aab54c0a05fd`, Accepted; ticket
  stapled, validated, signature verified, Gatekeeper accepts Notarized Developer ID.
- Mac executable SHA-256: `041fd2429d87ba016aac5b61e92f2e1834e5c43d1a4fe41bd037e5509022499b`.
- Stapled Mac ZIP SHA-256: `fe592e802e9553548485a97c2296a3b276dcb1abfd32c1ecf9f6d737fa6479f8`.
- Runtime bundle marker: `eb41c90414077f95127e30f74cfd6aa7ee1089023f1e3ae5bdb2b0c5d3042573`.
- Installed build 50 is running from `/Applications/ClawDad.app`. Its executable
  hash and bundled runtime marker match the notarized candidate; the active runtime
  marker also matches. The installed signature verifies, and port 4487 `/healthz`
  returns `ok: true` with the shared Codex app server ready.
- Existing Mac builds 48 and 49 are retained under the normal App Backups folder.

## Workspace checkpoint

The implementation, tests and release records form one scoped checkpoint. Five
pre-existing dirty groups remain for separate review: `.agents/skills/clawdad-release/SKILL.md`,
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`,
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`,
`assets/wordmark-explorations/`, and `marketing-site/`. They are excluded from this
checkpoint. Build, upload, notarization and UI artifacts remain in ignored canonical
build directories. ORP reports classified dirt, zero unclassified paths and safe
expansion; the five preserved groups remain intentionally dirty after this checkpoint.
