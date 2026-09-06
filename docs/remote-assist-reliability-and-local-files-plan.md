# Remote Assist reliability and local Files

## Next patch: physical Terminal windows and shared speech

Status: implemented for Mac 51 / iPhone 43; release verification is recorded in
`reports/remote-assist-window-groups-shared-voice-2026-09-05.md`. This section
supersedes the earlier choice of iPhone-native Remote Assist speech.
The released behavior and earlier acceptance records remain documented below.

### Terminal window groups

- [x] Show one expandable group per physical Terminal window, labeled with its
  stable window number and tab count. Expand the active window initially and
  remember the user's expanded groups. Preserve the switcher's Back control.
- [x] List each window's tabs top to bottom in the real tab strip's left-to-right
  order, including tabs hidden by overflow. Selecting a tab changes its highlight
  without changing either tab order or window-group order.
- [x] Keep every tab distinct, including multiple tabs with the same directory or
  title. Show its position and title; directory/title strings are display metadata.
- [x] Replace ambiguous title-based native grouping with verified physical-window
  and tab identity mapping. Validate the selected shell and native control identity
  while collecting the layout, including before and after selection. Keep the
  physical Terminal comparison in the acceptance checks below.
- [x] Reconcile opened, closed, renamed and moved tabs with the live Mac. Preserve
  within-window drag handles and accessible move actions, and confirm the actual
  Terminal order after a move. Cross-window dragging remains outside this patch.

Pre-patch code evidence: `RemoteAssist.swift` rendered a flat `remoteTerminalTabs`
list; `MacTerminalTabs.swift` matched native group members by title and declined
ambiguous matches. Adding section headers alone would leave the grouping defect.

### Same speech model and voice as the main app

- [x] Route Remote Assist speech through the main app's shared synthesis pipeline,
  using its effective model, voice and playback settings. Reuse the canonical
  configuration so a voice/model change applies to both experiences.
- [x] Preserve the inline speaker action: highlighted Mac text takes priority;
  a confirmed empty selection falls back to the focused Terminal tab's latest
  completed response. Retain the exact selected source while preparing audio.
- [x] Show compact inline "Preparing voice..." feedback, then play automatically
  when audio is ready. Cody explicitly accepts longer preparation for the same
  higher-quality voice. Allow preparation time appropriate to that pipeline while
  keeping connection failures distinguishable from ongoing synthesis.
- [x] Keep Stop/cancel available during lookup, preparation and playback. Cancelled
  requests, changed sources and reconnects must not start delayed or unrelated audio.
  Keep errors and Retry inline; preserve the shared voice choice when generation
  fails rather than silently substituting the iPhone system voice.
- [x] Reuse the existing paired-Mac synthesis, cache and authenticated audio-delivery
  capabilities. Prefer direct Remote Assist delivery where supported; preserve local
  compute/storage preferences and existing relay usage controls. Add no cloud file
  store or new cloud compute resources for this change.

Pre-patch check on September 5: the installed host's authenticated `/v1/tts/status`
reported `provider: doc-reader`, `engine: kokoro`, enabled and available. The main
iPhone history path requests `speech.synthesize.request`, while
`toggleRemoteReadAloud` called `toggleLocalSpeech` before this patch. The status endpoint does
not expose a voice identifier. The implementation resolves the shared voice from
the synthesis result, as verified below. Health is not audible-playback proof.

Implementation evidence: native AppKit fixtures exercise the production catalog
reader with two windows and 20 duplicate-named tabs, including left-to-right frames
and focus changes. The iPhone uses native list reordering. Shared synthesis produced
valid 24 kHz WAV audio with Kokoro and `af_heart`; model and voice come from the
main app's effective configuration. Expansion is retained while using the switcher
within the Remote Assist session. No iPhone system-voice fallback remains.

### Acceptance for this patch

- [ ] Compare the phone picker with two physical Terminal windows, including 20
  tabs, repeated titles/directories and overflowing tab bars. Verify Mac and phone
  reordering, open/close changes, stable selection, and preserved input/speech targets.
- [x] Verify both speech paths use the same effective model and voice configuration.
- [ ] Listen to the same passage through the main app and Remote Assist on the physical
  iPhone, including highlighted text and a latest completed Terminal response.
- [ ] Exercise slow preparation, cancellation, retries, disconnect/reconnect and
  source changes. Confirm one tap eventually plays the intended audio, the screen
  remains usable while waiting, and no speech sheet or stale playback appears.

## September 5 inline speech follow-up

