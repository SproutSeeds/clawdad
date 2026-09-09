# Assistant app-server access and destination selector audit

September 9, 2026. **Discussion checkpoint; no app-server tools, routing changes, or destination selector have been implemented.**

ClawDad can build the requested access using its existing authenticated Mac service, but it needs a complete inventory and an explicit live-owner check before it can safely control a thread. The current Terminal agents are standalone Codex runtimes. Reading their saved histories through the shared app server does not transfer control of those agents.

## Scope and evidence

The audit inspected the installed Codex 0.153.4 schema, ClawDad source, local indexes and rollout headers, process/file ownership, and the existing shared app-server socket. It issued only `initialize`, `thread/list`, `thread/loaded/list`, `thread/read`, `thread/turns/list`, and `thread/items/list` RPCs. No test messages, resume/start/steer/interrupt requests, Terminal focus/input operations, or draft edits were sent to working threads. `inspect_tab` was deliberately avoided because its native implementation focuses the tab. `/v1/projects` was also avoided because its GET handler performs auto-import; workspace configuration was read through `/v1/workspace` instead.

Private evidence is under `native/macos/dist/candidates/assistant-controls-images-2026-09-09/audit/`: `live-inventory.json`, `database-inventory.json`, `terminal-ownership.json`, `other-app-servers.json`, `clawdad-tracked-inventory.json`, `workspace.json`, `read-verification.json`, `audit-summary.json`, and the installed `schema/`. These files contain local identifiers and paths; they are not publication assets.

The API calls left the shared server's loaded-thread inventory empty. A later index comparison nevertheless observed **90 `history_mode` changes from legacy to paginated**, with no changes to the compared cwd/archive fields. Two additional index rows appeared while other agents were active. The audit did not request migrations; provider normalization and concurrent consumers prevent attributing every metadata update to a particular call. Therefore “read API” is evidence of no requested task execution, not a guarantee that the provider leaves its index bytes unchanged. Further live enumeration stopped after this observation. A future strict read-only inventory should use SQLite read-only snapshots and read-only file metadata, and test provider migration behavior on disposable copies before invoking legacy history APIs.

