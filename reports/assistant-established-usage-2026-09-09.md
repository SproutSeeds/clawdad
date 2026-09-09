# Established Terminal recognition and weekly Codex allowance

Implemented September 9, 2026. Mac **0.7.0 (87)** is installed, signed, notarized and healthy. iPhone **0.7.0 (76)** is VALID and IN_BETA_TESTING in **ClawDad Internal**. The existing production Worker is **afa8195e**, with its deployed source checked byte-for-byte against the tested candidate.

## Established-session repair

The established ClawDad Terminal process was holding both its main CLI rollout and a complete Guardian auxiliary rollout open. Build 85 treated every unrecognized rollout as a conversation still starting. The Guardian header therefore left an established session permanently in `session_starting`.

The busy-state reader had a separate restart problem: a large `world_state` record interrupted its backwards lifecycle scan before it reached `task_started`. An oversized incremental record could also erase previously observed working state. This explained the visible Working state disagreeing with the catalog after a Mac app restart.

Changes:

- Classify complete CLI, auxiliary, unrelated, incomplete and unsupported metadata separately. Complete Guardian metadata is excluded from the main conversation selection. Incomplete startup remains pending; malformed or unknown conversation metadata produces an explicit unsupported diagnosis.
- Bind discovery to the exact foreground Codex PID, process start signature, TTY and mapped executable. Recheck ownership after discovery. Inherited-TTY helper processes and stopped/background owners are excluded. Multiple main conversations remain ambiguous. Directories never substitute for live session identity.
- Skip oversized context/tool records during the bounded reverse scan, and retain working state while an oversized partial record arrives. Explicit task lifecycle events remain the authority.
- Preserve the existing before-first-turn process identity, draft/edit tokens, permission checks, separate Enter/Tab actions and persistent delivery receipts.

Installed-build evidence through the actual Assistant MCP implementation:

| Surface | Observed result |
| --- | --- |
| Established ClawDad tab, `/dev/ttys010` | PID 41580, Codex 0.153.4, session `01a06f70-051d-76e2-ab41-0d816990fcd8`; `agentAvailable:true`, `inputState:ready`, empty editable draft, catalog busy true after both app replacements |
| Reidentified catalog ID after build 87 | `d7eb07f4-b441-42d4-b69c-ac4f0a5f26b8`; old catalog IDs were not used as new live identities |
| Research tab, `/dev/ttys012` | Recognized, empty, eligible before its first turn, no borrowed session; no research prompt inserted or submitted |
| Two disposable same-directory sessions | Direct and shell-wrapped launch; distinct process identities and no initial rollout; first draft inserted/inspected/cleared without a dummy submission |
| Busy fixture | Draft inserted without Enter/Tab; `queue_tab_draft` and `queue_in_tab` each observed native acceptance after exactly one Tab |
| Execution | Original task completed first, then FIRST, then SECOND, in three distinct turns; exactly one user-message record for each request |
| Retry/restart | Repeated request IDs returned the original receipts before and after the Mac app restart; all three remained completed without replay |
| Preservation | Second fixture's unrelated draft survived the first fixture's work and the Mac restart; both disposable TTYs removed; all 14 original TTY/window/draft fingerprints matched the baseline |

The established tab currently has an **ellipsized existing native queue preview**. It is recognized and available for draft input, but queue readiness deliberately remains false because every pending entry cannot be observed. This is a separate conservative queue-verification boundary, not the repaired session-starting failure. The successful queue evidence comes from the disposable working session with readable pending entries. No additional follow-up was forced into Cody's actual queue.

One fixture-close receipt was uncertain although the returned catalog and independent Terminal TTY enumeration confirmed removal. That close was not retried. Closing behavior was outside this patch; the evidence is retained in diagnostics. The final inventory contains exactly the original 14 tabs.

## Weekly allowance

The authoritative source is the actual signed-in Codex account's `account/rateLimits/read` result. The reader initializes a short-lived local `codex app-server`, verifies ChatGPT account state with `account/read` before and after, reads limits once, then terminates its owned process. It issues **only account RPCs**, with no thread discovery, creation, resumption, submission or usage-check messages. This account-only integration does not implement the paused app-server thread access or destination selector.

The parser selects the `codex` bucket and its unique **10080-minute** window, whether returned as primary or secondary. Remaining percentage is `100 - usedPercent`. It excludes the separate Spark bucket and shorter windows and requires the provider's account ID; a hash of that ID keys local deduplication. It does not use tab counts, project directories, API billing or cached transcript limits.

The [official account rate-limit documentation](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt) describes the percentage/window and Unix reset fields. Live Codex 0.153.4 on this Mac returned the weekly window in `primary`, demonstrating why assuming `secondary` would be wrong.

Last retained installed reading: **30% remaining**, observed **2026-09-09 16:58:32.799 UTC**. Reset timestamp **1789435631** converts to **Monday, September 14, 2026, 8:27 PM CDT** on Cody's configured local timezone. These are point-in-time evidence; the UI continues updating.

