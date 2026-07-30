# ClawDad TURN Budget Runbook

Cloudflare TURN is the restrictive-network fallback for Remote Assist. Normal
ClawDad messages use the hibernating Workspace relay, and direct Remote Assist
uses peer-to-peer WebRTC with STUN. TURN egress begins only when direct
connectivity cannot establish the media path.

## Beta Limits

| Control | Default |
| --- | ---: |
| Credential lifetime | 900 seconds |
| Credential refresh | 720 seconds |
| Customer monthly limit | 20 GB |
| Global warning | 75 GB ($3.75) |
| Global urgent | 90 GB ($4.50) |
| Automatic global pause | 95 GB ($4.75) |
| Analytics cache | 300 seconds |

Cloudflare bills standalone TURN egress from its relay to a client at
$0.05/GB. The 95 GB pause leaves a 5 GB buffer below the beta's $5 monthly
ceiling and absorbs analytics delay, adaptive sampling, and already-issued
15-minute credentials. TURN is free only when used with Cloudflare's Realtime
SFU; ClawDad's peer-to-peer Remote Assist does not use that SFU.

## Secret Boundary

Provision these values as Worker secrets:

```text
CLAWDAD_TURN_KEY_ID
CLAWDAD_TURN_KEY_API_TOKEN
CLAWDAD_TURN_ANALYTICS_API_TOKEN
CLAWDAD_TURN_IDENTIFIER_SECRET
CLAWDAD_TURN_ADMIN_TOKEN
```

`CLAWDAD_TURN_KEY_API_TOKEN` is the key returned when the production TURN key is
created. `CLAWDAD_TURN_ANALYTICS_API_TOKEN` needs only Account Analytics read
access. Generate the identifier and admin secrets independently with at least
32 random bytes. Keep each value in Keychain and Worker secrets; never place
them in source, shell history, logs, screenshots, QR codes, or support bundles.

Set the Cloudflare account identifier as
`CLAWDAD_CLOUDFLARE_ACCOUNT_ID`. The deployed
`cloud/wrangler.toml` keeps `CLAWDAD_TURN_ENABLED` false until the staged
activation gate is complete.

## Operator Status

Use the dedicated admin bearer without printing it:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $CLAWDAD_TURN_ADMIN_TOKEN" \
  "https://clawdad-cloud.frg.earth/admin/turn/status?refresh=true"
```

The response reports the current month, measured global egress, threshold
state, cache age, dynamic pause state, and an optional pseudonymous customer
record. Query one customer by adding its `customIdentifier` parameter.

## Immediate Global Pause

```sh
curl --fail-with-body \
  -X PUT \
  -H "Authorization: Bearer $CLAWDAD_TURN_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"globalPaused":true}' \
  https://clawdad-cloud.frg.earth/admin/turn/control
```

Resume after reviewing usage:

```sh
curl --fail-with-body \
  -X PUT \
  -H "Authorization: Bearer $CLAWDAD_TURN_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"globalPaused":false,"clearUsageCache":true}' \
  https://clawdad-cloud.frg.earth/admin/turn/control
```

`CLAWDAD_TURN_KILL_SWITCH=true` is the deployment-level stop. It takes
precedence over dynamic controls.

## Customer Pause Or Override

Pause one pseudonymous customer:

```sh
curl --fail-with-body \
  -X PUT \
  -H "Authorization: Bearer $CLAWDAD_TURN_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"customIdentifier":"clawdad_REPLACE","customerPaused":true,"note":"usage review"}' \
  https://clawdad-cloud.frg.earth/admin/turn/control
```

Set a temporary byte limit by adding `customerLimitBytes`. Send
`customerLimitBytes: null` to restore the 20 GB default. Send
`customerPaused: false` to resume that customer.

## Activation Order

1. Deploy the hibernating Workspace relay with TURN disabled.
2. Verify cloud health, Mac reconnect, fresh iPhone reconnect, pairing,
   revocation, Direct, Queue, voice, image, and direct Remote Assist.
3. Activate Cloudflare Realtime/TURN after the explicit billing confirmation.
4. Create one production TURN key and one Account Analytics read token.
5. Store the five secret values in Keychain and Worker secrets.
6. Verify the admin status route can measure a zero or expected monthly value.
7. Change `CLAWDAD_TURN_ENABLED` to true and deploy.
8. Force a physical iPhone session through TURN on a restrictive network.
9. Temporarily lower the customer threshold, refresh credentials, and observe
   the active session end while a new direct-STUN attempt remains available.
10. Restore the production thresholds and recheck the status route.
11. Create the Cloudflare account-level $5 budget notification as an external
    backup. The notification is informational; the ClawDad circuit breaker is
    the enforcement path.

Realtime activation, API-token creation, and the external budget notification
are account and financial actions that require action-time confirmation.
