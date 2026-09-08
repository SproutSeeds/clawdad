# Assistant connection repair — September 8, 2026

Mac **0.7.0 (77)** is installed, notarized, and healthy. iPhone **0.7.0 (65)**
is available in **ClawDad Internal TestFlight**.
The existing Assistant conversation and all 12 Terminal tabs were retained.

## Findings and repair

Cody reported that both Assistant calls and text messages stopped connecting
after the grouped-controls release. The installed Mac's runtime, background
coordinator, Terminal inventory, and relay heartbeat were healthy during the
audit. The actual 33,638-byte Assistant snapshot decoded successfully with the
iPhone's shared Swift model. The phone's exact error and a failing physical-phone
request were not captured, so these checks alone do not establish the cause of
Cody's individual failed attempt.

Two defects in the shared connection path were reproduced and repaired:

1. A request timeout or failed send left the iPhone transport marked connected.
   Retry Connection could reuse that stale peer. State checks now time out after
   12 seconds, command receipts after 30 seconds, and speech/image operations
   retain their longer 150-second allowance. Transport failures invalidate the
   peer, and Retry Connection explicitly replaces it. Call startup checks a
   responsive Assistant before starting the microphone. A pending text send
   can recover once within its connection-recovery window using the same durable
   message ID, preserving the Mac's existing duplicate-delivery protection.

2. The Mac runs multiple Assistant requests concurrently. `PairedFilePeer.send`
   rejected a second valid reply while the first was sending. A test using real
   local WebRTC peers reproduced the lost response with simultaneous 900 KB
   speech-sized and 34 KB state replies. Sends now wait for the active framed
   message to finish, within the existing bounded transfer timeout. Stale peer
   and channel callbacks are ignored after replacement; an old sender cannot
   take ownership of a new connection's writer.

The transport does not replay native commands. Application-level errors keep
their explanations and do not reset a healthy connection. Text and attachment
drafts remain saved until the existing successful-send receipt or explicit
deletion. Pairing, permissions, relay byte limits, local speech models, and
Terminal restrictions remain in force.

## Verification

| Check | Result |
| --- | --- |
| Stale connection reproduction | Two initial tests produced five pre-fix assertion failures; repaired transport tests pass. |
| Concurrent real data-channel reproduction | Failed before the repair; exact bytes of both replies arrive after the repair. |
| Mobile Swift suite | 153 passed. |
| Mac Swift suite | 200 executed: 194 passed, six existing opt-in live checks skipped. |
| Runtime suite | Final run: 559 passed. An unrelated owned-approval test failed during parallel builds, then passed both its focused rerun and the full rerun. |
| iPhone Assistant UI suite | 12 passed, including Chat/Call separation, hangup during connection, image preview/removal, saved drafts across restart and failed sends, grouped navigation, and reply controls. Exported draft and menu screenshots inspected. |
| Installed Assistant conversation | A fresh diagnostic message received the exact requested response in 8.081 seconds. Repeating its ID retained one user message. Existing coordinator session and 12-tab inventory retained. |
| Selected local speech services | Kokoro 82M / `af_heart` generated a 3.75-second, 24 kHz mono PCM recording in 2.049 seconds. Local STT `base` transcribed the exact sentence in 831 ms. Voice selection unchanged. |
| Signed apps | Mac signature, notarization, staple, and Gatekeeper passed; iPhone archive version, bundle ID, and strict deep signature verified. |
| TestFlight | VALID, IN_BETA_TESTING, assigned to ClawDad Internal, and testing notes match. |

The live speech test generated and downloaded actual audio and transcribed it
through the installed Mac. It does not prove audible playback or microphone
capture on Cody's physical iPhone. The remaining acceptance check is to update
TestFlight to build 65, send an Assistant text message, then start an explicit
call and receive a full spoken reply. Reopening the app after backgrounding
should also be checked on the phone.

## Release evidence

Canonical private logs, regression reproductions, UI results, local speech,
release receipts, the notarized build, and the retained Mac 76 rollback bundle
are under `native/macos/dist/candidates/assistant-connection-repair-2026-09-08/`.

- Mac notarization: `6b16cba5-1a62-4172-8228-e8af848f129b`.
- Mac executable SHA-256: `019ed9a6041f56624372bb920fc08474e77b78694a9ebeb75d010c88a5f9f9a0`.
- Installed runtime bundle: `3eecc81042f6479f4b1bb664411df08d84c838bbcd250234e5f3e8c80ffcc2af`.
- iPhone executable SHA-256: `35dbe048e929e5c9589885f1109f748e6598f963dbbd4ee41c6b1a73b3877a53`.
- Apple build ID: `fd3afc3b-068d-430b-b6fe-6b22485e5d20`.
- Internal TestFlight assignment verified at `2026-09-08T17:16:37.724Z`.

This follows the private native release lane. The public Git remote has 46
earlier local commits ahead of its upstream; this repair does not publish that
accumulated history or an npm, public GitHub, external beta, or App Store release.

## Preserved work

The repair is scoped separately from these nine existing dirty paths. ORP
hygiene classified every path; no unclassified paths were present.

| Existing paths | Next action |
| --- | --- |
| `.agents/skills/clawdad-release/SKILL.md`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Reconcile release-skill revisions. |
| `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Review and commit plugin metadata. |
| `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh` | Audit and checkpoint storage/build workflow changes together. |
| `assets/wordmark-explorations/` | Curate branding artifacts. |
| `cloud/native/` | Review and canonicalize generated material. |
| `marketing-site/` | Review and release marketing work separately. |
