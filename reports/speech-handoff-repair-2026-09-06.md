# Remote Assist audio preparation handoff

Mac 0.7.0 build 61 is signed, notarized, installed, running, and verified. It fixes
the `audio is not ready` failure reported on iPhone build 50. The existing iPhone
build 50 supports the repaired protocol and requires no new phone build.

## Root cause and repair

The progressive speech connector downloads completed audio parts while the rest
of the response is generating. The local `/v1/tts/audio` endpoint still required
the entire manifest to be `ready`. A first part was correctly published after its
atomic file write, then rejected by that endpoint because later parts were still
generating. The connector forwarded the rejection to iPhone, which displayed
`audio is not ready` and `Retry Read Aloud`. A second tap often succeeded because
generation had finished by then.

The production Mac build 60 reproduced this with a fresh Kokoro Heart request:
the signed request was accepted, then failed after 1.56 seconds before delivering
any audio. This is separate from the first Terminal-catalog timeout and iPhone
audio-route startup recovery addressed in build 50. The earlier live speech check
waited for generation to finish before downloading; its mocked streaming checks
did not exercise the real HTTP endpoint's readiness gate.

Build 61 serves a published, completed part during generation after checking its
actual file size against the manifest. An unfinished part returns a structured
pending response. Unknown parts, incomplete files, and failed generation remain
errors; only published completed files can be streamed.

The connector now handles temporary local readiness responses, service restarts,
connection resets, and request timeouts within the original reading operation.
Retries preserve the original text, voice, audio job, and delivered-part offset.
They send no temporary error envelope to iPhone and do not repeat completed audio.
Polling uses bounded backoff and retains the existing five-minute preparation
budget. A persistent failure still provides a useful explanation rather than
waiting indefinitely. Existing iPhone Stop behavior rejects late chunks.

Storage, model choice, pairing, and cloud resource allocation are unchanged.

## Verification

- The new integration regression failed before the endpoint repair with the exact
  `audio is not ready` error and passed after it. A signed synthetic phone request
  goes through the production connector and an actual token-authenticated server.
  The fixture holds the second synthesis segment until the first segment has
  reached the phone callback. It checks signatures, part count, range download,
  structured pending behavior, byte order, and completion from a single request.
- Additional checks cover legacy and structured pending replies, a transient
  service restart, and an audio connection reset. They verify fixed text/voice,
  continued polling, no duplicate delivered part, and exact transferred bytes.
  An authorization error is preserved as a real failure.
- All 501 runtime tests pass with isolated Codex app-server mode and serial
  execution. Syntax and whitespace checks pass.
- Installed Mac live verification: a fresh Kokoro Heart request delivered its
  first signed audio segment after 1.573 seconds with the manifest still
  `generating`, then completed both parts after 9.960 seconds. No error envelope
  was sent. The first segment is a valid 228,044-byte mono PCM WAV at 24 kHz,
  containing 4.75 seconds of audio. The saved voice preference is unchanged.
- Installed bundle and active runtime hashes match both audited source files.
  The authenticated native-capabilities endpoint returns the expected runtime
  fingerprint, Remote Assist support, and native-shell protocol 1. Port 4487 is
  healthy with its shared Codex app server ready. The cloud-host process has an
  established connection, and the Mac app's web interface is loaded.

The integration synthesis fixture supplies small byte payloads and does not prove
physical audio output. The live verification uses the actual local voice service,
actual HTTP endpoint, and signed audio transfer captured locally. Audible playback
on the physical iPhone remains the final user check.

Evidence: `native/macos/dist/candidates/speech-handoff-2026-09-06/`.

## Native release and workspace

This repair changes two embedded runtime modules and no native Swift source.
The native source matches release commit `2985a0a`. Build 61 packages the verified
build 60 app with those two modules replaced, a regenerated runtime fingerprint,
and `CFBundleVersion` 61, then receives a fresh Developer ID signature and
notarization. The previous signed build 60 is retained in the candidate's
`rollback/ClawDad.app` directory on the development drive.

Apple accepted notarization submission
`fed1a112-40e9-4cf8-9387-0f5a7dd9e25f`. The candidate was stapled, and the installed
app passes strict signature and Gatekeeper checks. Finder's normal Copy/Replace
flow installed the update after the prior app quit. Native runtime fingerprint:
`4a6bdca3208298b3f680e9849ad5766a847feb9c95dce8740c1e4c99583f5f02`.

Installed executable SHA-256:
`36dfcae61b1378054b72ffb17149bd4d5b4d3a507184798219e0d6639063a96d`.
Stapled release ZIP SHA-256:
`1d32b349daf7928fcdb3788beda2ed982379cf1c3cdcc806535a4369779c87f5`.

The full-build wrapper stopped at its existing 50-GiB internal free-space guard
(46 GiB available). Packaging this runtime-only update on the development drive
avoids a new native compilation. No documents, media, or caches were deleted,
and no storage policy or security setting was changed.

The private installed-Mac release channel is used. iPhone TestFlight build 50
remains current; public npm/GitHub, the public appcast, and external TestFlight
do not change.

Eight existing dirty groups remain for separate owner review:
`.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`,
`native/macos/package-release.sh`, `native/macos/storage-workflow.sh`,
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`,
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`,
`assets/wordmark-explorations/`, and `marketing-site/`.

The final diff check passes. ORP classifies every dirty path, with zero
unclassified paths and expansion permitted. Only the two runtime modules, two
regression-test files, and two repair reports belong to this checkpoint.
