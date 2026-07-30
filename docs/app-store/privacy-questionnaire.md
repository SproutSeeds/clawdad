# App Store Privacy Evidence

This document is an evidence worksheet for the App Store Connect privacy
questionnaire. The account holder must confirm the final answers in Apple’s UI.

## Data Flow

| Data | Purpose | Storage and retention |
| --- | --- | --- |
| Device identifier and public key | Pair and revoke an iPhone | Relay/device registry until revoked |
| Workspace and host identifiers | Route encrypted app traffic to the paired Mac | Relay connection metadata |
| Subscription product and expiry state | Gate paid access | Privacy-safe snapshot on paired Mac |
| Signed Apple transaction | Verify entitlement | Processed in memory; never persisted by ClawDad |
| Project, thread, and message envelopes | Continue a selected Codex thread | Relayed transiently; canonical history remains on Mac |
| Images and voice recordings | User-requested prompt input | Relayed to the Mac; not retained by ClawDad Cloud |
| Remote Assist signaling | Establish a user-initiated WebRTC session | Transient signaling only |
| Remote desktop media and clipboard | User-initiated control | WebRTC peer session; never written to ClawDad history |
| Diagnostics | Support requested by user | Remain local until the user explicitly shares them |

## Expected Questionnaire Position

- Data is used for app functionality, authentication/security, purchases, and
  customer support.
- ClawDad does not use third-party advertising or cross-company tracking.
- ClawDad does not sell customer data.
- Project content is not used for ClawDad advertising or profiling.
- Identifiers are linked to the paired workspace so the service can route and
  revoke access.
- Purchase information is linked to the Apple account by Apple; ClawDad stores
  only the minimum verified entitlement state on the paired Mac.
- Voice, images, messages, and Remote Assist content are user-provided content
  used to perform the requested feature.

## Confirmation Gates

Before answering Apple:

1. Verified 2026-07-30: `cloud/worker.mjs` contains no request-body logging.
   Its Durable Object writes are limited to the signed Mac appcast and
   workspace, pairing, device-trust, revocation, and last-seen routing
   metadata. Relay tokens and one-time pairing tokens are persisted only as
   hashes. Messages, images, audio, clipboard text, Remote Assist media, and
   signed StoreKit transactions are not written to Worker storage.
2. Verified 2026-07-30: the production
   `https://clawdad-cloud.frg.earth/privacy` page states the same retention,
   advertising, tracking, diagnostics, and Remote Assist boundaries as this
   matrix.
3. Verified 2026-07-30: the exact build-19 archive embeds only
   `WebRTC.framework` in addition to Apple system frameworks. Its linked
   libraries contain no crash-reporting, advertising, or behavioral analytics
   SDK.
4. The account holder must confirm Apple’s current definitions for collection,
   linkage, and tracking while submitting the questionnaire.
5. Record the account holder’s submitted answers and date in the private release
   checklist; never store Apple credentials in this repository.
