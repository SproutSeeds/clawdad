# Terminal project-title repair — September 10, 2026

Status: delivered in signed, notarized, installed **Mac build 124** on September 10, 2026 (21:18 CDT / September 11 02:18 UTC). Both approved real names are verified through the running native Assistant transport. This lane changes display names and the authorized project-launch preparation workflow. The separate Terminal-control incident audit remains review-before-implementation.

## Confirmed causes

On installed Mac 120, actual Assistant `workspace` / `observe_tab` showed:

| Project | Exact live session | Actual directory | Old picker label |
|---|---|---|---|
| Cancer Research | `01a08d79-4a40-7792-a84b-f633647e9a6e` | `/Volumes/Code_2TB/code/curing-blood-cancer-lab` | `erdos-problems` |
| Ran the Credit Man | `01a087cb-63cc-7ba3-b0af-be74942720ff` | `/Volumes/Code_2TB/code/ran-the-credit-man` | `erdos-problems` |

Cancer was present in the approved Main Workspace roster; Ran was absent. The initial evidence is in the ignored candidate's `initial-identities.json`.

1. New Terminal tabs inherited the parent shell directory. `/etc/zshrc_Apple_Terminal` publishes shell PWD through OSC 7 at the prompt. `codex -C` changes the agent's working directory while that parent shell remains in Erdős. Actual process argv and exact open session metadata independently confirmed both agents' correct projects.
2. `MacNativeTerminalTabs` supplied Terminal's combined AX tab title in a field called `customTitle`. `macTerminalTabTitle` then selected the initial path before the em dash. That discarded the correct project information following it and could shorten an explicitly assigned path-shaped name.
3. Terminal's scripting `custom title of tabs` is the **live program title**; `custom title of current settings of tabs` is the **configured title**. Live inspection distinguished the stock configured `Terminal` from an intentionally inherited `Title Fixture Explicit`. Fresh Codex in Project Alpha initially emitted a live `clawdad` title while its configured title remained `Terminal`. Treating that live value as explicit user intent was incorrect. The final adapter captures the independent configured value. A disposable native test also showed OSC 0 replacing the Inspector's Tab Title, so merely setting a title once was insufficient.
4. Live acceptance caught two cases beyond the first unit fixtures. Terminal may omit its window-only title component from the native tab tooltip. Codex also alternates `[ . ] Action Required` and `[ ! ] Action Required`. Treating either temporary mismatch as a user rename incorrectly retained a generated title. Display-only comparison now accounts for those observed variants; unknown transitions cannot replace an approved name. Native input/ownership matching is unchanged.

## Implemented behavior

- Project metadata is read from the actual foreground Codex executable/process and argv, including `-C`/`--cd`, before a first transcript exists. An ordinary foreground shell supplies its verified cwd when no Codex agent is active. Ambiguous or unavailable metadata stays unverified.
- Native OSC 7 updates correct directory **display metadata**. Explicit names have priority, remain verbatim even when path-shaped, and are stored atomically on the internal drive under `ClawDad/TerminalTitles/names.json`.
- Names are bound to the exact live Terminal login process lifetime and TTY. They survive ClawDad/worker restart and agent exit within that tab; a reused TTY cannot inherit an old name. Main Workspace explicitly rebinds the name when restoring its verified conversation.
- The precedence is an explicit approved/native Tab Title name, then a deliberate configured native title, then the verified active agent directory, then the verified foreground shell directory. Unclassified native metadata is retained conservatively. The stock profile title `Terminal` supplies no project name. An explicit name is preserved even if it resembles a path or directory.
- Native AX title notifications recover an approved name after generated program-title updates. Unknown native custom names are preserved. Title comparison is display-only: no name, directory label, or notification grants input, routing, process or conversation ownership.
- A saved name is reconciled after native-worker/app restart using its exact TTY/login lifetime even before its catalog card has been visited. A visible Terminal Inspector Tab Title edit with the exact displayed TTY is explicit rename evidence, including its commit when focus leaves the field. Unrecognized title strings alone cannot override an approved name.
- `rename_terminal_tab` requires the inspected agent/session or native shell identity, changes no draft or queue, dispatches no keys, and verifies Terminal's actual AX tab title. It updates only an existing matching approved Main Workspace entry.
- `prepare_project_launch` prepares a safely quoted `cd -- 'path'` draft. Enter remains a separate action. After fresh inspection confirms the shell's directory, its `codex` stage prepares the launch draft, again without Enter or Tab. Missing drives/directories and nonempty drafts are preserved. Startup trust/sign-in remains with supported user controls.

