# Native shell input and existing agent drafts

Implemented and verified in signed, notarized **Mac build 117**, installed and healthy. This follow-up builds on the completed [Main Terminal workspace and existing-draft submission repair](main-terminal-workspace-2026-09-10.md), commit `062cd3f`. It does not duplicate that implementation.

## Confirmed causes

1. The build 103 `new_terminal_tab` result contained a native input token that the action's cleanup immediately invalidated. Build 112 already moved invalidation before creation and preserved the newly returned token. An installed build 112 MCP test used that token after 15 seconds to insert the exact reported shell command as a draft, without Enter. Repeating its stable request ID returned the original receipt.
2. The separate fresh-inspection failure had another cause. Inspection `e278efa0-5bdb-4361-b011-53a0d4131fe6` completed at 17:55:59.566 UTC. A phone-originated `terminal.focus` request, `eca712ea-5551-435b-8f40-f55326e59e80`, selected the same tab at 17:56:09.842–17:56:10.448. Its blanket invalidation removed the inspection. Typing at 17:56:14.203 reached the same native worker with the exact token/session values, within the 45-second lifetime. Serialization, token age and worker restart were not the cause of this refusal. The same failure was reproduced on build 112.
3. The earlier collapsed-Codex Enter failure was separate: changing accessibility scrollback invalidated an unchanged composer because the fallback compared the entire screen. Build 112 already repaired composer comparison and exact owning-turn acceptance tracking. Its expanded and 4,199-scalar collapsed submission evidence remains in the linked report.
4. Shell-to-Codex testing uncovered a directory metadata error. Codex 0.154.0 honored `-C <fixture>` while retaining its original OS process working directory. ClawDad reported the latter. The native adapter now reads only the actual owning process's argument vector, resolves supported directory options and verifies the process owner again. It does not associate a conversation by matching directories. A live build 114 inspection reports the correct fixture directory and the same fresh process identity before its first conversation turn.
5. A first-turn test on build 114 dispatched Enter once and completed its exact task, but the native acceptance check encountered partially written first-conversation metadata and immediately reported uncertainty. Build 116 treats this particular first-conversation state as a bounded read retry after dispatch. Changed/ambiguous owners and established sessions keep their refusal behavior; Enter remains outside the retry loop. The original uncertain receipt is retained as evidence rather than rewritten or replayed.
6. A rendering regression discarded blank-cell evidence when an inspection happened between Codex animation frames. A later decorated frame could therefore fail a draft comparison. The normalizer now retains observed blank cells even on a clean frame and accumulates evidence only within the same composer signature and human-input generation. Changed text, unobserved cells and literal Braille remain protected. Live build 114 guard refusals prompted this regression investigation; their generic errors alone do not prove which individual guard rejected each request.
7. The first busy append test exposed an omission in the newly added action's scheduler coverage: it was waiting behind accepted running/queued work. The undelivered fixture request was cancelled without changing the draft or interrupting the agent. Build 117 routes append through the same existing native editing concurrency rule as clear/replace. Native input actions still serialize with one another; accepted independent agent work can continue. The installed build 117 repeated test completed the append in **11.143 seconds while the parent agent remained working**.

## Implemented behavior

The input returned by `new_terminal_tab` directly authorizes one native shell draft/key operation for 45 seconds when present. An unchanged, observed focus action can retain it only when Terminal was already frontmost, the requested tab was selected, the exact input identity is unchanged, and the human-input generation is unchanged. Other actions, process changes, consumption, expiration and worker restarts retain their protections. Error receipts identify invalidation or expiration and direct the Assistant to inspect again before acting.

Agent draft tools now include `append_to_tab_input`. It appends an exact authorized suffix to the full verified current text, using the guarded native editor and one combined paste. Clearing, replacing and appending remain separate from Enter submission and native Tab queuing. Existing queue entries and unrelated inputs remain protected.

For a collapsed draft, append or queue can use a short-lived record of the exact paste this native worker inserted and verified. The record is bound to the input, process instance, conversation, foreground owner and human-input generation, expires after five minutes, and is discarded on independent edits/navigation or restart. A matching character count or old durable receipt alone cannot establish hidden contents. Explicit whole-draft clear/replace remains available when its native composer and action can be verified; attachments and ambiguous/clipped inputs retain their safeguards.

`queue_tab_draft` presses Tab once without pasting again. A fully observed native queue establishes queued acceptance. If a long pending queue is clipped, the receipt records that Tab was sent and awaits the exact new user turn in the owning transcript. Retrying the same request returns that receipt; uncertain delivery is never automatically replayed.

