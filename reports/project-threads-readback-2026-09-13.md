# Project thread access and readback

Status: Mac **0.7.0 (141)** installed and verified. iPhone **0.7.0 (92)** is VALID, IN_BETA_TESTING and assigned to **ClawDad Internal**, verified through Apple API readback. Open in Terminal and a new settings architecture remain deferred.

## Findings and scope

The existing main-screen project, session, model and effort controls retain their production behavior. This repair extends the Assistant's native tools and routes project-message speakers through the existing Assistant speech player. Terminal input/key/queue/window/workspace implementations were preserved.

### Thread access

The actual signed-in runtime is Codex **0.154.0**, using the existing shared Unix app-server socket. A paginated baseline found **3,556 index records**, 294 server-listed active histories, two archived histories and no loaded shared threads. Index metadata is broader than readable/live history. Final installed discovery, after creating/archiving a disposable fixture, returned **2,802 non-internal records over 57 pages** from 3,557 index records. Explicit `includeInternal` retains access to internal records as well.

Confirmed source defects:

- A failed history read could make that retained record disappear from the default inventory. Failed histories now remain listed with an unavailable state and recovery explanation. Inspection can return retained metadata without fabricating a writable runtime or replacement history.
- Subagent source metadata can be a JSON string in SQLite and an object in the server. The two forms now use the same explicit filter, instead of treating arbitrary objects as internal and leaking JSON-encoded internal rows.
- Older index cwd could overwrite newer server metadata. Server metadata now wins and disagreement is flagged as stale. Names remain display metadata.
- Assistant send/queue tool schemas lacked model/effort arguments. Codex's actual `thread/queue/add` protocol accepts input and client ID, **without per-item model/effort fields**. Supplying those settings to that RPC would not implement the requested semantics.

The new `thread_model_options` reads authenticated `model/list` and project `config/read`, including supported reasoning levels and image modalities. Explicit settings are validated and frozen into a durable waiting receipt. The dispatcher waits for the exact shared-owned thread to be idle with an empty native queue, obtains the same delivery claim as the manual app dispatcher, and issues `turn/start` with the selected settings and stable client ID. Runtime requests, persisted turn contexts and accepted input were verified. No permission/sandbox changes are sent with the turn. Requests without settings use the native thread settings. If an earlier configured request is waiting, later requests join that durable order.

Waiting, accepted native queue, submitted awaiting reconciliation, working, completed, cancelled and attention states remain distinct. A draft is cleared only after matching its accepted client message ID, and only if its revision has not changed. Queued work can be cancelled before delivery. Pausing prevents new dispatch; it does not interrupt a running project agent. Uncertain dispatch is reconciled with its original receipt and never automatically repeated. A shared-server PID/owner change before delivery yields attention with retained text/images rather than loading another runtime.

### Ownership boundary

Live inspection found independent Terminal processes holding the named conversations' rollout files, separate from the shared daemon. Matching saved history does not establish shared control. The installed Assistant path still reports these threads as Terminal-owned, readable and unavailable for app-server writes. The historical Cody-specific refusal was not located in the retained request records; two retained refusal records belong to older disposable tests. Consequently, stale ownership is **not established as the cause of Cody's particular refusal**.

Ownership is recomputed from current processes/handles and `thread/loaded/list`, rather than trusted from old catalog metadata. The inspection fingerprint is now scoped to the requested conversation: unrelated guardian handles held by the same process cannot invalidate that target. Tests cover the independent owner exiting, an old token being rejected, and a new inspection explicitly resuming the same saved ID. Live Terminal owners remain fenced.

The supported handoff is deliberate: finish and exit the independent owning Codex process, inspect the exact saved conversation again, then explicitly resume that ID in ClawDad. No active work, draft or native queue is transferred by this action. Do not exit an owner with a draft/queue that the user wants retained. An already-loaded shared-server thread is addressed in place; no second worker is launched. No protocol was found that safely injects an app-server message into an independent Terminal CLI runtime. A shared-runtime TUI attachment or automatic migration was not introduced.

The waiting dispatcher serializes ClawDad manual and Assistant sends and checks observed ownership/status. It is not a universal mutex against an uncoordinated third-party client using the same socket; no atomic idle-only `turn/start` predicate is advertised. The supported path is the existing ClawDad-owned shared runtime. Independent/ambiguous owners remain blocked; do not claim cross-client atomic control from this test.

## Capability matrix