The follow-up replaces the speech review sheets and manual Use on Mac action with
the approved inline menu behavior. The implementation and release evidence are in
`reports/remote-assist-inline-speech-release-2026-09-05.md` (Mac 50 / iPhone 42).

- [x] Request capabilities after installing the phone receiver; retry missing
  announcements and preserve capabilities through lock-only state updates.
- [x] Capture the original Mac input/window/caret and native Terminal tab on menu
  entry. Stop recording automatically transcribes and delivers once to that valid
  target, with a fresh capture for each subsequent recording.
- [x] Copy when no original target is available, and keep the toolbar Paste action
  aligned with the new transcript on both device clipboards.
- [x] Read highlighted Mac text first, falling back only after an explicit empty
  selection to the focused Terminal tab's latest completed answer. Keep playback,
  Stop, progress and errors in the menu; preserve clipboard contents when reading.
- [x] Wait through capability/target-capture startup with one tap, retain failed
  dictation for retry, and stop recording when Remote Assist backgrounds or closes.
- [x] Exercise wire-message loss/retry, stale targets, no-input fallback, repeated
  dictation, selection precedence, startup overlap and microphone lifecycle.
- [ ] Complete physical iPhone/Mac typing, selection and audible playback acceptance
  on the released pair. Simulator fixtures and data-channel tests are not that proof.

Status: implementation delivered in Mac 48 / iPhone 40; physical acceptance remains open.
Release evidence: `reports/files-reliability-release-2026-09-05.md`.
Unchecked acceptance items below remain explicit; the earlier audit describes build 46 / 38.
Audit date: 2026-09-05. Baseline commit: `b2cc1e0`.

## Product decisions

- The paired Mac owns agent execution, dictation processing, and the canonical Files library. Mac 51 / iPhone 43 share the main app's speech model and voice configuration; longer preparation is acceptable for that quality. Mac 50 / iPhone 42 previously used iPhone-native Remote Assist speech, as recorded in the release history below.
- Files use local Mac storage. The phone fetches files on demand and can retain downloads or export them to Apple Files/share destinations.
- Cloud infrastructure supplies the existing pairing, signaling, and necessary transient relay functions. This plan adds no cloud file store, automatic cloud backups, or cloud document processing.
- Prefer direct device transfer. Any relay fallback must obey usage controls; local storage alone does not eliminate relay bandwidth.
- With the Mac asleep/offline, previously downloaded phone files remain accessible. Other entries show that the Mac must reconnect before downloading.
- The default library contains intentional deliverables. Ordinary code changes, intermediate output, logs, and build files remain in their projects. A requested script or source bundle can be an intentional deliverable.
- Repair the reported Remote Assist regressions before expanding the product with Files.
- The Terminal picker mirrors the real visible tab order. Selecting a tab changes its highlight, while actual tab moves on the Mac change the picker order. A picker drag is a request to move that same live tab in Terminal.

## Baseline audit evidence

Read-only checks confirmed the installed Mac is build 46 and the connected physical iPhone has build 38. The native service on port 4487 reports healthy with the shared Codex service ready. Authenticated `/v1/tts/status` returned HTTP 200 with `doc-reader` enabled and available. This confirms service availability, not successful response retrieval, audio transfer, or audible playback on the phone.

The earlier release reports explicitly left physical phone playback and dictation insertion unverified. The new user reports make those acceptance cases open defects. Existing passing unit tests and preview UI tests do not close them.

