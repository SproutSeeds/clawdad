# ClawDad 0.7 Beta 5 Candidate Packet

Prepared: 2026-08-07

## Candidate Identity

- Package: `clawdad@0.7.0-beta.5`
- Planned Git tag: `v0.7.0-beta.5`
- Mac app: `0.7.0 (22)`
- iPhone app: `0.7.0 (24)`
- Status: signed and packaged locally; external release and live installation
  remain pending

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
| Mac DMG | `native/macos/dist/releases/0.7.0-beta.5/ClawDad-0.7.0-beta.5-mac.dmg` | `8bb60b73e625e17da0e981fe43858d6c5574db293e4a968e84b5c7e52dae84fe` |
| Mac ZIP | `native/macos/dist/releases/0.7.0-beta.5/appcast/ClawDad-0.7.0-beta.5-mac.zip` | `5ca94f54d7c40857f9aecdbb1700dbf17874144988aca9dadf6a7f614875c995` |
| Local appcast | `native/macos/dist/releases/0.7.0-beta.5/appcast/appcast.xml` | `ed889b2a046558600c45e0b90dbc48fcfbf6aaf35f62f26c2cd9328b7f22abb9` |
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
- Mac package: version `0.7.0`, build `22`, valid Developer ID signature; DMG,
  ZIP, local appcast, and checksums generated successfully.
- Bundled Mac runtime: `0.7.0-beta.5`, with project creation and paired-Mac-first
  TTS code present.
- npm dry run/package: 216 entries; generated tarball matches beta 5 metadata.
- Privacy-safe certification snapshot: live services are healthy, while exact
  beta 5 registry, TestFlight build 24, installed Mac build 22, and installed
  iPhone build 24 gates correctly remain false.

## Deliberately Unchanged Live Surfaces

- No Git tag or GitHub release was created.
- No branch or tag was pushed.
- No npm package was published.
- No Sparkle appcast or Mac installer was published.
- No Cloudflare Worker was deployed.
- No TestFlight build was uploaded or assigned.
- The locally installed Mac app was not replaced or restarted.
- Mac notarization and stapling were disabled for this local candidate and
  remain required before public Mac distribution.

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

## Release Actions After Approval

1. Complete and record the physical device gates against build 24.
2. Notarize and staple the exact Mac candidate, then revalidate Gatekeeper and
   regenerate final checksums if the artifacts change.
3. Commit the audited source, create `v0.7.0-beta.5`, and push the approved
   commit and tag.
4. Publish the npm package, GitHub prerelease, signed Sparkle appcast, and Mac
   installers from the approved artifacts.
5. Upload the exact build-24 archive to TestFlight, verify processing, and
   assign it only to the approved testing group.

## Keep Out

- `assets/wordmark-explorations/`
- unrelated local Codex hook/plugin changes
- temporary screenshots outside canonical App Store assets
- credentials, pairing tickets, relay tokens, and Apple-signed transactions
- local logs and customer project data
