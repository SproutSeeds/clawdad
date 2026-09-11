# Named Terminal snapshots and guarded window close

## Scope and release checkpoint

This release adds manual named snapshots of one physical Terminal window, exact-thread restoration, and confirmed whole-window closing. Saved setups are separate from live observations. Installing it does not resume project agents or enable supervisors.

**Released:** signed/notarized Mac 133 is installed and healthy. iPhone 88 is available in ClawDad Internal TestFlight (`VALID`, `IN_BETA_TESTING`). Mac 132 completed the exact close/restore and normal-window sizing cycle; Mac 133 adds the final scripting-census repair described below. The final installed-133 Save-and-close passed during Cody's coordinated idle interval. The disposable window is closed and its two test snapshots are archived. Intermediate failures remain separate evidence.

Evidence directory: `native/macos/dist/candidates/named-terminal-workspaces-2026-09-11/`.

## Confirmed causes and migration

The inspected legacy file had 32 roster entries for 15 live project tabs and eight previous versions. The old manual-save merge retained unmatched older entries after adding current observations. This accumulated absent tabs and alternative representations of the same project.

Native capture preferred an identified agent's directory, but used the foreground shell directory when an agent could not be identified. Launching `codex -C` from another project leaves the parent shell directory unchanged. Once the agent exits, the foreground shell and its inherited directory cannot prove which conversation previously occupied that tab. Recreated shells in the home directory likewise do not establish a project identity. Display names are not evidence of session ownership.

The concrete legacy reconciliation is recorded in `legacy-reconciliation.json`, including every entry ID, original name/directory/session, history-file existence and classification:

- Ran the Credit Man: entry 3 was a shell in `/Volumes/Code_2TB/code/erdos-problems`, with no conversation ID.
- Cancer Research: entry 6 was a shell without a conversation ID; entry 20 retained its exact agent conversation `01a08d79-4a40-7792-a84b-f633647e9a6e` and correct project directory.
- 26 records were shells, including 20 in `/Users/codymitchell`; one additional Codex record lacked a conversation ID.
- Five agent records retained existing history files. This establishes saved history, not permission to take over a currently running owner.

The original bytes were backed up **before migration** at:

`/Users/codymitchell/Library/Application Support/ClawDad/MainTerminalWorkspace/migration-backups/before-named-snapshots-20260911T180228Z/main-workspace.json`

Size: 161,091 bytes. SHA-256: `d3e6c9869cc942135389064ef4f83ba620d85afc25a71fd7e61e6fd2dca12fdd`.

The v2 migration also creates and verifies its own byte-for-byte backup. It imported the current roster plus all eight prior versions as nine recoverable named snapshots. Questionable shell/no-session records are flagged. It preserved interrupted restore progress and request receipts. No legacy record was deleted, inferred from its name, or silently repaired. The real Cancer and Ran tabs were observed as shells after agent exit; their real drafts and processes were not used as mutation fixtures.

## Implemented behavior

### Manual save and update

Choose a physical window, enter a name, and Save new snapshot. Update chosen snapshot replaces that setup's exact lineup and retains up to eight previous versions. The library supports up to 64 named setups on the Mac's internal drive. Atomic writes, file/directory synchronization, a process-wide operation guard and a filesystem lock protect the journal.

Each saved entry records its type, exact directory, durable conversation ID/history path when present, verified executable, name, order, selection and the observed window presentation. The original full-screen observation stays in recoverable snapshot data; it does not direct restoration into macOS Full Screen. Transient tab IDs, TTYs, process identities and login lifetimes remain separate binding evidence. Two conversations in the same directory remain distinct entries.

Background observation records health and binding evidence separately; it cannot update saved membership, project identity, names or captured drafts. Closing Terminal, an empty inventory, live renaming, an agent exit or app restart cannot erase a setup. Capture of a fresh agent without a resumable conversation ID fails clearly and preserves the prior version. No dummy first turn is sent.

