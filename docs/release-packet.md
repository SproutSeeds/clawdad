# ClawDad 0.7 Beta 7 Rollout Packet

Prepared: 2026-08-11

## Candidate Identity

- Package: `clawdad@0.7.0-beta.7`
- Git tag: `v0.7.0-beta.7`
- Mac app: `0.7.0 (24)`
- iPhone app: `0.7.0 (28)`
- Status: Mac source checkpoint `ca8ccc2`, iPhone checkpoint `873e2b4`, and tag
  `v0.7.0-beta.7` are pushed; the
  GitHub prerelease and signed Sparkle feed are public; Mac build 24 is
  installed; and TestFlight build 28 is `VALID` in `ClawDad Internal` only.
  The npm registry login is the remaining channel-auth exception.

## Included Scope

- Read Aloud activates the supported iPhone `.playback` and `.spokenAudio`
  session when Mac-generated audio arrives.
- Standard iPhone headphone, Bluetooth, and AirPlay routing stays available
  through the playback category's system-managed routes.
- Sent messages and Codex responses remain on-demand, so the paired Mac only
  generates speech after the corresponding speaker control is tapped.
- Remote Assist uses one 36-point lower-right launcher inside a 44-point touch
  target, four points from the full viewport bounds.
- The launcher opens the existing controls inside one compact overlay. A
  Special Commands control opens a nested page with an explicit back action.
- The main controls are bounded to 168 points including padding and Special
  Commands to 216 points, so neither overlay spans the remote viewport.
- The shortcut page provides Control-C, Control-J, Escape, Tab, four arrow
  keys, Control-L, and Command-Tab. Every action collapses back to one launcher.
- A typed shared protocol carries only the enumerated shortcuts. Control and
  navigation commands target the focused editable app; Command-Tab alone uses
  the macOS system event stream.
- The Mac rejects special commands while locked and continues to require its
  Accessibility permission before posting input.
- Existing Exit, Enter, clipboard, keyboard, pointer, scrolling, and zoom
  controls remain available from the compact menu.

## Local Candidate Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| npm package | `native/macos/dist/releases/0.7.0-beta.7/npm/clawdad-0.7.0-beta.7.tgz` | `a9dfdb2349225ad27a7b85ca7655e0860664dabd454d6ac0f7298e029c4bcf98` |
| Mac DMG | `native/macos/dist/releases/0.7.0-beta.7/ClawDad-0.7.0-beta.7-mac.dmg` | `00b6cff9ecbb9b4293918cef8639a860c37c085b8853e686053e438ba1113809` |
| Mac ZIP | `native/macos/dist/releases/0.7.0-beta.7/appcast/ClawDad-0.7.0-beta.7-mac.zip` | `454326a91f483f38052901e4abd8de320fb9984f76c2226475665c1fac6eb75d` |
| Local appcast | `native/macos/dist/releases/0.7.0-beta.7/appcast/appcast.xml` | `fc090ac8d3028ef304889d77db8176d81746333d6fdf678fcbdbfdc8a94371b5` |
| iPhone IPA | `apps/ios/ClawDadMobile/build/AppStore-28/ClawDad.ipa` | `8fddae3dc298689a13d07b34a33eb90895abe79d97e9f444b78fa5b01a1f3068` |

Beta 7 release notes are in `docs/releases/0.7.0-beta.7.md`; the iPhone control
notes are in `docs/releases/0.7.0-ios-27.md`, and the Read Aloud correction is
recorded in `docs/releases/0.7.0-ios-28.md`.

## Verification Completed

- `npm test`: 412/412 passed.
- `swift test --package-path apps/ios/ClawDadMobile`: 25/25 passed.
- `swift test --package-path native/ClawDadRemoteAssistProtocol`: 14/14 passed.
- `swift test --package-path native/macos`: 30/30 passed.
- Targeted workspace/release coverage: 78/78 passed.
- `npm run ios:generate` and `npm run ios:build` succeeded.
- The signed iPhone archive and App Store export are `0.7.0 (28)`, use the
  production bundle ID and Apple Distribution identity, and have
  `get-task-allow = false`.
- Mac package: version `0.7.0`, build `24`; the app and DMG were signed,
  notarized, stapled, and accepted by Gatekeeper.
- The Mac ZIP, signed Sparkle appcast, and generated checksums validate.
- Public appcast SHA-256 matches the signed local appcast exactly. GitHub serves
  the beta 7 DMG and ZIP from the tagged prerelease.
- Installed `/Applications/ClawDad.app`, its native runtime, the background
  service, and the CLI all report build 24 or beta 7 as appropriate. One
  canonical app process is running and the paired relay host is configured.
- App Store Connect reports build 28 `VALID`, export compliance clear, and
  assignment to `ClawDad Internal`; the founding-customer group is unassigned
  and Beta App Review is `NOT_SUBMITTED`.
- `npm pack --json` reports 222 entries with beta 7 metadata.
- ORP hygiene began with zero unclassified paths. Four unrelated pre-existing
  worktree buckets remain preserved and excluded from the release checkpoint.

## Rollout Boundaries

- Build 28 is assigned only to the private `ClawDad Internal` TestFlight group.
- The external founding-customer group, Beta App Review, public App Store
  submission, and paid-access certification remain behind their existing
  physical-device and human gates.
- The production relay Worker is unchanged by this release.
- LaunchServices and the process audit see one canonical ClawDad app after the
  build 24 installation.

## Physical Device Gates

- Tap the speaker on one sent message and one Codex response, then confirm both
  play without an OSStatus error.
- Confirm Read Aloud follows the selected iPhone speaker or headphone route.
- Confirm the small launcher is visible and tappable in portrait and both
  landscape orientations.
- Confirm the primary and Special Commands panels hug their controls instead
  of stretching across the remote viewport.
- Confirm the nested back control, outside-tap collapse, and one-launcher state
  after every action.
- Exercise Control-C and Control-J against harmless work in the Codex CLI.
- Exercise Escape, Tab, all arrows, and Control-L in a focused editable app.
- Confirm Command-Tab switches the active Mac application.
- Recheck Remote Assist reconnect, clipboard, keyboard, zoom, Mac lock/unlock,
  Mac sleep/wake, Wi-Fi-to-cellular, and restrictive-network behavior.

## Remaining Release Actions

1. Re-authenticate the `sproutseeds` npm account and publish beta 7 to the npm
   `beta` tag.
2. Install TestFlight build 28 on the paired iPhone.
3. Record fresh build-24/build-28 physical-device evidence before expanding
   distribution.

## Keep Out

- `assets/wordmark-explorations/`
- unrelated local Codex hook/plugin changes
- temporary screenshots outside canonical release assets
- credentials, pairing tickets, relay tokens, and Apple-signed transactions
- local logs and customer project data
