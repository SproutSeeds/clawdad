# Main Terminal workspace and existing-draft submission

Status: implemented and released. Signed, notarized Mac build **112** is installed and healthy. iPhone build **83** is available in **ClawDad Internal TestFlight**. Cody's Main Workspace is saved with **17 tabs**. All disposable test tabs/windows were closed after verification; the user's existing tabs and drafts remain intact.

## Submission repair

The reported requests `502340c1-b8a3-4f84-92ca-fad5d8ee4f40` and `017bd7d3-800b-4ef2-b779-760f3dfba920` failed before Enter dispatch. Inspection retained no readable draft for a collapsed paste, so the old fallback compared the complete accessibility screen. Terminal's changing scrollback prefix invalidated an unchanged composer representation. The original hidden payload was not independently readable; the investigation does not claim to have recovered or compared its contents.

The repaired native path compares the composer representation across inspection, durable receipt preparation and dispatch. Exact tab input identity, TTY, foreground process, Codex conversation, input-generation ticket and a 45-second single-use token remain required. User edits invalidate the observation. Enter is sent at most once. A new user turn in the exact owning rollout establishes acceptance; dispatch alone, a cleared input or an agent's later answer cannot substitute for that evidence.

Codex 0.154 also records native input in `response_item` user/input_text records. Acceptance tracking now supports these alongside older `event_msg/user_message` records and deduplicates mirrored representations. A receipt reports Enter dispatch and turn acceptance separately, including the actual accepted text and turn ID. For collapsed text, the pre-dispatch evidence is explicitly its visible representation and unchanged ownership/input generation; it is not independent access to the hidden payload.

Live installed-Assistant-tool evidence on Codex 0.154.0:

- Expanded Unicode draft: Enter request `c7f6e313-acad-42de-bd67-127ac421a29c`, accepted turn `01a08c74-c2e1-7900-984a-37c0249fc500`, exact 57-scalar input and `CLAWDAD_EXPANDED_OK` completion.
- Collapsed 4,199-scalar Unicode draft: request `4f06a429-7fa0-4890-80a0-232f1d7068d6`, accepted turn `01a08c75-32bf-7511-8bba-b17f8192a18c`, exact complete input and `CLAWDAD_COLLAPSED_OK` completion. Repeating the same request returned its original receipt and turn.
- A real edit between inspection and Enter rejected the stale token with `keySent:false`; the changed draft remained intact.
- Enter while a disposable agent was executing an authorized 45-second sleep was rejected with `keySent:false`. The original task completed and its held draft remained intact. Native Tab queuing remains a separate operation.

## Saved workspace behavior

One approved roster is stored on the internal drive at `~/Library/Application Support/ClawDad/MainTerminalWorkspace/main-workspace.json`. The folder is private, the file is mode 0600, and writes use atomic replacement plus file/directory synchronization. Eight previous snapshots are retained. Automatic observation runs at most once per 30 seconds and updates only approved, exactly identified members. Empty inventories and closing tabs do not remove the roster. Explicit removal changes the roster while preserving the live tab, conversation and files.

Automatic snapshot retention compares meaningful roster and recoverable-draft changes. Temporary control IDs, animated titles and other binding updates refresh the current observation without evicting previous recoverable drafts from the bounded history.

Saved entries include exact directory/worktree, persistent Codex conversation ID and transcript path, executable, observed model/effort, name, order, selection, full-screen preference, recoverable draft and pending receipt references. Temporary UI IDs are rebound through observed TTY/process/session ownership. Two conversations sharing one directory stay distinct. Shell tabs recover the exact directory without executing their previous commands.

Restore uses an internal-drive `flock`, a durable active request, per-entry creation/launch/draft phases and stable request receipts. It writes the creation marker before creating anything, reconciles the native custom title and observed identity afterward, and never blindly repeats uncertain creation or Enter delivery. Resume uses the saved explicit Codex conversation ID and the existing account-wide thread-ownership lock. A live app-server or other runtime owner blocks a second resume.

Live testing identified two additional native details addressed by the adapter: Terminal's accessibility label is different from its `custom title`, and title/order/Space changes can replace temporary tab controls. Rebinding and bounded read-only focus retries account for both. Native inventory is checked against Terminal's unique TTY inventory before absence can authorize creation. During an authorized restore, an exactly identified Main window may temporarily leave full screen to expose its controls, then return to the saved state. An unrelated full-screen window or inaccessible controls produce an actionable visibility state rather than duplicate tabs.

