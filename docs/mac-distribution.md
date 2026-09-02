# ClawDad Mac Distribution

ClawDad for Mac is the local execution host for the iPhone companion. The
customer build contains the ClawDad runtime, supervises its loopback service,
stores local credentials in macOS Keychain, and receives signed updates through
Sparkle.

## Distribution Boundary

The native Mac application is distributed as a signed and notarized app. A
private native candidate can be retained and installed locally; a separately
authorized public release can use the Sparkle update channel and GitHub assets.
The private iPhone companion is distributed through TestFlight. Root `npm`
scripts are build and verification entry points for this monorepo; `npm publish`
is a separate public CLI release and is not part of a native Mac or iPhone
rollout unless that public publication is explicitly requested.

## Private Native Install

For the current native beta 16 candidate, use the locally retained DMG that
matches the Mac:

1. Open the Apple-silicon artifact under
   `native/macos/dist/releases/0.7.0-beta.16-macos-38/`, or the Intel artifact
   under `native/macos/dist/releases/0.7.0-beta.16-macos-38-intel/`.
2. Quit ClawDad, drag ClawDad into Applications, and replace the previous app.
3. Open `/Applications/ClawDad.app` and verify version `0.7.0 (38)` with embedded
   runtime `0.7.0-beta.16`.
4. Confirm only the app-managed native services are active on port 4487 and the
   legacy service labels remain disabled.

## Published Customer Install

1. Download the Apple-silicon or Intel Mac beta from `https://clawdad.earth/`.
2. Open the DMG and drag ClawDad into Applications.
3. Open ClawDad from Applications.
4. Use the setup assistant to choose controller, host, or combined mode.
5. Confirm the managed Node and ORP runtime. On a host, approve the official
   standalone Codex installation if needed and complete ChatGPT sign-in.
6. Choose the primary projects folder, then pair the other computers and phones
   that should reach this host.

The DMG and app are signed with Developer ID, notarized by Apple, and stapled so
Gatekeeper can verify them even when the Mac is offline.

ClawDad embeds Node 24.20.0 and ORP inside the app bundle. It does not require a
global Node installation. When the customer approves Codex installation, the
setup assistant uses OpenAI's official standalone installer for
`~/.local/bin/codex`; ClawDad and Terminal then share the account and thread
history under `~/.codex`.

## First-Run Permissions

ClawDad requests each capability when the customer uses the matching feature:

- Microphone access supports voice-to-text in the composer.
- Screen Recording shares the display selected from the paired iPhone during a
  customer-started Remote Assist session.
- Accessibility sends keyboard and pointer input during Remote Assist.

Settings explains the two Remote Assist permissions and links directly to the
correct macOS Privacy & Security panes. Remote Assist stays inactive until the
customer enables it and grants both permissions.

Current macOS releases can still require a confirmation when a new unattended
Remote Assist capture starts, even after Screen & System Audio Recording shows
ClawDad as allowed. Apple reserves durable unattended screen access for VNC apps
that receive the restricted
`com.apple.developer.persistent-content-capture` entitlement. ClawDad must keep
the per-session confirmation until Apple approves that entitlement for the
Developer ID application.

## Updates And Diagnostics

The Apple-silicon app checks the primary HTTPS Sparkle feed daily:

`https://clawdad-cloud.frg.earth/mac/appcast.xml`

The Intel app uses its architecture-specific HTTPS feed:

`https://clawdad.earth/downloads/appcast-intel.xml`

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

For the current private native release, run:

```bash
CLAWDAD_RELEASE_VERSION=0.7.0-beta.16 \
CLAWDAD_APP_VERSION=0.7.0 \
CLAWDAD_APP_BUILD=38 \
CLAWDAD_MAC_ARCH=arm64 \
CLAWDAD_NOTARIZE=1 \
CLAWDAD_PUBLISH_APPCAST=0 \
  npm run native:release
```

Build the matching Intel artifact with a separate release directory and
filename suffix:

```bash
CLAWDAD_RELEASE_VERSION=0.7.0-beta.16 \
CLAWDAD_APP_VERSION=0.7.0 \
CLAWDAD_APP_BUILD=38 \
CLAWDAD_MAC_ARCH=x86_64 \
CLAWDAD_RELEASE_ARTIFACT_SUFFIX=intel \
CLAWDAD_RELEASE_DIR="$PWD/native/macos/dist/releases/0.7.0-beta.16-macos-38-intel" \
CLAWDAD_SPARKLE_FEED_URL=https://clawdad.earth/downloads/appcast-intel.xml \
CLAWDAD_RELEASE_DOWNLOAD_URL_PREFIX=https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.16/ \
CLAWDAD_NOTARIZE=1 \
CLAWDAD_PUBLISH_APPCAST=0 \
  npm run native:release
```

The command:

1. Builds the embedded ClawDad runtime.
2. Cross-compiles the selected architecture, thins its release frameworks,
   then signs Sparkle, WebRTC, and the host app in the required nested order.
3. Submits the app archive to Apple, waits for notarization, and staples it.
4. Generates the EdDSA-signed Sparkle appcast and update ZIP.
5. Creates a maximum-compression DMG, then signs, notarizes, and staples it.
6. Verifies Gatekeeper acceptance and writes `SHA256SUMS`.

Credentials remain outside the repository:

- Developer ID signing identity: macOS Keychain
- Notary profile: `ClawDad` in macOS Keychain
- Sparkle signing account: `earth.frg.ClawDad` in macOS Keychain
- Appcast publish token: service `clawdad-cloud-release`, account `appcast`

CI or isolated release environments can provide App Store Connect API
credentials directly with `CLAWDAD_NOTARY_KEY_PATH`,
`CLAWDAD_NOTARY_KEY_ID`, and `CLAWDAD_NOTARY_ISSUER_ID`. Set all three
together. Local releases continue to use the `ClawDad` Keychain profile by
default.

Set `CLAWDAD_SWIFT_SCRATCH_PATH` when SwiftPM build output must live outside
the package's `.build` directory. The release pipeline uses the same scratch
path for the app binary, Sparkle framework, and appcast generator.
Set `CLAWDAD_SWIFT_DISABLE_SANDBOX=1` only when an outer build sandbox blocks
SwiftPM's nested sandbox; ordinary local releases keep SwiftPM sandboxing on.
An isolated builder that cannot run `iconutil` may provide the previously
verified multi-resolution icon with `CLAWDAD_PREBUILT_ICON_PATH`.

The generated appcast, ZIP, and DMG remain local when
`CLAWDAD_PUBLISH_APPCAST=0`. Set `CLAWDAD_PUBLISH_APPCAST=1` only for a
separately authorized public release after its GitHub release archive is
available. The public feed is read-only; publishing requires the dedicated
release token.

## Verification

For a generated release:

```bash
codesign --verify --deep --strict native/macos/dist/ClawDad.app
spctl --assess --type execute --verbose=4 native/macos/dist/ClawDad.app
xcrun stapler validate native/macos/dist/ClawDad.app
xcrun stapler validate native/macos/dist/releases/<version>/ClawDad-<version>-mac.dmg
shasum -a 256 -c native/macos/dist/releases/<version>/SHA256SUMS
```

Repeat the architecture and Gatekeeper checks for the Intel release directory,
and require `lipo -archs` to report `x86_64` for the app, WebRTC, and Sparkle.

Gatekeeper should report `source=Notarized Developer ID`.

## Rollback

For a private native candidate, retain the defective notarized artifact and
checksum as evidence, restore the previous signed and notarized app locally,
and issue a higher build number. The public appcast and GitHub assets are
unchanged and require no rollback.

For a separately authorized public release, remove a defective release from the
public appcast first, then replace it with a new higher build number. Existing
notarized DMGs and their checksums remain on the GitHub release for support and
forensic comparison.
