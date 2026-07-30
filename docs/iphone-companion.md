# ClawDad iPhone Companion

This is the implementation home for the iPhone-first ClawDad companion.

## Current Slice

- `lib/cloud-protocol.mjs` defines signed cloud envelopes.
- `lib/cloud-host-connector.mjs` connects a Mac host to ClawDad Cloud and routes phone requests into the existing local app server.
- `cloud/worker.mjs` provides a Cloudflare Worker plus Durable Object realtime relay.
- `apps/ios/ClawDadMobile` contains the native SwiftUI companion and checked-in Xcode project.
- `GET /v1/cloud/status` lets the desktop UI/native shell inspect cloud host readiness without exposing secrets.

## Architecture

The Mac desktop remains the execution authority. The iPhone app sends signed envelopes to ClawDad Cloud. The Cloudflare relay forwards those envelopes over an outbound host WebSocket. The host connector verifies trusted device signatures for state-changing commands and then calls the existing local APIs such as `/v1/dispatch`, `/v1/projects`, `/v1/history`, and `/v1/artifacts`.

Cloud storage should stay minimal: account records, devices, hosts, revocations, APNs tokens, and connection metadata. Project messages, terminal output, attachments, and code content should stay on the desktop unless an explicit encrypted-cache mode is added.

## Local Desktop Config

`~/.clawdad/cloud.json`:

```json
{
  "cloudUrl": "http://127.0.0.1:8787",
  "accountId": "local-account",
  "workspaceId": "scratchpad",
  "hostId": "cody-mac",
  "localUrl": "http://127.0.0.1:4477",
  "localToken": "local-server-token",
  "hostPrivateKeyPath": "~/.clawdad/cloud-host-private.pem",
  "hostPublicKeyPath": "~/.clawdad/cloud-host-public.pem",
  "trustedDevicePublicKeys": {}
}
```

Check config:

```sh
clawdad cloud-host --json
```

Run connector:

```sh
clawdad cloud-host
```

## Cloud Dev

```sh
npx wrangler dev --config cloud/wrangler.toml
```

Optional development bearer token:

```sh
wrangler secret put CLAWDAD_CLOUD_DEV_TOKEN --config cloud/wrangler.toml
```

## Cloud Staging

The first TestFlight lane should point at an HTTPS Cloudflare Worker.

```sh
npm run cloud:deploy:staging
curl https://clawdad-cloud.frg.earth/healthz
```

If the Worker is still using the default `workers.dev` URL, update
`CLAWDAD_CLOUD_URL` for `Staging` and `Release` in
`apps/ios/ClawDadMobile/project.yml`, then regenerate the project:

```sh
npm run ios:generate
```

## iPhone App

The SwiftUI app currently supports:

- a ClawDad-style composer-first home screen
- QR-first phone pairing from desktop Settings
- advanced cloud URL/account/workspace/host settings hidden behind Settings disclosure
- persistent device id and P-256 signing key in Keychain
- realtime WebSocket connection
- automatic reconnect on launch, foregrounding, network changes, and host wake
- catalog request
- project picker
- active thread display
- signed `message.send` envelope with Direct and Queue modes
- lightweight `status.request` heartbeat snapshots for long-running turns
- relay and host heartbeat state that distinguishes Connected, Reconnecting,
  and Mac unavailable
- Repo scoped and Full access send options
- StoreKit monthly and annual subscriptions with a 14-day introductory trial
- independently verified Apple-signed entitlement sync to the paired Mac
- one-time QR pairing with a separate revocable Keychain credential per iPhone
- Face ID-gated Remote Assist for viewing and controlling the paired Mac on
  demand

The app project uses:

- product name: `ClawDad`
- bundle id: `earth.frg.clawdad.ios`
- version: `0.7.0`
- build: `19`
- minimum iOS: `18.0`
- Release cloud URL: `https://clawdad-cloud.frg.earth`

Build the Swift package and simulator app:

```sh
swift build --package-path apps/ios/ClawDadMobile
npm run ios:build
```

Create the signed Release archive:

```sh
npm run ios:archive
```

Upload that exact archive to App Store Connect for TestFlight:

```sh
npm run ios:upload:testflight
```

The upload command uses the checked-in App Store export policy and reads the
App Store Connect private key from `~/.private_keys/AuthKey_3SN77ZU256.p8` by
default. Override the key path, key id, or issuer id with
`CLAWDAD_ASC_KEY_PATH`, `CLAWDAD_ASC_KEY_ID`, or `CLAWDAD_ASC_ISSUER_ID`.

## QR Pairing For First TestFlight

1. Install the TestFlight build on the iPhone.
2. Start or confirm the desktop app server and cloud host connector.
3. Open ClawDad Settings on the Mac and generate a fresh Pair iPhone QR.
4. Open ClawDad on the iPhone, tap Pair, and scan the QR.
5. Confirm the app shows paired/connected state, then load the project catalog.

The thread selector includes a plus button for creating a new Codex thread in
the selected project. The claw menu controls Direct versus Queue delivery,
repo-scoped versus full access, and the Codex model and reasoning effort used by
subsequent messages. A fresh install starts with `gpt-5.6-sol` at `ultra`, then
refreshes the available choices from the Mac's live Codex model catalog.
The selected project and Codex thread persist across backgrounding, force quits,
and later launches. If either saved selection no longer exists, the app falls
back to the current active thread in the first available project.
Selecting a project, reconnecting, or using **Refresh Threads** synchronizes that
directory against the Mac's native Codex transcripts before the catalog is
returned. ClawDad preserves each Codex session ID, so a thread continued from the
iPhone can later be resumed in the desktop terminal with the same history.