Assistant MCP descriptions, generated Terminal instructions, tool coverage and task receipt handling include these distinctions.

| Intended action | Assistant tool and verification |
| --- | --- |
| Create a shell tab | `new_terminal_tab`: verified window/tab/TTY and directly usable input inspection when available; durable creation receipt. |
| Read or type a shell draft | `inspect_terminal_input`, `type_terminal_input`: exact current owner, single-use token, complete native readback; no Enter/Tab. |
| Submit an existing agent draft | `press_terminal_key` with Enter/submit: guarded composer and durable preparation; acceptance requires its exact new owning turn. Busy-agent Enter is rejected. |
| Insert into empty agent input, idle or busy | `insert_in_tab`: exact live instance/session and verified paste, held for review. Fresh composers need no dummy turn. |
| Clear or replace expanded/multiline/collapsed input | `clear_tab_input`, `replace_tab_input`: fresh inspected representation, explicit whole-draft authorization for collapsed text, observed empty input and exact replacement. |
| Add text to an existing agent draft | `append_to_tab_input`: readable full text or unchanged native paste provenance, then verified combined text; preserves the existing prefix. |
| Queue the existing draft while working | `queue_tab_draft`: fresh `draft.token` and complete `draft.queueText`; one Tab, no repaste. Native queue or exact subsequent turn verifies delivery. |
| Queue a new message into empty working input | Existing `queue_in_tab`: exact session, current Tab binding, one paste and one Tab. |
| Hidden contents without current provenance | Whole-draft clear/replace can be explicitly authorized. Append/queue cannot infer the text; inspect/expand it or authorize replacement. |
| Images, clipped or ambiguous composers, changed owners | Existing protections remain; report the missing verified capability and preserve the input. |

## Evidence and remaining checks

Detailed local receipts, fixture scripts and release artifacts are retained under `native/macos/dist/candidates/terminal-input-followup-2026-09-10/`. All mutation tests use a dedicated disposable tab and directory. Cody's new Erdős tab and other research inputs are not test fixtures.

The installed build 117 busy-agent test passed through the actual Assistant transport. The original task completed at **20:57:31.370 UTC**; the expanded queued message started at **20:57:31.460** and completed at **20:57:33.519**; the collapsed queued message started at **20:57:33.624** and completed at **20:57:36.144**. Each exact requested text appears once in that process's own rollout, with distinct turns and the expected replies. Duplicate request IDs returned their original receipts. The long queue's initial uncertain status reconciled to completion without another Tab or paste.

- Parent task: `5c694daf-2793-4a5e-82aa-2f6c10860185`.
- Existing expanded draft queued: `9fe591a3-f004-4e7f-9a2c-512cdfeaaacb`.
- Busy collapsed append: `372f5013-38a0-410b-92fb-085ae52ca274`.
- Existing collapsed draft queued: `b1dc58ae-242d-43b6-a25e-1e999f4614d8`.
- Fixture conversation: `01a08cf4-96fc-7610-aaff-0f5ed53ba162`.

Separate held-draft append, replacement with a collapsed paste and explicit clear succeeded while the parent was working and accepted native queue entries remained pending. Final input was empty. Build 116 additionally verified whole collapsed clearing after an app restart, expanded/collapsed replacement in both directions, and refusal to reuse hidden paste contents after an independent navigation action. The native implementation is unchanged in 117; its additional scheduler change enables busy append delivery. `agent117-evidence.json`, `live-agent-progress117.json`, the per-action receipts and the exact owning transcript contain the evidence.

The shell reproduction succeeded through the installed MCP → authenticated local service → native worker path after a same-input phone focus. Typing request `84ac4861-9dc1-4978-8eda-61091639716e` used inspection `5f19dcea-7109-4a8b-9068-11d5d2351b6e` after **17.634 seconds**, inserted the exact 46-character reported command and recorded `submitted:false`. The command targeting Erdős was subsequently cleared from the fixture; it was never executed. Separate disposable-directory launch used a different, explicitly authorized Enter request.

Additional shell checks verified a 1,634-scalar wrapped Unicode draft, expiration after a 46-second wait, same-ID duplicate prevention, refusal of a consumed token under a new ID, and worker-restart invalidation **28.607 seconds** after inspection, within its normal lifetime. A fresh Codex process rejected the old shell input identity, accepted/read back/cleared a multiline draft, and still had no first user turn. `shell-path-evidence.json` links these receipts.

