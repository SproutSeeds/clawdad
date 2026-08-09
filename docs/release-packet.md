# ClawDad 0.7 Beta 7 Rollout Packet

Prepared: 2026-08-09

## Candidate Identity

- Package: `clawdad@0.7.0-beta.7`
- Git tag: `v0.7.0-beta.7`
- Mac app: `0.7.0 (24)`
- iPhone app: `0.7.0 (26)`
- Status at preparation: the source, npm tarball, notarized Mac artifacts, and
  iPhone simulator build are ready; channel publication follows the audited
  source checkpoint.

## Included Scope

- Remote Assist uses one 36-point lower-right launcher inside a 44-point touch
  target, four points from the full viewport bounds.
- The launcher opens the existing controls inside one compact overlay. A
  Special Commands control opens a nested page with an explicit back action.
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
| iPhone IPA | Build-specific archive/export pending | Pending |

Beta 7 release notes are in `docs/releases/0.7.0-beta.7.md`; the iPhone control
notes are in `docs/releases/0.7.0-ios-26.md`.

## Verification Completed

- `npm test`: 412/412 passed.
- `swift test --package-path apps/ios/ClawDadMobile`: 25/25 passed.
- `swift test --package-path native/ClawDadRemoteAssistProtocol`: 14/14 passed.
- `swift test --package-path native/macos`: 30/30 passed.
- Targeted workspace/release coverage: 78/78 passed.
- `npm run ios:generate` and `npm run ios:build` succeeded.
- Mac package: version `0.7.0`, build `24`; the app and DMG were signed,
  notarized, stapled, and accepted by Gatekeeper.
- The Mac ZIP, signed Sparkle appcast, and generated checksums validate.
- `npm pack --json` reports 222 entries with beta 7 metadata.
- ORP hygiene began with zero unclassified paths. Four unrelated pre-existing
  worktree buckets remain preserved and excluded from the release checkpoint.

## Rollout Boundaries

- Build 26 is assigned only to the private `ClawDad Internal` TestFlight group.
- The external founding-customer group, Beta App Review, public App Store
  submission, and paid-access certification remain behind their existing
  physical-device and human gates.
- The production relay Worker is unchanged by this release.
- LaunchServices must see one canonical ClawDad app after build 24 is installed.

## Physical Device Gates

- Confirm the small launcher is visible and tappable in portrait and both
  landscape orientations.
- Confirm the nested back control, outside-tap collapse, and one-launcher state
  after every action.
- Exercise Control-C and Control-J against harmless work in the Codex CLI.
- Exercise Escape, Tab, all arrows, and Control-L in a focused editable app.
- Confirm Command-Tab switches the active Mac application.
- Recheck Remote Assist reconnect, clipboard, keyboard, zoom, Mac lock/unlock,
  Mac sleep/wake, Wi-Fi-to-cellular, and restrictive-network behavior.

## Remaining Release Actions

1. Commit and tag the audited source as `v0.7.0-beta.7`.
2. Publish the GitHub prerelease, Mac ZIP, DMG, and signed Sparkle appcast.
3. Publish npm beta 7 if the npm authenticator gate is available.
4. Install Mac build 24 and verify its bundled runtime plus local/relay health.
5. Archive, upload, and assign iPhone build 26 to `ClawDad Internal` only.
6. Record fresh build-24/build-26 physical-device evidence before expanding
   distribution.

## Keep Out

- `assets/wordmark-explorations/`
- unrelated local Codex hook/plugin changes
- temporary screenshots outside canonical release assets
- credentials, pairing tickets, relay tokens, and Apple-signed transactions
- local logs and customer project data