The principal source paths are [MacTerminalProjectTitles.swift](../native/macos/Sources/ClawDad/MacTerminalProjectTitles.swift), [MacNativeTerminalTabs.swift](../native/macos/Sources/ClawDad/MacNativeTerminalTabs.swift), [MacTerminalTabs.swift](../native/macos/Sources/ClawDad/MacTerminalTabs.swift), [MacAssistantBridge.swift](../native/macos/Sources/ClawDad/MacAssistantBridge.swift), and [MainTerminalWorkspace.swift](../native/macos/Sources/ClawDad/MainTerminalWorkspace.swift). Tool schemas, receipt handling, and launch instructions are in `lib/assistant-mcp.mjs`, `lib/assistant-runtime.mjs`, and `lib/assistant-coordinator.mjs`.

## Supported behavior and boundaries

| State/action | Final behavior | Verification |
|---|---|---|
| Fresh Codex, including `-C` before first history | Actual executable/foreground process plus directory arguments determine automatic project label | Native fresh fixture, no user prompt or dummy session |
| Established idle/busy or resumed agent | Exact owner/session stays separate from display name | Actual existing sessions and native tool receipts; regression owner checks |
| Ordinary shell `cd`, or agent exit | Verified foreground shell cwd becomes the automatic label; explicit name remains | Quoted shell-stage fixture and fresh-agent exit fixture |
| Custom native/tool name, including a path-shaped name | Preserve verbatim and recover from program-title output | Native Inspector, MCP rename, synthetic OSC output, restart |
| Multiple tabs with the same directory | Keep distinct tab/process identities and explicit names | Independent same-directory fixtures and regression tests |
| App/native-worker restart; reused TTY | Reconcile the same login lifetime; reject old lifetime names on reuse | Actual Mac reinstall/restart and regression tests |
| Existing saved Main Workspace entry | Update exact member only; restore rebinds its name after identity verification | Real Cancer roster update; atomic reload/restore tests |
| `rename_terminal_tab` | Exact inspected owner required; no keys or input invalidation; native title receipt | Real names and unchanged collapsed fixture draft |
| `prepare_project_launch` | Draft `cd` first; verify cwd before drafting `codex -C`; Enter stays separate | Actual native Assistant transport; spaces, apostrophe and Japanese path |
| Ambiguous/stale/missing owner or directory | Preserve existing display/input; require fresh evidence | Regression checks; no name-based fallback |

The existing guarded submission/queue interfaces are reused; this patch does not extend startup trust, change generic Enter/Tab predicates, or infer input authority from a label.

## Live evidence

All detailed local receipts/logs below are under the ignored canonical directory `native/macos/dist/candidates/terminal-project-titles-2026-09-10/`. No test prompt was submitted to a real project, and no real Terminal agent was restarted.

| Approved rename | Verified live owner | Rename receipt | Saved roster |
|---|---|---|---|
| Cancer Research | TTY012, PID59404, session `01a08d79-4a40-7792-a84b-f633647e9a6e` | `c885bf2c-efca-4906-af0f-ab6e22194a52` | Existing entry `69b0a8e4-196a-4f08-b6ee-643e0f1118a8` updated |
| Ran the Credit Man | TTY018, PID31921, session `01a087cb-63cc-7ba3-b0af-be74942720ff` | `182df6a9-c39a-4f27-b940-18d09c8489e7` | Absent before/after; no enrollment |

Both same-request retries returned the original verified receipt. The roster remains **18 approved entries**, with order/membership preserved. `real-name-outcomes-123.json` records unchanged draft representations. After build 124 restarted ClawDad and its native worker, `final-live-outcomes.json` independently confirmed both same process/session identities, correct actual directories, and both displayed names. New catalog IDs were rebound through inspection rather than inferred from labels.

The fresh Project Alpha fixture was launched with `codex -C` from a shell in `Project Beta ' 日本`. It displayed **Project Alpha**, had the verified Alpha directory, no session ID before its first user turn, and `ready_before_first_turn` through the actual Assistant tool. A screenshot captured through the native Assistant `computer` tool was inspected (`terminal-native-ui.jpg`). After stopping only this unused disposable agent, inspection returned the original Beta shell identity/directory and the picker reverted to Beta.

Another fixture retained a **4,357 UTF-8 byte** / 3,817 displayed-character unsent draft while renamed to `/deliberate/path-like-name`. Its exact-paste hash was `cb3ddaa5420b8d15ca8a9fb6a3b9baeba64e6a7bdae8eb7f3af288ee15a97ad2`. `unchanged-native-paste` provenance remained available before and after the rename. After app/worker restart, the same process and `[Pasted Content 3817 chars]` representation remained. Hidden contents were not independently reread after restart; representation preservation is not presented as that stronger claim. No Enter or Tab was sent to this agent.

On build 124, the same fixture's native Inspector name was changed to **Fixture Durable Name** and observed in durable metadata. Synthetic output-only OSC 0 then attempted to replace it with an Action Required title. The actual native AX tab name recovered within **224 ms**, an upper bound including observation overhead (`native-name-recovery-124.json`). This is display output, not input injection or a conversation turn.

