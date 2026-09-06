# Terminal layout diagnostics

Run the collector from a permitted local command session:

    zsh native/macos/diagnostics/collect-terminal-layout.sh

Reports go to the ignored .clawdad/diagnostics/terminal-layout/ directory. These
helpers inspect the already-running Terminal; they never activate, select, create,
move or close tabs, and do not read terminal contents, history, selected text or
clipboard data. Titles can contain working directories and process names; keep
the reports local.

The scripting report contains window IDs, TTYs, selection and bounds. Native macOS
tabs can appear as separate one-tab scripting windows. Scripting window indexes are
front-to-back order, so compare them with the native Accessibility tab strip and
its positions instead of assuming they are physical window groups.

The native report includes the group's selected control. Terminal can return
AXFailure for the individual AXValue of an idle tab; the group's AXValue still
identifies its selected tab. Overflow controls may retain stale frames.

The Mac XCTest suite includes three explicitly enabled live checks:

- CLAWDAD_TERMINAL_READ_ONLY_CHECK=1: repeated metadata-only catalogs.
- CLAWDAD_TERMINAL_FOCUS_CHECK=1: select existing first/middle/last tabs, then restore.
- CLAWDAD_TERMINAL_MOVE_CHECK=1: move the selected tab one place and restore its order.

Run an individual MacNativeTerminalTabTests test with swift test --filter.
The two action checks require an unlocked Mac, existing permissions and a quiet
Terminal. They never type commands or create/close shells. They remain skipped in
ordinary automated runs.