| Action | Support and verification boundary |
| --- | --- |
| Save/Update Main Workspace | Explicit window selection; saves exact live identities and visible recoverable drafts. Missing approved members remain until explicit removal. |
| Restore Main Workspace | Reuses matching live tabs in one managed window; creates only verified missing entries; restores names/order/selection/full screen. |
| Existing live drafts/tasks | Preserved, including edits made after the snapshot; existing agents are not interrupted. |
| Saved Codex conversation | Explicit `codex resume <conversation-id> --cd <exact-path>` with observed settings and verified resulting ownership. No agent prompt is submitted. |
| Ordinary shell | Exact directory restoration and supported visible single-line draft recovery; no command-history replay. |
| Recoverable Codex draft | Exact visible saved text, including supported multiline text, restored only into an empty or already-identical verified input. No Enter or Tab. |
| Hidden/collapsed text or attachments | No invented contents. Saved limitations and recoverable snapshot text remain available for review. Attachment recovery is not claimed. |
| Accepted/uncertain queue receipts | Retained for review and checked against accepted turns before draft recovery. Native queues are not automatically replayed. |
| Missing drive, directory, executable or conversation | Waiting with the exact missing requirement; retry performs reconciliation without substituting another path/session. |
| Ambiguous owners or saved tabs split across windows | Needs attention; no blind merge, close or duplicate resume. |
| Previous snapshot | Recover roster/draft data explicitly; recovery itself does not open tabs or submit work. |

UI entry points are the main app's **Main Terminal Workspace** button and the Remote Assist Terminal picker. The desktop embedded UI has the same workspace dialog. Controls include Restore, Save/Update, refresh, saved-draft copy, explicit removal and previous snapshots. The iPhone retains pending request IDs across navigation/reconnects and queries the original receipt before retrying. No Assistant call or microphone activation is needed.

Opening this dialog requests a bounded native inventory independently of whether the conversational Assistant is enabled. A short cache bound to the same native worker preserves the window chooser across intentionally omitted idle observations; a worker restart or inventory error invalidates it. This fixes a disappearing/disabled Save chooser without starting a call or changing microphone consent.

Assistant tools: `main_terminal_workspace`, `save_main_terminal_workspace`, `restore_main_terminal_workspace`, `remove_main_workspace_project`, and `recover_main_workspace_snapshot`. Tool descriptions and Terminal instructions explain exact targeting, stable IDs, progress and recovery boundaries.

### Saved user workspace

The saved roster contains five Codex tabs and twelve ordinary shell tabs, with full screen off. It includes one recoverable nonempty draft and one recorded draft limitation. Two Codex tabs—the second `erdos-problems` tab on `/dev/ttys016` and `college-kid` on `/dev/ttys013` at the time of verification—are legitimate fresh composers: the actual installed Assistant inspection returned `agentAvailable:true` and `inputState:ready_before_first_turn`. Neither has a persistent conversation ID yet. Their current live owners can be reused, but conversation resumption after those owners disappear must wait for a verified ID; no dummy prompt was submitted to create one. TTY values here are evidence timestamps, not permanent identities.

Saving a roster does not guarantee every hidden draft or attachment can be reconstructed. Those limits are shown per entry, and a missing first-turn conversation is reported for review rather than replaced by another conversation from the same directory.

## Verification and release evidence

Canonical detailed evidence is in the ignored local directory `native/macos/dist/candidates/main-terminal-workspace-2026-09-10/`.