A historical agent binding can be used after exit only with the same live login lifetime, an empty shell prompt, an exact final native `codex resume <UUID>` exit receipt and a verified matching transcript header. A known agent whose exit receipt cannot be verified is flagged rather than replaced with its shell's directory. A new login/TTY reuse cannot inherit that historical binding.

### Restore

Restore uses the saved exact conversation ID with the supported `codex resume <UUID> --cd <exact-directory>` interface, first entering that directory in the shell. It reads the latest persisted history/settings at restore time; it does not freeze history at the Save timestamp. No prompt argument, `continue`, submitted task, accepted native queue or supervisor activation is replayed.

Existing exact owners are reused. An account/runtime ownership lease guards new resume operations against the shared app-server writer path; a live app-server owner blocks a second Terminal runtime. Ambiguous duplicate owners, split physical windows and unsupported resume interfaces produce recovery guidance.

The durable operation ID, per-entry creation marker, original owner census, launch boundary and observed receipts survive reconnects and worker/app restarts. Uncertain creation is reconciled before another attempt; an unresolved receipt does not authorize a repeat. Repeated/concurrent requests converge on the operation. A different request ID cannot make uncertainty disappear.

If another setup is open, ClawDad offers explicit reuse of a chosen window, saving/closing it first, or explicitly opening a separate window. Choosing a setup by itself creates or closes nothing. Reuse preserves extra live tabs and their drafts. Existing saved projects spread across multiple windows require review instead of automatic merging.

Unavailable external drives, paths, transcript files, archived history, executables, trust/sign-in gates and active owners remain per-entry waiting/attention states. Successful progress is retained. ClawDad never substitutes home, another directory or a new conversation for an unavailable target.

