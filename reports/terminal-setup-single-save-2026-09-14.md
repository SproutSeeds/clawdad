# Terminal setup: one Save, one capture

Cody authorized the single-Save desktop flow on September 14, 2026. This replaces the duplicate capture in Mac 144. Scope: desktop Save/Update, its shared native capture/Assistant tool path, progress and verification. Existing restore/close operations and iPhone UI remain separate.

## Cause and implementation

The former desktop Review button called `mainworkspace.preview`, which visited each tab. Save then supplied that preview token to `mainworkspace.save`; the native engine captured the window again to compare its owners, names and drafts with the reviewed version. The second tour was final revalidation, not a failed first save.

The desktop now asks for the exact window and name, then **Save setup**. Save and **Update setup** both perform one full capture. A spinner and **Saving tab X of Y…** report native progress. Success opens the saved setup with its details collapsed under **View saved setup**. Starting a new Save displays instructions rather than the previous save's status. Names and frozen pending requests persist when the panel closes; accepted saves keep running and reopening reconciles the same receipt.

The direct native path checks the chosen complete window topology before capture and its ordered membership afterward. The capture rechecks foreground process/login ownership and the manual-interaction ticket without touring tabs again. Existing directory/conversation/draft checks, exact paste provenance, atomic storage, revision checks, single dispatch and previous-version recovery remain in place. A changed or unverifiable window preserves the previous setup. Save keeps every window and running agent open.

Progress contains only request ID and tab counts in a separate observation file; polling cannot mutate the manual snapshot library. A request ID binds that progress to the matching pending UI action. The file is removed on success/failure; interrupted receipts remain governed by existing job recovery. The optional native preview/token workflow stays compatible for callers explicitly requesting a reviewed capture. Assistant instructions now favor direct Save with the exact `windowId` and `tabId`.

Sources: `web/main-terminal-workspace.js`, `web/index.html`, `web/main-terminal-workspace.css`, `native/macos/Sources/ClawDad/MainTerminalWorkspace.swift`, `native/macos/Sources/ClawDad/MacMainWorkspaceNative.swift`, `lib/main-terminal-workspace.mjs`, `lib/assistant-runtime.mjs`, `lib/assistant-mcp.mjs`, `lib/assistant-coordinator.mjs`. User guide: `docs/terminal-setups.md`.

## Verification

Evidence: `native/macos/dist/candidates/terminal-setup-single-save-2026-09-14/`.

- Full native suite: 349 tests, 19 opt-in live checks skipped, zero failures. These include existing restore, close/cancel, draft, session and restart fixtures.
- Full runtime suite: 731 passed; the subsequently added progress regression and affected tool/UI policy checks also passed (12 targeted checks).
- Production WKWebView → HTTP AssistantRuntime → native job poll → production snapshot engine → native result → UI/MCP fixture: the two exact same-directory Codex conversations and Unicode drafts are captured with **one snapshot call and one visit per fixture tab**. Double-clicking Save, closing/reopening during capture, and reconciling the completed Save through Assistant MCP produce no second capture or second snapshot. Native tab progress is observed in the UI. The same fixture still restores the exact two identities without duplicate launches; its hardware boundary is entirely in memory.
- Direct Update removes absent fixture members and retains the previous two-tab version. Recreated native store instances reconcile the completed request without recapture. Stale window selection, membership/order/catalog changes during capture and missing directories preserve prior snapshots and drafts.
- Compact 390-point and desktop 980-point WKWebView screenshots were visually reviewed. Save/window/name controls retain at least 44-point targets; labels, keyboard focus return, accessible progress, optional saved details, reopen navigation and reduced-motion spinner handling are preserved.
- A final targeted test attempt overlapped SwiftPM release compilation and encountered its build-database lock. That attempt is retained as `native-final-build-lock.log`; it was rerun after compilation: 11 affected native/real-WebKit transport tests passed. The final source also uses the concise “Saved X tabs in NAME” success message.

No real workspace capture, Save, Update, Restore, close, new Terminal tab, agent prompt or research mutation is part of the tests. The live baseline is Mac 144 and 11 saved setups at revision 24, including Cody's new 14-tab **Main - September 13  2026** setup. Capture/restore behavior is tested through the real transport with disposable state; this is not a new physical Terminal tour test. Physical VoiceOver and Cody's next real Save remain owner checks. No reboot or power-loss test was performed.

## Release

**Mac 0.7.0 build 145 is installed and running**, signed/notarized and accepted by Gatekeeper. Installation finished at `2026-09-14T05:33:24Z`; native/service readiness took 9.504 seconds. App/runtime/source assets match fingerprint `c0e933fb1aed4c91b229bb86e0ab08b190d1bea5c8a179607345b288cf8659bd`. All 20 Terminal agent processes remained unchanged. Canonical snapshots, roster, request fingerprints and receipts exactly match the pre-implementation baseline; Assistant conversation/instructions, supervisor state and allowance settings were preserved. Service, project inventory, speech readiness and relay health checks passed. See `install-145-verification.json`. The prior signed Mac 144 app is retained in the ignored release candidate as a rollback artifact.

The installed home screen visibly shows Save/Open Terminal Setup. Automatic approval review declined a full accessibility-tree read because it could expose unrelated conversation history; subsequent verification used the visible home screenshot plus the isolated real-WebKit Save panel and hash-verified installed assets. No real Save was used as a verification shortcut. Physical VoiceOver and Cody’s real one-pass Save remain hands-on checks. Final fixture receipts: Save `89a151bb-b037-4009-b10f-96475097de66`, Restore `990bc651-e6de-419d-a4be-1f6bdd2c78b1`; both completed, with repeated MCP calls returning the same accepted receipts. iPhone build 94 remains compatible; this desktop/native update needs no new iPhone binary. Public CLI/npm publication, public source/history publication, appcast hosting and cloud changes are outside this native delivery.

## Workspace classification

The change is on the existing `codex/hermes-hybrid-supervisor-ui` worktree. Scoped implementation/tests/guide/report will be checkpointed together. The nine inherited buckets remain preserved and unstaged: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`, and `native/macos/storage-workflow.sh`. Next action for those buckets remains their separate owner/release/design review. The public GitHub remote's earlier unpublished history remains local as in the preceding native release; unrelated commits are not swept into publication.