- Full Node suite: **678 passed, zero failures** (`runtime-final-111.log`; unchanged runtime in final build 112). Three timing-sensitive checks failed during an earlier concurrent build run, then passed in isolation and subsequent complete reruns.
- Final Mac Swift suite: **261 tests, 10 environment-dependent skips, zero failures** (`native-final-112.log`). Coverage includes concurrent requests, cross-instance durable locking, same-directory conversations, partial restore, missing paths, interrupted creation and launch, uncertain creation, stale revisions, bounded meaningful snapshots, explicit removal, changed native identities, incomplete visibility, composer changes and exact acceptance evidence.
- Mobile Swift suite: **220 tests, one skip, zero failures**.
- iPhone simulator: **four workspace UI runs passed**, covering small iPhone SE and large Pro Max layouts with larger text and dark presentation. The screenshots were visually reviewed. Navigation, clear action labels and comfortable targets were checked.
- Installed desktop UI was inspected through a read-only local view of the real runtime: all 17 saved tabs appeared; Restore and Save were enabled; the dialog fit a 640-pixel viewport; Done/Escape closed it and returned focus. The view was closed after verification. Disabled-Assistant inventory coverage is automated evidence; the live check preserved the already-enabled Assistant state and issued no call-start action.
- Installed native live tests used only disposable conversation/directory fixtures. Full recovery after closing the three fixture tabs/window created exactly one managed window with two distinct Codex conversations in the same directory and one shell. Fresh process owners matched the original persistent conversations; native readback verified both exact unsent drafts, tab order, selection and full-screen on/off. Both owning transcript files remained byte-for-byte unchanged in length with zero new agent turns after resume. Partial restore also passed.
- Two concurrent installed-tool restores returned restored/already-open without adding tabs. Repeating the original restore request returned its original durable receipt. Full restore took **91.913 seconds** in this local fixture, including native startup, identity verification and full-screen transitions; this is an observed test duration, not an expected latency guarantee.
- App-only install/restart checks preserved actual Terminal agent processes, Assistant conversation/instructions, research state and allowance preferences. Build 112 became native-ready in **12.092 seconds** after launch. `/healthz`, native-online state and the installed runtime fingerprint matched the candidate/source. The speech status endpoint reported available; audible playback was outside this task's verification.
- Final installed build 112 observation advanced by **94.144 seconds** while the 17-member approved roster, revision and previous snapshot count remained unchanged. Transient observation updates no longer rotate out meaningful snapshots (`final-snapshot-retention112.json`).
- Mac app and DMG use Developer ID signing, successful notarization/stapling and Gatekeeper validation. Artifacts are in `native/macos/dist/releases/0.7.0-beta.20-macos-112/`. iPhone 83 is `VALID`, `IN_BETA_TESTING`, assigned to **ClawDad Internal**, build ID `305ba959-0a55-4c74-ad12-e99a869460eb`. Public npm/CLI publication and infrastructure changes are outside this release.

Key live evidence files: `live-submission-results.json`, `live-edit-guard-result.json`, `live-busy-verification.json`, `full-workspace-verification.json`, `full-restored-live-snapshot110.json`, `full-restore-no-prompt-replay.json`, `cody-main-workspace-saved.json`, `saved-unbound-tab-status.json`, `install-112-verification.json`, and `testflight83-release.json`.

## Remaining hands-on checks and boundaries

Physical iPhone interaction, VoiceOver/tap feel and a real phone-to-Mac restore remain to be exercised by Cody. Real Mac reboot, logout, Terminal application closure and drive removal were not performed; these require coordination. Controlled ClawDad-only restarts, durable crash simulations and disposable Terminal window tests are separate evidence.

Unknown inputs, inaccessible hidden windows, unavailable transcripts/executables and uncertain message delivery remain visible for review. Installing or restoring this feature does not enable a supervisor, change an allowance threshold, purchase usage, alter microphone consent or grant application permissions.

The hosted-computer subscription concept remains outside implementation scope.

## Workspace hygiene

The task's native/runtime/mobile/web changes and this report form one scoped checkpoint, titled **Repair existing draft submission and add durable Main Terminal workspace**. `git diff --check` passes. ORP hygiene reports `dirty_classified`, zero unclassified paths and `safeToExpand:true`.

The nine pre-existing dirty entries are excluded from that checkpoint:

| Preserved bucket | Exact paths | Next action |
| --- | --- | --- |
| Native release/storage workflow | `.agents/skills/clawdad-release/SKILL.md`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh` | Continue and checkpoint the existing release/storage lane separately. The existing native workflow was used for this authorized release. |
| Plugin metadata | `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Review in its originating plugin lane. |
| Design/web/infrastructure drafts | `assets/wordmark-explorations/`, `marketing-site/`, `cloud/native/` | Preserve for their separately authorized work; no publication or infrastructure activation in this task. |

Generated packages, simulator artifacts, local test fixtures and verification receipts are retained in canonical ignored release/candidate directories. The full disposable saved roster was archived and hash-verified before saving Cody's real 17-tab roster; the real workspace's recoverable snapshots remain intact.
