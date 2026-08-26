# ClawDad 0.7 Beta 8 Rollout Packet

Prepared: 2026-08-26

## Release Identity

- Package: `clawdad@0.7.0-beta.8`
- Git tag: `v0.7.0-beta.8`
- Source checkpoint: `aefc633fce0223ebbc807b4fd2bdd053e80c13bf`
- Feature checkpoint: `3d64694`
- Mac app: `0.7.0 (25)`
- iPhone app: `0.7.0 (30)`

The annotated tag and release branch are pushed. The notarized Mac release is
public on GitHub and through the signed Sparkle feed, build 25 is installed on
the paired Mac, TestFlight build 30 is `VALID` in `ClawDad Internal` only, and
npm accepted beta 8 for publication to the `beta` tag.

## Included Scope

- Remote Assist uses a private macOS event source and balanced key sequences so
  synthetic modifier state cannot remain held after a remote command.
- Session teardown releases remotely held keys and mouse buttons.
- Command-T is available in Special Commands and opens a new tab in the active
  Mac app.
- Command-Tab, Control-C, Control-J, Escape, Tab, arrows, and Control-L remain
  available through the typed shortcut allow-list.
- The iPhone keyboard dismisses on a normal viewport tap while the same click
  is forwarded to the paired Mac.
- The compact Remote Assist controls stay reachable without covering the
  viewport.
- iPhone and Mac composers include a Cut control that copies the exact draft,
  clears only after clipboard success, and restores editor focus.

## Release Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| npm package | `native/macos/dist/releases/0.7.0-beta.8/npm/clawdad-0.7.0-beta.8.tgz` | `783c1feffbc971f9b726d200cbecc6e31735d274ff5667a3ffa59786f76df252` |
| Mac DMG | `native/macos/dist/releases/0.7.0-beta.8/ClawDad-0.7.0-beta.8-mac.dmg` | `c5aac2ed05a6c08ac09015dbf5f320036a0c58663deb50502af8ca6a8c27cd4b` |
| Mac ZIP | `native/macos/dist/releases/0.7.0-beta.8/appcast/ClawDad-0.7.0-beta.8-mac.zip` | `cd0bfbb3614d61f1e2266e495690fd8c6284cee885704e5bb399c782bd770df6` |
| Signed appcast | `native/macos/dist/releases/0.7.0-beta.8/appcast/appcast.xml` | `38272aab9ad8b8929d48668572a3d074527fd0d6f15e705dbf68a2b82debd2da` |
| iPhone archive | `apps/ios/ClawDadMobile/build/ClawDadMobile-Founder-30.xcarchive` | Apple-accepted archive; direct upload retained no local IPA |

The GitHub prerelease is
`https://github.com/SproutSeeds/clawdad/releases/tag/v0.7.0-beta.8`.
The public Sparkle appcast is byte-identical to the signed local appcast.

Release notes are in `docs/releases/0.7.0-beta.8.md` and
`docs/releases/0.7.0-ios-30.md`.

## Verification Completed

- `npm test`: 414/414 passed.
- `swift test --package-path apps/ios/ClawDadMobile`: 28/28 passed.
- `swift test --package-path native/ClawDadRemoteAssistProtocol`: 15/15 passed.
- `swift test --package-path native/macos`: 36/36 passed.
- Targeted release coverage: 66/66 passed.
- `npm run ios:generate` and `npm run ios:build` succeeded.
- The iPhone archive is `0.7.0 (30)`, uses bundle ID
  `earth.frg.clawdad.ios`, points to the production cloud endpoint, has founder
  bypass disabled, and was accepted by App Store Connect.
- App Store Connect build ID `0c47168e-f25a-407d-9ce5-5a98a689b914` is
  `VALID`, export compliance is clear, and the build is assigned to
  `ClawDad Internal`.
- Mac build 25 and its DMG are signed, notarized, stapled, and accepted by
  Gatekeeper.
- GitHub asset digests match the local DMG and ZIP. The signed public appcast
  points to the beta 8 ZIP and advertises Sparkle build 25.
- `/Applications/ClawDad.app`, the app-managed runtime, the background server,
  the cloud host, and the global CLI all report build 25 or beta 8 as
  appropriate.
- One Mac app process is running. The background server owns port 4477 and the
  app-managed runtime owns its fallback port 4487 without a restart loop.
- npm authenticated as `sproutseeds` and accepted the exact beta 8 tarball for
  publication. Public registry read-back can lag while npm processes a package.

## Distribution Boundaries

- Build 30 is assigned only to the private `ClawDad Internal` TestFlight group.
- The external founding-customer group is unassigned, its public link is
  disabled, and Beta App Review is not submitted.
- The production relay Worker was unchanged by this release.
- Automated publication and host checks are complete; physical iPhone behavior
  remains a separate acceptance gate.

## Physical Device Gates

- Install TestFlight build 30 on the paired iPhone.
- Send Command-T from Remote Assist and confirm exactly one new tab opens with
  no literal `t` and no held Command modifier.
- Cut one draft on iPhone and one on Mac; confirm exact clipboard contents,
  editor clearing, and immediate typing focus.
- Recheck Command-Tab, pointer input, Terminal tab clicks, keyboard dismissal,
  clipboard, reconnect, Mac lock/unlock, and Wi-Fi-to-cellular recovery.

## Remaining Release Action

Wait for npm's post-publication processing to expose beta 8 through public
registry read-back, then record the final `beta` dist-tag result. This does not
block TestFlight or the installed Mac host, which already runs the exact
verified beta 8 package from the release tarball.

## Preserved Outside This Release

- The original working checkout and its unrelated edits
- `assets/wordmark-explorations/`
- unrelated local Codex hook/plugin changes
- credentials, pairing tickets, relay tokens, and Apple-signed transactions
- local logs and customer project data
