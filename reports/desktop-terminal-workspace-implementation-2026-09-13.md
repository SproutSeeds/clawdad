# Desktop Terminal setups — implementation and verification

Scope: Cody approved the [desktop audit](desktop-terminal-workspace-audit-2026-09-13.md) and [bounded proposal](desktop-terminal-workspace-next-implementation-2026-09-13.txt). The desktop now has **Save Terminal Setup…** and **Open Saved Setup…** above the project composer. Both use the existing native named-snapshot library shared with iPhone. [User guide](../docs/terminal-setups.md).

## Causes and changes

The backend was already present in the installed Mac build 141. Its entry point was a low-emphasis “Main Terminal Workspace” text button. The patch makes saving and reopening separate visible flows; no second snapshot backend, new Settings architecture, cloud storage, or migration is introduced.

The audit also found three concrete source-level interaction gaps: stale desktop window selections could fall back to another representative; Restore did not bind a reviewed snapshot revision; and opening the old panel dispatched a writing inspection while pending requests used loopback-origin localStorage. These are repaired as follows:

| Surface | Delivered behavior | Authority / preservation |
|---|---|---|
| Save chooser | Explicit exact-window choice, tab count and ordered preliminary lineup; Refresh and Review are separate actions. Unknown directories say they await inspection. | Complete native tab controls identify the physical window. Names and directories are display metadata. A stale choice requires reselection. |
| Reviewed Save | Ten-minute preview token; actual names, directories, session IDs and recoverable drafts are displayed before Save. | Final capture checks complete membership, order, TTY/login lifetime, process, session, directory, name and draft. A changed capture preserves the proposed name and existing snapshots. |
| Catalog reconstruction | Before Review, a rebuilt native catalog asks for an explicit new choice. After Review, Save can rebind through the same exact live TTY/lifetime/process/session evidence. | No title-based or same-directory fallback. The full reviewed lineup must still match. |
| Save / Update | New names create separate snapshots. Explicit Update replaces the lineup and retains the previous version. Duplicate names require a clear Save-new choice. | Manual membership and captured project identities remain separate from background observations. Fresh/unverifiable identities preserve the previous version. |
| Open / Restore | Read-only named setup list with capture time, count, exact IDs and draft/identity warnings. Restore uses the reviewed snapshot ID and revision. | Concurrent phone changes require Review latest. In-flight/retried operations keep their original durable request identity. Legacy client revisions are frozen at acceptance. |
| Progress / restart | Native preferences persist pending request ID and frozen arguments before dispatch, plus setup/window selection and proposed name. | Loopback-port changes do not lose the receipt. Existing native journal, global lock, atomic storage and creation/launch reconciliation remain the authority. |
| iPhone | The displayed saved lineup stays held when background status changes. Explicit Review latest is required for a new revision before Restore. | Same canonical library and versioned protocol. Existing phone save/close controls remain separate; browsing no longer automatically dispatches a writing inspection. |
| Window and thread recovery | Existing exact Terminal owners are reused; confirmed missing sessions resume by exact UUID and directory. Regular window fills usable display. | Current drafts win. No automatic continuation, task/queue replay, supervisor activation, competing app-server owner or recovery of in-memory computation is implied. |
| Assistant tools | `list_terminal_workspace_windows`, `inspect_terminal_workspace_window`, reviewed-token Save/Update and revision-bound Restore. | Same UI/native paths, existing permissions, exact targeting, durable receipts. Existing separate guarded Close tools are preserved. |

Relevant sources: [desktop markup](../web/index.html), [desktop controller](../web/main-terminal-workspace.js), [view policy](../web/main-terminal-workspace-state.mjs), [native preferences](../native/macos/Sources/ClawDad/MainWorkspaceDesktopState.swift), [snapshot engine](../native/macos/Sources/ClawDad/MainTerminalWorkspace.swift), [native inventory](../native/macos/Sources/ClawDad/MacMainWorkspaceNative.swift), [runtime projection](../lib/main-terminal-workspace.mjs), [request acceptance](../lib/assistant-runtime.mjs), [Assistant tool descriptions](../lib/assistant-mcp.mjs), and [iPhone shared-library view](../apps/ios/ClawDadMobile/Sources/ClawDadMobile/MainTerminalWorkspaceView.swift).

