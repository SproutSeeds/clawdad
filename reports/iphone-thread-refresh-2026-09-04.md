# iPhone All Projects refresh investigation

Date: September 4, 2026 (America/Chicago)

Status: Mac build 43 installed and verified; iPhone build 36 uploaded, accepted
as VALID by Apple, and assigned to ClawDad Internal. The user requested continued
deployment after candidate preparation. Installing build 36 on the physical
iPhone and testing the updated phone experience remain pending.

## Confirmed causes

1. The iPhone's five-second activity monitor requested the selected project's
   mailbox status, but never refreshed the All Projects catalog. Activity in
   other projects stayed stale until foregrounding, a manual refresh, a host
   reconnection, or a selected-project completion triggered a catalog request.
2. The Mac sends a warm catalog followed by a synchronized catalog. The first
   response could replace a newly selected native thread with the project's older
   active thread before import completed. It also consumed the requested
   50-message history limit, so the final response loaded only eight messages.
   Both behaviors were reproduced in executable Swift tests before the fix.
3. Catalog requests lacked correlation IDs. An older response could replace the
   latest project/thread selection or finish another request's loading state.
   History responses could similarly overwrite a newer page for the same thread.
4. Manual refresh reused the Mac's ten-second recent-thread cache. A new native
   conversation could remain absent immediately after tapping refresh.

## Implemented behavior

- Poll the latest 20 thread summaries every 15 seconds while connected and active.
  Routine relay replies contain recent summaries rather than the full catalog.
  The existing project picker and selected conversation remain in place.
- Refresh when entering All or tapping Refresh; explicit refresh bypasses the
  recent-thread cache. The refresh control displays progress.
- Coalesce duplicate requests. Retry unfinished requests after about 30 seconds,
  clear loading on errors, and invalidate pending responses on disconnect.
- Preserve a selected recent thread through the warm snapshot. Load its history
  after synchronization, and retain the chosen history limit during later refreshes.
- Echo the originating request ID from the host and ignore superseded catalog
  and history responses. Reject messages received from a replaced WebSocket.
- Preserve compatibility with older hosts. They send full catalogs and lack the
  same response-order guarantees until the Mac is upgraded.

Implementation: `CloudClient.swift`, `ContentView.swift`,
`lib/cloud-host-connector.mjs`, and `lib/server.mjs`. No cloud Worker deployment
is required.

## Evidence

| Check | Result |
| --- | --- |
| Installed Mac at investigation start | 0.7.0 build 42, runtime 0.7.0-beta.20 |
| Connected CodyVerse iPhone | 0.7.0 build 35 |
| Internal TestFlight before deployment | 35, VALID, assigned to ClawDad Internal |
| Internal TestFlight after deployment | 36, VALID, assigned to ClawDad Internal; build-specific test instructions verified |
| Native service health | Healthy on port 4487; shared Codex app-server ready |
| Live catalog compared with native discovery | All 20 current recent thread IDs present; 250 projects and 353 registered sessions |
| Full catalog response size | 531,755 bytes before compact relay projection |
| Clawdad project integration doctor | Pass, zero failures or warnings |
| Clawdad project session doctor | Pass, zero issues or repairs |
| Swift regression reproduction | Both initial tests failed before the fix, reproducing selection replacement and history-limit loss |
| Final Swift suite | 56 tests passed, including 9 CloudSession catalog regressions |
| Final runtime suite | 473 tests passed |
| iPhone simulator build | Passed; All scope preview rendered and inspected |
| iPhone Release archive | Build 36, archive succeeded, signature verified |
| Local App Store IPA export and upload | Succeeded; Apple processed build 36 as VALID |
| Installed Mac update | Build 43, Developer ID signed, notarized, stapled, signature verified, and Gatekeeper accepted |
| Live installed host smoke | Compact and full catalogs passed; signatures and request IDs validated against the live local service |
| Whitespace and worktree hygiene | `git diff --check` passed; all dirty paths classified |

The global session registry audit separately reported 28 active blockers and 228
historical issues, largely missing older transcripts and project directories.
None of the 28 active blockers referenced a thread in the current latest-20
catalog. The Clawdad project itself had no session issues. This task made no
registry repairs or changes to unrelated project sessions.

The live installed connector returned a compact signed 20-thread response of
6,857 bytes, compared with 387,487 bytes for the complete signed catalog. The
compact response completed in 192 ms. This smoke used temporary in-memory
verification identities with the actual installed host module and local server;
it created no relay pairing. Evidence is in
`reports/iphone-thread-refresh-live-host-2026-09-04.json`.