The intermediate Mac 121–123 installations were acceptance candidates. Longer observation exposed window/tab title differences, animated Action Required variants, and the configured-versus-live-title distinction. Failed fixtures and initial receipts remain in `launch-fixture-evidence.json`, `real-name-verification.json`, and subsequent candidate logs. Final build 124 supersedes those candidates; an initial successful rename receipt alone was not accepted as durability proof.

### Cleanup and separate audit evidence

All four disposable tabs (TTY019–022) were closed after exact fixture ownership checks. `final-state.json`, recorded at 02:33:09 UTC September 11, independently verifies their absence from native Terminal TTY inventory, **19 remaining real tabs**, and the same **nine real Terminal-associated Codex processes**. A final read-only inspection verified the original ClawDad TTY005/session and restored focus. No disposable entry was added to Main Workspace.

Two existing control observations remain deferred to the broader Terminal audit:

- After fixture agent exit, the shell parser included a prompt marker in its draft representation. The directory and original shell owner were verifiable; this was not treated as proof of an empty composer or worked around with typing/clearing.
- Final disposable close receipt `57dafa9a-ffc1-4c4c-bc7b-d04036fede86` reported `Terminal window order changed during discovery`, while its returned catalog already showed that the tab was gone. Independent read-only TTY/process reconciliation confirmed closure. Close was **not repeated**. This is preserved evidence, not a change to close semantics in this release.

## Automated verification and release

- Full Node runtime suite: **693 passed, zero failures** (`node-tests.log`).
- Final Mac suite: **282 tests, 13 skipped, zero failures** (`mac-tests-124-final.log`). The skips require opt-in/native hardware conditions. Dedicated title tests cover foreground wrappers, first-turn `-C`, configured/live metadata, shell transitions, lifetime changes, generated-title races, custom Unicode/path names, safe launch stages, and durable name storage. Workspace tests cover exact-member rename, no enrollment, reloading, separate same-directory conversations, preserved drafts/receipts, and restore reconciliation.
- Actual native Assistant MCP/service/worker checks exercised renamed real tabs, staged shell drafting and separate Enter, fresh Codex, retained collapsed paste, duplicate rename IDs, native title editing, app restart, and post-exit shell observation.
- Installed **Mac 124**, app version **0.7.0**, bundled runtime **0.7.0-beta.20**, at `/Applications/ClawDad.app`.
- Final executable SHA-256: `049f04335c82efeed1956a007ecca03006ff24e3da11c0f1cc4bdad6b8992513`.
- Verified loaded native worker: `D0EA99E7-49F2-4763-9397-E3C502253799`; actual post-install receipt examples: Cancer `32229822-c5cb-4762-9881-e3f4d97dd415`, Ran `0fc8fcfb-1ebb-4b76-a73f-9c86629ed1b4`, fresh Alpha `07d3686a-5c4f-4599-b64b-fb276ad7e5ea`.
- Installed runtime matches source fingerprint `e3fe7075b7a3a2ec954b74cf23e682d37e62dd27a99f001004c2d5092c7a1640`. The live affected agents use Codex **0.154.0**, resolved to `/opt/homebrew/Caskroom/codex/0.154.0/bin/codex`.
- Signed app/DMG, notarization, stapling and Gatekeeper acceptance passed (`package-124-final.log`). Release artifacts are under `native/macos/dist/releases/0.7.0-beta.20-macos-124/`.
- Installation preserved the Assistant conversation, instructions, research supervisor state, allowance preferences, and all real agent processes. Health-cache readiness timing was not used as proof of the new worker; actual new-worker receipts supply that evidence.
- Existing internal iPhone build **85** is unchanged. This repair changes native title data consumed by the current picker, so a new iPhone/TestFlight binary was not required. No npm, public appcast, or unrelated infrastructure publication was performed.

Remaining checks: physical iPhone picker display/reopening; a separately coordinated full Terminal/Mac restart and actual saved-workspace restoration. App/native-worker restart was exercised; full-machine restart and restored research-session behavior are covered by fixtures/automated tests rather than a disruptive real-machine test.

## Scope and workspace preservation

The scoped checkpoint comprises 17 title/launch source, test and report paths. The pre-existing nine dirty entries remain outside it:

| Preserved bucket | Exact paths | Next action |
|---|---|---|
| Native release workflow edits | `.agents/skills/clawdad-release/SKILL.md`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh` | Review/checkpoint in their own release-workflow lane |
| Integration metadata | `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Retain for its integration checkpoint |
| Existing design/cloud/site work | `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/` | Retain for the owning work lanes; no publication in this task |

`git diff --check` passes. Final ORP hygiene is intentionally `dirty_classified` with **zero unclassified paths**. The native build/install is delivered locally; the existing backlog of unrelated local branch commits is not swept into a remote publication.