Read-only window Review/Save preserves retained exact collapsed-paste provenance; it remains subject to existing unchanged-owner/input verification. Workspace Restore/Close still invalidate that provenance. Hidden text is never inferred from a paste-length label. This narrow change prevents the new two-step review flow from destroying its own recoverable-draft evidence between Review and Save.

## Installed smoke-test correction

The first installation, Mac 142, exposed a cold-start chooser defect absent from the original fully bound fixture. At `2026-09-14T04:21:01Z`, the running catalog contained **16 visible native tabs**, while the lightweight workspace observations contained **two process-bound tabs**. Deriving the chooser from those observations undercounted the physical window, and the full Review would then reject that partial membership hash.

The final patch separately caches complete native window/tab topology, including unvisited tabs. Only explicit Review captures process/session/draft identities. A new cold-start regression uses one process-bound observation with two native tabs and verifies that both exact conversations are reviewed and saved. The retained read-only observation is `installed-142-cold-catalog.json` in the evidence directory.

The installed Open → Done → Save path also exposed a WebKit accessibility-tree issue: Save controls were visible in a screenshot but absent from the modal AX tree. Rendering the intended pane before `showModal()` alone did not resolve repeated reopening in Mac 143. The final change reattaches the same pane nodes only when switching Save/Open, preserving values and handlers while rebuilding the AX subtree. A separate isolated WKWebView app then verified native AX visibility through Save → Done → Open → Done → Save; only status requests and zero native jobs occurred (`workspace-desktop-test-ax/read-only-evidence.json`). Final installed verification is recorded below.

## Verification and evidence

Evidence directory: `native/macos/dist/candidates/desktop-terminal-setups-2026-09-13/` (ignored native release artifacts).

The new **real WKWebView → HTTP AssistantRuntime → native job poll → production snapshot engine → HTTP receipt / Assistant MCP** test uses `MainWorkspaceFixture` for the Terminal boundary and a unique temporary root. It cannot reach AX, AppleScript, Cody’s canonical snapshots or any real Terminal window. This proves actual transport and durable engine behavior; it is not a new live Terminal resume/close test.

The fixture verifies two distinct Codex IDs in the same directory, exact Unicode drafts, read-only browsing, explicit review, one Save after double clicks, one restore operation after repeated UI/MCP requests, and exactly two fixture creations/launches. Another client changes the saved lineup: polling retains the old reviewed text and expanded row, disables Restore, and only explicit Review latest adopts the changed version. Open → Done → Save and 44-point controls are checked. Screenshots at 390 and 980 points were visually reviewed.

Final fixture receipts in `native-transport-receipts.json`:

| Action | Request ID | Result |
|---|---|---|
| Window list | `6115343d-99c5-4128-a319-c3847b1339d1` | Completed, full two-tab topology despite one process observation |
| Review | `3c18992c-e99c-43b4-95c6-db8fcbb38e44` | Completed; exact two-session preview; no snapshot yet |
| Save | `250cda39-255e-4d50-a445-f453a5dda4a5` | One named setup, exact two conversation IDs and drafts |
| Restore | `43284bed-31fd-4447-b8e0-7b3f1300093a` | Completed; repeat through MCP returned the same receipt; no duplicate creations |