Official documentation describes reading history separately from loading a runtime, cursor pagination, explicit remote Terminal attachment, and active-turn steering. The installed schema and live responses take precedence where their available fields differ from newer documentation. [OpenAI app-server documentation](https://developers.openai.com/codex/app-server)

## Complete inventory of the inspected home and endpoint

Snapshot counts are time-specific; ongoing user work can create additional records.

| Surface | Observed inventory | Coverage implication |
| --- | --- | --- |
| Shared server, all explicit source kinds, all providers, nonarchived | **161 threads**, 2 pages of up to 100 | Completed pagination to a null cursor. Sources: 54 CLI, 6 VS Code, 9 exec, 92 subagent records. |
| Shared server, default source filter | **60 threads** | Default interactive filtering omits exec and subagent records. It cannot be the complete inventory. |
| Shared server, archived filter | **0 threads**, terminal cursor | Explicitly paginated separately; zero returned does not prove the local index has no archived records. |
| Shared server loaded threads | **0 before and after reads** | This is scoped to that app-server process. Twelve Terminal agents remained alive independently. |
| Local `~/.codex/state_5.sqlite` | **3,391 records** initially; 3,390 nonarchived and 1 archived, 185 distinct stored directories | 518 CLI, 100 VS Code, 2,144 exec, 629 subagent records. Index records alone do not establish available history or resumability. |
| Existing rollout files among those index rows | **167** | 161 were API-listed; **6 retained files were omitted from the API list**. |
| Missing rollout paths among those index rows | **3,224** | 3,132 initially legacy and 92 paginated. A missing source can also invalidate paginated lineage. Do not delete these records or advertise them as resumable automatically. |
| ClawDad tracking state | **93 project entries / 539 session records** | 535 Codex, 3 Chimera, 1 unspecified provider; 134 quarantined and 43 unseeded records. These are tracking records, not 539 available live agents. |
| API-listed records already tracked by ClawDad | **34 of 161** | 29 CLI and 5 VS Code. The other 127 include 25 CLI, 1 VS Code, 9 exec and 92 internal subagent records. |
| Actual Terminal catalog | **13 tabs in one physical window**, 12 Codex primary sessions and one ordinary shell | Nine of the twelve current Codex sessions were tracked by ClawDad; all twelve exact IDs were in the shared server's saved-history list. |
| ClawDad workspace roots | Primary and only configured root: `/Volumes/Code_2TB/code` | Codex's local `projects` and `project_roots` tables were empty. ClawDad workspace configuration and thread cwd are separate models. |

The six list omissions were checked by exact ID with `thread/read`. All returned summaries. Full history returned two completed subagent turns with 33 and 31 items, one interrupted turn with no items, and three empty histories. Thus at least some omitted records contain readable work; a zero-item record needs a distinct empty/unavailable classification. The archived record returned a summary but failed full read with `thread not loaded`. A missing-source paginated sample failed full read with `invalid paginated history lineage … missing source rollout`. Neither was resumed to investigate.

Full cursor traversal of the Assistant's stored conversation returned **133 turns across 6 pages and 514 items across 21 pages**. The disposable image-verification conversation returned 4 turns and 8 items. Reads did not load either conversation into the shared server. Larger `thread/read(includeTurns: true)` requests were curtailed in favor of bounded pagination; full history on every active Terminal session was unnecessary for ownership mapping.

### Directory and source limitations

All 161 API list entries and the 20 exact-ID summary reads reported the same cwd: `~/Library/Application Support/ClawDad/runtime`. Local index records and rollout headers correctly identified different project directories. This is a confirmed discrepancy in this running endpoint's metadata; its root cause is not established by this audit. **Do not route by the API cwd until it is reconciled with verified local metadata.** A matching directory never identifies a unique thread anyway.

`source` describes origin, not current ownership. An exec conversation without a Terminal tab, a saved CLI conversation whose tab closed, and a thread currently loaded by an app server all need separate classifications. Filtering only `source=appServer` would miss useful histories; no such source was returned in this snapshot. The 149 listed records outside the twelve current Terminal sessions include 92 internal subagents, 42 other CLI histories, 6 VS Code histories and 9 exec histories. Internal/diagnostic records should be discoverable through explicit filters while remaining outside the normal user task feed.

The current ClawDad importer queries nonarchived CLI/VS Code records, optionally exec, with an SQL **2,000-row cap before directory filtering**. Default import candidates are limited to 12 and mobile recent threads to 20. The iPhone history path starts at cursor 0 with a bounded requested limit rather than exhausting provider pagination. None of these convenience lists is a complete account inventory. The importer also does not establish that each indexed rollout still exists.

### Other app-server processes

The shared socket's process was PID 1273, mapped to `/opt/homebrew/Caskroom/codex/0.153.4/bin/codex`, using `~/.codex/state_5.sqlite`. Six additional bundled ChatGPT `codex app-server --listen stdio://` children belonged to `cua_node/bin/node_repl` processes beneath current Terminal agents. They exposed no shared socket, state-database handle, or open rollout file in this inspection. These are separate tool-owned processes, not evidence of six extra user workspaces. Their private stdio streams were not attached to or commandeered.

This audit covers the configured home, retained local records and accessible endpoint. Ephemeral/in-memory work in another owner's private process, deleted history, another account/Codex home, or another host is not enumerable through this socket. Future access must identify each authorized provider home/endpoint explicitly and disclose unavailable sources instead of claiming global completeness.

## Thread identity and live ownership

| Identifier | Meaning and required use |
| --- | --- |
| Paired computer + provider home | Host/account namespace. Include it in destination keys, permissions and receipts. |
| App-server `thread.id` / rollout `session_meta.id` | Exact conversation leaf. The current Terminal tools call this value `sessionId`. Compare exact IDs, not names or paths. |
| App-server `thread.sessionId` | Schema describes a session-tree identifier. Do not substitute it for the exact leaf or merge sibling/subagent/fork records. |
| Native tab ID | Current catalog handle. It can change after host restart; re-resolve with the catalog generation and observed TTY/session binding. |
| Physical window ID + tab order | Native AX grouping, independently verified. Terminal's AppleScript “window” enumeration reported one logical window per tab here and is unsuitable for physical grouping. |
| TTY + owning PID/start time + exact rollout ID | Evidence that a specific native tab owns a standalone agent. Recheck before mutation; PID/TTY reuse invalidates stale receipts and edit tokens. |
| App-server endpoint + process generation + loaded thread/turn ID | Evidence of server-owned execution. `notLoaded` says nothing about a standalone Terminal agent's busy state. |
| Request ID + accepted turn ID | Delivery identity and result association. Keep distinct from conversation identity and from native queue acceptance. |

The twelve observed standalone owners follow. These are a snapshot, not permanent routing addresses. The complete file metadata and catalog are retained in private evidence.

| TTY | Owning PID | Exact thread ID | Initial rollout directory |
| --- | ---: | --- | --- |
| ttys000 | 99844 | `01a081a5-9262-7f82-8c1c-ba164e698cfd` | contract-work-search |
| ttys001 | 5084 | `01a06f86-95ab-7ed0-aa7d-650e8cafa58d` | erdos-problems |
| ttys002 | 2557 | `01a06f72-58e3-7360-806c-a612d360229d` | secure-research-readiness |
| ttys003 | 53616 | `01a0817a-a8cb-7c03-b05d-2c37832d6710` | ascension-free-pick |
| ttys004 | 88544 | `01a06fec-55cc-7d82-b52c-dcab2a002ac4` | youtube |
| ttys005 | 7164 | `01a07a1c-b7a2-7141-92cc-a01743634088` | RoomWave |
| ttys006 | 51503 | `01a07a41-f0b9-70b2-ab5a-d417674b9d72` | code |
| ttys007 | 11820 | `01a08272-127e-7303-9c7b-60f078245ab1` | code; stored current cwd later became singularity-atlas |
| ttys008 | 49949 | `01a06f51-d3f3-7fb0-9c90-86d9e7dc5d9e` | resume-job-search |
| ttys009 | 45952 | `01a06f8b-22b4-7483-9ae8-725df0a5d94f` | contract-work-search |
| ttys010 | 41580 | `01a06f70-051d-76e2-ab41-0d816990fcd8` | clawdad; this implementation conversation |
| ttys013 | 69805 | `01a07e4c-81f2-7460-91b7-82c333bcefb7` | code |

Each process had an exact CLI-origin rollout open and no `--remote` argument. No two primary owners in this snapshot shared a leaf ID. Current tab display names and directories can change and are not stronger evidence than the live binding.

The top-level Assistant is a separate background `codex exec` / `exec resume` conversation, currently `01a07f22-5a5f-7470-ab36-3c8fa6affaa9`. It invokes native Terminal tools through the local MCP bridge. Its conversation is not an extra Terminal tab and is not a turn owned by the shared app server. Its saved history is nevertheless readable there.

ClawDad already has an **Open in Terminal** launcher that can explicitly launch `codex --remote <shared endpoint> resume <id>`. That architecture can produce a Terminal UI and app-server client sharing one runtime. The twelve existing agents are not running that way. Do not retrospectively label them shared, or reopen them with `--remote` while their original owners remain active. Explicit remote terminal attachment is documented; safe ClawDad multi-client behavior still needs disposable end-to-end validation. [OpenAI remote Terminal and app-server protocol](https://developers.openai.com/codex/app-server)

## Capability matrix

“Missing” below means missing from the Assistant's native tool interface, even when a human-facing ClawDad path already exists. Proposed names are design recommendations, not newly callable tools.

| User action / surface | Existing manual/native path | Current Assistant coverage | Concrete app-server extension needed |
| --- | --- | --- | --- |
| Choose host and workspace/project | Paired computer selector; workspace root/directory controls; `/v1/workspace` | `workspace` lists Terminal tabs, not the full project/thread inventory | `list_workspaces` and `list_threads` scoped to the authorized host/home; merge tracked state, provider pages and read-only index evidence with provenance. |
| Find any thread, including older, archived and app-server-only | Project/recent pickers, import candidates; bounded history lists | Exact Terminal catalog plus its response context | Cursor pagination, all source/provider/archive filters, searchable stable IDs, explicit internal/diagnostic filter, unavailable-history states. |
| Read a thread or latest result | `/v1/history`, history.request, Terminal response reader | `inspect_tab`, `read_terminal_context`, task results | `read_thread` / `read_thread_turns`, bounded item pagination without resume; preserve attachment references and result-turn association. |
| Create a new thread in a project | `/v1/sessions`; provisional local ID may precede provider thread creation | `new_terminal_tab` creates an observed native tab | `create_thread` with exact workspace, model/permissions and stable request ID; distinguish local draft identity from a verified provider ID. No creation on mode switch. |
| Resume existing work / open in Terminal | Shared dispatch `thread/resume`; optional remote Terminal launcher | Existing exact tabs can be targeted; no app-server resume tool | Owner check and per-thread lease before resume; return exact runtime/thread identity. Explicit handoff only after the previous owner is released. |
| Type/clear/replace a reviewable draft | Main app composer is client UI state; native Terminal composer has verified editing | Native agent and supported shell draft tools, explicit replacement authorization | An app-server draft is an application-owned draft resource, not an RPC turn. Add `get/set/clear_thread_draft` with revision tokens, attachments and destination binding; never emulate it with turn/start. |
| Submit a new request | Main app Send (Direct/Queue), message.send → `/v1/dispatch` | `send_to_tab`, explicit Enter/key tools | `send_to_thread` with stable receipt and exact target; reuse authorized dispatch/approval controls after fixing ownership guards. |
| Add input while working | Native Tab queue; app-server Direct steering; ClawDad deferred Queue | `insert_in_tab`, `queue_in_tab`, `queue_tab_draft` | Separate `steer_thread` and `queue_thread_followup` semantics; no blanket “queue accepted” label for a local wait. |
| Send images | Main composer attachments → stored manifest → `localImage` model input; Assistant image upload fixed separately | Chat images and native Terminal image attachment tools | Reuse local retained files and hash-verified manifests; image-only input, retries and follow-up references bound to the exact app-server request. |
| Observe busy/queued/completed/error and open results | Status/history, tracked mailboxes, streamed app-server events, native queue receipts | `task_status`, existing readable task cards | Owner-aware task registry using thread + turn + request IDs, item/delta/completed subscriptions, reconnect reconciliation and updates to the original card. |
| Cancel pending work / interrupt working turn | Existing dispatch/delegate and app-server interrupt paths; Terminal special keys | Waiting-delivery cancellation and authorized native controls | Distinct cancel-before-delivery and interrupt-accepted-turn tools; require owner/turn confirmation and preserve already-accepted queues unless explicitly targeted. |
| Rename/archive/unarchive/delete | Main desktop session title/delete controls; installed provider archive/unarchive/delete APIs | Terminal close has its own native confirmation; no thread lifecycle tools | Explicit authorized lifecycle tools after identity/ownership checks, existing confirmations, clear distinction between hiding tracking, archiving history and irreversible provider deletion. |
| Approve a protected action | Native permission prompts and main app approval.decision | Existing user-owned permissions and Mac control pause | Relay pending approval identity to Cody. Tool access must not grant itself permissions or convert a destination choice into approval. |
| Models, reasoning, goals and workspace restrictions | Main app settings and dispatch configuration; provider goal/model APIs | Existing configured Assistant model and Terminal tools | Expose supported discovery/configuration only through current permissions; pin actual request settings and avoid hidden changes to user prompts. |

Representative source locations: `lib/assistant-mcp.mjs`; `native/macos/Sources/ClawDad/MacAssistantBridge.swift`; `lib/cloud-host-connector.mjs:1250`; `lib/server.mjs:17374`, `:21738`, `:25303`, `:25516`; `lib/codex-session-discovery.mjs:305`; `apps/ios/ClawDadMobile/Sources/ClawDadMobile/CloudClient.swift:1250`, `:1316`, `:1412`; `lib/codex-app-server-dispatch.mjs:308`, `:2249`, `:2624`. See also [the implemented Remote Assist tool inventory](../docs/assistant-remote-control-coverage.md).

## Queue semantics: support, evidence, unknowns

| Operation | What it actually means | Evidence / limit |
| --- | --- | --- |
| Native `insert_in_tab` while busy | Paste a verified draft; agent keeps working; neither Enter nor Tab is pressed | Existing native implementation and prior disposable live tests. The draft is not a submitted task. |
| Native `queue_in_tab` / `queue_tab_draft` | Press Tab once against the verified current binding; observe the agent's own queue entry and subsequent ordered turn | Prior installed Codex 0.153.4 tests observed original work followed by two queued turns, one delivery each. This audit did not enqueue new live work. [Verification report](assistant-tool-parity-2026-09-08.md) |
| App-server `turn/start` | Start a new turn in a loaded/owned thread | Installed schema and existing ClawDad dispatch. An RPC receipt/turn ID establishes acceptance, not completion. |
| App-server `turn/steer` | Add input to the currently active turn; requires `expectedTurnId`; creates no new turn | Documented and present in installed schema. Existing automated shared-dispatch tests verify expected-turn and stable-request handling. It is not the Terminal's deferred Tab queue. [OpenAI steering semantics](https://developers.openai.com/codex/app-server) |
| ClawDad app-server Queue mode | Wait locally for the active turn to finish, then call turn/start | Confirmed by `routeSharedTurn`. While waiting, this is **waiting for delivery**, not native queue acceptance. Existing queue worker state and request reconciliation support recovery. |
| Shared remote Terminal UI + API client | Both can address the same app-server-owned thread when deliberately attached to that server | Documented architecture; ClawDad has the remote launcher. Native Tab acceptance/order and cross-client draft behavior for this topology were **not tested live here**. |
| App-server mutation of a currently standalone Terminal-owned thread | A resume could establish a second runtime reading the same saved history | **Unsafe to assume shared control.** No cross-runtime queue/steer test was performed and no documented native queue bridge was found. Route through the existing native Terminal owner instead, or require an explicit verified handoff. |
| Standalone Terminal resuming an app-server-owned thread | Another independent owner unless launched through the same remote endpoint | Same duplication risk in the opposite direction. A fresh ordinary `codex resume` is not a safe transfer. |

The installed protocol has no dedicated deferred native queue RPC and no general persistent composer-draft RPC. Sending special keys to a terminal and calling app-server methods remain separate operations. Shared files/history may converge after writes, but do not synchronize unsent input, pending queues, active tool state or control ownership automatically.

## Gaps that must precede write access

1. **Complete, honest inventory.** Merge cursor-complete API results with read-only local tracking/index evidence; distinguish readable, empty, archived, missing-source, quarantined, internal and live-owned records. Root/source/page limits must be visible. Resolve the cwd discrepancy and migration behavior before trusting provider summaries as routing metadata.
2. **Check ownership before resume.** Current seeded dispatch invokes `thread/resume` before acquiring a delivery claim. Its reconnect path also resumes. A shared-server `notLoaded` response is not permission to resume a leaf held by a standalone Terminal process.
3. **Add a canonical single-writer lease.** `codexDeliveryClaimKey` hashes thread ID + request ID and stores the claim under the project mailbox. It prevents duplicate delivery of the same request among cooperating processes, but different request IDs or project aliases do not provide a thread-level ownership fence. Use host/provider-home/leaf identity, owner generation, liveness and compare-and-swap fencing before dispatch, resume, handoff or reconnect. Retain the existing per-request deduplication too.
4. **Track delivery stages truthfully.** Persist destination + request ID + payload/image hashes before delivery. Reconcile an uncertain receipt by exact client message/turn identity; never replay merely because a connection dropped. Distinguish draft, waiting for delivery, native queued, accepted server turn, working, completed and attention. Preserve FIFO for deferred requests to one target.
5. **Keep drafts and attachments out of implicit routing.** Use versioned, destination-bound drafts. A mode change cannot consume, edit, move or send them. App-server-only drafts need their own application storage; the protocol cannot inspect a standalone Terminal draft.
6. **Respect provider and user controls.** Do not seize another app's stdio process, silently choose isolated mode, alter sandbox/approval settings, import quarantined records, enable the microphone, or fall back to a different destination on failure.

## Proposed persistent destination selector — for Cody's decision

Use two adjacent icon buttons in the call bar: **Terminal** and the **ClawDad claw**. The selected icon has a steady filled treatment, outline and checkmark, plus an accessible name/value. Keep the messages button, infinity, microphone, interject when needed, and hang-up controls. At small sizes, use an accessible two-row layout rather than reducing the 44-point tap targets.

- **Terminal selected:** authorized work uses an existing exact native tab, or creates a tab only when Cody requests one. The Assistant may read other saved context, but work receipts show the actual Terminal destination.
- **ClawDad selected:** authorized work targets an existing exact app-server thread or an explicitly requested new one. Saved Terminal-owned histories can be read, with a clear “Open in Terminal” ownership state. Mutations wait for an explicit destination override/handoff; they never resume a second owner automatically.
- Persist selection per paired Mac and Assistant conversation across navigation/reconnect. Include it as explicit structured conversation context, separate from Cody's literal words. Freeze it with each submitted request so later switching cannot reroute a model turn, draft delivery or queued task already underway.
- An explicit user target overrides the default for that action, with the resolved destination shown in the resulting card. It does not silently change the selector. Ambiguous same-name tabs/threads require clarification using readable labels and exact IDs.
- Switching modes itself performs **no create, resume, move, send or replay action**. Typed drafts, attachment files, chat history, running work and result-card associations survive. A draft already bound to a destination stays there until Cody deliberately changes it.
- Replace routine “Listening/Hearing you” text in the bar with the selector. Keep actionable reconnect/permission/paused-control notices in the conversation header and an accessible persistent attention indicator with a direct recovery action. Keep visible microphone-off state; removing routine text must not hide a disconnected or muted call.
- Add the two selector icons and their precise behavior to the Settings glossary only when this phase is implemented. They are intentionally absent from the current glossary.

The simplest ownership policy is to keep existing standalone Terminal agents on their native paths, while giving app-server-owned or safely dormant threads a separate ClawDad path. A later opt-in migration to shared remote Terminal UIs could unify live control, but requires a separate validated handoff and should not happen merely to select an icon.

## Concrete implementation and verification plan after review

1. Build the read adapter and inventory schema with provenance, complete cursors, explicit archive/internal/provider filters, stable leaf IDs, verified cwd/root membership and availability reasons. Test more than 2,000 index rows, more than one API page, omitted retained files, missing ancestors, empty/archived histories and multiple homes. Test provider read-side normalization on copied fixtures.
2. Add owner registry/leases and versioned app-server drafts. Test two independent Terminal owners, one deliberately shared remote Terminal, process/TTY reuse, stale catalogs, different project aliases, unseeded ID remapping, archived/missing history and disconnected hosts. A refused mutation must leave all drafts/queues untouched.
3. Add authenticated Assistant-native discovery/read/create/resume/draft/send/steer/deferred-queue/status tools, then lifecycle operations under existing confirmation rules. Update owned tool instructions without rewriting user-authored prompts. Real harmless disposable fixtures must verify exact IDs, image-only/model delivery, FIFO follow-ups, failure/reconnect reconciliation and one execution per stable request ID.
4. Wire task events and readable results back to the original request card. Test restart recovery, late tool results, duplicate events, wrong-thread approvals, queued versus working state and large history pagination. Diagnostic fixtures stay in diagnostics.
5. Add the reviewed selector and glossary entries. Test switching during listening, Think aloud, mute, image import, unsent text, pending delivery, active work and disconnected states. Verify the selected context is frozen at submission and explicit user targets win without silent rerouting.
6. Run isolated shared-remote-terminal tests before claiming cross-client queue support. Verify actual Tab binding, queue acceptance/order, API steering, draft preservation, observation from both clients and restart ownership. Until that passes, report those semantics as unverified and preserve native routing.
7. Perform physical iPhone checks for compact layouts, larger text/VoiceOver, navigation, actionable recovery notices, image-only follow-ups, and hands-on confirmation that mode switching leaves work untouched.

**Decision requested:** approve the two-destination selector with native ownership preserved, then implement the inventory/ownership foundation before enabling app-server writes. No change in this phase is included in the controls/image release.
