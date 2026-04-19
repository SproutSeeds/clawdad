# Tailscale Live Services

Clawdad, Cmail, and Dumpy should keep their current device URLs live while durable
Tailscale Services are introduced in parallel.

Current compatibility URLs:

- Clawdad: `https://codys-mac-studio-1.tail649edd.ts.net`
- Cmail: `https://codys-mac-studio-1.tail649edd.ts.net:4311`
- Dumpy: `https://codys-mac-studio-1.tail649edd.ts.net:7331`

Target durable URLs:

- Clawdad: `https://clawdad.tail649edd.ts.net`
- Cmail: `https://cmail.tail649edd.ts.net`
- Dumpy: `https://dumpy.tail649edd.ts.net`

## Service Host

The durable route should use a separate userspace Tailscale node rather than
tagging the primary Mac user device. This keeps the normal Mac Tailscale identity
intact while giving the live apps their own infrastructure identity.

Local service-host state:

- LaunchAgent: `~/Library/LaunchAgents/com.sproutseeds.tailscale.live-app-host.plist`
- State dir: `~/.clawdad/tailscale-live-host`
- Socket: `~/.clawdad/tailscale-live-host/tailscaled.sock`

## Required Tailnet Policy

Merge the following into the existing Tailscale Access Controls policy. Do not
replace the whole policy with this snippet.

```json
{
  "tagOwners": {
    "tag:live-app-host": ["autogroup:admin"]
  },
  "autoApprovers": {
    "services": {
      "svc:clawdad": ["tag:live-app-host"],
      "svc:cmail": ["tag:live-app-host"],
      "svc:dumpy": ["tag:live-app-host"]
    }
  }
}
```

If `tagOwners` or `autoApprovers` already exist, merge these keys into the
existing objects.

## Service Definitions

In the Tailscale Services admin page, define these Services with endpoint
`tcp:443`:

- `svc:clawdad`
- `svc:cmail`
- `svc:dumpy`

If auto-approval is not configured, approve the advertised host for each Service
after the CLI advertisement step.

## CLI Steps

Authenticate the isolated service-host node after the tag policy exists:

```bash
/opt/homebrew/opt/tailscale/bin/tailscale \
  --socket ~/.clawdad/tailscale-live-host/tailscaled.sock \
  up \
  --hostname live-app-host \
  --advertise-tags=tag:live-app-host \
  --accept-dns=false \
  --accept-routes=false \
  --ssh=false \
  --shields-up=false
```

Advertise the live app Services:

```bash
/opt/homebrew/opt/tailscale/bin/tailscale \
  --socket ~/.clawdad/tailscale-live-host/tailscaled.sock \
  serve --yes --service=svc:clawdad --https=443 127.0.0.1:4477

/opt/homebrew/opt/tailscale/bin/tailscale \
  --socket ~/.clawdad/tailscale-live-host/tailscaled.sock \
  serve --yes --service=svc:cmail --https=443 127.0.0.1:4311

/opt/homebrew/opt/tailscale/bin/tailscale \
  --socket ~/.clawdad/tailscale-live-host/tailscaled.sock \
  serve --yes --service=svc:dumpy --https=443 127.0.0.1:7331
```

Verify both compatibility and durable URLs before updating any user-facing links.