- `swift test --package-path native/macos`: **346 tests, 19 opt-in checks skipped, zero failures** (`native-release143.log`). Includes existing manual immutability, explicit replacement, multiple windows/same-directory sessions, missing directories/history, restart/atomic-write/uncertain-launch reconciliation, active/exited/fresh bindings, unchanged draft preservation and guarded close/cancel fixtures. No live opt-in Terminal harness was enabled. After the final WebKit pane correction, the affected native web-view/transport test passed again (`native-release144-ui.log`); its final receipts are listed above.
- Targeted JavaScript transport/UI/revision checks: **88 passed**. Final `npm test`: **731 passed, zero failures** in 50.4 seconds (`runtime-release144-full.log`).
- iPhone build 94: four relevant UI checks on the compact simulator and four on the 6.9-inch simulator, including larger accessibility text, workspace navigation/restore preview and separate close confirmation cancellation. All eight passed (`ios-compact.xcresult`, `ios-large.xcresult`). These use preview fixtures.
- Native preferences tests verify persistence across recreated stores/origin changes, frozen request arguments, allowed-action validation and invalid-state rejection. Review tests verify process/login/session/name/draft/member changes, preview expiry, request-ID reuse, catalog rebinding and snapshot-revision rejection before creation.

Prior September 11 actual Terminal fixture evidence remains referenced in the audit: exact Codex IDs/directories, later persisted history byte preservation, Unicode draft recovery, regular-window display sizing and separate guarded close receipts. It is historical evidence, not a live test repeated for this release.

Initial failed test approaches are retained in the evidence directory: missing fixture HTTP route, a test JavaScript function value unsupported by WKWebView’s return bridge, and the older beta-catalog expectation. Each was corrected; their failing logs are not counted as passing evidence. The cold-start issue above was a product defect discovered by installed testing and received a specific new regression.

## Release checkpoint and preservation

**Delivered:** Mac **0.7.0 (144)**, installed and running from `/Applications/ClawDad.app`; signed app and DMG both notarized and accepted by Gatekeeper. Installation completed at `2026-09-14T04:43:40Z`. Native/service readiness took **6.355 seconds**. Runtime fingerprint `0a9647ea9cbc9d030d25d0a579c18824cade9275ca9d94e7711eb5490301d14d`; installed bundle, prepared runtime and audited source assets match. See `install-144-verification.json` and `mac-release144.log`.

iPhone **0.7.0 (94)** is `VALID` / `IN_BETA_TESTING` in **ClawDad Internal**, build ID `5f12e22e-c063-494d-a707-567e3841ec8b`. Internal-group membership and final release notes were read back through App Store Connect (`testflight94-final-evidence.json`). The upload retained app symbols; the pre-existing third-party WebRTC framework generated a missing-dSYM warning. Public/external distribution, appcast hosting, CLI/npm publication and cloud infrastructure were not changed.

Final installed read-only UI evidence: the Mac home screen visibly exposes both buttons; Save → Done → Open → Done → Save exposes every expected control in the native AX tree. Keyboard focus reaches the chooser, Done/Escape return to the main screen, and the new catalog correctly requires explicit reselection of the old window choice after app restart. The live list contains **15 tabs in window 1 and one in window 2**, matching all 16 catalog rows; preliminary directory gaps are explicitly labeled. Open shows the preserved 17-entry manual setup with three draft warnings. No native workspace job was dispatched by this browsing. These observations and final preservation hashes are recorded in `final-preservation-and-ui.json`.

The canonical library began and remains at revision 23 with ten saved setups. The selected Main Workspace has 17 captured entries (13 Codex conversations, four shells). Existing legacy recovery records, questionable home-directory shells, earlier fixture entries and opaque drafts remain visible and unmodified. No roster cleanup or migration was performed. All three scoped app installations (142, 143, final 144) preserved the full named library, selected roster, request fingerprints and receipts; **all 20 independently running Terminal Codex processes remained unchanged** through each installation. The final four canonical hashes exactly match the original pre-install sample, including snapshots `906a8567cc1d6df81c97a4d1310e1de2cc7176133c22150abdb3fbe1429cfecc` and roster `72d7b476047c0f483a37e18d80d862ece6ac02b17ac1b60700371f8b1ed87122`.

Only ClawDad’s app bundle is replaced during native installation after checking that the top-level Assistant/native delivery is idle. Terminal and project-agent processes are not restarted. No real Save, Update, Review, Restore, Close, Terminal creation, Terminal closure, agent prompt, logout, reboot or power-cycle is part of this task’s test procedure.