This Terminal/zsh profile renders the supplementary-plane lobster emoji as an escape-like string. The emoji-containing shell paste correctly remained unverified and no Enter/Tab followed; the inspected fixture draft was explicitly cleared. Full emoji shell readback is not claimed. BMP Unicode and combining characters passed; prior Codex collapsed Unicode submission evidence remains valid separately.

## Release and regression checks

- **Mac build 117** is installed. The app and DMG passed Developer ID signature validation, notarization, stapling and Gatekeeper assessment. Release artifacts: `native/macos/dist/releases/0.7.0-beta.20-macos-117/`.
- Installed runtime fingerprint: `f62e7ba5f7f57c16529916636f7dd4fa120171d7912f2da0dd815daf3c98ed81`. The app became native-ready after **11.047 seconds** during the controlled ClawDad-only restart. Actual native tool requests subsequently reached worker `02525EF1-5D34-4BE6-AF9C-7A6FE69EF883`.
- **682 runtime tests passed**, zero failures (`runtime-full117.log`). Coverage includes real MCP/HTTP serialization with an injected native worker, stable requests, uncertain receipts/restarts, immediate busy append scheduling and serialization between native edits.
- **268 Mac tests, 10 environment-dependent skips, zero failures** (`native-tests116.log`; native implementation unchanged in 117). Coverage includes token expiry/consumption/restart, no-op focus, owner/provenance changes, collapsed queue without repaste, clipped queue uncertainty, argument-vector parsing and directory overrides, first-conversation read retries, composer animation and preserved literal text.
- Installation preserved the Assistant's conversation and user instructions, research state, allowance preferences and all seven then-running Terminal Codex processes, including the fixture. Supervisors remained disabled. No microphone preference was changed.
- This follow-up changes the Mac/runtime implementation and tool descriptions. It requires no new iPhone build. The Main Workspace UI previously shipped in **iPhone build 83**, with its TestFlight verification recorded in the linked Main Workspace report.

The final build also passed a second fresh-directory launch through the actual installed Assistant tools. `new_terminal_tab` returned a usable shell token (`bababa3b-e34a-4b88-af7c-d7fe175f67bd`); shell draft `8c6af650-661d-4925-864b-6ef9e7573cf1` and separate launch Enter `2c85d3c2-02b3-4edf-9255-bbe59d9bcd74` led to the exact fresh Codex process/directory. Agent draft `fb147e29-b09e-42df-807d-1e3eb238a07b` remained unsent until explicit Enter `a6e6fc63-b8e5-482d-ac5c-c492ed950a3e`. That receipt verified accepted turn `01a08d1d-fc3d-78a0-91dc-c88d37d291ed` in conversation `01a08d1d-7b7c-7913-aedb-6e4f4b15dbed`, with exact text and one completion. Repeating the request returned the same receipt and turn. `first-turn117-evidence.json` records this final installed-path proof.

## Remaining hands-on checks

Cody's physical iPhone interaction with the conversational Assistant remains a hands-on check: request a held shell draft, clear/replace an intended draft, append to it, and explicitly queue it. Native delivery was exercised against the real Mac through the Assistant MCP/service path; this is separate from a physical phone gesture or spoken-request test. No phone UI changed in this follow-up.

Real Mac reboot, logout, Terminal application closure and drive removal were not performed. Controlled ClawDad-only restarts and the earlier disposable Main Workspace restoration tests provide the current restart evidence. Full disruptive checks require coordination. Unknown hidden contents, attachment-bearing drafts, unreadable native inputs and uncertain receipts retain their visible recovery boundaries.

## Workspace hygiene

The implementation, regression tests and this report form a scoped checkpoint. The nine pre-existing dirty entries remain excluded: `.agents/skills/clawdad-release/SKILL.md`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `assets/wordmark-explorations/`, `marketing-site/`, and `cloud/native/`. Their separate release/storage, plugin and design/infrastructure lanes retain their next actions from the Main Workspace report. Generated test/release artifacts stay in canonical ignored candidate and release directories.

Both exact disposable tabs were closed after their tasks completed and inputs were verified empty. The native inventory returned from 19 tabs to the original **17**. Final comparison confirmed the same approved entry IDs, ordering, names, paths, conversation IDs, selected entry and full-screen preference; seven bounded previous snapshots remain. Cody's `/dev/ttys016` Erdős tab was not mutated. `fixture-cleanup117.json` and `final-preservation117.json` record the checks.

`git diff --check` passes. ORP reports `dirty_classified`, zero unclassified paths and `safeToExpand:true`. The scoped source checkpoint excludes all nine unrelated entries listed above. The installed runtime fingerprint matches the final packaged source, and final health/native-online checks pass.
