# ClawDad 0.7 Native Beta 11 Release Packet

Prepared: 2026-09-01

## Release Identity

- Embedded runtime: `0.7.0-beta.11`
- Mac app: `0.7.0 (33)`
- iPhone app: `0.7.0 (32)`
- Distribution mode: public signed Mac download plus private internal iPhone
  TestFlight

The Mac installer is available directly from `https://clawdad.earth/`. The
iPhone companion remains assigned only to `ClawDad Internal`. The npm package,
git tags, public GitHub release assets, primary cloud Sparkle appcast, external
TestFlight group, Beta App Review, and App Store submission are unchanged. The
Intel build uses its dedicated signed appcast on clawdad.earth.

## Included Scope

- Every Mac installation now owns a separate signed controller identity in
  Keychain in addition to its existing host identity.
- Desktop Settings includes **Remote Computers** for pairing, opening, and
  forgetting another Mac with a short-lived code.
- Pair acceptance and every Remote Assist response are verified against the
  host public key pinned in that code.
- Relay credentials are scoped per saved computer in Keychain and excluded from
  saved profiles and diagnostics.
- The native Mac viewer requires Touch ID or the Mac login password, then
  supports pointer and keyboard input, multi-display selection, clipboard
  exchange, and special commands.
- Pairing remains directional. A fresh reverse pairing is required when both
  Macs should control each other.
- Each Mac release is cross-compiled and thinned to its selected architecture
  before signing. Maximum DMG compression keeps both notarized installers
  inside the clawdad.earth single-file delivery boundary.

## Release Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| Apple-silicon DMG | `native/macos/dist/releases/0.7.0-beta.11-macos-33/ClawDad-0.7.0-beta.11-mac.dmg` | `192a6c2dead6660ae2393e875f21610432da53f9a756bb29730d5245c608f252` |
| Intel DMG | `native/macos/dist/releases/0.7.0-beta.11-macos-33-intel/ClawDad-0.7.0-beta.11-mac-intel.dmg` | `88e879b065005053e01f258c4e15eba57854811526448f84e080bf07b1b833b9` |
| Intel ZIP | `native/macos/dist/releases/0.7.0-beta.11-macos-33-intel/appcast/ClawDad-0.7.0-beta.11-mac-intel.zip` | `1826d8ed54a77f8c8aee92fa0135c193f62e4c1d63f65c5af1324eb648589bd8` |
| Intel signed appcast | `native/macos/dist/releases/0.7.0-beta.11-macos-33-intel/appcast/appcast.xml` | `e86ce38fa4e1c72c8f0c4dee76013e1158fc7f7b65f5d4e162b1260c63a59367` |
| Live Apple-silicon DMG | `https://clawdad.earth/downloads/ClawDad-0.7.0-beta.11-mac.dmg` | `192a6c2dead6660ae2393e875f21610432da53f9a756bb29730d5245c608f252` |
| Live Intel DMG | `https://clawdad.earth/downloads/ClawDad-0.7.0-beta.11-mac-intel.dmg` | `88e879b065005053e01f258c4e15eba57854811526448f84e080bf07b1b833b9` |

The live Apple-silicon and Intel DMGs are `25,266,379` and `25,442,495` bytes.
Both match their local notarized artifacts byte for byte.

## Verification Completed

- Node application/runtime suite: 462 tests passed.
- iPhone Swift suite: 45 tests passed.
- Shared Remote Assist protocol suite: 28 tests passed.
- Mac Swift suite: 59 tests passed.
- Marketing site lint completed with zero errors and 14 pre-existing image
  optimization warnings; its production build completed with the home, About,
  Privacy, Release Notes, and Support routes.
- Both architecture-specific Mac apps and DMGs are Developer ID signed,
  notarized, stapled, and accepted by Gatekeeper.
- The installed `/Applications/ClawDad.app` reports `0.7.0 (33)`, embeds runtime
  `0.7.0-beta.11`, and uses arm64 WebRTC and Sparkle frameworks.
- One native runtime and one native cloud-host process are active; port 4487 has
  one listener and `/healthz` reports the beta 11 runtime ready with the shared
  Codex app-server.
- clawdad.earth serves beta 11 build 33, the Mac-to-Mac release notes, separate
  Apple-silicon and Intel choices, both exact verified DMGs, and the signed
  Intel update feed.

## Physical Device Gates

- Download the matching build 33 architecture from clawdad.earth on the Mac
  laptop, install it, and open ClawDad.
- On the Studio, open Settings, choose **Allow a Device**, and copy the current
  short-lived pairing code.
- On the laptop, paste that code under **Remote Computers**, pair, then open the
  Studio with Remote Assist.
- Verify Touch ID or login authentication, display selection, click and typing
  alignment, copy, paste, Command-Tab, and Command-T.
- Generate a fresh code on the laptop and repeat from the Studio to verify the
  reverse direction.
- Pair the iPhone with both Macs and confirm each appears as an independent
  thread and Remote Assist source.

## Remaining Release Action

The artifact, installed Studio host, and website download gates are complete.
The release becomes physically accepted after the laptop and iPhone checks
above are observed on the actual devices.

## Preserved Outside This Release

- The public npm package and its authentication flow
- Public GitHub release assets, git tags, and the primary cloud Sparkle appcast
- External TestFlight and App Store release state
- Unrelated working-tree changes and `assets/wordmark-explorations/`
- Credentials, pairing tickets, relay tokens, logs, project contents, and
  customer data
