# Research management through the main Assistant — 2026-09-09

Implemented and installed in **ClawDad Mac 0.7.0 build 90**. Cody's existing top-level voice/text Assistant can manage an independent research supervisor for an explicitly selected Terminal process and conversation. Existing iPhone build 77 can use these host tools; this change requires no new iPhone build or relay deployment. All real threads remain opted out.

## Available controls

| Cody's request | Assistant tool | Observed behavior |
| --- | --- | --- |
| Set up research; refine or replace its objective | `configure_research` | Saves the full objective, scope, requirements and evidence paths. `start=false` saves it off; `start=true` explicitly enables supervision. |
| Start, pause, resume, stop or restart it | `manage_research` | Uses the exact saved thread and its current revision. Restart reassesses completed work while retaining past decisions and delivery receipts. |
| Steer the next step | `steer_research` | Records direction within the approved scope and invalidates a pending review. Paused/stopped setups retain that state. |
| Clear its research setup | `manage_research(clear)` | Removes configuration and disables supervision. Keeps history, evidence files, Terminal drafts, accepted queues and running work. Starting again requires configuration. |
| Explain progress or a past decision | `research_status`, `research_history` | Reads the independent supervisor's status and paginated history without interrupting it. |

The Assistant can use an explicit current conversation instruction as approval. It asks for missing intent, target, objective, scope or verification requirements when needed. The existing Workspace controls remain usable.

Stopping supervision leaves running Terminal work intact. Interrupting that agent remains a separate explicitly requested action. The 20% account reserve, stale-usage pause and bounded allowance overrides are unchanged; management tools cannot override the allowance. App-server access and the destination selector remain paused for separate review.

## Findings and implementation

The previous runtime allowed Assistant tools to read research status and history but rejected all research mutations. Only Workspace UI controls could configure supervision. Existing configuration also refused changes while a continuation was running, and decisions were indexed only by source completion, so revising an objective could leave an old concluded decision suppressing its reassessment.

Changes in `lib/research-supervisor.mjs`, `lib/assistant-runtime.mjs`, `lib/assistant-mcp.mjs` and `lib/assistant-coordinator.mjs`:

- Added the three management tools, their schemas, mappings and managed Assistant instructions. Management returns a control receipt so ordinary conversation can continue without polling for research completion.
- Bound each Assistant mutation to the active user-originated conversation request, an exact quoted authorizing passage and the request text's hash. Supervisor output, task-update messages and older history alone cannot authorize a mutation. The Assistant interprets the requested operation; the backend verifies the current user source and quote.
- Required the current setup revision for Assistant changes. Native observation verifies the original process/session before configuration or starting; refreshed catalog IDs can resolve only to that same owner.
- Added recorded objective generations. Configuration changes, steering and explicit restarts invalidate the prior decision without deleting its evidence or receipts. Late review results and delivery errors cannot mutate a replacement objective.
- Preserved running and accepted native requests when changing configuration. Only waiting automatic work belonging to the superseded revision is cancelled. Manual drafts and queues continue to take priority.
- Added stable control receipts and concurrent-request deduplication. Repeating the original request after its conversation ends or after restart retrieves its receipt without applying it again. Reusing an ID with changed arguments is rejected.
- Made cleared configurations readable by existing clients and history views. Kept the ledger backward compatible with previously stored supervisors and decisions.

The conversational coordinator and research reviewer remain separate. No loop waiting for supervisor completion was added to the Assistant's conversational request path.

## Automated verification

**630 runtime tests passed**, with no failures or skips, using the isolated app-server test mode and concurrency 2. The final focused Assistant/runtime/supervisor run passed **87 tests**. Syntax checks for the four changed runtime modules and `git diff --check` passed.

New coverage verifies:

- Configure stopped, start, steer, pause, resume, stop, restart, clear and reconfigure, with retained history and evidence files.
- Clearing or replacing an objective while a review is pending; stale review results never dispatch.
- Changes while a continuation is working or already in the native queue; original receipts and drafts remain protected.
- Superseded waiting requests are cancelled without cancelling newer requests or running/manual work.
- Changed process/account ownership, refreshed catalog identity, stale setup revisions and a stop racing an asynchronous configuration.
- Concurrent duplicate controls, durable restart recovery and receipt lookup after the original conversation ends.
- The shared allowance latch surviving stop, restart, clear and configuration changes.
- Current-user authorization, rejection of supervisor/task-update authority, MCP routing and restricted budget overrides.
- A pending background review while a separate top-level conversation finishes, followed by a conversational clear that aborts only that review. This concurrency case uses the real runtime with controlled model fixtures.

