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
git tags, public GitHub release assets, public Sparkle appcast, external
TestFlight group, Beta App Review, and App Store submission are unchanged.

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
- The Mac release frameworks are thinned to arm64 before signing so the
  notarized installer fits the clawdad.earth single-file delivery boundary.

## Release Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| Mac DMG | `native/macos/dist/releases/0.7.0-beta.11-macos-33/ClawDad-0.7.0-beta.11-mac.dmg` | `192a6c2dead6660ae2393e875f21610432da53f9a756bb29730d5245c608f252` |
| Mac ZIP | `native/macos/dist/releases/0.7.0-beta.11-macos-33/appcast/ClawDad-0.7.0-beta.11-mac.zip` | `19318ba0ea36ad4e7abffc416a9f713dd4d9283778b58284266ac94868c29587` |
| Local signed appcast | `native/macos/dist/releases/0.7.0-beta.11-macos-33/appcast/appcast.xml` | `2a87597eb7873084ea8239a86c787ba9612475b87b4cb6c36016b97eebd6d156` |
| Live website DMG | `https://clawdad.earth/downloads/ClawDad-0.7.0-beta.11-mac.dmg` | `192a6c2dead6660ae2393e875f21610432da53f9a756bb29730d5245c608f252` |

The live response is `application/octet-stream`, has a content length of
`25,266,379` bytes, and matches the local notarized DMG byte for byte.

## Verification Completed

- Node application/runtime suite: 462 tests passed.
- iPhone Swift suite: 45 tests passed.
- Shared Remote Assist protocol suite: 28 tests passed.
- Mac Swift suite: 59 tests passed.
- Marketing site lint completed with zero errors and 14 pre-existing image
  optimization warnings; its production build completed with the home, About,
  Privacy, Release Notes, and Support routes.
- The Mac app and DMG are Developer ID signed, notarized, stapled, and accepted
  by Gatekeeper.
- The installed `/Applications/ClawDad.app` reports `0.7.0 (33)`, embeds runtime
  `0.7.0-beta.11`, and uses arm64 WebRTC and Sparkle frameworks.
- One native runtime and one native cloud-host process are active; port 4487 has
  one listener and `/healthz` reports the beta 11 runtime ready with the shared
  Codex app-server.
- clawdad.earth serves beta 11 build 33, the Mac-to-Mac release notes, and the
  exact verified DMG.

## Physical Device Gates

- Download build 33 from clawdad.earth on the Mac laptop, install it, and open
  ClawDad.
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
- Public GitHub release assets, git tags, and the public Sparkle appcast
- External TestFlight and App Store release state
- Unrelated working-tree changes and `assets/wordmark-explorations/`
- Credentials, pairing tickets, relay tokens, logs, project contents, and
  customer data