Restore expands a **regular window to the current display’s usable area**, leaving the menu bar and Dock accessible. It never enters macOS Full Screen or creates a full-screen Space. The screen is selected from the restored window’s actual position, and current display geometry is used instead of saved pixels. AX readback must confirm the resulting size, allowing Terminal’s character-grid rounding. This uses Apple’s [NSScreen.visibleFrame](https://developer.apple.com/documentation/appkit/nsscreen/visibleframe) for the available area.

### Draft recovery

Recoverable text is saved with its transcript boundary. Live drafts always win over a saved draft. Recovery requires an empty verified target and reconciles accepted turns/pending receipts before insertion. If the captured draft has been submitted since Save, it is not replayed. Typing recovery does not press Enter or Tab.

Opaque/collapsed text is recoverable only when current exact native paste provenance proves the contents. Unreadable text, attachments and uncertain queues retain limitations/receipts for review; their contents are never invented. Save-and-close requires every affected identity and draft to be recoverable and rejects unresolved delivery receipts. Plain Close remains an explicit destructive choice with a stopping-work warning.

### Whole-window close

The Terminal picker window row offers swipe-left Close window and an accessible context-menu/action alternative. The same close sheet is available from Main Workspace. Inspection captures the exact window membership, tab count, busy agents, drafts and a five-minute confirmation token.

Save snapshot and close completes and verifies Save before crossing the close boundary. Confirmation explicitly covers stopping running work: restoring history cannot restore an in-memory computation. Cancel sends no close. Every operation retains a stable request ID and durable receipt before native dispatch.

The final close implementation uses the existing verified native per-tab Close command, right to left, rechecking the remaining members, drafts, process/session ownership and consent boundary. Each owned Terminal confirmation is separately resolved. Independent scripting TTY census and login-lifetime checks must confirm every original session has disappeared; a partial AX inventory is insufficient. Partial/uncertain results stop and preserve receipts, and never repeat a destructive dispatch automatically.

This verification was added after actual fixture tests showed that a native tab-group close button could remove only the selected tab, and the whole-window shortcut could remove shell tabs before presenting a later process dialog. An AX strip transition then looked like disappearance. Those failed approaches are retained in the evidence directory. The existing generic Terminal-control audit remains separate; the final implementation reuses its current single-tab close path.

Closing a member can briefly invalidate the remaining native strip (`-25202`). The adapter now retries only read/focus inspection with bounded backoff; it never repeats a close. Creating/naming a tab can likewise replace native controls and physical-group identifiers. Restore re-identifies the original exact anchor and newly marked tab instead of comparing a stale group ID or creating another tab. A final AX title check verifies Terminal's saved custom tab name separately from ClawDad's display metadata. Terminal's existing activity-caption preference remains in effect, as detailed below. Known creation markers are removed after ownership is verified.

The full-screen test on 130 found that the selected shell was still exactly bound after a Space transition while the first agent tab was temporarily unbound. Close incorrectly required that first tab as its anchor and refused before dispatch (`f57a6c53-6549-4f52-b99f-3a6218da0112`). The repair accepts any member with the exact inspected TTY, login lifetime, owner, conversation and directory, then reinspects and compares the complete window. During a confirmed close sequence, the window remains exposed until the operation ends, avoiding full-screen exit/re-entry between individual member closures. This changes no ownership or draft safeguards.

## UI and Assistant capability matrix

| User action | Assistant-native tool | Guard / observed result |
| --- | --- | --- |
| List / inspect named setups | `main_terminal_workspace` | Optional exact snapshot ID; read-only identity/draft/progress projection |
| Save new setup | `save_main_terminal_workspace` | Exact window-containing tab ID, name, current library revision, request ID |
| Update chosen setup | `save_main_terminal_workspace` with snapshot ID | Exact replacement; prior version retained; never closes |
| Restore setup | `restore_main_terminal_workspace` | Exact snapshot ID, durable request; explicit reuse/separate-window choice |
| Remove a saved project | `remove_main_workspace_project` | Exact snapshot/entry/revision; leaves live work/history intact |
| Recover prior version | `recover_main_workspace_snapshot` | Exact snapshot/version/revision; edits saved data only |
| Inspect window close | `inspect_terminal_window_close` | Exact current window membership, stopping-work warning, confirmation token |
| Close / save-and-close / cancel | `close_terminal_window` | Explicit confirmation, optional verified save, stable one-way receipt |

Mac embedded UI and iPhone use the same native service actions. The icon glossary explains saved layouts and whole-window close. Phone controls retain at least 44-point tap targets, named accessibility actions and standard sheet navigation. Per-snapshot status is separate so selecting one setup does not display another setup's restore result.

## Verification evidence

### Automated and simulator

- Full runtime suite: 695 tests passed (`runtime-tests-final.log`). Final targeted workspace/release tests: 16 passed (`node-tests133.log`).
- Full Mac suite after final repair: 306 tests, 13 intentional skips, zero failures (`mac-tests133.log`).
- iPhone model/runtime tests: 234 tests, one skip, zero failures (`mobile-tests.log`).
- Small 375×667 iPhone simulator: two focused UI tests passed (`ios-compact-final.xcresult`). Large iPhone with accessibility text size: two focused tests passed (`ios-large-retry.xcresult`). Screenshots were visually reviewed for names, save/restore controls, exact-window close confirmation, navigation and scrolling.
- Desktop embedded-UI mock exercised selection, save/update, close inspection/cancellation and the save-and-close request. This is fixture browser evidence, not an actual destructive desktop-window test.

Workspace regression coverage includes exact replacement, unchanged background membership, same-directory conversations, shells, first-turn/unknown identity refusal, missing directories, exact byte migration, interrupted atomic saves, process-wide/file-lock concurrency, restart after creation/launch, uncertain receipts, duplicate request IDs, live draft preservation, confirmation expiry/cancellation, changed owners/drafts, partial close and a modal tab omitted from AX inventory. Display geometry tests cover smaller/larger resolutions, offset monitors, menu/Dock space, wrong-monitor rejection and observed Terminal grid rounding. Existing native close tests cover the owned dialog and single dispatch. Lifecycle restart tests are simulated service/object restarts; they are not physical power-loss tests.

### Actual installed Assistant/native transport

All mutation tests use the disposable QA window and synthetic text beneath the evidence directory. Original project windows and ongoing agents remain intact.

- Fresh Codex Save was refused before its first intended fixture turn; the existing roster remained intact (`fixture-fresh-save-refusal.json`).
- Saved three tabs: two exact Codex conversations and one shell. The second agent launched with `-C` from an inherited different cwd, and Save recorded the active agent's actual directory (`fixture-three-tabs-saved.json`).
- Saved exact two-line Unicode agent draft and shell draft without submitting either (`fixture-before-close-snapshot.json`).
- Produced newer fixture history after an earlier Save to test latest-history resumption (`fixture-progress-after-save.json`).
- Native close cancellation left the fixture unchanged (`fixture-close-cancelled.json`).
- App installs 126 and 127 verified the embedded runtime hashes, one healthy native process, unchanged original Terminal-agent processes, Assistant history, user instructions, research states and allowance settings (`install-126-verification.json`, `install-127-verification.json`).
- Mac 128 reconciled an uncertain creation marker and restored the original agent without creating a duplicate (`fixture-reconcile-created128-result.json`, `fixture-restored128-verified.json`).
- Mac 129 closed both remaining QA agents through the actual Assistant MCP/service/native path. Independent native TTY/lifetime checks confirmed closure; a duplicate request reused the original receipt (`fixture-close129-verification.json`).
- One restore request, issued concurrently twice, recreated both exact Codex IDs and the ordinary shell in one QA window. It restored the two-line Unicode draft and shell draft, correct order, selected shell, and latest completed responses. Duplicate requests reused the same receipt (`fixture-restore129-verification.json`). Native restore took 193.920 seconds for three tabs, including repeated ownership/visibility checks among the other open windows. The local service answered a concurrent health request in 20 ms. This establishes service responsiveness, not a synthetic conversational-model benchmark.
- Strong history proof: the 339,308-byte and 327,758-byte pre-close transcript prefixes retained their exact SHA-256 hashes, and no new accepted-work records appeared. The first had two prior tasks and the second one. The initial fixture counter looked only for the older `event_msg:user_message` shape and incorrectly reported zero; it was replaced by byte preservation plus actual `task_started` and `response_item` user-record checks (`fixture-history-byte-proof129.json`).

Two test-harness assertions were corrected without changing product behavior: a catalog lookup immediately after completion needed the ordinary publication refresh, and later draft inspections changed selection before the selection assertion. The initial post-restore catalog and native screenshot establish the original restored selection. The native-name readback check was added separately; selected tab names were then verified visually. The inactive activity caption was subsequently isolated from saved-name correctness.

Mac 132 installation verified exact embedded runtime hashes and one healthy native app (12.233 seconds to native readiness), with the original Terminal agents, Assistant conversation, research state and allowance preferences unchanged (`install-132-verification.json`). Save-and-close then verified all three QA tabs removed through independent Terminal scripting inventory. The updated named snapshot has exactly three entries and retains its previous version; the duplicate close ID reused its receipt, and both history files stayed byte-for-byte unchanged (`fixture-close132-verification.json`).

A close preflight on 132 refused once before dispatch because its window comparison failed. Subsequent read-only inspections showed the same owners, conversation IDs and draft text, but the exact mismatching predicate at the earlier instant was not retained; a cause is not claimed. A fresh inspection/confirmation succeeded (`fixture-close132-fresh-anchor-result.json`). A post-resize `inspect_tab` similarly returned `input_changed` once and preserved the input; read-only reinspection is retained separately from restore acceptance. These safe refusals remain evidence and are not erased by the successful cycle. The test harness also stopped once on an obsolete expectation that the QA window remained full screen; no close was sent by that failed assertion.

Mac 132 then recreated the same three tabs from the saved snapshot via concurrent duplicate restore requests. Exact conversation IDs, directories, latest responses, Unicode agent draft, shell draft, order and selected shell were verified. Both complete history files stayed byte-for-byte identical, proving no new task or continuation was submitted. Native restore took 191.842 seconds; the local health endpoint responded in 18 ms and Assistant state in 58 ms during restoration (`fixture-restore132-verification.json`, `service-during-restore132.json`).

The regular window was verified on both actual displays: primary 2560×1440, usable 2560×1410, observed 2529×1387 at (0,30); secondary 1920×1080, usable 1920×1050, observed 1920×1037 at (-1920,30). Terminal character-grid rounding accounts for the small unused margins. The second-display restore reused all existing exact tabs with unchanged snapshot and histories (`fixture-display132-verification.json`). The read-only helper needed `NSApplication.shared` initialized to obtain the secondary display’s menu-bar exclusion correctly. The installed app already had that initialization; this was a test-helper correction, not a second product defect. An initial screenshot helper nested `displayId` incorrectly; corrected captures explicitly verified display 4/5 before visual review.

**Terminal activity captions:** the saved names and AX tab titles were correct, while inactive tabs displayed the long running command. Terminal’s native Profiles > Tab explanatory text states that its activity indicator also displays the process name. A disposable clone of Basic proved the distinction: disabling only its activity indicator immediately displayed “QA Research One” on the inactive tab (`qa-activity-title-proof132.jpg`). The original Basic profile was reapplied and the temporary clone deleted. Product behavior preserves the existing Terminal appearance preference. This is separate from lost or incorrect saved names; see Apple’s [Terminal Tab settings](https://support.apple.com/en-mide/guide/terminal/trmltab/mac).

**Final census defect:** opening and closing native Terminal Settings left a nineteenth scripting-window entry with a missing ID and empty tab/title arrays. The earlier per-window dereference failed with automation `-1728` (“Can’t get every tab of item 19 of every window”). Two cleanup attempts on 132 stopped in preflight; their plans remained `confirmation_required`, every original TTY remained present, and no Close crossed the dispatch boundary (`fixture-final-close132-result.json`, `mcp-inspect_terminal_window_close-6209f71b-afce-4187-a702-e999c1cc3e66.json`).

Mac 133 uses bulk window-ID, TTY and title reads, matching window order and TTY membership before and after the name read. A missing window ID is accepted only with completely empty, structurally valid tab/title arrays. Missing IDs with tabs, unreadable devices, mismatched names, changed membership and conflicting aliases still fail. Bounded retries repeat only the read. Native automation failures retain their error number and permission guidance. The old and revised algorithms were exercised read-only against the same live inventory: the old scan failed at entry 19 while the new one returned all 18 unique real TTYs (`native-title-census133-proof.json`). Five regression tests cover that exact empty-reference shape and the corresponding unsafe cases.

Mac 133 installed with matching embedded source/runtime hashes and recovered native readiness in 10.814 seconds. All seven then-running Terminal agent processes, the Assistant conversation, user instructions, supervisor state and allowance preferences were preserved (`install-133-verification.json`). The same invalid scripting entry remained present after installation, while the new census still returned all 18 real tabs (`installed133-title-census-before-close.json`).

The first installed-133 window inspection passed that census and later stopped when the existing manual keyboard/pointer/scroll protection invalidated its snapshot (`mcp-inspect_terminal_window_close-1867d0f3-2ac7-45e8-902a-2b42601bf7d7.json`). No close was dispatched. The user was asked for a brief idle interval to finish the disposable-window cleanup; this protection was preserved.

The later installed-133 Save-and-close attempt successfully saved revision 6 with exactly the two verified conversations and one shell, including both unsent drafts. Incoming input activity then invalidated inspection before any member closed; the aggregate receipt conservatively reports `uncertain` and will not repeat a close. Independent native TTY inventory confirmed all three QA tabs still present. Their full transcript hashes remain identical, and the nine imported legacy snapshots remain unchanged (`fixture-idle-close133-result.json`, `save133-and-preservation-verification.json`). This is an observed manual-control protection stop, not successful final-build closure proof.

After Cody confirmed the controls were idle, a fresh inspection matched the exact two QA conversations, their directories, the shell's TTY/directory, both unsent drafts and the absence of working agents or pending receipts. Request `847d5628-b891-4e62-99f0-6eabfd0416b1` saved revision 7 with exactly three entries and closed the disposable window through the installed Assistant MCP/service/native path. Independent Terminal scripting inventory confirmed every QA TTY absent. Both complete transcript hashes remained identical, all six real-agent processes present before this attempt remained intact, and a duplicate request reused the original closed receipt (`fixture-coordinated-close133-verification.json`).

The first post-close harness assertion sampled the cached Assistant catalog for 3.5 seconds and still saw the three old QA rows. This was a catalog propagation delay, not evidence of a second close or failed native teardown. Independent TTY inventory proved closure; later read-only Assistant inventory contained only the 15 real tabs and zero QA rows. No new destructive request was issued to resolve the stale rows. The failed assertion remains in `coordinated-close133.log`.

The original imported setup was selected again without restoring or changing membership. `archive-qa-snapshots.py` then archived only the two exact QA snapshots and their restore history under `~/Library/Application Support/ClawDad/MainTerminalWorkspace/qa-archives/named-terminal-workspaces-2026-09-11`, retaining a complete pre-archive state backup and all close/request receipts. All nine imported snapshots deep-compare unchanged against their baseline; the native projection lists those nine setups and retains the original 32-entry roster for review. Fixture directories, unsent draft text, transcripts and test evidence remain recoverable. The service is healthy and the shared app server ready (`qa-cleanup-verification.json`, `qa-cleanup-native133-verification.json`). No additional app build or install was needed for this evidence/cleanup pass.

Release evidence: `testflight88-release.json` confirms build `8f8f00b9-3ad8-4c1d-806c-2f3c7058b012` assigned to ClawDad Internal, with `internalBuildState: IN_BETA_TESTING`. Mac 133 notarization IDs are `5833c08c-9588-4250-acf3-f317176b5b56` (app) and `1787cf16-cd58-4abb-88d5-8dc2401fb0c9` (DMG), both Accepted. Installed executable SHA-256: `e7d2993c146ebd65b50bcc4ef368366df245109b9c352ad5938c2021e345aac5`; embedded/runtime fingerprint: `365644f393bd093cd715c88711eb9605eb8b847033977a711d8df28ced83a501`. Cody cancelled the orphaned dialog from the failed 127 approach before the later tests. Two installer attempts rolled back because the disposable verification script accidentally changed its loopback-host assertion while changing build numbers; targeted substitutions fixed the harness. The verified 128–130 installs recovered normally.

## Remaining physical checks

Save/close/recreate passed on 132; the final census repair and installed-133 Save-and-close are separately verified above. Physical iPhone swipe actions, VoiceOver/context-menu interaction and slow/reconnecting phone behavior require hands-on confirmation. Both connected Mac displays were verified with actual native bounds and screenshots. No Mac power-cycle, real project-window closure or research-task resubmission was performed. Physical power-loss recovery remains untested; automated tests exercise interrupted writes and restore boundaries.

## Workspace hygiene

The scoped source/test/report paths belong to this feature. Pre-existing release/storage tooling changes, plugin metadata, wordmark exploration, cloud/native and marketing-site work remain separate dirty buckets. No public npm release, infrastructure change or external spending is included.

Preserved unrelated paths and next actions:

- `.agents/skills/clawdad-release/SKILL.md`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`: existing release/storage workflow lane; review and checkpoint separately.
- `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`: existing plugin metadata lane; keep with its own publication decision.
- `assets/wordmark-explorations/`: retain the design exploration for its separate review.
- `cloud/native/`, `marketing-site/`: retain the cloud/site work for its own implementation/release lane.

QA logs, failed receipts, signed candidates and disposable synthetic projects live in the ignored evidence directory. They are release evidence, not unclassified source changes. The broader Terminal audit and research-review lanes remain paused as requested.
