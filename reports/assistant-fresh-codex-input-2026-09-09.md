# Fresh Codex Terminal input repair

September 9, 2026. Native Mac implementation and verification. App-server access and the Terminal/ClawDad destination selector remain paused.

## Confirmed cause

The research tab was a real foreground Codex 0.153.4 process, PID 48697, on `/dev/ttys012`, in `/Volumes/Code_2TB/code/research-system-experiments`. Its normal idle composer was visible. The process had no open rollout JSONL and the read-only Codex `state_5.sqlite` thread query for this directory returned no row. This installation persists the usable conversation history on the first submitted turn. Waiting or refreshing could not supply a transcript that did not exist yet.

`MacAssistantBridge` previously required `MacTerminalResponseReader.resolve()` to return a real session/rollout before inspecting, inserting, editing or sending. It converted resolution failure into `agentAvailable:false` and the generic idle-input error. `MacAssistantTerminalInput` similarly classified this fresh agent as an unknown native input. Picker discovery and composer readiness used different criteria.

The research process was launched through Cody's shell function as `/opt/homebrew/bin/codex -c features.code_mode_host=true`. Node helpers inherited the TTY but had separate process groups. The mapped executable, rather than the launch symlink or title, verified version 0.153.4. The helper names and supported composer renderer were not the cause of the reproduced refusal.

## Implemented behavior

- A native input binding identifies the exact foreground Codex PID, start time, process group, TTY and mapped executable. `agentInstanceId` is a process identity, distinct from a Codex session UUID. Directories remain descriptive metadata and never select another conversation.
- A supported, fully observed composer is eligible before its first turn. `inspect_tab` returns `agentAvailable:true`, `inputState:ready_before_first_turn`, `historyState:awaiting_first_turn`, its process identity, and a normal inspected draft token. Its real `sessionId` and `conversationPath` remain null.
- `insert_in_tab` accepts that fresh `agentInstanceId` or an inspected existing `sessionId`. It verifies one exact native paste without Enter or Tab. Existing visible, multiline and collapsed draft edit protections apply before and after first submission. Attachments and ambiguous/clipped inputs retain their guards.
- `send_to_tab` accepts the inspected process identity and requires it before a first turn. The native worker persists its receipt before input. After authorized Enter, background read-only discovery links only the same process's open rollout to the original receipt. A slow first transcript never triggers another paste or Enter. Existing native Enter controls remain separate and can submit a reviewed draft.
- Native Tab queuing continues to require a real working turn, exact session, verified running version and observed queue entry. Fresh idle input does not pretend to be a working queue. Waiting, inserted, submitted, native queued, working and completed receipts retain their separate meanings.
- Session adoption is monotonic: a fresh binding can acquire its real rollout; a known session cannot disappear or change within an inspected action. Process restarts and stale picker IDs require fresh inspection. Changed process bindings end unresolved tracking with an attention receipt; no automatic rerouting or replay occurs.
- Startup/trust/sign-in/loading, unknown foreground programs, unsupported versions, suspended/background agents, multiple owners and changing or incomplete session files have specific diagnostic states. The normal composer, current Accessibility/lock checks, explicit user actions and interaction cancellation remain required.
- Assistant MCP descriptions, schemas, managed Terminal instructions and native shell/agent classification expose the new identity correctly. Read Aloud still requires an actual completed response.

## Automated verification

Evidence: `native/macos/dist/candidates/assistant-fresh-codex-2026-09-09/`.

- `runtime-full.log`: **583 tests passed**. Three added runtime regressions exercise fresh durable preparation, duplicate requests, worker/runtime reconnect, delayed first-session adoption, wrong TTY/instance rejection, timeout reconciliation, process replacement, fresh clear receipts, and rejection of native queue requests without a working session.
- `native-final.log`: **226 tests executed; nine opt-in live checks skipped; zero failures**. New binding tests cover absent history, same-directory files that must not be borrowed, wrappers/inherited TTY helpers, multiple/suspended/background owners, process start-time/TTY changes, a process changing during inspection, mapped executable version, partial/multiple rollouts and one-way session adoption. Existing composer, multiline/collapsed editing, attachments, stale tokens, busy input, native queue and permissions tests passed.
- `binding-tests.log`: all seven binding tests passed separately with the process-only research inspection explicitly enabled. It neither selected nor typed into that tab.
- `codex-doctor.json`: repository Codex doctor passed. The broader session-registry doctor reported pre-existing cross-project problems (93 projects, 305 findings, 39 active blockers, 266 historical findings). No broad registry repair, migration or app-server resumption was performed; it would not create the fresh process's missing first rollout.

## Installed/live evidence