Before restarting the Mac app, the live catalog reported no running, starting,
dispatched, or queued project/session. After installation, service health was
ready and both running runtime files (`server.mjs` and `cloud-host-connector.mjs`)
matched the fixed source by SHA-256. The native Mac UI loaded the latest threads.
The runtime retains package version `0.7.0-beta.20`; Mac bundle build 43 and the
runtime file hashes identify this installed patch.

## Prepared artifacts

- Mac app: `native/macos/dist/ClawDad.app` (0.7.0 build 43).
- Stable Mac ZIP: `native/macos/dist/candidates/iphone-thread-refresh-2026-09-04/ClawDad-0.7.0-43-mac.zip`.
  SHA-256: `30f64caa72ad0c51d55ffc4e98a4c2ebf7fff51ede95ada9b6aad3509c301684`.
- Notarization receipt: `native/macos/dist/candidates/iphone-thread-refresh-2026-09-04/notary-app.json`.
  Apple submission `41a21592-ee45-4a70-a199-fcbf1601ed77` was accepted.
- iPhone archive: `apps/ios/ClawDadMobile/build/ClawDadMobile-ThreadRefresh-36.xcarchive`.
- iPhone IPA: `apps/ios/ClawDadMobile/build/ThreadRefresh-AppStore-36/ClawDad.ipa`.
  SHA-256: `304449f562232a570c7936e0a5545a8345921f69f010eea1b59f87bbf55bbc59`.
- Simulator preview: `apps/ios/ClawDadMobile/build/thread-refresh-simulator/all-projects-preview.png`.

Build commands used `CLAWDAD_APP_BUILD=43` and `CURRENT_PROJECT_VERSION=36`.
The checked-in iPhone project/spec and `lib/app-store-connect.mjs` now target
build 36, with updated internal test instructions and matching release tests.
The upload used the exact prepared archive through `CLAWDAD_IOS_ARCHIVE_PATH`.
Apple build ID `f43d8be2-4328-4535-852c-0d9fba975762` is VALID and assigned to
ClawDad Internal. `ops/app-store-release.json` records the verified state.
The external beta group remains unassigned; App Store review, public releases,
npm, and public appcasts were not changed.

The previous Mac app is preserved at
`~/Library/Application Support/ClawDad/App Backups/ClawDad-0.7.0-build42.app`.
The TestFlight uploader warned that the vendored WebRTC framework has no matching
dSYM. Upload and Apple validation succeeded; this warning limits symbolication
of WebRTC crash frames and does not indicate an app validation failure.

The installed Mac is on build 43. The last physical iPhone inventory was build 35.
Passing source tests, archive checks, or a preview screenshot does not establish
that the updated physical iPhone experience is fixed. iPhone Mirroring reports
Mac Wi-Fi is off, so the user was asked to update through TestFlight on the
phone and report when build 36 is installed. Network settings were not changed.

## Phone acceptance after deployment

1. Install Mac build 43 and verify its healthy native service and relay connection.
   Install iPhone build 36 from internal TestFlight and retain the existing pairing.
2. Leave All visible, then start or continue a thread in another project on the
   Mac. Confirm the activity appears automatically within two refresh intervals
   (30 seconds), without changing the selected project or thread.
3. Create another native thread and tap Refresh immediately. Confirm it appears
   even if the previous catalog was loaded less than ten seconds earlier.
4. Open a recent native thread that has not yet been imported. Confirm its title,
   identity, and messages stay correct through both catalog responses and that
   an expanded conversation retains its history window.
5. Switch projects quickly during refresh, then background and reopen the phone
   app. Repeat across a Wi-Fi/cellular change. Confirm updates resume and delayed
   replies do not replace the selected conversation.

## Worktree buckets and next actions

- This fix: the four implementation files above, the new
  `CloudSessionCatalogTests.swift`, `test/cloud-host-connector.test.mjs`,
  `test/server-project-catalog.test.mjs`, `docs/iphone-companion.md`, and this
  report and live-host receipt. Release metadata includes `project.yml`, its
  generated Xcode project, `lib/app-store-connect.mjs`,
  `ops/app-store-release.json`, `test/app-store-connect.test.mjs`, and
  `test/ios-release.test.mjs`. These audited paths are checkpointed together in
  the thread-refresh commit. Complete the physical phone acceptance checks after
  its TestFlight update.
- Pre-existing integration work: `.agents/skills/clawdad-release/SKILL.md`,
  `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, and
  `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`. Preserve for
  their owner's separate review/checkpoint.
- Pre-existing creative work: `assets/wordmark-explorations/`. Preserve for the
  separate wordmark selection and asset handoff.
- Pre-existing nested website: `marketing-site/`. Continue and checkpoint within
  its own website lane; exclude it from the thread-refresh commit.
- Generated candidates and build caches: the ignored native and iPhone build
  paths listed above. Keep the candidates for deployment and the caches for
  repeatable build verification.
