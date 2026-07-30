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