- The iPhone main screen and Remote Assist primary three-dot panel share one host-bound reading. Both show percentage remaining, reset day/date and local time. A compact three-line format keeps the entire reset visible on a 375-point phone. Tapping opens allowance details and existing alerts; Done returns to the prior view.
- The Mac main web view shows the same reading with local-time formatting and an allowance-details dialog.
- The Mac polls the provider every two minutes, coalesces concurrent requests and reuses cached snapshots for screen refreshes. Reads fail to stale/unavailable, including after process restart until refreshed, after disconnection and after a passed reset. Cached values are never labeled current beyond their validity interval. Devices format the Unix timestamp in their own timezone.
- Mac/local notifications reserve stable identifiers before delivery. iPhone uses the existing authorized push registration and relay. Both routes preserve notification permission choices; no notification permission, microphone setting or call state was remotely enabled.
- One <=5% event and one 0% event are recorded per account/cycle in an atomically replaced owner-only local checkpoint. The relay also deduplicates stable event IDs. First observation at 0% creates only the 0% alert. If unsent low and zero events accumulate, only zero is forwarded together. Repeated reads, reconnects and process restarts do not create new threshold events.
- A verified later weekly cycle after the prior reset boundary rearms alerts. Early timestamp corrections and out-of-order readings do not. Account changes have independent receipts; returning to an account preserves its prior threshold state.
- In-app notices can open the allowance. Notification taps route to the matching paired Mac's allowance; the Mac holds a notification-open request until its page loads. Unpaired notification destinations are rejected.

The new cloud payload includes allowance/reset metadata and routing identifiers, not conversation text, code, audio, account credentials or the Codex account key. It reuses the existing Worker, Durable Objects and APNs configuration. No new cloud resource or paid service was provisioned.

## Verification and release

| Check | Evidence |
| --- | --- |
| Runtime suite | **594 passed**, zero failures; includes account-only RPC sequence, stalled/changed account, weekly-vs-short-window interpretation, threshold persistence, skipped readings, reset/account changes, unavailable/stale data, trusted relay reads and notification-registration states |
| Mac suite | **229 executed, 8 explicitly skipped, zero failures**; includes auxiliary metadata, fresh bindings, ambiguity/stale ownership, large complete/incomplete/incremental context records and live read-only activity inspection |
| Mobile suite | **208 executed, 1 explicitly skipped, zero failures**; includes host/reconnect scoping, notice acknowledgment persistence, exact local reset/DST/day-boundary formatting, notification destinations and existing Assistant/voice/draft regressions |
| iPhone UI | **2 tests passed**, compact 375×667 simulator and accessibility XXXL text, both locations, minimum tap height, details and Done navigation; final screenshots inspected |
| Installed Mac UI | Main window visually verified at 30% remaining with the complete Monday/Sep 14/8:27 PM CDT reset; matches the installed runtime reading |
| Release metadata | **11 tests passed** after selecting final iPhone build 76 |
| Mac release | Build 87 installed atomically with rollback retained; Gatekeeper, code signature, app/DMG notarization/staples, managed runtime and service health verified; Terminal process/workspace unchanged |
| iPhone release | Build 76 uploaded, Apple VALID, existing Internal group assigned, matching testing notes; distribution IPA signature verified with `aps-environment=production`, correct app/team and `get-task-allow=false` |
| Production relay | Active latest version `afa8195e`; previous `cb0f13c6`; editor/deployed source exactly matches the tested bundle; health/privacy HTTP 200; authenticated notification status configured, one registered device and no pending events |

Mac build 86 and iPhone build 75 were intermediate candidates. Final build 87 adds startup-safe Mac notification navigation; final iPhone 76 includes the verified compact reset layout. Mac 87's bundled release-catalog metadata still names the intermediate iPhone 75; the installed functional weekly/Terminal modules match their released source, while App Store Connect carries final build 76 and its correct notes. This packaging metadata difference does not select a runtime or affect either feature.

The vendor WebRTC distribution framework still produces Apple's existing missing-dSYM upload warning; upload and processing succeeded. Symbolication inside that prebuilt framework remains limited.

Physical iPhone checks remain: install TestFlight 76, compare the live main/menu readings, navigate through a real usage alert from foreground/background/cold launch, confirm notification appearance and permission-denied behavior, and exercise the repaired Terminal actions through the phone. Automated threshold simulations and successful Apple acceptance of existing completion alerts do not establish physical delivery of a weekly threshold alert. No fake zero-allowance alert was sent to Cody's phone. Persistent event deduplication is verified; APNs presentation is not an exactly-once delivery guarantee during uncertain provider responses. Separate Mac installations do not yet share a single cross-host allowance monitor.

Broader icon reorganization, app-server thread access and the Terminal/ClawDad destination selector remain untouched.

## Evidence and workspace handoff

Canonical artifacts: `native/macos/dist/candidates/assistant-established-usage-2026-09-09/`. Key evidence: `recognition-final-summary.json`, `live-ordered-completion.json`, `fixture-bindings-after-restart.json`, `research-final-87.json`, `preservation-final.json`, `installed-usage-final.json`, `install-87-verification.json`, `iphone-76-distribution-verification.json`, `testflight-verification.json`, `cloud-deployment-verification.json`, `cloud-push-status.json`, final suite logs and `usage-ui-compact-date.xcresult`.

The disposable fixture directory and two CLI rollouts are diagnostic artifacts; no production project prompt was submitted. The original clipboard was kept in helper-process memory during the Worker editor comparison and restored afterwards. Browser JavaScript automation stayed disabled; deployment used the existing signed-in Chrome UI. No new account grant was created.

This lane is checkpointed separately. Preserve the nine pre-existing unrelated dirty buckets: the two managed release-skill files; `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh`; the integration plugin manifest; `assets/wordmark-explorations/`; `cloud/native/` prior notification artifacts; and `marketing-site/`. Their next action remains their owning release/branding/marketing work. No broad branch push, npm publication or app-server routing migration is included. `git diff --check` and final ORP hygiene are required at handoff.
