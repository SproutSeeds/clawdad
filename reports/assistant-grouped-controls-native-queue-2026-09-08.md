# Grouped Remote Assist controls and native agent queues

Released September 8, 2026: **iPhone 0.7.0 (64)** in **ClawDad Internal TestFlight**, with **Mac 0.7.0 (76)** installed, signed, notarized, stapled and healthy.

## Remote Assist controls

Cody approved the grouped layout before implementation. The expanded menu now uses labeled, fully tappable tiles in three groups:

- **Assistant:** Chat and Call. Chat opens the retained text conversation; Call explicitly starts voice communication. The conversation retains its image selection, preview, removal and saved drafts.
- **Mac input:** Keyboard, Dictate, Enter, Paste to Mac, Copy to iPhone and Presets. Dictation and playback retain their inline Stop controls. Presets keep their existing immediate-send behavior.
- **Workspace:** Terminal tabs, Read aloud, Photo to Terminal, Files and Special keys, with Displays and Fit screen when applicable. The photo destination is named separately from attachments inside Assistant chat.

The wider menu has consistent spacing, captions, an opaque-enough background for reading over the desktop, and a separate End Remote Assist control. The panel scrolls when the available height is short. Back returns from secondary controls to the main menu; keyboard Escape shares that navigation. The existing collapse chevron remains available. Input capture, permissions and existing tab-picker gestures are retained.

## Native Terminal queue tool

The Assistant now has `queue_in_tab({tabId, sessionId, text, requestId})`. It uses the exact native Terminal tab and the session ID from a fresh `inspect_tab`. It inserts the authorized plain-text follow-up and presses **Tab once**, placing it in the working Codex agent's own pending queue. `send_to_tab` retains its separate behavior: wait in ClawDad for an idle input, then insert and press Enter.

The implementation verifies the executable owning the target TTY, its CLI version, the owning conversation, the active request, native input identity, captured input, application permissions and absence of intervening manual input. Support is currently verified for installed **Codex 0.153.4**. It requires an empty, fully readable composer and the actual `tab to queue message` binding after insertion. Unknown versions, other agents, command-prefixed text, control characters, changed targets, existing drafts and opaque input states produce an attention receipt.

Existing drafts are preserved without clearing. Existing pending messages must remain unchanged before Tab. Queue acceptance requires the fully rendered pending list to contain the previous entries followed by this exact message, with an empty composer. A posted key or an empty composer alone does not establish acceptance. A brief read-only wait lets an initial Codex redraw settle before any text is inserted. If delivery becomes uncertain after insertion or Tab, the tool retains its original receipt and never repeats the input automatically.

Stable request IDs are durable across retries and restarts. Repeating an ID returns its existing receipt; changing the intended payload under the same ID is rejected. Preparation is recorded before Tab, and duplicate preparation is refused. Queue delivery shares native input serialization while allowing a follow-up to reach an already-working agent. Existing application permissions, supported-app restrictions and generic Computer Use restrictions are retained.

| Receipt state | Observed meaning |
| --- | --- |
| `queued` | Waiting for Mac control. |
| `running` | Native delivery is in progress. |
| `agent_queued` | The message was observed in Codex's own pending queue. |
| `submitted` | The existing Enter-based submission has been delivered. |
| `working` | This exact message appeared in its own new agent turn; `submittedAt` and `acceptedAt` are recorded. |
| `completed` | That message's own turn finished. |
| `attention` | Unsupported, changed or uncertain delivery requires inspection of the original receipt and tab. |

The original task finishing cannot complete a queued follow-up. Duplicate transcript representations cannot assign one turn to multiple identical queued requests. Late transcript evidence can resolve a prepared but uncertain delivery without resending it. A closed tab or a queue that stops progressing requires attention. ClawDad's pending-job cancellation cannot pretend to remove an entry already accepted by Codex.

The tool description and managed Assistant Terminal instructions explain these distinctions, draft preservation and stable-ID recovery. Installation verified that text outside the managed instruction block remained unchanged. Both native mobile and web task displays use readable status labels.

## Verification

