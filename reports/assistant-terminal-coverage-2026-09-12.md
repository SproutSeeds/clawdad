# Assistant-native Terminal coverage — September 12, 2026

Status: Mac 136 is installed and notarized; native queue verification is still in progress. A live cold-selection defect was reproduced after installation and is being repaired before the final handoff.

Release coordination update: the speech lane reserved Mac 137 and committed `3dd73e8` on top of this lane's `564c53d`. This lane reserves **Mac 138** for the observed-selection follow-up. Its isolated release source must preserve the already committed speech checkpoint. Do not downgrade a newer installed build. Native QA is still active; installation requires an idle Assistant and no pending native delivery.

Release coordination: this Terminal lane reserves **Mac 136**, with no iPhone build required. The concurrent speech/settings lane is documented in `reports/speech-boost-2026-09-12.md`; its edits are preserved, including its separate import/early-dispatch hunks in `lib/assistant-runtime.mjs`. Terminal packaging will use an isolated export/worktree of the scoped verified Terminal commit so pending speech changes are not accidentally included. Reinspect installed versions before installation; do not downgrade another completed release.

## Scope and preserved work

Cody authorized the Terminal adapters and their necessary repairs in this request. The earlier Terminal-control audit's implementation pause is superseded for this lane. Other computer-control expansion and icon reorganization remain discussion-only. No real project trust prompt, draft, queue or task is used as a destructive test.

Baseline: branch `codex/hermes-hybrid-supervisor-ui`, commit `5110956485d93c2158c31af5e154815bdea73ba3`, installed Mac 135 and iPhone 89. Installed and source MCP hashes matched at the start. Original worker `4301BB91-DC31-46DD-BE61-50CE7603DC61`.

Pre-existing dirty buckets are preserved: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, the integration plugin manifest and release skill, `assets/wordmark-explorations/`, `cloud/native/`, and `marketing-site/`. This lane owns the Assistant Terminal adapter/runtime/MCP/instruction changes, targeted tests and this report. Candidate evidence lives in the ignored `native/macos/dist/candidates/assistant-terminal-coverage-2026-09-12/` directory. No public CLI publication, new infrastructure or account login is included.

## Confirmed causes

1. Receipt `597430d1-bf9d-4070-a4c9-8fa040f202bc` began at 2026-09-13T01:12:16.933Z. It records `keySent=false`, `submitted=false`, `turnAccepted=false` and `enter-not-dispatched`. The native Enter guard requires an ordinary agent composer. It has no startup-choice adapter, so the authorized trust action was rejected before dispatch. The source is `MacAssistantTerminalInput.execute`, not a missing user instruction or a failed Enter delivery.
2. Reinspection found the same `agent-safety-lab` process/TTY already at an idle Codex composer. Its trust screen had been cleared before this audit's inspection. We did not accept its prompt or insert a research message. Exact original process: `codex-process-365527ce19027b71696b71c2598bc76475159aa9bbb3d56d0b1bc0772fd4a3cb`, TTY `/dev/ttys008`. Display names were never used as input authority.
3. The prior queue defects remain in baseline 135: the new-message queue route does not retain its own exact collapsed paste, and its final synchronous screen check uses a different normalization path from its async inspection. The patch retains verified paste provenance and uses one guarded async observation before dispatch, with explicit owner, working-turn, draft and binding failure codes.
4. The prior accepted-queue monitor looks up only the original catalog UUID. A worker/catalog rebuild can replace that display ID while the exact Codex process and session remain. Queue receipts now retain the process and TTY, request an exact read-only owner reconciliation, and keep the original request fingerprint intact. An unavailable historical receipt without enough identity remains for review.

## Implemented interface

`inspect_terminal_input` reports a separate observed `prompt`, including its kind, question, choices, selected choice, directory and SHA-256 prompt identity. `respond_terminal_prompt` receives the exact native input token, prompt ID, choice ID and a quote of Cody's actual authorizing message. An earlier user request in the same conversation can supply that authorization; no repeated confirmation is required. The service validates that provenance and stores its request ID and hashes before native selection/Enter dispatch. Repository text, agent output and caller-supplied authorization objects cannot supply that provenance. The Assistant must still interpret scope, later restrictions and user-approved AGENTS rules correctly.

Prompt decisions, Enter message submission and Tab queueing have distinct receipts. Prompt dispatch is prepared durably first; selection changes are observed before Enter. The native result distinguishes `decisionSent`, `resultVerified`, and `readyForAgentInput`. It always keeps `submitted=false` for prompt decisions. An uncertain result never causes an automatic repeat. Credentials, unsupported prompts and ambiguous inputs retain their user/platform flow.

