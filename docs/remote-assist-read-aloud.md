# Remote Assist: Read latest response

Approved and released September 5, 2026. Mac build 46 is installed; iPhone build
38 is available in ClawDad Internal TestFlight. Evidence and physical acceptance
checks are in `../reports/terminal-reader-release-2026-09-05.md`.

- Remote Assist → … → speaker reads the selected Terminal tab's latest completed
  Codex response using the existing paired-computer Read Aloud service.
- Resolve the tab's terminal identity to the CLI's actual open conversation file.
  Exclude subagents and reject ambiguous matches. Recheck the tab and conversation
  after retrieval. This path is independent of All Projects history rendering.
- Read backward through the transcript to the latest completed turn. Preserve
  its text and completion time. A new turn in progress is labeled and the previous
  answer is available only through an explicit Play action.
- Show the source tab, response time, readable text, Pause/Resume/Stop, and Copy
  text to iPhone. Back returns to Remote Assist while a compact player remains.
- Read selected text provides an explicit fallback for other agents or Mac text.
  It copies from the current foreground app and never silently reads an old target.
- Cancel pending results on tab/computer changes, lock, disconnect, Stop, or panel
  dismissal. Stop owned audio on tab changes and when leaving Remote Assist.
- Keep tap-to-read as the default. Automatic reading of future turns is a later
  option. Older hosts show an update message.

Verification covers transcript boundaries, long output, unfinished turns,
ambiguous processes, source/request ownership, cancellation, old-host decoding,
selection fallback, UI Back/copy, native builds, and the existing runtime suite.
The release follows the installed native Mac and ClawDad Internal TestFlight path.