| Existing action | Assistant tool/path | Supported behavior and boundary |
|---|---|---|
| Choose a project | `list_workspaces`, `list_threads(project)` | Current configured roots and paginated exact project/thread IDs. No new directory or settings UI. |
| Discover retained/archived threads | `list_threads`, cursors, `includeInternal` | Server pages plus retained SQLite index; stale/unavailable histories remain explicit. |
| Inspect/read history | `inspect_thread`, `read_thread_history` | Exact ID, owner, current status, draft and every requested history page. Legacy immutable read snapshot when appropriate; no implicit resume. |
| Create a conversation | `create_thread` | Verified new ID in an authorized workspace, existing native sandbox/approval policy; no user turn. |
| Restore/resume history | `restore_thread`, `resume_thread` | Explicit archived restoration, then fresh inspection and exact-ID resume only with a verified safe owner. |
| Draft/edit/clear | `set_thread_draft`, `clear_thread_draft` | Revision-checked Assistant-owned text/image draft. Separate from the iPhone main-screen composer and from submission. |
| Choose model/effort | `thread_model_options`; send/queue arguments | Actual authenticated catalog, validation, settings frozen per message. Original UI per-message controls unchanged. |
| Send while idle | `send_to_thread` | Exact shared owner; selected settings use observed `turn/start` acceptance; an active thread is rejected rather than steered. |
| Follow-up while busy | `queue_thread` | Native queue with inherited runtime settings, or durable ordered waiting for explicit per-message settings. Preserves prior native entries. |
| Images | Send/queue `paths`, or inspected draft revision | Retained PNG/JPEG bytes, SHA-256 checks, actual local-image model input; image-only supported. Existing limit: four images, 10 MB each. |
| Track/recover | `task_status`, `reconcile_thread_request`, `assistant_control(cancel_waiting)` | Exact client/turn IDs, response updates, one-time delivery, durable cancellation/attention. No blind replay after uncertainty. |
| Approval/question | Existing in-app permission path | Assistant does not grant itself approval or answer a prompt belonging to another client. |
| Terminal-owned conversation | Existing Terminal tools | Read shared history; write using its exact native Terminal owner. Deliberate exit/reinspect/resume for a later handoff; no silent routing. |

Assistant app-server drafts retain the existing 32,000 UTF-8 byte limit; this work does not change main-Assistant chat capacity or imply unlimited model context.

## Project speaker repair

The previous project speaker path was `ThreadConversationTurn → CloudSession.toggleReadAloud → MobileReadAloudController → MobileAudioSession.reservePlayback`. During an Assistant call the conversation owns the audio session. The second controller is rejected with **“End the Assistant voice conversation before using another microphone or playback control.”** This is a reproducible active-call defect. Cody's exact current error text and phone build remain unconfirmed, so it is not claimed to explain every reported speaker error.

Project user/agent speakers now send the selected message text through `MobileAssistantController.toggleProjectReadAloud` and its shared production playback cursor. Identity includes project, conversation, request, participant and text fingerprint. This reuses the selected high-quality voice, boost, chunk retries, saved position, cancellation fencing and microphone suppression. It connects only the data channel when needed; it does not start a call or submit an Assistant turn. A second message supersedes the first. Pause/resume/stop remain available in the thread sheet and across navigation; the underlying call bar is hidden while that sheet owns its controls. Speaker hit targets are 44 points. The preview history fixture was repaired under `#if DEBUG` so selecting a preview thread can exercise the real sheet controls.

Before changing the phone player, direct local and signed synthetic cloud-envelope tests generated and retrieved all four WAV parts for both a user message and a 1,540-character multi-paragraph response. Primary speech was Doc Reader / local Kokoro `kokoro-82m-v1`, `af_heart`, speed 1. This supports a healthy synthesis/envelope path at inspection time; it does not prove phone playback or rule out intermittent network failures.

## Verification

Evidence root: `native/macos/dist/candidates/project-threads-readback-2026-09-13/`.

