# ClawDad Release Packet

Prepared: 2026-07-30

## Release

- Package: `clawdad`
- Package version: `0.7.0-beta.4`
- Git tag: `v0.7.0-beta.4`
- Mac app: `0.7.0 (19)`
- iPhone app: `0.7.0 (19)`
- Internal TestFlight group: `ClawDad Internal`
- External TestFlight group: `ClawDad Founding Customers`
- App Store record: `ClawDad Mobile`, version `1.0`

## Customer Artifacts

- `ClawDad-0.7.0-beta.4-mac.dmg`
- `ClawDad-0.7.0-beta.4-mac.zip`
- `SHA256SUMS`
- signed Sparkle `appcast.xml`
- TestFlight build 19
- release notes in `docs/releases/0.7.0-beta.4.md`

## Release Scope

- Per-device QR pairing, inventory, revocation, and Keychain storage.
- Workspace-scoped cloud relay authorization.
- StoreKit monthly and annual plans with a 14-day free trial.
- Apple-signed entitlement verification on the paired Mac.
- Direct and Queue delivery through long turns and reconnects.
- Voice, images, formatted thread history, and cross-project recent threads.
- Face ID-gated Remote Assist with keyboard and explicit clipboard transfer.
- Signed, notarized Mac install and Sparkle update pipeline.

## Current Gate State

- The installed Mac host, production cloud relay, public support/privacy pages,
  GitHub prerelease, signed appcast, and TestFlight build 19 are live and
  healthy.
- App Store subscription metadata is complete. The group, monthly plan, and
  annual plan each have a localized version-1 draft in
  `PREPARE_FOR_SUBMISSION`; these draft-version states are authoritative.
- The private external `ClawDad Founding Customers` TestFlight group is live
  with feedback enabled, no public link, no assigned build, and no review
  submission. The guarded submission command is prepared for the end of the
  physical certification pass.
- The exact `v0.7.0-beta.4` npm package was reconstructed from the tag and
  verified at 207 files. Publication reached npm successfully and stopped at
  the account OTP challenge without publishing a partial version. Publish that
  tagged reconstruction, not the newer 208-file branch package, under the
  beta.4 version.
- Two canonical 6.9-inch App Store screenshots are reproducible from synthetic
  in-memory data, opaque, visually reviewed at `1290x2796`, and uploaded in
  order to the draft App Store version with `COMPLETE` processing state.
- The connected iPhone remains on `0.1.0 (15)`. Physical certification begins
  after TestFlight updates it to `0.7.0 (19)`.
- The existing Cloudflare deployment token is healthy for Workers deployment
  but lacks `Calls Write`; TURN activation needs a narrowly scoped token.
- Session Doctor is healthy apart from four missing historical project paths
  awaiting an explicit keep-or-retire decision:
  `ai-shorts-studio`, `campus-ready`, `gw2-companion`, and `richboy-tyria`.

## Human Gates

- Install TestFlight build 19 and complete the physical certification matrix.
- Supply the monitored Beta App Review phone number, then use the guarded
  command to assign build 19 and start external Beta App Review.
- Enter a fresh npm authenticator code to publish the prepared beta.4 package.
- Confirm Paid Applications Agreement, banking, tax, and app privacy answers.
- Attach the first subscriptions and a public build to App Store version 1.0.
- Supply App Review contact details and a durable reviewer pairing path.
- Create a Cloudflare API token limited to `Calls Write`, then complete
  restrictive-network TURN testing.
- Choose whether the four missing historical project entries should be retired
  from ClawDad or restored on disk.

## Verification

Run:

```sh
npm test
swift test --package-path apps/ios/ClawDadMobile
swift test --package-path native/macos
npm run ios:build
zsh ./bin/clawdad-app-store-screenshots
npm run certify:snapshot
npm pack --dry-run --json
git diff --check
orp hygiene --json
```

For the generated Mac release, verify:

```sh
codesign --verify --deep --strict --verbose=2 \
  native/macos/dist/ClawDad.app
xcrun stapler validate \
  native/macos/dist/releases/0.7.0-beta.4/ClawDad-0.7.0-beta.4-mac.dmg
shasum -a 256 -c \
  native/macos/dist/releases/0.7.0-beta.4/SHA256SUMS
```

## Keep Out

- `assets/wordmark-explorations/`
- local screenshots outside canonical App Store assets
- credentials, pairing tickets, relay tokens, and Apple signed transactions
- local logs and customer project data