| Check | Result |
| --- | --- |
| Full runtime suite | 559 passed, zero failed. |
| Mac Swift suite after the redraw fix | 199 executed: 193 passed, six existing opt-in checks skipped, zero failed. |
| Mobile Swift suite | 145 passed. |
| Shared protocol suite | 65 passed. |
| Assistant iPhone simulator UI | All 12 scenarios passed, including chat/call separation, grouped navigation, contact links, attachments and draft preservation. A final focused landscape scenario also passed; portrait and landscape screenshots were inspected. |
| Final release metadata checks | 11 passed. |
| Installed Codex behavior | Real Codex 0.153.4 displayed a Tab-queued message while its original task continued, then processed it in a separate turn. |
| Installed Mac 76 through the actual Assistant MCP tool | Two follow-ups entered the native queue while the original task worked; the first entry remained intact when the second was added. Repeating the first stable ID returned its existing receipt. Each message was accepted exactly once and completed in its own turn, in order. |
| Live input and targeting protections | Idle queueing and a changed agent session were rejected without insertion. All 12 unrelated Terminal tabs and their draft hashes were unchanged across the successful test; the test composer finished empty. |

The live test used a disposable, read-only Codex session in a dedicated Terminal window. It asked that agent to sleep once and return exact markers; it did not submit work to Cody's project agents. Successful final turn IDs were:

- Original: `01a081a6-de06-7230-a40e-8333cdcb35ed` — `ORIGINAL_FINISHED_4A1C2B3A`.
- First follow-up: `01a081a7-b2a7-7fc3-84c0-7f7cb279fd5b` — `NATIVE_QUEUE_FIRST_4A1C2B3A`.
- Second follow-up: `01a081a7-c4c4-7dd2-9245-356e964c678f` — `NATIVE_QUEUE_SECOND_4A1C2B3A`.

Final live proof was recorded at `2026-09-08T15:34:18.273Z`. An earlier live attempt safely refused its second request during an unreadable initial redraw; the bounded pre-insertion wait was added, regression-tested and included in build 76 before the complete test passed. Automated checks also cover nonempty drafts, remapped Tab bindings, changing inputs, clipped queues, delayed rendering, restart uncertainty, duplicate events and tab closure.

Evidence is in the ignored canonical directory `native/macos/dist/candidates/assistant-native-queue-2026-09-08/`: `live-queue-verification.json`, `live-queue-visible.json`, per-request receipts, test logs, UI result bundles, inspected screenshots, release receipts and rollback app bundles.

## Release evidence

- Mac 76 installed at `2026-09-08T15:32:43.406708Z`; strict signature, Gatekeeper, notarization staple, health, native availability and runtime source hashes verified.
- Mac executable SHA-256: `101b8d367734e49ecd1c6c7053215eeeb322e03b7f79bba9eb4d4ee263c6f242`.
- Mac notarization: `e56e3507-5012-4d8d-b1dc-d97007fe4b61`, Accepted.
- iPhone executable SHA-256: `f66d66303c50d6d5f3a6d8c638eeb5ee8e2cd30769dab0d6febadb3521dde14f`.
- Apple build 64 ID: `c281c958-024c-49bb-b249-3954a5e1ffb7`.
- TestFlight reverified at `2026-09-08T15:33:42.686Z`: `VALID`, `IN_BETA_TESTING`, assigned to ClawDad Internal, testing notes match the release catalog.

The existing WebRTC dSYM upload warning remains; the archive and upload succeeded. This private native release adds no cloud storage or telephony service. No npm publication, public GitHub release, external beta or App Store review was created.

## Physical iPhone acceptance

Physical iPhone verification remains. Update to build 64, open Remote Assist, and check the grouped labels, spacing and scrolling on Cody's phone. Confirm Chat opens without starting a call, Call remains explicit, and Photo to Terminal is distinct from attachments in Assistant chat. Ask the Assistant to queue an authorized harmless follow-up in a working test tab and observe Queued in agent followed by that request's own result. Simulator and live Mac checks establish the tested behavior; they do not establish physical phone-to-Mac acceptance.

## Workspace

The nine pre-existing dirty paths remain outside this patch's commit:

- Release workflow: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`. Next action: audit and checkpoint the existing release/storage changes in their owning lane.
- Plugin integration: `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`. Next action: review and checkpoint that integration's metadata and guidance.
- Other product work: `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`. Next action: curate assets and finish/checkpoint each owning product lane separately.

The implementation, tests, release metadata and this report are the scoped checkpoint. Hygiene reports zero unclassified dirty paths. The disposable Terminal fixture was closed after its own tasks finished; the remaining 12-tab inventory matched the pre-test inventory. The simulator was returned to its original Shutdown state.