| Area | Audit finding | Confidence and remaining evidence |
| --- | --- | --- |
| Terminal taps | A catalog refresh and a focus request share one pending-request slot. The iPhone disables every unselected tab while a refresh is pending. Silent polling runs every two seconds. | Confirmed code behavior that can discard the user's tap during a refresh. Physical timings and the full reported repeated-tap sequence still need measurement. |
| Terminal latency | A focus operation reads the complete catalog before focusing and again afterward. Each catalog executes Terminal automation and an Accessibility traversal for unread indicators on one serial queue. | Confirmed extra work on the switch path; its wall-clock contribution has not been benchmarked in this audit. |
| Terminal order | The Mac enumerates windows by their front-to-back index, then tabs by index inside each window. Focusing explicitly puts the target window at index 1. The iPhone renders that returned sequence unchanged. | Confirmed mechanism for focus-driven group reshuffling. Compare the visible tab bar with scripting and native window-tab groups before treating window order as tab-strip order. There is no separate recent-use sort in the inspected picker code. |
| Terminal reader | Reading first refreshes the catalog, then the Mac's reader reads it before and after resolving the response. A reader request is rejected if a Terminal operation is already pending. The mini player also polls the catalog every two seconds while it retains a source. | Confirmed contention and repeated catalog work. The reader's selected-tab safeguards must survive any optimization. |
| Acknowledgements | Mac control replies discard the Boolean result from the WebRTC data-channel send. The response reader also ignores that result. The iPhone times out clipboard delivery after five seconds and tab requests after eight seconds. | Confirmed reliability/diagnostic gap. A failed send can leave the phone waiting; no captured failed user request yet proves this is the sole cause. |
| Read Aloud | Text retrieval uses Remote Assist's data channel. Speech preparation/audio delivery uses the separate cloud-envelope connection. Playback waits for all audio parts and has a three-minute preparation timeout. | Confirmed independent failure stages. A healthy remote video session does not establish that the speech connection or phone audio output is healthy. |
| Relay recovery | Current native connector logs show socket errors with reconnect waits of 3, 6, 12, and 24 seconds. The failure counter resets after a clean connection return, rather than when a new connection becomes healthy. | Confirmed source/log evidence for recovery delay growth. Correlation with the reported speech attempts is pending. |
| Use on Mac | Delivery copies text to the Mac clipboard and attempts insertion into the current eligible foreground target. Several phone readiness guards return silently. The shortcut fallback reports insertion when it posts a paste shortcut, without observing the resulting text. | Confirmed implementation limitations. Need to distinguish a disabled button, failed request, missing receipt, clipboard-only success, and failed insertion on the actual phone. |
| Recording appearance | The mic styles use circles; recording replaces the mic glyph with `stop.fill` and adds a pulse/glow. The prior screenshot shows a transcript preview rather than recording. | The reported surrounding square has not been visually reproduced. Inspect actual recording/pressed/focus states before identifying the cause. |
| Files | The desktop has a basic aggregate Files view backed by per-project `.clawdad/artifacts` directories. The cloud connector handles artifact listing, while the iPhone has no complete Files/download experience. | Confirmed code foundation; it is not yet a shared, durable deliverables library. |

No product source, running app, permissions, cloud configuration, or release channel was changed during this audit. No remote input or clipboard write was issued to the user's Mac.

## 1. Make Terminal actions reliable

- [ ] Record one request ID through tap, accepted intent, Mac receipt, catalog/focus execution, reply send, and phone application. Keep diagnostic timing and error codes local and bounded; omit terminal contents and dictated text.
- [x] Separate background catalog refresh from foreground selection state. Accept a tap immediately even when a refresh is running, display the requested destination, and execute it as soon as the current safe operation finishes.
- [x] Coalesce repeated taps to the same destination. If the user chooses another destination while waiting, retain the newest explicit choice with a sequence number and reject stale acknowledgements.
- [x] Keep the current selection marked as confirmed until the Mac acknowledges the new selection. A background response at the same topology revision must not overwrite a newer focus result.
- [x] Consolidate polling, coalesce overlapping refreshes, and pause/defer low-priority refresh work around explicit actions. Read cached tab identity and validate the target without rescanning unrelated unread indicators for every switch.
- [x] Preserve stable tab identity, topology checks, moved/closed-tab handling, and exact post-focus confirmation. Avoid retaining mutable tab indexes as the authority.
- [x] Handle send failures and transport congestion explicitly. Add bounded reply retry/status reconciliation without replaying input or making unbounded queues.

Exit evidence: timed phone-to-Mac switching across multiple live tabs, including taps during refresh, repeated taps, rapid changes of destination, long-running sessions, closed/reordered tabs, and reconnect. A single accepted tap must reach the intended tab without repeat tapping. Immediate local feedback should be visible within 100 ms; record median and p95 completion times, targeting p95 under two seconds on a healthy connection after catalog warmup.

### 1A. Mirror Terminal order and reorder real tabs

User-facing behavior:

- [ ] Show each visible Terminal tab strip in its real left-to-right order. Selecting a tab, receiving new output, reading an answer, and refreshing leave that order intact.
- [x] Reconcile the Mac's scripting catalog with the actual visible tab bar, including native grouped windows where applicable. Keep selection/frontmost state separate from order so an ordinary focus change does not change the order revision.
- [x] For multiple independent windows, use stable window groups with the native tab order inside each group. Keep group placement stable when another window comes forward; avoid treating desktop stacking order as a shared tab order. Window grouping can remain unobtrusive for a single window.
- [ ] Add a clearly visible drag handle on the trailing side of each picker row. Tapping the row focuses its tab; holding and dragging the handle lifts the row with haptic feedback, an insertion marker, and edge auto-scroll. Keep normal list scrolling easy.
- [x] Send one reorder request on drop. Preview the destination immediately, then adopt the order confirmed by Terminal. After a timeout or rejection, read back the actual order before resolving the pending UI; do not blindly repeat a move or apply an undo against potentially newer Mac changes.
- [x] Preserve the active tab/conversation when reorganizing another tab, and retain input/speech ownership by stable tab identity rather than row position. A position-only change should not select another conversation or restart a terminal process.
- [ ] Reflect a drag performed directly on the Mac in the iPhone picker. Opening/closing tabs updates their actual positions; titles and unread markers do not sort the list.
- [x] Provide accessible Move up/Move down actions in addition to the drag gesture, with the same confirmed Mac operation. Preserve Back/Escape behavior and focus when exiting the picker.

Mac capability and protocol work:

- [ ] Prove a reliable move of an existing Terminal tab in a controlled test session before enabling the drag control. The installed `Terminal.sdef` describes window `index` as front-to-back order; its tab collection is read-only and exposes no tab-position setter. A generic `move` command exists in the dictionary, but its presence does not establish that moving live tabs is supported. Validate the actual command or supported native UI operation and read back the result.
- [x] Keep running shells/agents intact throughout the move. The implementation must move the existing tab and preserve its identity/session contents.
- [x] Add structured window/group identity and native tab position to the protocol; the current human-readable `detail` label is insufficient as a machine identity. Advertise verified reorder capability and handle older hosts explicitly.
- [x] Address moves by stable source-tab ID, destination neighbor ID, group ID, expected order revision, and request ID. Validate the source/target again when executing. If either changed or closed, reconcile and report the result without moving an unintended row.
- [x] Run focus and reorder operations through the same bounded foreground scheduler, with catalog/unread polling deferred during drag/commit. Keep stale acknowledgements and same-revision older snapshots from overwriting a newer confirmed order.

Implemented scope: reordering within each real window/tab group. Moving a tab between independent windows would change its membership and needs separate identity, focus, empty-window, and rollback/reconciliation acceptance. Cross-window moves remain outside this release.

Exit evidence: after repeated selection of different tabs/windows, the row order stays fixed; moving a real Mac tab changes the picker to match; dragging first/middle/last rows on the phone produces the same actual Terminal order; opening/closing/reordering during a drag and disconnecting during commit never moves the wrong tab. Verify duplicate titles, many tabs/auto-scroll, preserved active input/TTS target, accessibility actions, and increased text size. Compare the visible Mac tab strip and phone together. The existing live agent sessions must remain running and unchanged.