Mac **0.7.0 (85)** is signed, notarized and installed. The release pipeline kept its appcast and artifacts local. `install-85-verification.json` verifies the executable hash, bundled/installed runtime source hashes, health, native availability and preservation of the 14 original tabs in one window. Existing Assistant workspace instructions outside the managed tool section were retained. Build 84 is retained as the rollback artifact.

`research-installed-85.json` verifies the actual research tab as ready and editable with an empty draft, no session ID and the same process identity captured before installation. The Mac restart changed its picker ID from `ffd9e49c-aad6-452d-9fcc-d9c1d368d947` to `226b2488-e93d-4a35-825f-3f99d9e58c33`; using the stale ID was safely rejected. The replacement was verified through the original TTY and process binding, not inferred from its directory. No research text was inserted or submitted.

Disposable fixtures used `/private/tmp/clawdad-fresh-session-DzgLN7` and separately owned native tabs. Internal test jobs use the diagnostic channel, preserving ordinary Assistant chat presentation. Before the first submitted turn, live tests passed exact first-draft insertion, duplicate receipt retrieval, preservation of an existing draft, long Unicode collapsed replacement, explicit whole-draft clearing and exact empty readback. A second same-directory fresh process retained its own independent draft, and an attempt to use the other process's binding was rejected.

One queue attempt stopped on the existing input-change fence with its draft intact. Its receipt remained uncertain and was never replayed. Inspection showed no accepted follow-up, and the disposable draft was explicitly cleared before an independent queue test. Both queue APIs subsequently returned verified native queue receipts. The original and two follow-ups completed in three distinct turns, in order, with one authoritative user-message record per request. Completion times were 15:40:25.936, 15:40:30.890 and 15:40:35.265 UTC; each follow-up started after its predecessor completed.

| Live check | Observed evidence |
| --- | --- |
| First Enter and real history | The first fixture submission completed with its expected marker. `reconciled-ccf1ca4b-ba2d-4fad-8ba4-d07e88baa57a.json` links the original fresh process receipt to its newly persisted session. |
| Busy draft and two native queue paths | `live-queue-checkpoint.json` and `live-queue-completed.json`: rendered queue acceptance for existing-draft Tab and insert-plus-Tab; three unique completed turns; stable-ID retries did not add messages. |
| Separate Enter | `live-separate-enter.json`: the second same-directory process retained a draft with no session, then one explicit native Enter submitted it. The original inserted receipt acquired that process's distinct session and completed with its exact expected answer. |
| Restart and stale identities | `live-restart.json`: stopping only the completed, empty fixture and relaunching in the same TTY produced a new process identity and null session. Both existing same-directory sessions stayed separate; stale process/session arguments were rejected with the composer empty. A native Control-L redrew residual shell output after fixture termination before its empty shell input was used. |
| Explicit directory trust | `trust-pending.json`, `trust-fixture-result.json`, `trust-first-draft.json`: a separately created, explicitly untrusted directory presented Codex's real trust screen. Inspection returned `startup_pending`, unavailable and uneditable. Explicit native acceptance made its empty composer ready without a turn. Its first draft was inserted, duplicate-checked and cleared without Enter or Tab. |
| Preservation and cleanup | `fixture-cleanup.json`, `preservation.json`: all three owned fixture tabs closed. All 14 original TTYs, native window identities and draft fingerprints match the before snapshot. `research-final.json` confirms the original research process remains empty, first-turn-ready and without a transcript. |

The first fixture's direct binary launch with alternate sandbox flags failed inside Codex configuration bootstrap. Launching via Cody's actual `codex` shell function, which supplies `features.code_mode_host=true`, succeeded. This environmental distinction was preserved; no Codex configuration, model default, permissions or experimental feature settings were changed by the product repair. The failed bootstrap correctly remained unavailable for native input.

## Remaining checks and workspace

Implementation, native installation and live fixture verification are complete. **Remaining physical iPhone check:** reopen Assistant, choose the exact current research tab, and ask for an authorized draft-only insertion. Confirm it appears for review without submission; only send or queue when intended. Also confirm ordinary Assistant chat/reconnect ergonomics on the phone. The research task itself was deliberately never used as a test.

Physical iPhone Assistant-to-tool selection remains a hands-on check; the Mac tests exercise the same installed native MCP delivery path. This repair requires the Mac update and adds no iPhone UI or microphone behavior. App-server access/routing, destination selection and broader icon changes remain paused.

The nine pre-existing dirty paths remain separate, with these next actions:

- Packaging/integration review: `.agents/skills/clawdad-release/SKILL.md`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`.
- Branding review: `assets/wordmark-explorations/`.
- Separate cloud/marketing implementation review: `cloud/native/`, `marketing-site/`.

 The scoped checkpoint contains only the native input binding/bridge, native input classification, Assistant runtime/tool instructions, regression tests and this report. Hygiene currently reports zero unclassified paths.