Logs: `native/macos/dist/candidates/assistant-research-management-2026-09-09/runtime-tests-final.log` and `targeted-tests-final.log`.

## Installed live verification

Used the installed Mac runtime, real Assistant MCP tools, the existing top-level Assistant conversation and a disposable Codex 0.153.4 Terminal tab. This did not submit work to Cody's project agents.

- The main Assistant executed nine management mutations: configure stopped, start, steer, pause, resume, replace configuration stopped, restart, stop and clear. Each durable entry was tied to the same authorized diagnostic user request. Final revision was 9, with the configuration cleared and autonomy off.
- The fixture used its own TTY `/dev/ttys015`, session `01a087b3-4509-7130-83a1-45513dd019a5` and verified process identity. An inherited shell title did not substitute ownership of Cody's existing similarly named tab.
- A follow-up was observed as `agent_queued` in Codex's native queue, then accepted into its own turn after the running request completed. Transcript inspection found each accepted fixture prompt exactly once.
- A separate unsent review draft remained byte-for-byte equal through the management sequence. It was cleared through the targeted native draft control only during fixture cleanup and was never submitted.
- Retrying the original clear receipt outside its source conversational turn left the revision unchanged.
- The same top-level conversation answered a subsequent ordinary message; its session ID was preserved. Diagnostic prompts and replies stayed out of visible chat. The nine-action management request took 168.2 seconds in total; the separate short conversational response took 9.7 seconds. These are model/tool timings from this fixture, not iPhone voice latency measurements.
- The original ClawDad agent remained `agentAvailable=true`, `inputState=ready`, with established session `01a06f70-051d-76e2-ab41-0d816990fcd8`. The fresh research tab remained recognizable with an empty draft.
- The disposable tab was closed only after its accepted requests completed. All 14 original Terminal draft fingerprints matched the baseline, and the original selection was restored. All real threads remain unchanged and autonomy remains off.

Evidence under `native/macos/dist/candidates/assistant-research-management-2026-09-09/`:

- `live-management-result.json`: actual conversation receipts, authorizations, nine history entries, native queue/draft evidence and duplicate check.
- `live-cleanup-result.json`: exact-once accepted prompts, unsubmitted draft, target readiness and fixture closure.
- `protected-drafts-before.json`, `protected-drafts-after.json`: original Terminal draft fingerprints.
- `install-90-verification.json`: installed build, native health, source/bundle/runtime hashes and preserved Terminal layout.

One existing native queue limitation was observed: a long file path wrapped inside a token failed the conservative rendered-draft comparison. The guard explicitly sent neither Tab nor Enter. Its original receipt and draft were inspected, then only the disposable draft was cleared; a separate short fixture message was queued successfully. Transcript inspection confirmed the refused text was never submitted. General handling of such split-token queue drafts was not changed in this management patch. Evidence is in `queue-refusal-inspection.json` and the original queue receipt.

Two test-harness corrections were needed during the live run: the clear tool reports `completed`, and the resumed harness needed the saved TTY rather than an out-of-scope variable. Existing receipts were inspected before resuming; setup, insertion and submission steps were not replayed.

## Native release and remaining checks

- Mac **0.7.0 (90)** signed with Developer ID, notarized and stapled; app and DMG both passed Gatekeeper verification. Installed at `/Applications/ClawDad.app`, with one healthy managed app process and matching embedded/runtime source hashes.
- Apple accepted app notarization `02979587-4500-4e6d-95d0-dce9b0c4a839` and DMG notarization `452a29ff-895a-4b8d-b053-397aeae4653b`.
- Private artifacts and the prior build 89 rollback bundle are retained in the canonical candidate directory. No public npm publication, public appcast update or new cloud infrastructure was performed.
- No native iPhone UI, microphone, playback, attachment, draft, link or selection controls changed. Existing iPhone/TestFlight build 77 uses the updated host tools. Physical iPhone checks remain: request these actions through an ordinary voice call and text chat, verify the status/history refresh across navigation, and confirm call/microphone behavior remains comfortable. Automated and Mac live tests do not establish that physical-device experience.

## Workspace checkpoint

Scoped source/tests and this report are checkpointed together. Generated verification artifacts remain in the ignored canonical candidate directory.

Nine pre-existing unrelated dirty buckets are preserved for their existing owners to review and checkpoint separately: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, and `marketing-site/`. They are outside this commit's staged path set. Final hygiene verification is retained beside the release evidence.