- **724 runtime tests passed.** New tests cover missing histories, JSON source forms, stale cwd, exact owner handoff, settings validation, ordered waiting, restart, cancellation, draft revisions and lost acknowledgement.
- **255 mobile tests: 252 passed, three intentional opt-in skips, zero failures.** The focused playback/diagnostic suite passed 17 checks. An initial new fixture incorrectly kept its fake connection closed after binding; corrected fixture and rerun passed. No live microphone preference was changed.
- **71 native Terminal/workspace regressions: 65 passed, six intentional live-fixture skips.** Earlier Mac 140 verification includes disposable installed-MCP switches/window cleanup. Installed Mac 141 read-only Assistant inspection recognized the currently selected real agent as `agentAvailable=true`, `inputState=ready`, exact session `01a0988e-bbdf-73c2-814b-ae5733ceff69`; its draft was untouched. Native-shell `canTypeDraft=false` on an agent composer correctly directs the caller to agent draft/queue tools.
- **Real MCP → HTTP → AssistantRuntime → app-server fixture:** thread `01a09ccf-4f76-7fa1-8ae5-41bbaeb48879`; three accepted turns in order, exact input hashes and no duplicate after MCP/local-receipt reload. Runtime turn contexts: `gpt-5.6-sol/low`, native inherited `gpt-5.6-sol/low`, then `gpt-5.6-sol/medium`. Requests `bbd22f7f-837c-45e2-9b0a-ffb259d61c22`, `30f7727b-0fc2-4513-88c1-29a2960807a6`, `c738e131-6201-4474-a028-9d9380e1061c`. Fixture archived after completion.
- **Installed Mac 141 MCP image-only proof:** request `2dfcacc7-dbe6-4fc4-a5b2-91b3c27f9ffd`, exact thread `01a09cda-8a5d-7513-92bb-5e7a9e9217d0`, turn `01a09cda-9ccd-76b1-912e-2910a07b01a3`. One accepted image turn despite duplicate call; actual model response correctly identified the supplied solid red square. Fixture archived. Original bytes and SHA evidence retained.
- **Complete native output:** all four actual project response WAVs completed in order, **99.15 seconds**, with +12 dB synthetic test preference, source bytes unchanged. Production player output was muted. This is engine/callback verification, not audible iPhone verification.
- **Six distinct UI scenarios passed:** user/agent speaker, switch/replay/pause/stop, and muted-call preservation at compact and 6.9-inch sizes, including Accessibility XL. Initial harness failures came from tapping a partially clipped row, seeking a later row in the wrong scroll direction, and preview history being empty. The test was corrected to target the visible scroll region. A real duplicate underlying bar was removed. Final screenshots were visually inspected; the compact large-text view remains scrollable with reachable stop controls.
- Existing speech boost/voice consistency, Think aloud, transcription, connection, draft/image, notification, copying/selection and queue regressions remained passing. Larger-text native readback controls use icon-only pause/stop with accessible labels.

## Release and remaining checks

Mac 141 installed at **2026-09-13 22:16:31 UTC**, native-ready in **7.291 seconds**. One running app, source/embedded/loaded runtime fingerprint `a8876f46747c09f349b21545fd783acaf771de7619632111b1e2416adee898e9`; all 13 pre-install Terminal Codex process rows, Assistant conversation/user rules, supervisor state and allowance preferences preserved. App/DMG signed, notarized, stapled and Gatekeeper-verified. No npm publication or unrelated infrastructure change.

iPhone 92 archive app and matching dSYM UUID: `CFCD73B6-447A-3BF2-9D8C-C80A9FC2DEB4`. Upload succeeded at **22:25:26 UTC**; Apple's build upload timestamp is **22:26:12 UTC**. Apple build `206907c8-18d3-4369-809e-8dc6d26cc5dc` is VALID / IN_BETA_TESTING and assigned to ClawDad Internal `bbba6b69-7ac4-4d56-bc41-e9456d56b02e`. Exact testing notes and group membership were read back (`testflight92-evidence.json`). The existing third-party WebRTC missing-dSYM warning remains; the app's matching symbols are retained. No external TestFlight group was enabled. Physical phone installation is not yet verified.

Physical iPhone: verify the installed build, original reported error, complete audible readback of user/agent/long messages, preferred voice/boost, pause/replay/cancel and network/background recovery with a muted/unmuted call. No live phone microphone/call state was changed remotely. The paired phone remained unavailable. Actual iPhone crash cause remains unconfirmed; see `iphone-crash-evidence-2026-09-13.md`.

Unrelated classified paths preserved: release skill copies/plugin metadata, existing build/package/storage scripts, wordmark explorations, `cloud/native/`, `marketing-site/`. No real project drafts, native queues, saved roster membership or research prompts were used as mutation fixtures.

Source checkpoints: `5cf5f24` (Assistant project runtime/tools) and `1c85f95` (iPhone readback, bounded crash evidence and release report). ORP handoff state is `dirty_classified`, nine unrelated paths, zero unclassified, safe to expand. Remaining buckets and next actions:

| Preserved paths | Next action |
|---|---|
| `.agents/skills/clawdad-release/SKILL.md`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Separate integration/release-guidance review; not included in these commits. |
| `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh` | Retain the existing native build/storage lane for its own audited checkpoint. |
| `assets/wordmark-explorations/` | Preserve design exploration pending its design review. |
| `cloud/native/`, `marketing-site/` | Preserve the separate cloud/marketing lane; no deployment in this repair. |

## Physical follow-up

On September 13, Cody confirmed that the project/thread speaker error no longer appears on his iPhone. USB inspection the same evening verified installed iPhone build 92. The separately retrieved actual crash reports identify a notification-completion threading fault; see `reports/iphone-crash-evidence-2026-09-13.md`. This confirmation resolves the previously unanswered exact-error follow-up and does not claim full physical playback or crash-free verification.
