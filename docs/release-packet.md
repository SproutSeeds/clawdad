# ClawDad 0.7 Native Beta 10 Release Packet

Prepared: 2026-08-27

## Release Identity

- Embedded runtime: `0.7.0-beta.10`
- Mac app: `0.7.0 (26)`
- iPhone app: `0.7.0 (31)`
- Distribution mode: `native-private`

The signed and notarized Mac release is retained locally and build 26 is
installed on the paired Mac. TestFlight build 31 is `VALID` and assigned only to
`ClawDad Internal`. The npm package, git tags, public GitHub release assets,
public appcast, external TestFlight group, Beta App Review, and App Store
submission are unchanged.

## Included Scope

- The signed Mac app embeds one beta 10 runtime and owns the native service on
  port 4487; legacy global service labels remain disabled.
- The paired iPhone can select among connected Mac displays without opening a
  second Remote Assist session.
- Display switches pause input until the new capture commits, and a disconnected
  selection falls back to an available display.
- Pointer mapping uses the selected display's real global bounds, including
  Retina scaling and displays with negative origins.
- Command-T remains available in Special Commands, and iPhone and Mac composers
  retain clipboard-safe Cut behavior.

## Release Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| Mac DMG | `native/macos/dist/releases/0.7.0-beta.10/ClawDad-0.7.0-beta.10-mac.dmg` | `75aa977e13356c85b00f0ec0d0e9edc118a0a8afd2bcce6118ab1a11fc17bce9` |
| Mac ZIP | `native/macos/dist/releases/0.7.0-beta.10/appcast/ClawDad-0.7.0-beta.10-mac.zip` | `fdd92aa9b9ef793cf42ec1c977771b5db2d99bb9652f8b338a554e6e882e17b1` |
| Local signed appcast | `native/macos/dist/releases/0.7.0-beta.10/appcast/appcast.xml` | `f48725386e02ef046956bdfa7ea04e2eb2774df4a4af614348671e8a6fe93823` |
| iPhone archive | `apps/ios/ClawDadMobile/build/ClawDadMobile-Founder-31.xcarchive` | Apple-accepted archive; direct upload retained no local IPA |

The appcast and Mac artifacts remain local. Release notes are in
`docs/releases/0.7.0-beta.10.md` and `docs/releases/0.7.0-ios-31.md`.

## Verification Completed

- Node application/runtime suite: 448 tests passed on the merged release
  checkpoint.
- `swift test --package-path apps/ios/ClawDadMobile`: 35 tests passed.
- `swift test --package-path native/ClawDadRemoteAssistProtocol`: 22 tests
  passed.
- `swift test --package-path native/macos`: 43 tests passed.
- The iPhone archive is `0.7.0 (31)`, uses bundle ID
  `earth.frg.clawdad.ios`, points to the production cloud endpoint, and was
  accepted by App Store Connect.
- App Store Connect build ID `7336ea34-d9ab-4c47-b69e-76775d7554d2` is
  `VALID`, export compliance is clear, and the build is assigned to
  `ClawDad Internal`.
- Mac build 26 and its DMG are Developer ID signed, notarized, stapled, and
  accepted by Gatekeeper; all recorded SHA-256 checks pass.
- `/Applications/ClawDad.app` reports version `0.7.0 (26)` with embedded runtime
  `0.7.0-beta.10`.
- Native services are active only on port 4487; legacy service labels are
  disabled.

## Distribution Boundaries

- Build 31 is assigned only to the private `ClawDad Internal` TestFlight group.
- The external founding-customer group is unassigned, its public link is
  disabled, and Beta App Review is not submitted.
- Public npm, git tags, GitHub release assets, and the public appcast were not
  changed by this release.
- Native artifact and internal TestFlight checks are complete; physical iPhone
  behavior remains a separate acceptance gate.

## Physical Device Gates

- Install TestFlight build 31 on a physical iPhone from `ClawDad Internal` and
  confirm a clean launch.
- Pair it to installed Mac build 26 with a fresh QR.
- With at least two connected displays, switch in both directions, verify the
  active label and click alignment, and confirm input stays paused until each
  switch commits.
- Rearrange displays to create a negative global origin, then disconnect the
  selected display and verify clean fallback.
- Recheck Command-T, Command-Tab, Cut, pointer input, keyboard dismissal,
  clipboard, reconnect, Mac lock/unlock, and Wi-Fi-to-cellular recovery.

## Remaining Release Action

Install TestFlight build 31 on the paired physical iPhone and complete the
physical acceptance checks above. Native artifact, Mac installation, and
internal TestFlight distribution checks are complete.

## Preserved Outside This Release

- The original working checkout and its unrelated edits
- `assets/wordmark-explorations/`
- unrelated local Codex hook/plugin changes
- credentials, pairing tickets, relay tokens, and Apple-signed transactions
- local logs and customer project data