Remaining physical checks: Cody’s iPhone installation of 94, touch/VoiceOver with his actual library, and a future explicitly coordinated real restart/recovery test. No physical power-loss or claim of in-flight computation preservation is made. Mac browsing and fixture verification do not prove every legacy saved entry is currently restorable; displayed recovery limitations remain authoritative.


## Workspace classification

Repository: `codex/hermes-hybrid-supervisor-ui`, one existing worktree. This task is one bounded desktop/shared-snapshot UI change. Scoped paths for its commit:

- `apps/ios/ClawDadMobile/ClawDadMobile.xcodeproj/project.pbxproj`
- `apps/ios/ClawDadMobile/Sources/ClawDadMobile/AssistantPreview.swift`
- `apps/ios/ClawDadMobile/Sources/ClawDadMobile/MainTerminalWorkspaceView.swift`
- `apps/ios/ClawDadMobile/project.yml`
- `docs/terminal-setups.md`
- `lib/app-store-connect.mjs`
- `lib/assistant-coordinator.mjs`
- `lib/assistant-mcp.mjs`
- `lib/assistant-runtime.mjs`
- `lib/main-terminal-workspace.mjs`
- `lib/server.mjs`
- `native/macos/Sources/ClawDad/MacAssistantBridge.swift`
- `native/macos/Sources/ClawDad/MacMainWorkspaceNative.swift`
- `native/macos/Sources/ClawDad/MainTerminalWorkspace.swift`
- `native/macos/Sources/ClawDad/MainWorkspaceDesktopState.swift`
- `native/macos/Sources/ClawDad/main.swift`
- `native/macos/Tests/ClawDadTests/DesktopWorkspaceFlowTests.swift`
- `native/macos/Tests/ClawDadTests/MainTerminalWorkspaceTests.swift`
- `native/macos/Tests/ClawDadTests/MainWorkspaceReviewTests.swift`
- `reports/desktop-terminal-workspace-audit-2026-09-13.md`
- `reports/desktop-terminal-workspace-implementation-2026-09-13.md`
- `reports/desktop-terminal-workspace-next-implementation-2026-09-13.txt`
- `test/app-store-connect.test.mjs`
- `test/assistant-runtime.test.mjs`
- `test/desktop-terminal-workspace.test.mjs`
- `test/fixtures/workspace-desktop-server.mjs`
- `test/main-terminal-workspace.test.mjs`
- `web/index.html`
- `web/main-terminal-workspace-state.mjs`
- `web/main-terminal-workspace.css`
- `web/main-terminal-workspace.js`

The nine inherited dirty buckets remain separate and unstaged:

| Path | Next action |
|---|---|
| `.agents/skills/clawdad-release/SKILL.md` | Separate release-skill review; preserved. |
| `native/macos/build-app.sh` | Separate storage/release workflow review; used as installed baseline, not staged. |
| `native/macos/package-release.sh` | Separate storage/release workflow review; used as installed baseline, not staged. |
| `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Separate plugin release metadata review; preserved. |
| `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Separate mirrored release-skill review; preserved. |
| `assets/wordmark-explorations/` | Design exploration; owner review. |
| `cloud/native/` | Separate native cloud work; owner review. |
| `marketing-site/` | Separate marketing-site work; owner review. |
| `native/macos/storage-workflow.sh` | Separate storage guard workflow; owner review. |

Signed native packages, test logs/results, screenshots, local UI-only fixture sources and rollback apps remain under the canonical ignored candidate directory. They follow existing local artifact retention; no broad cleanup was performed. The separate research, Terminal-audit, speech and crash lanes were not expanded.

Source is checkpointed locally. `SproutSeeds/clawdad` was verified to be a public GitHub repository; this task’s local audit evidence and the nine pre-existing unpublished commits are retained for separate source-publication review. Native Mac installation and Internal TestFlight delivery are complete without publishing that history or making a public release/tag.
