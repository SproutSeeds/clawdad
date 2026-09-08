# Terminal response notifications — 2026-09-07

**Production push configuration is active.** Mac build 70 is installed and
healthy, and iPhone build 55 is available in ClawDad Internal TestFlight.
Physical iPhone delivery and notification-tap acceptance are still open. Enable
**Agent response notifications** in ClawDad Settings and allow iOS alerts.

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
The installed monitor discovered 15 conversations without changing Terminal focus.

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
| Mac | Build 70 installed; signature, Gatekeeper, startup, Remote Assist capability, and background Assistant health verified |
| Notarization | Accepted and stapled: `355b0eab-2fbf-46f4-b197-225dcb8f55dc` |
| Mac executable SHA-256 | `e160bf0b6f6713179aca35ecc4b970894cf4caf9c3cda06166d98aff46fa01e2` |
| Runtime bundle | `74e38c9dbed5c89ebaecd09ef4c86d68aea41a9a487d43ba84896cbbc0c0171b` |
| iPhone | Build 55, `8455f211-8c1d-40ab-adc8-369b54159fbc`, `VALID`, `IN_BETA_TESTING`, assigned to ClawDad Internal |
| Signing | Distribution export verified with `aps-environment=production`, correct app/team identifiers, and `get-task-allow=false` |
| App ID | `PUSH_NOTIFICATIONS` enabled for `earth.frg.clawdad.ios` only |
| Relay | Deployment `f8491a7c` at 100% traffic, all three APNs secrets configured, existing three bindings retained, health and notification privacy disclosure return HTTP 200 |
| Apple key | `363GQMT73W`, ClawDad Production Push; production only, one topic: `earth.frg.clawdad.ios`; team `4QV4WR9G32` |
| Rollback | Relay before push activation `2a5c74fb`; before notification code `24f79f55`; Mac builds 69 and 68 preserved in the candidate directory |

The deployed Worker was copied through the existing dashboard editor and compared
with the repository baseline. It matched after normalizing generated filename
identifiers. The prepared replacement was copied back and checked against the
verified bundle before deployment.

Automatic approval review rejected granting Wrangler broad new account, Workers,
and DNS permissions. That authorization flow was cancelled. The patch was
published through the already authenticated dashboard without granting access.
Apple Developer sign-in was verified for Cody Mitchell's team `4QV4WR9G32`.
After explicit user approval, the production-only, ClawDad-topic APNs key was
created and Cloudflare sign-in completed with the existing Google account. The
downloaded key is secured outside the repository with owner-only `0600`
permissions. It was entered as an encrypted secret in the existing Worker along
with its key and team identifiers. Existing CalDrop keys remain untouched.

Dashboard verification confirmed all three APNs secret entries, all 16 existing
runtime variable/secret rows unchanged, and the original `RELEASE_CATALOG`,
`TURN_BUDGET`, and `WORKSPACE_RELAY` bindings. The version with all three new
secrets was explicitly promoted to 100% production traffic. Full settings
snapshots were not persisted; retained configuration evidence contains only
non-sensitive presence checks and counts.

TestFlight notes now recommend Mac build 70 or later. The Apple-activation-pending
prefix was removed and the saved notes were fetched back and matched exactly.
No external beta, App Store submission, public npm publication, tag, GitHub
release, or broad branch push was performed. Upload succeeded with the existing
vendor WebRTC dSYM warning; it did not prevent Apple's build validation.

## Completion timestamp repair

Live verification found that current Codex `task_complete` records supply
`completed_at` as Unix seconds. The original monitor passed that number to
`Date.parse`, which returned an invalid date and skipped completed answers.
The initial test fixture had omitted this real lifecycle field.

The fixture now matches the observed numeric timestamp schema. It reproduced
five failing tests before the fix. Mac build 70 converts numeric seconds and
milliseconds explicitly while retaining ISO text and record-timestamp support.
All six monitor tests now pass, including history exclusion, all-tab discovery,
partial records, retries, restart, and duplicate prevention.

A read-only replay of recent real records recognized five completed answers
that the old parser skipped. This replay sent no alerts and did not rewind the
live cursor or flood the phone with old completions. The installed and active
monitor files match the corrected source byte for byte (SHA-256
`99215e27d40b6c05e2035c7fadfcac364fda18a2c6b297e52b67cb6dffd5ba48`).

## Validation

- 538 Node runtime tests passed, including 14 notification tests after the
  completion timestamp repair. The 11 App Store Connect tests also passed after
  the release-note update.
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
The initial local APNs transport probe stopped; macOS workerd's HTTP/2 limitation
means that probe cannot establish production APNs delivery. A separate native
HTTP/2 probe with the new key reached Apple's production endpoint and received
the expected `400 BadDeviceToken` for an intentionally invalid device token.
This establishes transport reachability, not real iPhone delivery or a successful
Worker send. Screenshots verify layout, not physical receipt.

The live monitor checkpoint is fresh and tracks 15 conversations. No new live
completion had been recorded after the corrected host restarted at the final
health check. Physical registration, receipt, and tap routing remain acceptance
checks. Cloudflare Data Studio does not authorize inspection of its internal KV
table schema, so it was not used to claim device registration or delivery.

## Physical iPhone acceptance

1. Update the iPhone to Internal TestFlight build 55, reopen ClawDad, enable the notification
   setting, and allow iOS notification permission.
2. Complete a harmless Codex turn while the phone is locked. Verify the directory,
   completion time, and tap destination. Repeat with two conversations in the
   same directory, then verify opt-out stops further alerts.
3. Record physical acceptance separately from build and provider configuration.

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
