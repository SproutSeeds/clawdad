# ClawDad Release Packet

Prepared: 2026-07-30

## Release

- Package: `clawdad`
- Package version: `0.7.0-beta.3`
- Git tag: `v0.7.0-beta.3`
- Mac app: `0.7.0 (18)`
- iPhone app: `0.7.0 (19)`
- TestFlight group: `ClawDad Internal`
- App Store record: `ClawDad Mobile`, version `1.0`

## Customer Artifacts

- `ClawDad-0.7.0-beta.3-mac.dmg`
- `ClawDad-0.7.0-beta.3-mac.zip`
- `SHA256SUMS`
- signed Sparkle `appcast.xml`
- TestFlight build 19
- release notes in `docs/releases/0.7.0-beta.3.md`

## Release Scope

- Per-device QR pairing, inventory, revocation, and Keychain storage.
- Workspace-scoped cloud relay authorization.
- StoreKit monthly and annual plans with a 14-day free trial.
- Apple-signed entitlement verification on the paired Mac.
- Direct and Queue delivery through long turns and reconnects.
- Voice, images, formatted thread history, and cross-project recent threads.
- Face ID-gated Remote Assist with keyboard and explicit clipboard transfer.
- Signed, notarized Mac install and Sparkle update pipeline.

## Human Gates

- Install TestFlight build 19 and complete the physical certification matrix.
- Confirm Paid Applications Agreement, banking, tax, and app privacy answers.
- Attach the first subscriptions and a public build to App Store version 1.0.
- Supply App Review contact details and a durable reviewer pairing path.
- Obtain Cloudflare Calls Write access before restrictive-network TURN testing.

## Verification

Run:

```sh
npm test
swift test --package-path apps/ios/ClawDadMobile
swift test --package-path native/macos
npm run ios:build
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
  native/macos/dist/releases/0.7.0-beta.3/ClawDad-0.7.0-beta.3-mac.dmg
shasum -a 256 -c \
  native/macos/dist/releases/0.7.0-beta.3/SHA256SUMS
```

## Keep Out

- `assets/wordmark-explorations/`
- local screenshots outside canonical App Store assets
- credentials, pairing tickets, relay tokens, and Apple signed transactions
- local logs and customer project data
