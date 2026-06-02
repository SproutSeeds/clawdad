# Tailscale Live Services

Clawdad, Cmail, and Dumpy use durable Tailscale Services as the primary phone
URLs. Older device URLs can exist as compatibility routes, but the bare Mac
hostname may be owned by an unrelated app or Funnel route.

Current legacy device URLs:

- Cmail: `https://codys-mac-studio-1.tail649edd.ts.net:4311`
- Dumpy: `https://codys-mac-studio-1.tail649edd.ts.net:7331`

Primary durable URLs:

- Clawdad: `https://clawdad.tail649edd.ts.net`
- Cmail: `https://cmail.tail649edd.ts.net`
- Dumpy: `https://dumpy.tail649edd.ts.net`

## Service Host

The durable route uses a separate userspace Tailscale node rather than
tagging the primary Mac user device. This keeps the normal Mac Tailscale identity
intact while giving the live apps their own infrastructure identity.

Local service-host state:

- LaunchAgent: `~/Library/LaunchAgents/com.sproutseeds.tailscale.live-app-host.plist`
- State dir: `~/.clawdad/tailscale-live-host`
- Socket: `~/.clawdad/tailscale-live-host/tailscaled.sock`

## Required Tailnet Policy

The following keys are merged into the existing Tailscale Access Controls
policy. Do not replace the whole policy with this snippet.

```json
{
  "tagOwners": {
    "tag:live-app-host": ["autogroup:admin", "autogroup:owner"]
  },
  "autoApprovers": {
    "services": {
      "svc:clawdad": ["tag:live-app-host"],
      "svc:cmail": ["tag:live-app-host"],
      "svc:dumpy": ["tag:live-app-host"]
    }
  },
  "grants": [
    {
      "src": ["autogroup:member"],
      "dst": ["svc:clawdad", "svc:cmail", "svc:dumpy"],
      "ip": ["443"]
    }
  ]
}
```

If `tagOwners`, `autoApprovers`, or `grants` already exist, merge these keys into
the existing policy rather than replacing unrelated rules.

## Service Definitions

The Tailscale Services API/admin page defines these Services with endpoint
`tcp:443`:

- `svc:clawdad`
- `svc:cmail`
- `svc:dumpy`

The service host tag is auto-approved for these Services. If auto-approval is
not configured, approve the advertised host for each Service after the CLI
advertisement step.

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
  serve --yes --service=svc:clawdad --https=443 http://127.0.0.1:4477

/opt/homebrew/opt/tailscale/bin/tailscale \
  --socket ~/.clawdad/tailscale-live-host/tailscaled.sock \
  serve --yes --service=svc:cmail --https=443 http://127.0.0.1:4311

/opt/homebrew/opt/tailscale/bin/tailscale \
  --socket ~/.clawdad/tailscale-live-host/tailscaled.sock \
  serve --yes --service=svc:dumpy --https=443 http://127.0.0.1:7331
```

Verify the durable URLs after any Tailscale policy or Serve change. Treat
device-host compatibility routes as optional and app-specific.

## Startup Orchestration

Use `clawdad secure-doctor --ensure` for the operational readiness check. It
keeps the same secure-doctor route checks, then runs the shared
`@sproutseeds/tailnet-app` ensure pass so configured local and cross-machine
dependencies are started or reported as degraded before users rely on the app.

Live app entries can include `port`, `healthPath`, `serviceName`,
`serviceSocket`, `required`, `autoStart`, and `startCommand` as they migrate to
the shared startup contract. Apps should still start their UI in degraded mode
when an optional backend is down, while clearly reporting which feature is
blocked.
