# Local voice selection and continuous playback

Released: Mac 0.7.0 build 54 is installed, notarized, and healthy. iPhone 0.7.0
build 46 is VALID, assigned to ClawDad Internal, and IN_BETA_TESTING.

## Result

Settings → Voice & Playback offers Kokoro 82M (54 voices), Pocket TTS 3.1
(26 voices), and Kitten TTS Mini 0.8 (8 voices). Every bundled voice is selectable.
Language and voice type filters, localized previews, and supported speaking speed
controls help compare the voices. Pocket uses natural speed and leaves gender
unspecified where its publisher supplies no gender metadata. Voice style is
auditioned through Preview; no unsupported emotional-style controls are invented.

The paired computer owns one atomic voice-settings.json beside its server config.
Concurrent saves retain each model's choice. A saved choice applies to new reading
in the main app and Remote Assist. Previews leave that preference intact. Audio
cache identity includes model, voice, and speed so an older voice cannot be reused
solely because its text matches.

The app owns iPhone playback across Terminal switches, Remote Assist dismissal,
and navigation to other screens. Captured text and its voice remain fixed for that
reading. Pause, Resume, and Stop remain available outside Remote Assist. Stop
rejects late preparation results and later audio chunks. The phone starts the
first completed audio part while the Mac generates the remaining parts; the
transfer handles buffering, ordered playback, duplicate parts, and cancellation.

The final Mac refinement retains existing dropdown options during background
refresh. Model changes update the dependent voices without rebuilding unchanged
menus while the user is choosing.

## Local speech service

The shared Doc Reader service on 127.0.0.1:8772 runs Kokoro, Pocket, Kitten and
the existing Whisper dictation model. Generation and downloaded model data stay
on the paired Mac; audio uses the existing authenticated connection to the phone.
The local service patch is committed in doc-reader as 0792114.

Pinned dependencies are recorded in doc-reader/requirements-local-speech.txt;
setup and deployment instructions are in doc-reader/docs/local-speech-models.md.
The managed Python environment was updated in place. Japanese Kokoro additionally
required the official UniDic dictionary. The service's two speech source files
and existing LaunchAgent engine argument were updated while preserving its other
settings. Its original source and plist are retained under the candidate's
service-backup directory.

## Verification

- All 88 catalog voices generated actual nonempty WAV audio. Five Japanese voices
  passed after the required dictionary was installed. This verifies synthesis,
  not a listening-based ranking of the voices.
- The live production service generated Kokoro, Pocket and Kitten WAVs. Existing
  Whisper transcribed the synthetic test sentence correctly after the update.
- All 486 final runtime tests passed, including the dropdown regression. Decisive
  command: CLAWDAD_CODEX_APP_SERVER_MODE=isolated node --test --test-concurrency=1
  test/*.test.mjs. Evidence: runtime-release54.log (174.5 seconds).
- 76 mobile Swift tests and seven speech-service Python tests passed.
- Three final iPhone UI tests passed: all models and saved/reopened voice settings;
  preparation continuing after leaving Remote Assist; and playback starting from
  the first part while Stop rejects the delayed remainder. The Settings UI test
  uses the actual local catalog and preference API through a DEBUG-only fixture.
- The iPhone archive and installed Mac runtime signatures were checked. iPhone
  archive executable SHA-256:
  0752008ecc0d7c29b25b3fe9e3714daf0858bf4e73d554f39d954351fe9945c0.
- In the installed Mac app, verified the three model choices, Pocket's 26-voice
  catalog and natural pace, and all eight Kitten menu entries. Selected Jasper,
  ran Preview, and verified its actual two-part Kitten audio manifest reached
  ready. Stop and Refresh returned the controls to the saved Kokoro Heart choice;
  the canonical preference remained unchanged. Mac screenshots are retained in
  the candidate directory. A browser test route was blocked by its client; this
  final review used the actual installed native Mac app.

Earlier concurrent runtime runs exposed an existing dispatch timing failure and
a temporary-directory cleanup race; the dispatch check passed in isolation and
the decisive suite passed serially. The simultaneous-save test was corrected to
allow either client to arrive last while requiring both model choices to survive.
Release fixture build numbers were updated for build 46. An initial navigation UI
test used the wrong Close Remote Assist label; the corrected test and final UI
bundle passed.

Physical iPhone voice quality, time to first audible sound, Bluetooth behavior,
and background/locked-screen listening remain hands-on checks. Local generation
timings exclude phone/network delay and do not establish a categorically faster
model. Pocket and Kitten are additional choices; the existing Kokoro preference
is retained.

Evidence is in native/macos/dist/candidates/local-voices-2026-09-06/, including
voice-validation.json, production-speech-checks.json, real WAV samples, runtime
logs, notarization receipts and App Store upload/processing receipts. The final
iPhone UI bundle is apps/ios/ClawDadMobile/build/LocalVoicesFinalUITests.xcresult;
the archive is build/LocalVoices46.xcarchive and export is build/LocalVoices46Export.

## Release and workspace

Apple build 5b8eed0d-a7f9-49be-9fae-fed388d229e8 is assigned to the existing
ClawDad Internal group bbba6b69-7ac4-4d56-bc41-e9456d56b02e. Test instructions were
read back. The canonical receipt is ops/app-store-release.json. External TestFlight
assignment remains false. This is the installed Mac/internal iPhone release
channel; public package and public update publication are separate.

Mac build 52 was preserved under ~/Library/Application Support/ClawDad/App Backups/
before installing build 53. Build 54 carries the final dropdown refinement.

Eight pre-existing ClawDad path groups remain for separate owner review:
.agents/skills/clawdad-release/SKILL.md;
plugins/clawdad-codex-integration/.codex-plugin/plugin.json;
plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md;
assets/wordmark-explorations/; marketing-site/; native/macos/build-app.sh;
native/macos/package-release.sh; native/macos/storage-workflow.sh.
Their next action is separate scoped review and validation; none belongs to this
speech commit. The existing Mac build/storage scripts were used as present.

Four pre-existing Doc Reader paths remain for separate owner review and tests:
bin/read-docs.js; doc_reader/webapp.py;
macos/DocReaderApp/Sources/DocReaderApp/main.swift; tests/test_webapp_library.py.
No unrelated changes were reverted or included in the speech-service commit.

Mac build 54 was accepted under Apple notarization submission
6d544504-8a12-4bef-9663-b46eed53711b, stapled, and passed Gatekeeper. The installed
speech source paths match the audited checkout. Its bundle runtime marker is
273b15c49a7f6cdd8beb9d125b7f3a177790df87ccdad705478f7df9a0fe6e5e.
The preferred local port 4487 reports healthy with the shared Codex app server
ready. The live cloud-host process targets 4487 and has an established relay
connection; its catalog advertises speech.voices. The local speech service reports
Kokoro, Pocket, Kitten and Whisper loaded without errors. Temporary test listeners
on 8773 and 4490 were stopped after validation.

Final git diff checks passed. ORP classifies every remaining unrelated dirty path
in both repositories, with zero unclassified paths. Their separate review actions
are listed above.
