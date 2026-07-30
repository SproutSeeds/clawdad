# ClawDad Mac Distribution

ClawDad for Mac is the local execution host for the iPhone companion. The
customer build contains the ClawDad runtime, supervises its loopback service,
stores local credentials in macOS Keychain, and receives signed updates through
Sparkle.

## Customer Install

1. Download `ClawDad-<version>-mac.dmg` from the matching GitHub release.
2. Open the DMG and drag ClawDad into Applications.
3. Open ClawDad from Applications.
4. Choose the primary projects folder during setup.
5. Open Settings to pair an iPhone or add more project folders.

The DMG and app are signed with Developer ID, notarized by Apple, and stapled so
Gatekeeper can verify them even when the Mac is offline.

## First-Run Permissions

ClawDad requests each capability when the customer uses the matching feature:

- Microphone access supports voice-to-text in the composer.
- Screen Recording shares the primary display during a customer-started Remote
  Assist session.
- Accessibility sends keyboard and pointer input during Remote Assist.

Settings explains the two Remote Assist permissions and links directly to the
correct macOS Privacy & Security panes. Remote Assist stays inactive until the
customer enables it and grants both permissions.

## Updates And Diagnostics

The app checks the HTTPS Sparkle feed daily:

`https://clawdad-cloud.frg.earth/mac/appcast.xml`

Every update archive is signed with the ClawDad Sparkle EdDSA key. The private
key remains in macOS Keychain; the app contains only the public key. Customers
can also choose **Check for Updates** from the ClawDad menu or desktop Settings.

Desktop Settings provides:

- **Check for Updates** to open Sparkle's signed update flow.
- **Open Logs** to reveal ClawDad's local support logs in Finder.
- **Copy Diagnostics** to copy app/runtime versions and permission/connection
  states without copying project paths, prompts, responses, credentials, or
  code.

## Release Command

Run:

```bash
npm run native:release
```

The command:

1. Builds the embedded ClawDad runtime.
2. Signs Sparkle, WebRTC, and the host app in the required nested order.
3. Submits the app archive to Apple, waits for notarization, and staples it.
4. Generates the EdDSA-signed Sparkle appcast and update ZIP.
5. Creates, signs, notarizes, and staples the customer DMG.
6. Verifies Gatekeeper acceptance and writes `SHA256SUMS`.

Credentials remain outside the repository:

- Developer ID signing identity: macOS Keychain
- Notary profile: `ClawDad` in macOS Keychain
- Sparkle signing account: `earth.frg.ClawDad` in macOS Keychain
- Appcast publish token: service `clawdad-cloud-release`, account `appcast`

Set `CLAWDAD_PUBLISH_APPCAST=1` to publish the generated feed after its GitHub
release archive is available. The public feed is read-only; publishing requires
the dedicated release token.

## Verification

For a generated release:

```bash
codesign --verify --deep --strict native/macos/dist/ClawDad.app
spctl --assess --type execute --verbose=4 native/macos/dist/ClawDad.app
xcrun stapler validate native/macos/dist/ClawDad.app
xcrun stapler validate native/macos/dist/releases/<version>/ClawDad-<version>-mac.dmg
shasum -a 256 -c native/macos/dist/releases/<version>/SHA256SUMS
```

Gatekeeper should report `source=Notarized Developer ID`.

## Rollback

Sparkle retains prior release entries when future appcasts are generated. A bad
release should be removed from the public appcast first, then replaced with a
new higher build number. Existing notarized DMGs and their checksums remain on
the GitHub release for support and forensic comparison.
