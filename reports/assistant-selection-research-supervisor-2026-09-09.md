# Assistant text selection and opt-in Terminal research supervision

Released September 9, 2026. **Mac 0.7.0 (89)** is installed, signed, notarized, and healthy. **iPhone 0.7.0 (77)** is VALID and IN_BETA_TESTING in **ClawDad Internal**. The production notification Worker is **c332026c**; its deployed source matches the tested candidate byte for byte.

**Autonomy is off on Cody's existing threads.** The only supervisor record is the completed, disabled disposable verification fixture. Its Terminal tab has been closed. All 14 original Terminal draft fingerprints matched their pre-test baseline after cleanup.

## Selecting part of a message

User messages, Assistant responses, task requests/results, and image captions now use a native, read-only `UITextView` on iPhone. Long-press opens native selection, handles adjust the selected range, and the contextual Copy action copies only that range. System Look Up, Translate, and Share remain available where iOS supplies them. The existing quick-copy button still copies the complete message.

The component preserves every source character, including multiline lists, code fences, inline code, emoji, and contact information. Code receives a monospaced font. Existing phone/address routing is retained and ordinary URLs are detected. Selecting text does not invoke a link, enter editing mode, modify history, or call the conversation's send/microphone controls. Apple's [selectable text view interface](https://developer.apple.com/documentation/uikit/uitextview/isselectable) provides the native interaction rather than a custom selection overlay.

While a range or initial touch is active, the text view holds its displayed attributed string. The visible conversation also holds its history snapshot and suspends incoming-message autoscroll. Calls and incoming state continue independently. Revisions apply when selection ends; Copy continues to refer to the text actually selected. The Mac web conversation similarly defers message/task DOM replacement, removal, and autoscroll during selection.

No new persistent selection controls were added. The existing whole-message copy icon remains the quick action.

## Research supervisor controls and operation

Open **Assistant → Workspace → Research autonomy** beneath the exact Terminal tab. Enter the objective, allowed scope, verification requirements, an evidence directory on the Mac, and relevant report/checkpoint paths. Enabling requires a separate confirmation. A fresh composer can be used manually, but supervision requires an identified session after its first actual user request; enabling never sends a dummy prompt.

Each thread has Pause, Resume, Turn off, manual steering, a compact activity list, and expandable decision history. Turning autonomy off invalidates any pending decision and cancels only automatic work waiting for delivery. Interruption of an already-running Terminal agent remains a separate user action. The Icon glossary includes Research autonomy. Opening/closing these controls preserves the current conversation, call, typed draft, and images.

The separate reviewer runs through the installed Codex CLI, using `gpt-6-astra` with medium reasoning. It receives the actual completed response and approved local evidence. Its run is ephemeral and read-only, with shell, web, user plugins/MCP configuration, and Terminal control disabled. It cannot enable itself or change budgets. The conversational Assistant keeps its own coordinator and can read `research_status` and paginated `research_history` without waiting for the review. `observe_tab` provides exact ownership/completion observation without switching tabs.

Every review records:

- Exact Terminal TTY, process instance, session, source completion, and completion identifier.
- Evidence contents and SHA-256 digests, plus missing, changed, binary, oversized, or out-of-scope evidence.
- Distinct proved findings, hypotheses, diagnostic cases, unresolved obligations, and failed approaches.
- An assessment of every approved verification requirement, with exact evidence quotations.
- The decision, rationale, acceptance criteria, exact outgoing prompt, stable request ID, and delivery/result transitions.

A completed objective requires artifact evidence for every approved requirement; an agent's statement alone cannot satisfy one. Missing evidence or unresolved obligations prevent the complete state. A continuation must contain a bounded task and acceptance criteria within the approved objective and scope. Human decisions, expanded scope, conflicts that cannot be resolved within scope, repeated work without meaningful progress, uncertain identity, and uncertain delivery pause further automatic work. Two no-progress reviews stop the loop. Earlier failed approaches and obligations remain in history.

Evidence is limited to the approved real directory, with at most 24 files, 256 KiB per file and 1 MiB per review. Larger history requires a user-approved checkpoint after 256 KiB of prior review context. These limits produce an explicit pause or unverified evidence rather than silently accepting truncated proof. Review is an evidence assessment by a model; it is not independent formal certification. The bounded continuation can request additional tests or proof work through the original agent.

State, review inputs/decisions, account reservations, and receipts live on the Mac under `~/Library/Application Support/ClawDad/Assistant/Research/`. Files are atomically replaced with owner-only permissions; review checkpoints are durable. Ordinary cycles stay in research activity/diagnostics. Milestones, objective completion, blockers, and pauses use in-app notices and the existing system notification routes. Notification payloads contain routing and event metadata rather than research evidence or conversation text.

## Exact targeting, manual work, and recovery

Authorization binds to the exact TTY, live process instance, and Codex session. A changed catalog ID after a Mac app restart can be rebound only when all three still match. A matching directory or shared rollout history never authorizes another live process.

The supervisor waits for a completed turn, reconciles prior delivery receipts, and gives manual drafts and native queued work priority. Automated delivery uses the existing authorized native Terminal path with empty-composer/queue inspection, current ownership, the interaction gate, and persisted delivery preparation. Fresh budget and enabled/revision checks run again at native delivery boundaries. Automated continuations use the separate send action after completion; busy-agent Tab queuing remains its own verified tool and is not used to overwrite or bypass an existing queue.

Manual tool actions or explicit steering invalidate a review before its outgoing prompt can be delivered. A newer completion discovered after review also takes priority. Stable IDs deduplicate completions, controls, and outgoing prompts across polling, retry, and restart. Once delivery may have begun, a missing/uncertain receipt pauses supervision; no replacement request ID is invented and no automatic resend is attempted. Restart during a review requires explicit resume; already-submitted agent work is observed through its saved receipt.

The live fixture exposed and fixed one additional blocker: an old `terminal.native.type` receipt for launching `codex` remained `inserted`, and was incorrectly treated as a current Codex draft forever. Historical shell-launch receipts no longer block supervision. Current inserted Codex drafts bound to the same live session, active requests, and actual native input checks still protect user work. Build 89 contains this fix; build 88 was an intermediate candidate.

## Established-session prerequisite

The build-85 recognition failure was repaired in the prior [established-session release](assistant-established-usage-2026-09-09.md), and reverified through the actual installed Assistant MCP path in this release. Two causes were confirmed: a complete Guardian auxiliary rollout was treated as unresolved conversation startup, and a large `world_state` record interrupted the bounded busy-state lifecycle scan after restart. Main-session classification and lifecycle scanning now distinguish those records correctly.

Installed build 89 recognizes the established ClawDad process on `/dev/ttys010`, PID 41580, Codex 0.153.4, session `01a06f70-051d-76e2-ab41-0d816990fcd8`, as available, ready, and busy. The catalog agrees. The untouched research tab on `/dev/ttys012` remains `ready_before_first_turn`, empty and eligible, without borrowing a session. No research task was submitted there. Existing ambiguous or ellipsized native queue previews still fail closed; the queue test used a disposable working agent with observable entries.

## Shared weekly allowance reserve

The prerequisite weekly monitor is implemented and reused. It reads the signed-in account's authoritative `account/rateLimits/read` result, selects the `codex` bucket's unique **10080-minute** window, and computes `100 - usedPercent`. It checks account state before and after the account-only RPC. It never creates/resumes threads or sends an agent message to obtain usage. The minimal main-screen and Remote Assist menu displays and separate persistent 5%/0% general alerts remain in place.

The account endpoint was observed correcting a still-future reset timestamp in both directions. Previously, an earlier correction was rejected indefinitely as an older cycle. The monitor now accepts the fresh authoritative correction while retaining the same alert cycle; a date correction alone does not rearm general alerts or release the autonomy pause.

One account admission ledger serializes all research supervisors managed by this Mac. New reviews and continuation dispatches require a successful fresh account read; concurrent checks coalesce the underlying account request. Stale/unavailable usage or a changed account pauses new automatic work. Idle/busy monitoring uses the shared cached source, with a ten-second supervisor sweep and ordinary two-minute account polling.

At **20% remaining or lower**, the account reserve latches and emits one budget event. New automatic work stops across that account's supervised threads. Already-running agents are left intact and can consume additional allowance; this is not a hard consumption cap. A restart, reconnect, refresh, later increased reading, or weekly reset never clears the latch.

Continuing requires a deliberate recorded override: exact account and selected thread scope, a revised reserve from 0–20%, and a maximum of 1–20 additional reviews. It expires at the next verified weekly cycle or after 24 hours, whichever is earlier. The iPhone control applies it to the selected thread; the underlying control can bind an explicit selected set. Review-count grants are persisted and dispatch must have its corresponding grant. An override never purchases usage or changes a subscription.

Last retained reading: **27% remaining** at **2026-09-09 18:35:25.184 UTC**. Reset `1789435631` is **Monday, September 14, 2026 at 8:27 PM CDT**. This is release evidence, not a fixed current value. The UI continues refreshing.

This coordination covers all supervised threads managed by the installed Mac runtime. Separate Mac installations do not share this local admission ledger; distributed cross-host autonomy budgeting is outside this release. The paused app-server thread-access and destination-selector implementation remains paused.

## Verification evidence

Canonical evidence directory: `native/macos/dist/candidates/assistant-selection-supervisor-2026-09-09/`.

| Check | Result and evidence |
| --- | --- |
| Full runtime suite | **618 passed, zero failures**, `runtime-release-final.log`; includes 24 research tests, account usage, manual/native queue behavior, durable receipts and notification regressions |
| Mac suite | **229 executed, 10 explicitly skipped, zero failures**, `mac-final.log` |
| Mobile suite | **208 executed, 1 explicitly skipped, zero failures**, `mobile-final.log`; existing normal turn ending measured 2056 ms in this automated run |
| Native selected-range unit tests | **4 passed** in an app-hosted simulator target: exact word/sentence/multiline/list/code/emoji/caption clipboard contents, 80-line text, pending attributed revisions, read-only behavior, and phone/address/URL ranges |
| iPhone UI tests | **10 distinct affected-flow tests passed** across recorded runs: user/Assistant partial Copy during simulated call, handle drag across lines, accessibility XL text, opt-in/pause/off, whole-message copy/task history, image-only failed-send recovery, Think aloud while muted, phone/Google Maps links, Apple Maps fallback, and held voice-edit reopening/one send |
| Compact-screen visual inspection | Native handles and contextual Copy inspected at 375×667 points, normal and accessibility XL text. Large text remains selectable; existing header wrapping becomes crowded at that size and has not been redesigned in this scope |
| Desktop browser fixture | Actual `web/assistant.js`, CSS, and research panel mounted in an isolated browser. Native browser clipboard copied the exact cross-line range from both roles. Incoming message/revision polling preserved selection; clearing it applied the deferred update without duplicates. Whole copy, typed draft, opt-in cancellation and form reopening passed. `browser-selection-verification.json` |
| Account reserve fixtures | First observation below 20%, concurrent admissions, threshold crossed during review and before delivery, stale usage, account change, bounded override/count/expiry/scope, repeated events, restart and reset while latched all passed |
| Lifecycle fixtures | Completion-review-continuation, duplicate completion/request, restart reconciliation, exact owner/catalog rebind, wrong process, manual draft/queue priority, steering, off/pause during review and before dispatch, verified completion, false completion, missing evidence, genuine blockers and repeated no progress passed |
| Actual native queue | Disposable Codex 0.153.4 agent accepted the follow-up after one Tab while its first request was working. Receipt reported `rendered-agent-queue`; first task completed before the queued turn. Retry retained its original ID/receipt; actual rollout contained the queued prompt once |
| Actual autonomous cycle | First response and real `report.txt`/`verify.mjs` evidence were reviewed. Exactly one continuation ran the second Node assertion in the same live process. The second review verified both requirements and set autonomy to complete/off. Actual rollout contained the automatic prompt once. `live-supervisor-result.json`, `live-final-verification.json` |
| Responsiveness | Read-only status/history probes continued during the real review cycle: median 2 ms, slowest 1491 ms. Simulated call and unrelated typed draft remained available through native research controls. No additional conversational model message was submitted solely to demonstrate responsiveness |
| Preservation | Disposable tab closed using its exact confirmation receipt. All 14 original TTY draft fingerprints matched afterward. Established and fresh research ownership re-inspected. `preservation-final.log`, `live-inspection-final.log` |
| Production notification | Real fixture completion event accepted once by Apple, HTTP 200, with no pending relay event/outbox item. This proves APNs acceptance, not that Cody saw or tapped the notification |

Real review timing: first review started **18:18:19.311 UTC**, returned its decision **18:18:38.038** (18.7 s); the continuation was accepted by the agent **18:18:45.589**, completed **18:18:58.388**; second review ran **18:19:07.118–18:19:24.611** (17.5 s) and stopped the supervisor. Model review and agent task time consume the existing Codex allowance. Ordinary idle sweeps launch neither reviewer nor agent turns.

Earlier UI harness attempts encountered lazy-form visibility and duplicate accessibility-query matches; final tests use exact component IDs and observed scroll positions. The research form now dismisses its keyboard before enable confirmation and offers Done typing. One earlier full-suite run encountered an existing timing-sensitive delegate test; its isolated rerun passed, and the final complete 618-test run passed. Intermediate attempts remain in diagnostics rather than the visible conversation.

## Release and remaining physical checks

Mac 89 was installed atomically with rollback retained. Code signature, notarization, health, unchanged Terminal processes/layout, and the installed runtime files were verified. iPhone 77 is assigned to ClawDad Internal with matching release notes; the exported IPA has the correct app/team, production push entitlement, and disabled debug entitlement. Apple's existing missing-dSYM warning for the vendor WebRTC framework remains; upload and processing succeeded.

Production Worker **c332026c** replaced **afa8195e**. The reloaded deployed source is exactly the tested 80,523-byte candidate, SHA-256 `a9f8e16a353e90d231d0a1af33e075d2a3d664e87894b27e74690c00a7ee594d`. Health and privacy endpoints return HTTP 200. Existing authentication, notification registration, and cloud resources were reused. The change only extends the existing notification relay for research events.

Physical iPhone checks still needed after installing TestFlight 77:

1. Long-press and adjust both handles through a very long message; confirm contextual menu placement and selected-only Copy across scroll boundaries.
2. Repeat while using an actual microphone call with incoming responses, then open links, use whole-copy, and return to the held typed/image draft. Simulator call fixtures do not capture real microphone audio.
3. Verify VoiceOver reading/selection rotor, accessible menu actions, and comfortable gestures at Cody's preferred text size. UIKit accessibility and automated queries do not establish physical VoiceOver behavior.
4. Review the exact thread, objective, scope and evidence paths before opting in. Exercise pause/off and decision-history navigation during a real call. No existing thread was enabled for these tests.
5. Verify foreground/background/cold-launch notification appearance and navigation. The reserve/5%/0% conditions were exercised with synthetic local readings; no fake low-budget notification was sent to Cody's phone. Provider retry after an uncertain network response cannot guarantee exactly-once visible APNs presentation.

## Workspace checkpoint

The scoped source/tests and this report belong to the selection/supervisor lane. Release artifacts and disposable fixture evidence are retained in the canonical ignored candidate directory. No broad branch push, public npm release, app-server routing migration, or unrelated icon reorganization is included.

Preserve these nine pre-existing unrelated dirty buckets: `.agents/skills/clawdad-release/SKILL.md`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`; `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh`; `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`; `assets/wordmark-explorations/`; `cloud/native/`; `marketing-site/`. Their next actions remain their owning release/storage, integration, branding and marketing work. Final `git diff --check` and ORP hygiene verification accompany the scoped commit; no unclassified paths remain.
