# Assistant native Remote Assist tools — September 8, 2026

The Assistant now has native tools for the Mac actions in Remote Assist, including creating an identified Terminal tab in the intended physical window, typing into ordinary local shell prompts, explicit special keys, and queuing an already-present agent draft. The complete control-to-tool inventory and the device-owned boundaries are in [Assistant Remote Assist coverage](../docs/assistant-remote-control-coverage.md).

## Implementation

- `remote_controls` exposes the current control inventory. Every actual `RemoteShortcut` case has a tool mapping, checked against the shared protocol enum. Tool schemas, descriptions, MCP initialization and the Assistant's owned Terminal instructions describe the new capabilities.
- `new_terminal_tab` uses Terminal's native Command-T menu item. The menu traversal recognizes its profile submenu. One native action must produce exactly one new TTY/tab in the anchor's physical window, preserve existing order and return the verified new identity. A stable request ID cannot create it twice. Its observed catalog becomes available immediately to follow-up tools.
- `inspect_terminal_input` binds the exact tab, TTY, foreground process/session, native input identity and manual-control generation to a short-lived single-use token. `type_terminal_input` edits a readable local zsh/bash/sh draft. Insert preserves existing text; replace/clear requires its exact inspected text. Native readback verifies the result, including observable wraps. Erased Terminal cells, process-list padding and custom ordinary shell prompts are handled.
- Explicit keys, bounded Terminal text-area gestures, saved-image attachments, selected/latest-response context, Mac clipboard, local Files operations and display inspection/capture reuse the existing native control paths. General desktop input directs Terminal actions through the dedicated tools. Integer pagination rejects overflow/fractions rather than trapping in the native Files adapter.
- Existing busy-agent insertion, collapsed-paste verification and running-version detection were retained. `queue_tab_draft` adds the missing already-present-draft path: inspect it, press Tab once, verify native queue acceptance, then track that request's own turn. Its progress updates the original draft task instead of adding another task card.
- Create/focus/move/close results immediately refresh the Assistant's inventory. Close refusal and confirmation outcomes remain attention states; resolving the confirmation updates the original request. The native confirmation decision stays with Cody.
- Diagnostic jobs stay out of the visible chat. User text chat, images, persistent drafts, contact links, voice turn ending, connection recovery and manual controls retain their current implementation. No iPhone view or icon-layout files changed.

## Observed verification