The claw menu also includes **Images**. Select up to four photos; ClawDad resizes
each one to a maximum 2048-pixel edge, shows removable previews above the send
bar, and sends the images to the selected Codex thread with or without message
text. The signed cloud envelope is validated by the Mac connector, translated
into the local multipart dispatch format, and delivered to Codex as native image
inputs. Individual prepared images are limited to 4 MB and the message total is
limited to 12 MB.

Host connector check:

```sh
clawdad cloud-host --json
clawdad cloud-host
```

## Security Status

The founding paid beta uses workspace claims rather than a global ClawDad
account. A one-time QR ticket creates a unique opaque relay token for that
iPhone, the token is stored in the iPhone Keychain, and the Mac can list or
revoke each paired device. The relay validates the workspace, host, and device
identity before forwarding app data. Active StoreKit access is accepted by the
Mac only when the iPhone supplies an Apple-signed transaction that validates
against the bundled Apple trust roots.

The production relay remains in compatibility mode until build 19 is installed
on a physical iPhone and a fresh pairing proves the per-device credential path.
After that proof, enable relay enforcement and recheck connection, revocation,
and re-pairing. Passkeys, App Attest, APNs, and multi-Mac account recovery are
future account-platform work; they are not claimed by this beta.

## Acceptance Test

1. Start local ClawDad desktop service.
2. Start the Cloudflare Worker dev server.
3. Run `clawdad cloud-host --json` and confirm `configured: true`.
4. Generate a Pair iPhone QR from desktop Settings.
5. Run `clawdad cloud-host`.
6. Launch the iPhone app, scan the QR, let it connect automatically, choose Scratchpad, and send a message.
7. Confirm the desktop thread receives the same dispatch path as the desktop composer.
8. Lock the Mac screen during an active turn and confirm the response still
   arrives.
9. Put the Mac to sleep, wake it, and confirm the phone transitions through
   `Reconnecting` and restores the project catalog without re-pairing.
10. Start a fresh thread, send one Direct message, immediately Queue a second
    message, and confirm both responses land on the same real Codex thread in
    order.

## Remote Assist

Remote Assist is a manual, phone-initiated path for the moments when a browser,
terminal, or native Mac prompt needs direct attention. It is intentionally
separate from Codex threads.

1. On the Mac, open ClawDad Settings and enable **Remote Assist**.
2. Grant ClawDad Screen Recording and Accessibility access in macOS System
   Settings. Screen Recording may require relaunching ClawDad.
3. Generate a fresh Pair iPhone QR and scan it from the iPhone. Older pairings
   must be replaced because Remote Assist pins the Mac signing key carried by
   the new QR.
4. Tap the floating desktop icon at the top-left of ClawDad on the iPhone.
5. Approve Face ID or the device passcode.
6. Use the full-screen Mac view. One finger points and clicks, two fingers
   scroll, a two-finger tap right-clicks, and the keyboard control sends text.
   Hold briefly and drag with one finger to select text or drag a Mac item. The
   floating Enter control presses the Mac Return key. Paste to Mac transfers
   plain text from the iPhone clipboard and performs Command-V without
   submitting it. While the Mac is locked, text and Paste are delivered as
   physical keyboard events without writing the password to the Mac clipboard;
   Copy from Mac is disabled. Copy from Mac otherwise performs Command-C on the
   current Mac selection and places the fresh text on the iPhone clipboard.
   When the phone keyboard is open, ClawDad restores its input focus after
   these controls are used.
7. Close the view on the iPhone or use **Stop Remote Assist** on the Mac.

The signaling messages are signed in both directions. Screen video and control
events travel through the encrypted WebRTC session rather than through Codex or
the ClawDad message history. The first release shares one primary display with
one paired iPhone and requires the Mac to remain awake and logged in. Clipboard
transfer is explicit, text-only, limited to 64 KB per operation, and is never
written to ClawDad logs or cloud signaling.

Direct peer connectivity uses STUN. Reliable connectivity across restrictive
networks can use short-lived Cloudflare TURN credentials through
`POST /remote-assist/ice-servers`. Keep the long-lived TURN key in Worker
secrets:

```text
CLAWDAD_TURN_KEY_ID
CLAWDAD_TURN_KEY_API_TOKEN
CLAWDAD_REMOTE_ASSIST_TOKEN
```

Store the matching short-lived endpoint bearer value only in the Mac's private
`~/.clawdad/cloud.json` as `remoteAssistCredentialToken`. Activating TURN is a
separate billing and credentials gate; the app falls back to STUN when those
secrets are absent.

For a signed, opt-in transport smoke on a paired physical iPhone, use the
hidden `ClawDadMobile-LiveSmoke` scheme and select only the live test:

```sh
xcodebuild \
  -project apps/ios/ClawDadMobile/ClawDadMobile.xcodeproj \
  -scheme ClawDadMobile-LiveSmoke \
  -configuration Staging \
  -destination 'id=<hardware-udid>' \
  DEVELOPMENT_TEAM=<team-id> \
  -allowProvisioningUpdates \
  -parallel-testing-enabled NO \
  -only-testing:ClawDadMobileUITests/ClawDadMobileUITests/testPairedPhoneDispatchesDirectReliabilitySmoke \
  test
```

The dedicated scheme supplies `CLAWDAD_RUN_LIVE_IOS_SMOKE=1` to XCTest. The
test remains skipped under the ordinary Debug and Staging schemes.
