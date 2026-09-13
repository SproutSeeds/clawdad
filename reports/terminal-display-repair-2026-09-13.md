# Terminal display repair — September 13, 2026

Status: Mac **0.7.0 (140)** signed, notarized, installed and verified through the installed Assistant MCP/native worker at 21:34 UTC. Source checkpoint: `f58c60c`.

## Cause and scope

The prior audit captured two competing title writers: Codex 0.154.0 emits animated OSC 0 program titles, and Mac 139's ClawDad observer repeatedly restores the approved OSC 1 tab title. The captured Ran the Credit Man tab changed 14 times in 55 observations over approximately nine seconds. Event coalescing made the repair cheaper but did not eliminate the feedback loop. The old one-shot title test established eventual recovery, not visual stability.

Terminal's Inspector title, scripting custom title, profile title, and title-display switches do not suppress subsequent OSC 0 program titles. Read-only AX inspection confirms tab titles are not settable AX attributes. Isolated profile experiments preserved Cody's Basic profile and real tabs. These approaches were rejected as a stable repair.

Codex has a supported local `/title` settings editor, available during an active task. An empty `tui.terminal_title` list stops Codex's title writer. This was established from the actual 0.154.0 source and a fresh disposable Codex session, without submitting an agent task. The editor writes only this setting: comparison of parsed configuration before/after confirmed every other configuration value was unchanged. A private recoverable configuration copy is retained with the candidate evidence.

Primary source: [Codex title writer](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/tui/src/terminal_title.rs), [title controls](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/tui/src/chatwidget/status_controls.rs), and [local commands allowed during work](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/tui/src/slash_command.rs). The checked source copies are in the candidate evidence.

The intermittent shrink happened during tab switches by Cody's observation. Passive sampling did not reproduce it, so the exact original sizing trigger remains unconfirmed. We found that ClawDad switched from the native tab control to Terminal's logical scripting-window route once it learned a TTY. That route raises/reindexes a logical tab window, which can have a different retained character-grid geometry. The repair protects the physical frame around both supported selection routes. A native-only selection experiment was rejected after a cross-window verification failure; the established exact-TTY activation behavior is retained.

## Delivered behavior

- Native title notifications now observe user edits without rewriting program animation. Directory metadata and saved names are written only on explicit rename or a verified owner/directory transition. Names retain their existing lifetime/TTY fences and remain display metadata, never routing authority.
- Prepared Codex launches and exact Main Workspace resumes add `-c 'tui.terminal_title=[]'`. Runtime receipt validation expects the same exact draft, including safely quoted Unicode paths. Typing and submission remain separate. The same setting was saved for ordinary future Codex launches.
- Existing sessions can be repaired through the local display editor without restarting their agents. The opt-in native repair runner requires a manifest of exact TTY, login lifetime, foreground process and directory. It starts only from a verified empty composer, verifies the exact `/title` autocomplete offer, observes every option, confirms only after all options are unchecked, then verifies the same owner and empty composer. It sends no Tab or agent task. Every intended control is journaled. Manual input, changed ownership or unsupported text pauses it; rerunning an uncertain operation requires inspecting and explicitly reconciling the local editor. Installation never starts this runner automatically.
- Cold native selection and established TTY-based activation receive the same physical-frame guard. A one-operation frame guard restores size only if the exact selected physical window changed substantially during the switch, both observations are normal windows, the origin/displays are unchanged, and no manual input intervened. It never forces full-screen, fills unrelated windows, periodically locks geometry or overrides a later manual resize. An unverified restoration reports that specific outcome.

## Verification

- Runtime suite: **719 passed**, zero failures.
- Native suite: **338 tests**, 19 opt-in/device tests skipped, zero failures. The live switching check ran separately.
- Geometry regression: large-to-small stale grid change, one AX selection/size write, already-selected no-op, manual resize/input, unavailable geometry, full-screen transitions, changed displays, changed origins, grid rounding and bounded operation duration.
- **12 actual native tab switches** in the exact disposable two-tab window retained its `(29, 262, 597, 421)` physical frame and verified each selected native control and input identity. This includes the warmed/known-TTY path.
- Repeated 1,000 animation events and subsequent background refresh issue no competing title writes. Explicit names, path-shaped custom names, process changes, TTY reuse and cold name reload remain covered.
- The disposable local title editor completed in **22.5 seconds**, returning the same fresh Codex owner to an empty composer. No first user turn was created.
- Ran the Credit Man, Erdős, Resume Job Search and Agent Safety sessions were updated in their existing owners and returned to empty composers. The working ClawDad session was updated at 21:16 UTC and remained the same active agent. One manual-input pause on the Ran session was safely reconciled from the observed local editor. One Collaboration inspection could not distinguish animated cells/Braille; it stopped before inserting anything. Reinspect live ownership before treating any earlier manifest as current.
- A test harness initially stalled after inserting its own `/title` draft because its duration-based sleep did not resume in that XCTest run. The draft was recovered by inspection and the harness changed to the native application's existing nanosecond sleep convention. No agent task was submitted. This is recorded as a harness failure, not evidence of a product crash.

Evidence: `native/macos/dist/candidates/terminal-display-repair-2026-09-13/`. Logs distinguish local editor keystrokes, ordinary inspection failures, unit/simulated geometry behavior and actual native observations. No real Terminal agent was restarted and no real research prompt was submitted as a test.

## Release and preservation

This is a Mac-only native repair. Existing iPhone/TestFlight speech work is preserved; a new iPhone build is unnecessary for this lane. Installed Mac 140 became native-ready in **9.421 seconds**, with one installed app, matching embedded/loaded runtime, all 14 pre-install Terminal Codex process rows intact, and Assistant/research/budget data preserved. App notarization `14014f8b-9908-4e5b-86de-bf20ee64f05d` and DMG notarization `5788e3cc-2b5f-4ad8-9c76-e62ef2cc35b5` were accepted; signing, stapling and Gatekeeper verification passed.

The installed Assistant MCP verified both exact disposable input owners and completed another **12 alternating switches**, preserving `(29, 262, 597, 421)` on every switch. Native worker: `08186F57-8B05-4C2C-9433-E524F6CC7BF4`. An initial inspection returned attention before the assertions; reinspection succeeded and all actions used current identities. No input was inserted by this check. The dedicated whole-window close path then verified and closed only the two empty disposable tabs (TTYs 002 and 006). Receipt and confirmation plan are retained in `close-fixture-receipt.json`; no snapshot membership was added or deleted. Unused QA profile artifacts remain inert and documented rather than risking alteration of a real profile. Melody Companion's existing owner was also repaired at 21:25 UTC, returning to its verified empty composer.

Scoped paths: the Terminal title/geometry/selection/launch sources, their native tests, the runtime's exact prepared-launch receipt check and its test, and this report. The nine unrelated workflow/storage/plugin/branding/cloud/marketing paths present at the start remain classified and unmodified by this lane. Build scripts are pre-existing release workflow changes; the dirty plugin and exploration directories are outside the packaged runtime inputs.

Remaining physical checks: Cody's normal iPhone picker switching, manual Mac switching while near screen-filling size, and visual stability over his ordinary work session. The original intermittent shrink was not captured live. No Mac reboot, logout, power loss, real window closure, voice/call change or TTS watchdog implementation belongs to this repair.

Queued follow-ups authorized during this work: evidence-led physical iPhone crash investigation, then existing in-app project/thread Assistant access and project-message speaker readback. Preserve their scope, per-message model controls and the deferral of Open in Terminal/new settings architecture. They are separate from this display release.
