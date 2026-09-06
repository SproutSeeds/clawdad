# Dictation after Read Aloud

September 6, 2026. iPhone 0.7.0 build 48 is VALID and IN_BETA_TESTING in the
existing ClawDad Internal group. The installed Mac remains build 55.

## Failure and repair

Continuous Read Aloud could survive leaving Remote Assist and then activate the
iPhone's playback audio session after composer dictation had begun. The recorder
and player each changed the same AVAudioSession independently. Playback cleanup
also deactivated the session even when that controller no longer owned it, and
old player delegate callbacks could affect a newer request.

The simulator reproduced the regression against the previous code: the pending
reading remained active after starting composer dictation, and a separate capture
check failed to reach ten seconds after delayed playback arrived. With the repair,
the same transition records past ten seconds and the old reading stays stopped.

Both dictation recorders and Read Aloud now use MobileAudioSession. A playback
reservation starts during preparation, so starting a recording cancels pending
audio as well as active playback. Ownership IDs ensure an old cleanup cannot
release a newer recording's session. Voice previews cannot take over an active
recording. Playback delegate events must belong to the current player.

The existing in-menu Stop, remembered Mac input, automatic insertion and clipboard
fallback continue to use the same delivery path. Read Aloud still continues when
navigating between Terminal tabs or leaving Remote Assist. Starting dictation
deliberately stops that reading so the microphone can capture the next message.

## Evidence

- The actual installed Mac handler accepted a signed synthetic iPhone AAC request
  and returned a verified, signed transcription through the live local Whisper
  endpoint. The expected sentence matched exactly in approximately
  0.76 seconds. The probe used ephemeral test identities and changed no pairing.
- A direct authenticated ClawDad transcription request also succeeded. The shared
  local speech service reported Kokoro, Pocket, Kitten and Whisper healthy.
  There is no current evidence requiring a Whisper or service configuration change.
- All 87 mobile Swift tests passed. Five new audio ownership tests cover pending
  and playing audio, late chunks, stale cleanup and callbacks, microphone priority,
  and retry after failed audio activation.
- All 491 runtime tests passed with isolated Codex test servers and serial test
  files. The final run took 173 seconds. Four existing assertions were updated
  for build 48 and the audio configuration's move into the shared coordinator.
- Seven iPhone simulator UI scenarios passed in STT48Acceptance.xcresult:
  composer dictation after pending reading; Remote Assist dictation after playing
  audio with a delayed later part; insertion twice; clipboard fallback and Paste;
  backgrounding during capture; reading across navigation; and Stop during a
  multipart audio transfer.
- The signed Release archive is 0.7.0 (48), points to the production cloud URL,
  disables the preview beta override, and excludes the DEBUG speech fixtures.
  Its executable SHA-256 is
  e60209adeb8d428f39bd3ad3ce7b5daa4ca20abdaeabc10f722523d574481ae2.
- The paired physical iPhone currently has build 47 installed. Simulator recording
  exercises AVAudioRecorder; deterministic transcript/delivery fixtures do not
  establish physical microphone quality or actual Mac input insertion. Those
  remain hands-on acceptance checks after updating the phone.

The investigation followed the recording, transcription, and delivery stages
separately. Apple's [audio recorder documentation](https://developer.apple.com/documentation/avfaudio/avaudiorecorder)
describes the recording category and recorder state used by this path.

## Release and workspace

This is an iPhone repair compatible with installed Mac build 55. The separately
prepared Mac build 58 remains ready for its pending installation; this change
does not require the unresolved App Management permission change.

Archive: apps/ios/ClawDadMobile/build/STT48.xcarchive.
Automated evidence: native/macos/dist/candidates/stt-regression-*.
The decisive runtime command was
`CLAWDAD_CODEX_APP_SERVER_MODE=isolated node --test --test-concurrency=1 test/*.test.mjs`;
mobile tests used `swift test --package-path apps/ios/ClawDadMobile`.
There are 585 passing checks across the runtime, mobile package, and seven UI tests.

Apple build ID: a882ea7a-bfc0-44cb-8805-8d2f04da6751. At
2026-09-06T16:14:56Z the build was VALID, IN_BETA_TESTING, and assigned to
ClawDad Internal (bbba6b69-7ac4-4d56-bc41-e9456d56b02e). Test instructions were
read back, and external assignment remains false. The canonical provider receipt
is ops/app-store-release.json; stt-regression-testflight48.json records the internal
testing state. Export/upload succeeded. Apple warned that the prebuilt WebRTC
framework lacks its dSYM, which limits third-party crash symbolication.

The fix is available by updating ClawDad in TestFlight. Physical iPhone dictation
and actual Mac insertion still need acceptance after installing build 48.

Eight pre-existing dirty groups remain for separate scoped review:
.agents/skills/clawdad-release/SKILL.md;
plugins/clawdad-codex-integration/.codex-plugin/plugin.json;
plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md;
assets/wordmark-explorations/; marketing-site/; native/macos/build-app.sh;
native/macos/package-release.sh; native/macos/storage-workflow.sh.
Their next action remains owner review and validation; none belongs to this repair.
The diff check passed and ORP reports zero unclassified paths.