Evidence is stored privately under `native/macos/dist/candidates/assistant-tool-parity-2026-09-08/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Native New Tab in the intended window, shell insertion/replacement/clear, existing-draft refusal, Unicode, arrows, Control-L and Enter on an empty draft | PASS | `live-native-created-first.json`, `live-native.json`, `live-mcp-resumed.log` |
| Installed MCP new-tab receipt, exact shell typing, duplicate request prevention and separate explicit fixture launch | PASS | `installed-mcp-verification.json`, individual `mcp-*.json` receipts |
| Actual running Codex 0.153.4, exact TTY/session, busy draft insertion and both native queue paths | PASS | `installed-queue-checkpoint.json`, `installed-mcp-verification.json` |
| Original work followed by two queued requests, each in its own ordered turn, one user-message delivery each | PASS | Native queue receipts and CLI JSONL checked by `live-mcp.mjs` |
| Original draft task tracks its queued delivery; diagnostic test jobs stay out of user chat | PASS | `installed-mcp-verification.json`, runtime regression tests |
| Fourteen unrelated tab drafts preserved | PASS | `other-drafts-before.json`, `installed-mcp-verification.json` |
| Highlighted first response takes priority while the latest response is different | PASS | `installed-extra-verification.json` |
| Native image attachment visible as `[Image #1]`, without Enter or Tab | PASS | `installed-extra-verification.json`, corresponding image receipt |
| Explicit native arrow key, bounded pointer movement, local Files listing and display inventory | PASS | `installed-extra-verification.json` |
| New-tab identity appears immediately in workspace; wrong expected draft is preserved; completed queue receipts survive host restart | PASS | `installed-final-verification.json` |
| Cleanup of the four disposable test tabs, retaining the original fourteen tabs and physical window | PASS | `fixture-cleanup.json` |
| Final installed create/close flow in the populated intended window, immediate catalogs, accurate stale-close refusal, duplicate prevention and cleanup | PASS | `installed-release-catalog-verification.json`; all fourteen existing drafts preserved |
| Real Assistant discovers the five new Terminal capability names; diagnostic conversation remains hidden | PASS | `installed-assistant-discovery.json` |
| Actual coverage guide published/listed/read through native Files, byte-for-byte/hash match, title update, duplicate prevention and overflow rejection | PASS | `installed-library-verification.json` |

The agent fixture used a read-only sandbox. Its only requested tool workload was one bounded `/bin/sleep 55`; follow-ups returned unique verification strings. No arbitrary user command was run to demonstrate coverage. After its own turns completed, its disposable process was stopped and its test tabs closed. An unexpected close confirmation would be cancelled by the cleanup harness rather than accepted silently.

The live audit caught stale cached inventory after tab creation and closure. Both were repaired, with regression coverage for immediate catalog publication and close refusal/confirmation outcomes. Native close safety checks remain in place; a preflight stale-catalog refusal is not replayed blindly.

## Automated checks

| Suite | Result |
| --- | --- |
| `npm test` | 577 passed, zero failures |
| `swift test --package-path native/macos` | 214 discovered; 206 passed, 8 opt-in tests skipped, zero failures |
| `swift test --package-path apps/ios/ClawDadMobile` | 164 discovered; 163 passed, 1 opt-in test skipped, zero failures |
| `swift test --package-path native/ClawDadRemoteAssistProtocol` | 65 passed, zero failures |
| Opt-in native parity fixture test | 1 passed; native UI operations observed |
| `git diff --check` | PASS |

## Release and handoff

Mac build **0.7.0 (81)** is installed, signed, notarized and healthy. Final installed-bundle and notarization verification are recorded in `install-81-release-verification.json` and `notarization-81-release-status.json`. The signed executable hash is `59df9580514075b5ab62963e26972281554e125ac6338fd52ce143edb52376c3`. The iPhone client uses the host tools through its existing connection; this change requires no new iPhone build.

The coverage guide is available in the local shared Files library as **ClawDad Assistant Controls** (item `5262c0b4-6ac7-4799-854f-64abd1eff7c6`). The native read returned all 10,053 bytes, matching the source and SHA-256 `759ddb557ac336d3458e6fe8a0fe24ae635f3ac0e9f40cfce4554b0ca62e0cef`. No cloud object storage was introduced.

## Remaining boundaries and physical iPhone checks

- Photo selection, microphone/call/playback consent and controls, iPhone clipboard access, custom phone preset editing, navigation/zoom and Save to Files remain user controls. The Mac cannot silently operate those phone-local interfaces.
- The native shell verifier covers readable local single-line zsh/bash/sh prompts. Unknown prompts, password/canonical reads, SSH/REPL editors, unreadable earlier multiline/collapsed drafts and unfamiliar editing bindings return an explicit limitation or uncertain result. A working agent's unreadable collapsed draft can still be manually queued by Cody.
- Key and pointer receipts verify dispatch and available observation. They do not establish that a resulting shell command or agent task completed. Queue completion requires the request's own observed turn.
- The native Assistant toolkit targets macOS; Windows retains its existing manual Remote Assist implementation.
- Physical iPhone verification remains: request a new tab in a named window from text chat and voice; ask for a harmless reviewable shell draft; review a busy-agent draft and manually queue it; request native queuing directly; confirm/cancel a close when appropriate; inspect selected-response playback; and download the coverage guide through Files. Existing attachment/draft restoration and contact-link flows should be smoke-tested after reconnect. These were not claimed as physical-device proof by the automated suites.

## Preserved workspace buckets

The following pre-existing changes remain outside this scoped patch. They are classified by `orp/hygiene-policy.json`; their next action belongs to the corresponding owner lane:

- Native release/storage workflow: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`. Review/checkpoint that workflow independently.
- Codex integration metadata: `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`. Reconcile/checkpoint the integration lane independently.
- Existing product/creative surfaces: `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`. Continue their respective owner lanes; no files from these buckets are staged in this patch.

Broader Remote Assist icon organization remains discussion-only.
