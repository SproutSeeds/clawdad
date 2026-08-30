# ClawDad 0.7 Native Beta 10 Release Packet

Prepared: 2026-08-30

## Release Identity

- Embedded runtime: `0.7.0-beta.10`
- Mac app: `0.7.0 (28)`
- iPhone app: `0.7.0 (32)`
- Distribution mode: `native-private`

The signed and notarized Mac release is retained locally and build 28 is
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
- Command-T remains available in Special Commands, and iPhone and Mac composers
  retain clipboard-safe Cut behavior.

## Release Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| Mac DMG | `native/macos/dist/releases/0.7.0-beta.10-macos-28/ClawDad-0.7.0-beta.10-mac.dmg` | `b2e5d43b5dff03ef87dd5b7c85f9278279ef9efd96e9f63ccd33d531f0cee8e3` |
| Mac ZIP | `native/macos/dist/releases/0.7.0-beta.10-macos-28/appcast/ClawDad-0.7.0-beta.10-mac.zip` | `f7e367f9729a0941aadfa420463b72944c7f764c102836cae102765473262248` |
| Local signed appcast | `native/macos/dist/releases/0.7.0-beta.10-macos-28/appcast/appcast.xml` | `8ec83402c6bdab6f92afd6e00222433f257ae6c6e153b928cc11d5aaefb13933` |
| iPhone archive | `apps/ios/ClawDadMobile/build/ClawDadMobile-Founder-32.xcarchive` | Apple-accepted upload source; direct upload retained no local IPA |

The appcast and Mac artifacts remain local. Release notes are in
`docs/releases/0.7.0-macos-28.md` and `docs/releases/0.7.0-ios-32.md`.

## Verification Completed

- Node application/runtime suite: 449 tests passed on the merged release
  checkpoint.
- `swift test --package-path apps/ios/ClawDadMobile`: 40 tests passed.
- `swift test --package-path native/ClawDadRemoteAssistProtocol`: 28 tests
  passed.
- `swift test --package-path native/macos`: 52 tests passed.
- The iPhone archive is `0.7.0 (32)`, uses bundle ID
  `earth.frg.clawdad.ios`, points to the production cloud endpoint, and was
  accepted by App Store Connect.
- App Store Connect build ID `f0d60bc9-c671-4bd5-9a31-f1b465f85cdf` is
  `VALID`, export compliance is clear, and the build is assigned to
  `ClawDad Internal`.
- Mac build 28 and its DMG are Developer ID signed, notarized, stapled, and
  accepted by Gatekeeper; all recorded SHA-256 checks pass.
- `/Applications/ClawDad.app` reports version `0.7.0 (28)` with embedded runtime
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
- Pair it to installed Mac build 28 with a fresh QR.
- Open Remote Assist, choose Terminal Tabs from the compact menu, approve the
  one-time macOS Terminal Automation prompt if shown, and focus at least two
  different Terminal rows.
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
