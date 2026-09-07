# Terminal response notifications — 2026-09-07

The notification implementation is built and privately released. **Apple push
activation remains pending Apple Developer sign-in and an APNs signing key.**
Physical iPhone delivery and notification-tap acceptance are still open.

## Behavior

- Settings adds an opt-in **Agent response notifications** switch and requests
  iPhone notification permission when enabled.
- Mac discovery watches CLI-owned Codex conversations across Terminal tabs using
  read-only process metadata and transcript cursors. Visiting a tab is unnecessary.
- A completed turn with an assistant answer triggers an event. Focus changes,
  ordinary output, aborted turns, and historical completions do not.
- Alerts show the directory, computer, short conversation reference, and
  completion time in the phone's time zone. The short reference distinguishes
  conversations that share a directory; it is not a Terminal tab ordinal.
- Tapping an alert resolves its exact session through the paired Mac's signed
  reply and opens that conversation in ClawDad. Stale catalogs cannot replace
  it with another conversation in the same directory.
- The Mac must remain awake with ClawDad running. Delivery uses Apple's push
  service while the iPhone app is in the background.

## Local processing and relay storage

The Mac samples every five seconds and keeps a private, atomic cursor/outbox at
`~/.clawdad/terminal-notifications.json`. Its owner-only permissions were verified
as `0600`. Local links remain available for up to 30 days, capped at 1,000 events.
The installed monitor discovered 13 conversations without changing Terminal focus.

The existing Cloudflare `WorkspaceRelay` stores opt-in push registrations and a
bounded notification queue. It receives directory and identity metadata rather
than full paths or response text. Queued metadata expires after 24 hours through
durable cleanup alarms. Temporary failures retry; acknowledged recipients are
checkpointed and APNs collapse identifiers reduce duplicates. Apple delivery is
not an exactly-once guarantee.

Pairing credentials protect registration and host credentials protect completion
submission. Revocation, opt-out, and invalid-token responses remove registrations.
The iPhone captures a best-effort authenticated removal before Forget Computer
erases its credential. Successful registration requests are cached locally so
ordinary UI refreshes do not repeatedly write relay state.

No new cloud resource or storage bucket was provisioned. Existing relay bindings,
TURN controls, domains, and account access were preserved.

## Release evidence

| Surface | Result |
| --- | --- |
| Mac | Build 69 installed; signature, Gatekeeper, startup, Remote Assist capability, and background Assistant health verified |
| Notarization | Accepted and stapled: `397ef050-6aca-47a7-92d0-f619b7c8d019` |
| Mac executable SHA-256 | `bc73def316ac59e7fb88f73b486e0c313cdc0f2f19c1d4dc79ee188306416beb` |
| Runtime bundle | `0b123e1ca99e893522d01ac3921f0938ff53c54968d6a34546725f35ccc384b1` |
| iPhone | Build 55, `8455f211-8c1d-40ab-adc8-369b54159fbc`, `VALID`, `IN_BETA_TESTING`, assigned to ClawDad Internal |
| Signing | Distribution export verified with `aps-environment=production`, correct app/team identifiers, and `get-task-allow=false` |
| App ID | `PUSH_NOTIFICATIONS` enabled for `earth.frg.clawdad.ios` only |
| Relay | Deployment `2a5c74fb`, existing three bindings retained, health and notification privacy disclosure return HTTP 200 |
| Rollback | Previous relay `24f79f55`; Mac build 68 preserved in the candidate directory |

The deployed Worker was copied through the existing dashboard editor and compared
with the repository baseline. It matched after normalizing generated filename
identifiers. The prepared replacement was copied back and checked against the
verified bundle before deployment.

Automatic approval review rejected granting Wrangler broad new account, Workers,
and DNS permissions. That authorization flow was cancelled. The patch was
published through the already authenticated dashboard without granting access.
Apple Developer remains on its sign-in page; the user was asked to sign in there.
No password or verification code was requested in chat. No APNs key has been
created or copied into the repository.

TestFlight notes explicitly say push delivery awaits Apple key activation.
No external beta, App Store submission, public npm publication, tag, GitHub
release, or broad branch push was performed. Upload succeeded with the existing
vendor WebRTC dSYM warning; it did not prevent Apple's build validation.

## Validation

- 537 Node runtime tests passed, including 13 new notification tests.
- 105 iPhone package tests passed, including signed conversation routing,
  malformed payload rejection, unpaired alert handling, and stale-catalog checks.
- Two iPhone simulator UI checks passed: notification opt-in/navigation and
  preservation of existing model/voice choices through Settings navigation.
- Notification tests exercise partial transcript records, retries and restart,
  duplicate completion handling, all-tab discovery, APNs signing, environment
  separation, device revocation, opt-out, invalid tokens, and durable expiry.
- Swift iOS simulator build, signed archive/export, Worker dry-run, syntax checks,
  and `git diff --check` passed.

The initial voice UI run lacked its isolated localhost catalog fixture. After
starting that fixture, both final UI checks passed. The fixture was stopped.
The local APNs transport probe also stopped; macOS workerd's HTTP/2 limitation
means that probe cannot establish production APNs delivery. Screenshots verify
the notification layout; they do not prove a physical push was received.

## Remaining activation

1. Sign in to the Apple Developer tab already opened for this task.
2. Create an APNs key valid for production and `earth.frg.clawdad.ios`, preferably
   restricted to that topic. Secure the downloaded key outside the repository.
3. Add `CLAWDAD_APNS_PRIVATE_KEY`, `CLAWDAD_APNS_KEY_ID`, and
   `CLAWDAD_APNS_TEAM_ID` to the existing `clawdad-cloud` Worker. See
   [relay setup](../cloud/README.md). The ASC upload key cannot send APNs alerts.
4. Update the iPhone to Internal TestFlight build 55, enable the notification
   setting, and allow iOS notification permission.
5. Complete a harmless Codex turn while the phone is locked. Verify the directory,
   completion time, and tap destination. Repeat with two conversations in the
   same directory, then verify opt-out stops further alerts.
6. Remove the activation-pending sentence from build 55's TestFlight notes after
   provider configuration is verified; record physical acceptance separately.

## Artifacts and worktree handoff

Canonical evidence:
`native/macos/dist/candidates/notifications-2026-09-07/`.
It contains build and test logs, original/final Worker bundles, deployment and
notarization receipts, install verification, monitor counts, UI screenshots,
distribution entitlement evidence, and TestFlight status.

Eight pre-existing dirty groups are preserved for their existing owner review:
`.agents/skills/clawdad-release/SKILL.md`;
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`;
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`;
`assets/wordmark-explorations/`; `marketing-site/`;
`native/macos/build-app.sh`; `native/macos/package-release.sh`;
`native/macos/storage-workflow.sh`.

One generated bucket is also classified:
`cloud/native/macos/dist/candidates/notifications-2026-09-07/worker-bundle/`.
Wrangler initially resolved a relative output directory beneath `cloud/`.
The source and map were copied into the canonical candidate directory. A local
read-only `dist/` hook blocked removing the misplaced copy; it remains preserved
for the artifact retention workflow. It is excluded from the notification commit.
Final hygiene must report zero unclassified paths.
