# iPhone startup waiting on a crashed Mac service — September 10, 2026

Fixed and installed in **ClawDad Mac 0.7.0 (91)**. The existing iPhone app can use this repair without a TestFlight update. Physical iPhone cold-launch confirmation remains pending.

## Confirmed cause

The Mac app and cloud connector were running, but its local workspace service on port 4487 had exited. Health, catalog and Assistant requests all failed immediately. The iPhone's `startupLoading` screen waits for its paired Mac's first catalog response, so this split state left the phone waiting indefinitely.

The preserved startup logs show:

- September 9, 5:24:31 PM CDT: the workspace listener became ready.
- 5:24:34 PM: an unhandled rejected fetch to `127.0.0.1:8772` terminated Node.
- The current local speech-service process started at 5:24:57 PM, after that failure.
- The cloud connector remained running for the following hours; the native app had no child-process recovery.

ClawDad's desktop boot calls `/v1/tts/status`. With a saved voice, that handler first fetches the local voice catalog. If speech starts later than ClawDad, `runtimeWithVoice` rejects. The handler lacked a catch, and Node's HTTP callback does not handle rejected async-handler promises. The isolated regression reproduced a dropped connection and process exit with a saved voice and an offline local service.

The iPhone also checks StoreKit before presenting its workspace. That is a separate possible loading dependency; no physical evidence established it as the cause here, so subscription or access behavior was not changed.

## Repair

- Speech-status failures return an unavailable speech state while workspace, pairing, Assistant and Terminal APIs stay available. The saved model and voice are preserved, and the same service process can report speech ready when its dependency returns. Disabled speech remains disabled.
- Added an HTTP request error boundary so another unexpected request exception cannot terminate the entire host. Partial responses are closed safely; diagnostics contain no request body or private conversation content.
- The native app now monitors only the server and connector `Process` instances it created. Exited children restart on the same port/configuration, with increasing retry delays capped at 30 seconds. Healthy processes are left running; ports or unrelated processes are never adopted or killed. Quitting disables recovery.
- Service logs survive automatic restarts, retaining the original failure for diagnosis.
- The recovery fixture exposed an additional shutdown hang: `waitUntilExit` could remain in a run loop after a timer-launched child had exited. Shutdown now uses bounded checks after termination. The existing exact-process orphan reaper remains the fallback on the next launch.

This layer never sends or replays an agent request. Existing runtime receipts, uncertain-delivery checks and disabled automatic mailbox-resume settings remain in place. No Terminal drafts, microphone settings, research objectives, subscription settings, relay credentials or app-server routing were changed.

## Verification

**Runtime:** 631 tests passed, zero failures or skips. The speech regression failed before the patch and passed afterward. It verifies offline speech with a saved voice, continuing workspace health, a contained routing exception, successful recovery when the local catalog returns, and unchanged saved voice preferences. Focused voice/catalog/relay checks passed as well.

**Native Mac:** 232 tests executed: 222 passed and 10 opt-in live checks skipped. Six targeted ownership/recovery checks passed. Disposable real child processes verified automatic recovery, healthy-child preservation, repeated failures/backoff, duplicate-start suppression, unrelated-process preservation and recovery cancellation on quit. The accelerated timer fixture recovered in about 1.06 seconds; production uses a two-second observation interval and backoff, so this is not a production latency promise. The installed user's service was not deliberately crashed after recovery.

**iPhone state logic:** all nine existing `CloudSessionCatalogTests` passed, including delayed replies, startup refresh retries, disconnect/reconnect and preservation of selected threads/history. These ran through the mobile Swift package on Mac; they are not physical iPhone or simulator UI measurements.

**Installed live checks:**

- Mac build 91 is signed, notarized and stapled. App and DMG passed Gatekeeper verification. Source, bundle and installed runtime hashes match.
- App launch to native readiness: **5.78 seconds** during installation, including the Mac app's startup. This is distinct from opening the iPhone app against an already-running Mac.
- Warm workspace catalog: **33–45 ms**, returning 254 projects. Health: 1–19 ms. Speech status: 4–13 ms, available. These are local Mac measurements, excluding phone/network latency.
- The actual Mac UI changed from an empty ClawDad window to its populated workspace and recent threads.
- All 18 Terminal Codex process records were preserved through installation. Assistant message history, enabled/paused state and workspace instructions matched before/after; research autonomy remains off.
- The prior signed build 90 is retained as rollback evidence. No public npm release, appcast publication or cloud deployment was performed.

Remaining physical check: reopen ClawDad on Cody's iPhone and confirm the workspace appears promptly, then confirm returning from the background still reconnects. The phone's exact installed build and end-to-end launch time were not observed. If a delay remains, identify whether it is the system launch screen, subscription check, or paired-workspace screen before changing another startup dependency.

## Evidence and workspace checkpoint

Canonical ignored evidence: `native/macos/dist/candidates/iphone-startup-2026-09-10/`. Includes the original crash/connector logs, before/after regression output, full runtime and Mac checks, mobile catalog checks, signed release artifacts, installation verification and final health timing.

Scoped source, tests and this report are committed together. Nine unrelated dirty buckets remain preserved and classified: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/` and `marketing-site/`. Their next action remains review/checkpoint by their existing lanes.
