# Assistant call remodel — September 7, 2026

The headset now starts a conversation with compact call controls. A persistent background Codex CLI conversation handles discussion and coordinates the existing native Terminal and computer controls. Starting or reconnecting Assistant no longer creates its own Terminal window or tab.

## Resulting behavior

- One tap starts connecting and listening. Mute, End, and optional Messages/history stay available. Closing Messages or navigating through Remote Assist preserves the call. Ending during connection prevents delayed microphone startup.
- The conversation explicitly uses `gpt-6-astra` with `model_reasoning_effort="low"`. Follow-ups resume the specific saved Codex session ID, never the last arbitrary session. Project-tab agents keep their own model and reasoning settings.
- Local speech recognition and the selected local synthesis model/voice remain the speech path. Completed conversational messages become available before the entire Codex turn finishes and play in order without interrupting preceding speech.
- The Mac publishes its shared Terminal inventory independently of conversation startup. Duplicate directory names retain distinct tab IDs. Project requests use the existing native Terminal delivery controls and durable receipts. The background coordinator does not dispatch project work through Codex app-server turns.
- Both clients check the host's `conversationMode: "background"` capability before starting. An older Mac produces an update instruction before it can receive a legacy Terminal-launch request.
- Legacy Assistant messages/tasks remain saved. Legacy Terminal coordinator bindings are set aside; existing user windows are left untouched.

## Implementation

`lib/assistant-coordinator.mjs` owns the bounded CLI subprocess, persistent conversation identity, explicit model settings, private diagnostics, and exclusive conversation lock. It passes the exact user message through stdin with `shell: false`. The coordinator uses a read-only shell sandbox and the required ClawDad Assistant MCP bridge for authorized computer/Terminal actions.

`lib/assistant-runtime.mjs` now runs conversational jobs separately from the native action queue. Native polling cannot claim start/message jobs, so a coordinator can await a native tool receipt without blocking the worker needed to produce it. Durable delivery IDs prevent retries from silently duplicating project submissions. Interrupted or uncertain work remains visible for inspection.

`MacAssistantBridge.swift` contains only the existing native actions and inventory publisher; its generated Terminal-launch script and legacy launch/binding helpers were removed. iPhone and web Assistant controllers provide compact call controls, optional text/history, ordered speech playback, and navigation behavior.

No telephony provider, new cloud compute, or cloud storage was provisioned. Conversation inference uses the Mac's existing signed-in Codex account; speech processing stays on the Mac.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Full Node/runtime suite | PASS: 524 tests | `runtime-tests.log` |
| Focused coordinator/runtime suite | PASS: 23 tests, included above | `targeted-tests.log` |
| Mac Swift package | PASS: 167; six opt-in live Terminal tests skipped | `mac-tests.log` |
| Mobile Swift package | PASS: 101 tests | `mobile-tests.log` |
| Shared protocol package | PASS: 61 tests | `protocol-tests.log` |
| iPhone simulator Assistant UI | PASS: three tests | `ui-tests-fixed.log`, `assistant-ui-fixed.xcresult` |
| Desktop browser Assistant controls | PASS using synthetic workspace and microphone | `ui-evidence/mac-browser-results.json` |
| Actual signed-in Codex CLI and MCP | PASS: saved identity resumes and synthetic selected tab is read correctly | `cli-smoke-results.json` |
| Native releases and running Mac | PASS | `install-verification.json`, `testflight-release.json` |
| Source, installed bundle, active runtime | PASS: seven changed runtime files match by SHA-256 | `runtime-source-verification.json` |

Evidence files are under the ignored canonical directory `native/macos/dist/candidates/assistant-call-2026-09-07/`.

The actual CLI smoke returned its first completed response in 5.94 seconds on a new conversation and 5.25 seconds on resume. A subsequent MCP workspace lookup emitted an initial conversational message at 5.35 seconds and its final answer at 14.07 seconds. These are text timings from synthetic requests, excluding microphone capture, transcription, and TTS. They establish that the real CLI configuration and bridge work; they do not establish physical phone call latency.

The subprocess fixture suite covers twenty repeated starts without a Terminal launch, persistent session identity, exact input, duplicate request IDs, delayed inventory, same-directory tabs, native work during a conversational turn, early/ordered messages, exclusive ownership, shutdown, mismatch rejection, failure recovery, and legacy migration.

Simulator and browser checks cover the compact start flow, optional chat, distinct target rows, Back/Escape, mute/end, and hangup during connection. Screenshots were inspected. The browser fixture deliberately replaces the main workspace data and microphone; it does not exercise the real microphone or Terminal input.

An initial simulator run exposed duplicate call bars and a preview refresh problem; both were corrected before the final passing run. The release check also caught the catalog still naming build 53; catalog and testing notes now match 54, and the final full runtime suite passes.

## Private release

- Mac: version `0.7.0`, build **68**, installed at `/Applications/ClawDad.app` and running as one native app process. Signature, staple, Gatekeeper, local health, Remote Assist capability, and background Assistant capability pass. The native bridge reports online.
- Final notarization: `2a5a5195-849e-410a-98b6-d58f5fd87fe8`, accepted. Executable SHA-256: `e17cf354ca56cc118de94d267f2a84858dea20a739c07167fcc746630bea80c6`.
- Embedded runtime bundle marker: `b70aee9fc0078720cde7dff8aded2ffe95eda4c9890045e95a9459e4aab61916`.
- Prior Mac build 67 is retained in the candidate directory as `ClawDad-Mac-67-rollback.app` with its original executable hash verified.
- iPhone: version `0.7.0`, build **54**, App Store Connect build `ab96f141-1892-4a00-b7be-eb710691c7af`, processing `VALID`, assigned to **ClawDad Internal**, state `IN_BETA_TESTING`. Build-specific test instructions were verified after saving.
- The upload reported the existing missing WebRTC dSYM warning; the archive and upload succeeded. This limits symbolication for that prebuilt framework.
- No external TestFlight submission, public appcast/npm publication, App Store submission, or public GitHub release was performed.

## Remaining hands-on check

Update the physical iPhone to TestFlight build 54. Start and end several calls, have a short spoken exchange, send a typed follow-up, navigate in/out of Remote Assist, and ask for a harmless action in a disposable project tab. Confirm no new Assistant Terminal window, correct tab routing, and acceptable audible response timing.

Physical microphone-to-Terminal delivery and audible playback remain unverified in this run. Terminal GUI automation was unavailable to this agent; no alternate Terminal control path was used to bypass that restriction. The real CLI smoke used synthetic MCP inventory and rejected all mutations.

## Preserved workspace changes

This implementation is committed as one scoped change on `codex/hermes-hybrid-supervisor-ui`. The following eight existing paths/groups remain intentionally dirty and outside the commit:

| Paths | Classification and next action |
| --- | --- |
| `.agents/skills/clawdad-release/SKILL.md`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Existing release-skill revisions; reconcile in the plugin/release workflow lane. |
| `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Existing plugin metadata change; review and commit with its plugin update. |
| `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh` | Existing storage/build workflow changes; audit and commit together in their original lane. The current local build workflow was used for this private candidate. |
| `assets/wordmark-explorations/` | Existing design artifacts; curate in the branding lane. |
| `marketing-site/` | Existing marketing-site work; review and release separately. |

ORP hygiene reports these paths classified with zero unclassified paths. Historical local commits remain on the existing branch; this private native release does not publish them wholesale.
