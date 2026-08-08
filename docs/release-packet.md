# ClawDad 0.7 Beta 5 Rollout Packet

Prepared: 2026-08-07

## Candidate Identity

- Package: `clawdad@0.7.0-beta.5`
- Git tag: `v0.7.0-beta.5`
- Mac app: `0.7.0 (22)`
- iPhone app: `0.7.0 (24)`
- Status: npm, GitHub, Sparkle, the notarized Mac app, and private internal
  TestFlight are live; physical certification and founding-customer
  distribution remain pending

## Included Scope

- A plus button in the iPhone project picker creates and registers a project
  under the paired Mac's configured primary projects root.
- Project creation is a trusted, signed operation. The phone supplies a
  validated folder name; the Mac chooses the root and never accepts an
  arbitrary phone-supplied path.
- Every sent-message and Codex-response card has on-demand Read Aloud.
- Read Aloud tries the paired Mac speech service first. The iPhone Settings
  toggle controls whether Umbra may be used when Mac speech is unavailable.
- Speech is generated only after the speaker button is tapped. ClawDad sends
  the requested text to the selected speech service and returns bounded,
  signed audio chunks to the paired iPhone.
- Connection and Remote Assist states distinguish relay reconnect, paired-Mac
  offline, missing pairing identity, and the 25-second host-answer timeout.
- Existing single-instance Mac ownership, stale WebRTC-answer protection, and
  one-worker-per-Codex-session behavior remain included.

## Local Candidate Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| npm package | `native/macos/dist/releases/0.7.0-beta.5/npm/clawdad-0.7.0-beta.5.tgz` | `3b7683dacc19a60dbfb0b5acbf6c11d664001b7931c575c36f1be908a4cafef2` |
| Mac DMG | `native/macos/dist/releases/0.7.0-beta.5/ClawDad-0.7.0-beta.5-mac.dmg` | `296e149e3c4cfda325970b8338b1a4dc19d38e0333ac82a03c9279aa0dc67ccc` |
| Mac ZIP | `native/macos/dist/releases/0.7.0-beta.5/appcast/ClawDad-0.7.0-beta.5-mac.zip` | `ac1c771b0e4c52b8a65180997cbf21062a4868776e1ad9f9ad9d701452b70655` |
| Local appcast | `native/macos/dist/releases/0.7.0-beta.5/appcast/appcast.xml` | `ee1b6dc0e440324396fd37bff62b82e2f5a2ecafcb9c8ad0f9c5e1d46750471d` |
| iPhone IPA | `apps/ios/ClawDadMobile/build/AppStore-24/ClawDad.ipa` | `f352333d50fe1ecbf9c9f70a4e6ed4eb0a136a3232cea03cdece2c158876450e` |

The matching iPhone archive is
`apps/ios/ClawDadMobile/build/ClawDadMobile-Founder-24.xcarchive`. Release notes
are in `docs/releases/0.7.0-beta.5.md`.

## Verification Completed

- `npm test`: 408/408 passed.
- `swift test --package-path apps/ios/ClawDadMobile`: 25/25 passed.
- `swift test --package-path native/macos`: 27/27 passed.
- `npm run ios:build`: simulator build passed.
- iPhone Release archive: version `0.7.0`, build `24`, arm64, valid signature.
- iPhone export: Apple Distribution-signed IPA, valid signature, exact build
  retained.
- Mac package: version `0.7.0`, build `22`, notarized and stapled; the installed
  app and DMG pass Gatekeeper, while the ZIP, signed appcast, and final
  checksums validate.
- Bundled Mac runtime: `0.7.0-beta.5`, with project creation and paired-Mac-first
  TTS code present.
- npm dry run/package: 216 entries; generated tarball matches beta 5 metadata.
- The npm `beta` tag resolves to `0.7.0-beta.5`; the Git tag and GitHub
  prerelease resolve to commit `c34a299` with the final Mac assets.
- The public appcast, Mac ZIP, Mac DMG, `/healthz`, `/support`, and `/privacy`
  all return HTTP 200.
- The installed Mac is build 22, the service and cloud host run beta 5, and
  the host maintains an established TLS connection to the relay.
- TestFlight build 24 is `VALID`, export-compliance complete, and assigned to
  `ClawDad Internal` only.
- Privacy-safe certification reports registry, local service, Mac build,
  cloud, and TestFlight ready. Installed iPhone build 24 and the physical
  checks remain open until the device update is observed.

## Live Rollout Boundaries

- `v0.7.0-beta.5`, the GitHub prerelease, npm `beta`, and the signed Sparkle
  feed are live.
- The canonical `/Applications/ClawDad.app` is build 22. Its build-21 backup
  is stored outside `/Applications` so LaunchServices sees one app instance.
- The production relay code was unchanged; the existing Worker did not need
  a deployment for this Mac/iPhone release.
- Build 24 is available only to `ClawDad Internal`. The founding-customer
  group has no build assigned, its public link is disabled, and Beta App
  Review has not been submitted.
- Public App Store submission and paid-access certification remain gated on
  the documented human and physical-device checks.

## Physical Device Gates

- Install the matching Mac build 22 and iPhone build 24 on the paired devices.
- Create a project from the iPhone and confirm its directory appears under the
  configured Mac projects root with a selectable Codex thread.
- Play Read Aloud from one sent message and one Codex response.
- Disable Umbra fallback, verify Mac-only speech, and confirm a clear failure
  when the Mac speech service is intentionally unavailable.
- Enable Umbra fallback and verify it is used only after Mac speech is
  unavailable.
- Exercise Wi-Fi-to-cellular reconnect, Mac sleep/wake, and Remote Assist
  timeout/retry behavior.
- Recheck voice transcription, image delivery, Direct/Queue ordering, long
  turns, and fresh-launch selection restoration.
- Complete the existing purchase, restore, revocation, and forced-TURN matrix
  before founding-customer distribution.

## Remaining Release Actions

1. Install TestFlight build 24 on the paired iPhone and record the physical
   device gates against that exact build and Mac build 22.
2. Rerun the privacy-safe certification snapshot and preserve concrete
   evidence for every pass, failure, or blocked row.
3. Complete the paid purchase, restore, cancellation, and forced-TURN matrix.
4. Fill the Beta App Review contact/reviewer details only when the private
   external beta is ready.
5. Assign build 24 to founding customers and submit Beta App Review only after
   explicit approval of the completed physical certification.

## Keep Out

- `assets/wordmark-explorations/`
- unrelated local Codex hook/plugin changes
- temporary screenshots outside canonical App Store assets
- credentials, pairing tickets, relay tokens, and Apple-signed transactions
- local logs and customer project data