This proposal follows the [macOS convention of dragging tabs to reorder them](https://support.apple.com/guide/mac-help/use-tabs-in-windows-mchla4695cce/mac). That user-facing convention does not itself prove programmatic Terminal support. Fixed ordering and the urgent speech/delivery repairs can ship independently if reliable native reordering needs additional work.

## 2. Restore Read Aloud end to end

The completed native-playback items in this section describe the earlier release.
The pending shared-model work at the top replaces that playback choice.

- [ ] Reproduce both latest-response and selected-text reading on the actual iPhone. Also check the main conversation speaker to distinguish a shared speech failure from the new Terminal reader.
- [x] Expose response lookup, local speech startup, playing, paused, stopped, and failure states while preserving the source text. Native iPhone speech replaces the separate Mac audio transfer for Remote Assist.
- [x] Serialize or coalesce catalog/reader work so a normal refresh does not make an explicit read fail with a busy response. Avoid redundant catalog scans while retaining selected-tab/turn ownership validation.
- [ ] Verify host binding, request IDs, signed envelopes, readiness transitions, chunk limits/order, complete receipts, and cancellation when switching tabs/computers or disconnecting.
- [x] Handle failed/oversized response sends and use bounded chunks where needed. Never truncate an answer silently or substitute another tab's response.
- [x] Audit the separate speech connection and reset reconnect backoff after an established healthy connection. Report loss of that connection while remote video remains available.
- [ ] Verify the iPhone audio session after microphone use, interruption, background/foreground transitions, and changes between speaker and headphones. Coordinate recorder/playback ownership if a conflict is reproduced.
- [x] Start Remote Assist speech locally on iPhone once its complete, verified response text arrives. This removes cloud audio preparation and chunk assembly from this path.

Exit evidence: physically hear the correct completed answer from two distinct tabs, including one with a long thread; verify selected-text fallback, previous-completed-turn labeling, pause/resume/stop, and reading immediately after dictation. Record request stage timings and test interruption/reconnect. Synthetic audio generation and simulator previews are supporting checks only.

## 3. Repair Use on Mac and the recording control

- [x] Make unavailable delivery explain itself: connection, host capability, display transition, another clipboard action, or a draft belonging to another computer. Keep the draft editable/recoverable after errors.
- [x] Match the exact delivery request and receipt over the data channel. Reconcile an ambiguous timeout before offering a retry that could duplicate text; retain deduplication across the supported retry lifecycle.
- [x] Write and verify the Mac clipboard before attempting insertion. At delivery time, use the currently focused eligible input; with no eligible input, report clipboard-only success clearly.
- [x] Verify the real paste outcome where the target exposes it. Where verification is unavailable, use an accurate delivery status rather than treating posted keystrokes as proof of inserted text.
- [x] Keep Copy to iPhone available independently. Preserve the user's transcript and never press Enter/submit a terminal command automatically.
- [ ] Reproduce the square around the recording icon in idle, recording, pressed, permission, and transcription states on the actual iOS build. Check both the Remote Assist mic and the main composer control.
- [ ] Correct the specific background, clipping, focus, or animation defect after reproduction. Retain a recognizable Stop control, recording feedback, adequate tap target, and accessibility behavior.
- [x] Ensure Back/Cancel return to Remote Assist without discarding the reviewed transcript unexpectedly or leaving microphone capture running.

Exit evidence: one-tap delivery into Terminal and a normal Mac text field; clipboard-only delivery with no eligible field; Copy to iPhone; retry after interruption without duplicate insertion; Unicode and multiline text; visual review of each recording state and larger text settings. These cases must exercise real delivery rather than DEBUG preview fixtures.

## 4. Build the local Files library

### Canonical records and storage

- [x] Create one local library catalog under the Mac's ClawDad application-support directory, with stable deliverable IDs, display names, project/source-conversation references, versions, format variants, sizes, hashes, and completion state.
- [x] Keep original project files at their existing canonical paths. Store a completed local snapshot for each delivered version so later project edits/moves do not break a previously delivered download. Both apps address the same deliverable/version IDs.
- [x] Register completed deliverables through an explicit agent handoff action plus a manual Add to Files action. Support terminal-driven agent sessions through that same handoff mechanism; merely observing a changed file is insufficient.
- [x] Validate file existence/completion and publish atomically. Deduplicate identical delivered versions; group revisions and related formats under the same item.
- [x] Treat existing `.clawdad/artifacts` contents as import candidates with a controlled import preview. Avoid auto-importing every historical report or changing external sharing behavior as a side effect.

### Discovery and phone use

- [x] Evolve the desktop Files space and add matching iPhone access, including a Files shortcut from Remote Assist.
- [x] Default to recent deliverables across projects. Add search by title/filename/project, simple type/project filters, pinning, and archive. Show source context and the latest delivered version; keep earlier versions one level deeper.
- [x] Add preview, download/keep on phone, export to Apple Files/share, and desktop open/reveal actions. Use visible Back behavior and restore the previous context.
- [x] Fetch only requested files/previews. Cache metadata and explicitly retained downloads locally with clear availability and storage-use controls.
- [x] Removing a phone download only removes that local copy. Removing/archiving a library item preserves original project files; deletion of managed versions must have an explicit scope.

### Paired transfer and resource limits

- [x] Add a file-only paired connection usable from the ordinary Files screen without starting screen capture or remote-control mode. Reuse existing device authentication, revocation, and host selection.
- [x] Prefer direct authenticated device transfer. Keep bulk transfer separate from interactive control messages and prioritize Terminal/clipboard actions over downloads.
- [x] Download by authorized deliverable/version ID. Revalidate ownership and file identity; do not expose a general arbitrary-path download endpoint.
- [x] Use bounded chunks, backpressure, progress, cancellation, resumable offsets, and final hash verification. Publish the completed phone file only after verification.
- [x] Keep file bytes and library payloads out of durable cloud storage. Use existing cloud infrastructure for signaling and only necessary transient relay traffic.
- [ ] Apply existing TURN controls to any relayed file connection, add transfer-level accounting/limits, and show when a transfer is paused by budget. Reconcile analytics delay and active credential lifetime when assessing enforcement; do not promise a zero-cloud-cost path on every network.
- [x] Avoid background mirroring, automatic full-library downloads, unnecessary full-catalog scans, and cloud indexing/AI processing. Generate thumbnails/search indexes locally and lazily.

Exit evidence: an agent delivers a file from a normal conversation and a Terminal session; it appears once in both apps; the phone previews/exports identical bytes; a new version stays grouped; ordinary source edits add no library entries; an interrupted download resumes correctly; a retained phone copy opens with both devices offline. Verify relay usage/accounting on a controlled connection before enabling bulk fallback.

## Execution and release checkpoints

1. Capture failing phone attempts with the installed build pair and add the local request diagnostics needed to identify the speech/delivery failure stages.
2. Repair Terminal scheduling, acknowledgement handling, and focus-driven ordering; verify physical switching and retain the timing evidence. Prove and add real-tab reordering with the same scheduler without delaying urgent reliability fixes on an unverified move capability.
3. Complete Read Aloud, Use on Mac, and recording-state acceptance. Run focused behavioral tests for the reproduced failures and affected regressions, including existing All Projects refresh, remote input, pairing, and reconnect.
4. Ship the verified native reliability release through the current installed Mac/internal TestFlight channel. Keep release identity and remaining hands-on checks explicit.
5. Implement the local Files catalog, deliberate handoff, desktop/mobile views, and on-demand transfer as the next bounded change. Share the proven transport reliability work without making the speech repair wait for Files.
6. Verify the full file delivery/download flow, resource use, and repository hygiene before its native release.

The subsequent user instruction authorized implementation and production release through the installed Mac and Internal TestFlight channels. The release report separates automated evidence from physical acceptance. File relay fallback remains disabled pending controlled usage/accounting verification.

## Implementation references

- Terminal state, polling, UI gating, reader requests, and clipboard lifecycle: `apps/ios/ClawDadMobile/Sources/ClawDadMobile/RemoteAssist.swift` (selection state around 199; delivery/reader around 866; refresh/focus around 1045; clipboard around 1704; polling around 2639; row gating around 3187).
- Mac catalog/focus and serial automation: `native/macos/Sources/ClawDad/MacTerminalTabs.swift` (focus around 160; automation around 325).
- Terminal ordering/capability evidence: `MacTerminalTabs.swift` (catalog around 374; focus sets frontmost/window index around 408), `native/ClawDadRemoteAssistProtocol/Sources/ClawDadRemoteAssistProtocol/RemoteTerminalTabProtocol.swift`, and the installed `/System/Applications/Utilities/Terminal.app/Contents/Resources/Terminal.sdef` (window order around 216, read-only tab collection around 255, tab class around 413).
- Mac sends and operation ownership: `native/macos/Sources/ClawDad/MacRemotePeer.swift` (reply sending around 297; Terminal work around 493; reader around 578).
- Speech transport/playback: `lib/cloud-host-connector.mjs` (preparation/transfer around 955; reconnect around 1607), `apps/ios/ClawDadMobile/Sources/ClawDadMobile/CloudClient.swift`, and `RemoteTerminalReader.swift` / `RemoteTerminalReaderPanel.swift` in that same iPhone source directory.
- Dictation delivery: `native/macos/Sources/ClawDad/MacInputController.swift` (around 182), `MacDictationDelivery.swift`, and `MacEditableTargetPolicy.swift`; iPhone `RemoteDictationDraft.swift` / `RemoteDictationPanel.swift`.
- Recording style/audio lifecycle: iPhone `ContentView.swift` (around 3547), `VoiceRecorder.swift`, and `RemoteAssist.swift` (around 3220).
- Existing Files surface: `web/app.js` (around 12873), `lib/server.mjs` (artifact catalog around 16279/16638), and `lib/cloud-host-connector.mjs` (artifact listing around 1366).
- Resource policy and release evidence: `docs/turn-budget-runbook.md`, `cloud/wrangler.toml`, `reports/terminal-reader-release-2026-09-05.md`, and `reports/remote-assist-dictation-2026-09-05.md`.

## Workspace checkpoint

Only this plan belongs to the current change. Five pre-existing dirty groups were preserved: `.agents/skills/clawdad-release/SKILL.md`; `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`; `assets/wordmark-explorations/`; and `marketing-site/`. Their next action is separate owner review/checkpoint. Initial ORP hygiene reported all five classified and safe to expand. Temporary phone inventory was kept outside the repository under `/tmp` and contains no credential material.
