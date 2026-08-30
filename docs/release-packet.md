# ClawDad 0.7 Native Beta 10 Release Packet

Prepared: 2026-08-30

## Release Identity

- Embedded runtime: `0.7.0-beta.10`
- Mac app: `0.7.0 (29)`
- iPhone app: `0.7.0 (32)`
- Distribution mode: `native-private`

The signed and notarized Mac release is retained locally and build 29 is
installed on the paired Mac. TestFlight build 32 is `VALID` and assigned only to
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
- The Remote Assist command menu can request a privacy-minimized catalog of
  Terminal.app windows and tabs, then focus an explicitly selected tab.
- Terminal catalog rows contain only an opaque identifier, cleaned title,
  window/tab position, selected state, and busy state. Terminal contents,
  history, commands, and process lists stay on the Mac.
- When macOS reports denied Terminal Automation access, ClawDad opens the exact
  Privacy & Security Automation pane and tells the iPhone to refresh after the
  user enables Terminal.
- Command-T remains available in Special Commands, and iPhone and Mac composers
  retain clipboard-safe Cut behavior.

## Release Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| Mac DMG | `native/macos/dist/releases/0.7.0-beta.10-macos-29/ClawDad-0.7.0-beta.10-mac.dmg` | `2a4f03b49ae307db7511f975701c61f0e55aac9a16fd759acaac20e9996ded9e` |
| Mac ZIP | `native/macos/dist/releases/0.7.0-beta.10-macos-29/appcast/ClawDad-0.7.0-beta.10-mac.zip` | `272ec059f86d0b7421f361bd85274d2405bbac9a01253e2cb11babaa554062bf` |
| Local signed appcast | `native/macos/dist/releases/0.7.0-beta.10-macos-29/appcast/appcast.xml` | `36f4534a311fe93dc4a5ad8858ce3ab6007ce3d2857f3cc84ef81fe4ec438b03` |
| iPhone archive | `apps/ios/ClawDadMobile/build/ClawDadMobile-Founder-32.xcarchive` | Apple-accepted upload source; direct upload retained no local IPA |

The appcast and Mac artifacts remain local. Release notes are in
`docs/releases/0.7.0-macos-29.md` and `docs/releases/0.7.0-ios-32.md`.

## Verification Completed

- Node application/runtime suite: 449 tests passed on the merged release
  checkpoint.
- `swift test --package-path apps/ios/ClawDadMobile`: 40 tests passed.
- `swift test --package-path native/ClawDadRemoteAssistProtocol`: 28 tests
  passed.
- `swift test --package-path native/macos`: 55 tests passed.
- The iPhone archive is `0.7.0 (32)`, uses bundle ID
  `earth.frg.clawdad.ios`, points to the production cloud endpoint, and was
  accepted by App Store Connect.
- App Store Connect build ID `f0d60bc9-c671-4bd5-9a31-f1b465f85cdf` is
  `VALID`, export compliance is clear, and the build is assigned to
  `ClawDad Internal`.
- Mac build 29 and its DMG are Developer ID signed, notarized, stapled, and
  accepted by Gatekeeper; all recorded SHA-256 checks pass.
- `/Applications/ClawDad.app` reports version `0.7.0 (29)` with embedded runtime
  `0.7.0-beta.10`.
- Native services are active only on port 4487; legacy service labels are
  disabled.

## Distribution Boundaries

- Build 32 is assigned only to the private `ClawDad Internal` TestFlight group.
- The external founding-customer group is unassigned, its public link is
  disabled, and Beta App Review is not submitted.
- Public npm, git tags, GitHub release assets, and the public appcast were not
  changed by this release.
- Native artifact and internal TestFlight checks are complete; physical iPhone
  behavior remains a separate acceptance gate.

## Physical Device Gates

- Install TestFlight build 32 on a physical iPhone from `ClawDad Internal` and
  confirm a clean launch.
- Pair it to installed Mac build 29 with a fresh QR.
- Open Remote Assist, choose Terminal Tabs from the compact menu, approve the
  one-time macOS Terminal Automation prompt if shown, and focus at least two
  different Terminal rows. If access was previously denied, confirm System
  Settings opens directly to Automation before enabling Terminal and refreshing.
- With at least two connected displays, switch in both directions, verify the
  active label and click alignment, and confirm input stays paused until each
  switch commits.
- Rearrange displays to create a negative global origin, then disconnect the
  selected display and verify clean fallback.
- Recheck Command-T, Command-Tab, Cut, pointer input, keyboard dismissal,
  clipboard, reconnect, Mac lock/unlock, and Wi-Fi-to-cellular recovery.

## Remaining Release Action

Install TestFlight build 32 on the paired physical iPhone and complete the
physical acceptance checks above. Native artifact, Mac installation, and
internal TestFlight distribution checks are complete.

## Preserved Outside This Release

- The original working checkout and its unrelated edits
- `assets/wordmark-explorations/`
- unrelated local Codex hook/plugin changes
- credentials, pairing tickets, relay tokens, and Apple-signed transactions
- local logs and customer project data