The live Codex 0.154.0 trust screen places `> You are in <directory>` before a paragraph beginning with the trust question. The parser covers that actual rendering, canonicalizes verified filesystem path aliases such as `/tmp` and `/private/tmp`, and hashes the observed prompt separately from its selected row. It does not infer ownership from the displayed path.

## Capability inventory

| User action | Assistant-native path | Verification / boundary |
|---|---|---|
| List/read/refresh Terminal windows and tabs | `workspace`, `inspect_tab`, `observe_tab` | Exact native catalog, foreground process and session; names are display metadata |
| Inspect/rebind native shell or fresh agent input | `inspect_terminal_input` | One-use 45-second token; optional prior TTY/input-session/foreground identity tuple |
| Accept/decline directory trust | `respond_terminal_prompt` | Exact observed directory question and choice, user-message authorization, prepared receipt, observed result |
| Numbered menus and canonical yes/no prompts | `respond_terminal_prompt` | Explicit observed selection/footer; canonical echo required for line input; result must reach another recognized prompt/composer or shell |
| Type into an ordinary shell | `type_terminal_input` | Exact readable shell draft and foreground process, no Enter/Tab |
| Prepare a project launch | `prepare_project_launch` | Separate directory and Codex drafts; safe quoting and verified directory |
| Insert a Codex draft, idle or busy | `insert_in_tab` | Exact process/session, native paste and visible/readback provenance |
| Clear, replace or append draft text | `clear_tab_input`, `replace_tab_input`, `append_to_tab_input` | Fresh expected draft; whole-draft authorization for opaque collapsed input; images remain protected |
| Submit an idle Codex draft | `press_terminal_key` with Enter/submit, or `send_to_tab` | Native prepare plus exact new owning-rollout user turn, independently of key dispatch |
| Queue new text or an existing draft while busy | `queue_in_tab`, `queue_tab_draft` | One Tab, active-turn/owner/draft/binding checks; rendered queue or exact later accepted turn |
| Special keys and custom navigation/edit combinations | `press_terminal_key` | Explicit action intent; supported Shift/Option/Control chord adapters; guarded Shift-Left queue recall |
| Create/select/reorder/rename/close tabs | Existing dedicated Terminal tools | Native identity, catalog revision and applicable close authorization |
| Save/update/restore named setups; guarded window close | Existing Main Workspace tools | Durable snapshot revisions, exact window and separate save/restore/close requests |
| Images, clipboard, selected/latest response and pointer operations | Existing image/clipboard/context/pointer tools | Existing native target, permissions, draft and attachment protections |
| Unsupported REPLs, passwords/sign-in challenges, arbitrary macros/bindings | Explicit unavailable result | No generic Computer Use or blind key fallback |

### Other computer-control gaps for discussion

The existing `computer` tools cover authorized app inspection/capture, supported pointer/key/text controls, launch and readable accessibility text editing. Phone-local preset editing, photo-library selection, iPhone clipboard operations, microphone/call consent and phone navigation stay on the device. Unsupported secure/read-only app inputs and unverified application-specific workflows need dedicated adapters. Broad generic input is not an alternative Terminal transport. No expansion of these surfaces is included here.

## Evidence so far

- Focused JS suite: 71 passing tests, including actual MCP/authenticated HTTP serialization, genuine prior-message authorization, missing authorization, restart uncertainty, duplicate IDs and exact catalog rebind.
- Initial focused native suite: 32 tests, one opt-in live fixture skipped, no failures. More regressions were added afterward; final totals pending.
- An isolated Assistant service and the actual native bridge operate disposable tabs with separate history and workspace storage. Routine background workspace/activity observation is excluded from this harness; the production default remains enabled. The installed Mac's real MCP path independently inspected the same disposable process. The isolated XCTest worker initially failed to focus an off-screen fixture; installed native focus succeeded, and exact TTY/process checks fenced the subsequent operation. This is recorded as test-harness evidence, not a claim that the failed selection was fixed.
- Accept: receipt `130e95ec-eb5b-4335-bbaa-f1baeefa0a38`, prepared 02:04:25.378Z, observed result 02:04:25.862Z. One Enter; trust accepted; no conversation turn submitted. Repeating the same request returned the same receipt with no dispatch.
- Decline: receipt `5a24ae2a-d062-4bcd-a92c-33187c9c4e67`, prepared 02:06:49.227Z, observed result 02:06:49.864Z. One Down followed by one Enter; return to ordinary shell verified; no conversation turn submitted.
- Synthetic long-message busy/queue sequence: in progress. All actual text, hashes, exact process/session identities and request receipts are retained in candidate evidence.

Physical iPhone voice intent recognition and a phone-originated trust decision remain distinct device checks. Automated and native desktop tests do not prove iPhone microphone accuracy or physical touch behavior. No reboot, logout, real Terminal closure or power-loss test is performed.
