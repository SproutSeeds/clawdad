# iPhone account-switch cancellation recovery — September 17, 2026

## Incident and immediate recovery

Cody tapped Cancel on the stopped nine-tab switch, saw loading/a connection failure, reopened the app and found Cancel disabled. The Mac still had operation `8e0cf96b-6454-4b2b-aea7-eb1d0c4e688b` in preflight, zero effects, with no accepted cancellation. The exact original phone request ID/network error was unavailable; the latest Mac relay error did not establish the cause of this phone failure.

Cody's requested cancellation was completed through ClawDad's existing authenticated desktop request/control endpoint, using durable request `repair-cancel-8e0cf96b-20260917`. Cancellation was verified **05:43:34.839 UTC**: `status=cancelled`, `fenced=false`, zero transition effects. The account stayed BackToFort; no Terminal window was closed, no login changed and no agent work was replayed.

## Confirmed UI defects and repair

1. `CodexAccountsView.perform` correctly persisted an unacknowledged request across connection loss and reopening, but its Cancel control disabled itself whenever *any* pending request existed. The same Cancel now retries that exact request ID for the exact operation after the current attempt returns. Other pending actions cannot be replaced or repeated through Cancel.
2. Status acknowledgement required the request's `accountId` to equal the server receipt's account ID. Cancellation requests contain an `operationId`, so a successful cancellation receipt could never match after a lost response. Account-bound requests now match account IDs; operation-bound requests match operation IDs, with exact request-ID checking.
3. The exact operation's authoritative cancellation state resolves a retained Cancel even when another authorized control completed it. This cannot clear a pending switch/sign-in, match another operation, or treat an unverified cancellation status as completed. Existing host/workspace/account scoping remains in place.

No Mac/runtime, authentication protocol, Terminal adapter, microphone, draft or account-budget behavior changed in this lane. Mac 156 remains installed. The recovery fix is in iPhone build 100.

## Verification

- Four focused Swift tests pass: operation-based acknowledgement, wrong IDs/accounts, persisted request round trip, exact-operation cancellation/status recovery, and preserved unrelated pending actions.
- Three iPhone simulator UI tests passed: failure before acceptance followed by same-ID Cancel retry after leaving/reopening the screen (23.301 s); accepted cancellation with lost reply and status reconciliation (21.036 s); and existing window selection/accessibility XL text behavior (78.083 s). Both recovery tests also verify that the account picker unlocks and no voice call starts.
- Evidence: `native/macos/dist/candidates/account-cancel-2026-09-17/compact.xcresult` and exported screenshots in its sibling `screenshots/` directory. The large-text screenshot was visually inspected; actual cancellation/retry results are established by the UI assertions, rather than the pre-cancel screenshots.
- Debug-only fixtures cannot reach a real host. The retry fixture rejects a changed request ID. Physical iPhone disconnect/force-quit/relaunch behavior remains a user check; the original connectivity failure itself is not claimed reproduced.

## Release

- Signed iPhone Release archive **0.7.0 (100)** succeeded; bundle identity and archive build number verified. Apple accepted the upload at **05:55:25 UTC**. At **05:58:22 UTC**, build `435ac5b6-903a-4caf-bb41-509724fec40e` was verified `VALID`, `IN_BETA_TESTING` and assigned to the existing **ClawDad Internal** group. Receipt: `native/macos/dist/candidates/account-cancel-2026-09-17/testflight100-release.json`. The existing vendor WebRTC dSYM upload warning was nonfatal; app archive/export succeeded. Physical iPhone installation remains unverified.
- Existing Mac **0.7.0 (156)** remains installed. This fix needs no Mac release, account authentication or Terminal restart.

## Workspace classification

This lane owns the iPhone account view/recovery helper, focused unit/UI tests, debug fixtures in `MobileAssistant.swift` and `AssistantPreview.swift`, iPhone version metadata and this report. Prior native repair commits and nine inherited release/storage/plugin/marketing/artwork buckets remain preserved. Candidate/archive/export evidence stays in canonical ignored native/iPhone build paths.

Final `git diff --check` passed. ORP hygiene classifies all dirty paths (`dirty_classified`, zero unclassified, `safe_to_expand=true`); only this lane's eight paths are included in its checkpoint.
