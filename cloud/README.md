# ClawDad Cloud

ClawDad Cloud is the secure relay for the iPhone companion. The desktop app stays the execution authority; the cloud worker only authenticates connections and forwards protocol envelopes between trusted devices and the connected Mac host.

## Pieces

- `worker.mjs` runs on Cloudflare Workers.
- `WorkspaceRelay` is a Durable Object keyed by `accountId:workspaceId`.
- `ReleaseCatalog` stores the public signed Sparkle appcast.
- Desktop hosts connect with `clawdad cloud-host`.
- The iPhone app connects to `/workspaces/:workspaceId/realtime`.

## Local Dev

```sh
npx wrangler dev --config cloud/wrangler.toml
```

Set `CLAWDAD_CLOUD_DEV_TOKEN` in the Worker environment to require a bearer token during development.

## Staging Deploy

```sh
npm run cloud:deploy:staging
curl https://clawdad-cloud.frg.earth/healthz
```

The Mac updater reads `GET /mac/appcast.xml`. Publishing is a separate
release-only operation:

```sh
curl --request PUT \
  --header "authorization: Bearer $CLAWDAD_RELEASE_TOKEN" \
  --header "content-type: application/rss+xml" \
  --data-binary @native/macos/dist/releases/VERSION/appcast/appcast.xml \
  https://clawdad-cloud.frg.earth/admin/mac/appcast
```

Store `CLAWDAD_RELEASE_TOKEN` as a Worker secret. The public route accepts only
reads, the admin route accepts only an authenticated valid Sparkle appcast, and
the catalog rejects unsigned or non-HTTPS release entries.

The iPhone Release/TestFlight configuration expects an HTTPS Worker URL. If the
deployed Worker URL differs, update `CLAWDAD_CLOUD_URL` in
`apps/ios/ClawDadMobile/project.yml` and run `npm run ios:generate`.

## Desktop Host

Create `~/.clawdad/cloud.json`:

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
  "trustedDevicePublicKeys": {
    "ios-device-id-from-phone": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
  }
}
```

Then run:

```sh
clawdad cloud-host --json
clawdad cloud-host
```

## Storage Boundary

The relay should store account, device, host, and revocation metadata. It should avoid durable storage of project message bodies, terminal output, attachments, and code content unless a future encrypted-cache mode is explicitly enabled.

## iPhone response alerts

The existing `WorkspaceRelay` Durable Object delivers opt-in Apple push alerts.
No additional Worker, storage bucket, database, or paid speech service is needed.
Registration requires the paired iPhone's relay credential; completion events
require the Mac host credential. Revoking a device also removes its push token.

Configure these secrets on `clawdad-cloud` for production/TestFlight:

- `CLAWDAD_APNS_PRIVATE_KEY`: the APNs `.p8` signing key, kept outside the repository.
- `CLAWDAD_APNS_KEY_ID`: its Apple key identifier.
- `CLAWDAD_APNS_TEAM_ID`: the Apple Developer team identifier.

Use an Apple push key valid for production and topic `earth.frg.clawdad.ios`.
The App Store Connect upload key cannot send Apple push notifications. Debug
device builds use the sandbox endpoint and need their own
`CLAWDAD_APNS_DEVELOPMENT_KEY_ID` and `CLAWDAD_APNS_DEVELOPMENT_PRIVATE_KEY`.
The app's `aps-environment` entitlement must match its delivery environment.

The relay retains registration tokens until opt-out, revocation, or Apple's
invalid-token response. Completion metadata (directory, conversation and host
identifiers, completion time) expires within 24 hours. Durable alarms retry
temporary provider failures and checkpoint successful recipients. APNs collapse
identifiers suppress redundant alerts for the same completed turn. No transcript
text or full local file path is sent to APNs or stored in the relay queue.

The Mac stores its private notification cursor and outbox beside its cloud config
as `terminal-notifications.json`, with owner-only permissions. Local notification
links remain resolvable for up to 30 days, capped at 1,000 events. Discovery reads
process metadata and owned Codex transcript files; it does not focus Terminal.

Verification: `node --test test/push-notifications.test.mjs test/terminal-notifications.test.mjs`.
Local workerd on macOS cannot establish the same APNs HTTP/2 transport used by
deployed Workers, so physical production-device delivery remains a separate check.
See [Apple APNs setup](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)
and the [workerd HTTP/2 issue](https://github.com/cloudflare/workerd/issues/4841).
