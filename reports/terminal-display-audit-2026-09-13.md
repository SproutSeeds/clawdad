# Terminal resizing and blinking titles — September 13, 2026

Read-only diagnosis in response to Cody's 12:52–12:53 AM CDT screenshots. No product, preference, window-frame, selection, title, draft, queue or agent changes were made. Native Mac build **139** remains installed; one ClawDad app process (PID 12023) was observed. Source checkpoint before this audit: `2673a12`.

## Confirmed title problem

Live native accessibility observations captured **Ran the Credit Man alternating between its approved short name and Terminal's generated long path/command/status title**. During 55 samples from 06:01:35–06:01:44 UTC (01:01:35–01:01:44 CDT), the affected tab changed its title 14 times. The generated title includes `[ . ] Action Required` / `[ ! ] Action Required`, the conversation title, the project directory and `codex ... ▸ codex-code-mode-host`. Other active agents also emit animated spinner titles. Cody's screenshots show the same short-name versus long-generated-label alternation.

The two writers are identifiable in current source and live state:

* Codex publishes animated program titles, observed independently in Terminal's bulk scripting `custom title` field.
* ClawDad preserves the approved short name in `TerminalTitles/names.json`, bound to a Terminal login lifetime and TTY. `MacTerminalProjectTitles.nativeTitleChanged` reacts to generated AX title changes by writing OSC 1 to restore that name. `refresh` can also restore a missing visible name every three seconds.
* The next program title replaces it again. The 150 ms notification coalescing and event-driven repair reduce blocking but do not establish exclusive title ownership. The long path/process title and short name have different widths, making the alternation particularly conspicuous in Terminal's tab strip.

Sources: [MacTerminalProjectTitles.swift](../native/macos/Sources/ClawDad/MacTerminalProjectTitles.swift), especially `refresh`, `nativeTitleChanged`, `output`, and `MacTerminalTitleNotifications.schedule`; [MacNativeTerminalTabs.swift](../native/macos/Sources/ClawDad/MacNativeTerminalTabs.swift) installs the title observer. The earlier [title-repair report](terminal-project-titles-2026-09-10.md) documented one-shot recovery after an OSC overwrite. That tested eventual restoration, but did not require continuous visual stability while Codex repeatedly animates a title.

This is a confirmed display conflict. Titles are not used as authority to deliver input, and fixing their display must preserve that separation.

## Window size: observation and remaining uncertainty

Cody's screenshot shows the shorter **180 × 35** grid. Live inspection found a mixture of 35-row and 49-row tab states. Several background logical Terminal windows retained 35 rows while selected/visited tabs reported 49. This is relevant to per-tab geometry and focus handling, but a stale background row count is not by itself proof that it resizes the visible window.

A passive scripting observation from **05:56:00–05:59:30 UTC** recorded 90 snapshots. The visible-size reports remained at **1,405 pixels high**, with widths 2,557 or 2,540 and origin (0,30); selection changed during this interval. A later native AX observation measured (0,30,2557,1405) throughout. The actual height reduction did **not** recur in these captures. Therefore the exact resize initiator remains unconfirmed.

Relevant code paths for a focused repair:

* [MacTerminalTabs.swift](../native/macos/Sources/ClawDad/MacTerminalTabs.swift) `focusScript` selects a verified logical Terminal window/tab, makes it frontmost and changes its index. It does not directly write a size, but currently does not preserve and compare the physical window rectangle around these operations. Terminal's tabbed-window scripting aliases must be distinguished from its actual visible window.
* [MacMainWorkspaceNative.swift](../native/macos/Sources/ClawDad/MacMainWorkspaceNative.swift) `finish` / `fillAvailableDisplay` intentionally fits the restored normal window to the current display's usable area. Background inventory and the title repair do not invoke that sizing function. This honors Cody's requested normal-window presentation; it is not a periodic size lock.
* [server.mjs](../lib/server.mjs) retains older Terminal launch paths with explicit bounds, a `.terminal` profile grid and a `.command` fallback that emits a VT window-size sequence. These are launch-time paths, not proof of the current incident. No recent matching launcher invocation was established.
* The inspected user `codex` shell wrapper adds `features.code_mode_host=true`; the inspected shell startup files contain no fixed 35-row resize command. Apple's shell integration publishes current-directory display metadata.
* At 05:58:07 UTC, while passive observation was running, the independent conversational Assistant created one `terminal.inspect` request (`380fffda-78e9-47bb-a26a-7035bd2ee142`), which reached attention. This occurred after Cody's screenshots and cannot explain the earlier shrink. There is no basis to attribute all visible selection changes to this audit, Cody, or another task from the available display metadata alone.

Cody was asked whether shrinking accompanies tab/Assistant actions or occurs while remaining on the same tab. That reproduction detail was still unanswered at this checkpoint. The next useful evidence is a before/after physical-window frame and exact operation/selected identity at an actual shrink. Avoid claiming the title conflict also explains the height change without this evidence.

## Recommended patch direction for discussion

1. Give approved tab names one stable display owner. Verify a supported native override or per-session suppression of competing program-title updates before choosing an implementation. A continuous race that reapplies a name after every frame is insufficient. Keep the useful busy/attention state separately in ClawDad. Preserve explicit user names, exact session/process binding and restored snapshots. Do not restart active agents merely to change appearance.
2. Preserve the current normal-window rectangle through tab selection and Assistant input/inspection. Distinguish an explicit user resize and a changed display from unintended geometry restoration. Apply “fill available display” only on authorized restore/fit actions, rather than installing a timer that fights Cody's manual sizing.
3. Verify with disposable windows that repeated native and Assistant tab changes preserve size, including tabs with different saved grids, Codex/shell transitions and same-directory sessions. Record actual frames before/after; retain the unchanged full-screen preference. Run repeated animated-title tests that require stable visible names throughout, rather than eventual correction after one overwrite.

Implementation and live window manipulation were not performed in response to these diagnostic questions. The separate speech watchdog proposal also remains paused for review.

## Evidence and hygiene

Local evidence: `native/macos/dist/candidates/terminal-display-audit-2026-09-13/` (ignored canonical candidate path): passive scripting sampler/source and `observed-display.json`, `observation-summary.json`; faster bulk observation and its source; native `ObserveAX.swift`, `ax-observation.jsonl`, `ax-summary.json`. No input text or screenshot contents were scraped from Terminal. Window/tab titles can contain project names and are retained locally.

The first scripting sampler took 210 seconds for 90 snapshots because it queried individual properties; the later bulk sampler and native AX sampler were lighter. One premature JSON read failed while that output was still being written; its complete output was subsequently read successfully. An attempted stop found the sampler already exited, so no process was terminated. The native observer had one compile-only whitespace error, corrected in its disposable source before execution. These observations did not alter production code.

The nine prior unrelated dirty buckets remain unchanged: native release skill/build/package/storage tooling; plugin metadata/release skill; branding assets; `cloud/native/`; `marketing-site/`. This audit report is a separate canonical artifact for review. No build, install or release was made.
