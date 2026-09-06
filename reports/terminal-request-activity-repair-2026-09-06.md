# Terminal Busy status follows the agent request

The repair is implemented and verified for the native Mac host. It works with
the existing iPhone build 47. Final candidate: Mac 0.7.0 build 58, which also
includes the pending desktop voice-picker stability repair. Installation needs
Terminal's App Management permission, currently off in macOS Privacy & Security.
The installed build 55 remains running while the update is prepared.

## Cause and behavior

The picker copied Terminal's shell `busy` property into the remote Busy badge.
That property can remain true while an interactive Codex process waits for the
next prompt. Native tab-to-TTY bindings are learned on selection, so viewing a
tab could make its shell's busy flag appear on the card.

The shell busy column is removed from discovery. Each verified tab TTY is now
matched to its owning Codex CLI process and CLI session file. Only a timestamped
`task_started` event after that process launched establishes Busy; `task_complete`
or `turn_aborted` clears it. An old unfinished request from an earlier process
does not make a reopened session Busy. Ordinary output, unfinished answer text,
focus, unread indicators, and the existence of an open agent process do not
establish working state.

Activity follows the owning TTY when focus or tab order changes. Presentation
changes do not increment the topology revision or replace tab identities.
Unmapped tabs, unsupported agents, ambiguous CLI bindings, and failed lookups
have no Busy badge. The existing native identity rules remain in effect: the
host does not guess a TTY from a shared directory or tab title.

One process inventory and one open-file inventory cover all known tabs. A
background actor checks logs incrementally; initial discovery reads backward
through at most 64 MiB and handles partial writes. Catalog and focus operations
return cached activity immediately and never await the process/file probe.
Unknown or oversized data fails conservatively, and old positive samples expire
after six seconds. Updated badges arrive through the existing picker polling.
This uses local Mac resources and adds no cloud compute or storage.

## Verification

- The pre-fix focus regression failed both before and after selecting an idle
  tab. The same behavior check passes with the repair.
- Full Mac suite: 121 tests executed, 117 passed, four optional physical Terminal
  interaction/response checks skipped, zero failures. The read-only live agent
  activity check was explicitly enabled.
- Shared Remote Assist protocol suite: 45 tests passed. The wire format remains
  compatible; `isBusy` retains its Boolean encoding.
- Coverage includes request start/completion/abort, ordinary output and unfinished
  final text, long records across read chunks, partial writes, truncation and
  file replacement, duplicate wrappers and subagents, ambiguous bindings,
  exited processes, reopened old sessions, deferred/expired probes, late replies
  after tabs close, focus, reordering, stable identities, and the revised six-field
  Terminal catalog decoder.
- The final live sample checked twelve Codex terminal identities and identified
  two active requests. Initial sampling took about 0.38 seconds; the next took
  about 0.17 seconds. No conversation text was printed. These are background
  sampler timings, not measurements of a physical iPhone's tap-to-switch latency.
- The installed iPhone UI already displays this Boolean from the host, so this
  repair needs no new iPhone upload. Physical iPhone badge verification remains
  pending installation of the new Mac build.

## Release and installation handoff

Apple accepted build 58 notarization `685d9b2a-fbad-46ac-8ffa-088b4457ce72`.
The candidate is stapled and passes strict code-signature verification and
Gatekeeper assessment. The ready app is preserved at
`native/macos/dist/candidates/terminal-request-activity-2026-09-06/ready/ClawDad.app`.

Candidate evidence is under
`native/macos/dist/candidates/terminal-request-activity-2026-09-06/`.
It includes `baseline.log`, `targeted-tests.log`, `mac-tests.log`,
`protocol-tests.log`, build logs, and notarization evidence.

Build 57 was an intermediate notarized candidate. Build 58 includes the additional
process-launch guard and is the candidate to install. The protected installed
app has not been replaced in this task. macOS App Management was inspected through
System Settings and Terminal's switch is off. The execution process ancestry
also identifies Terminal as the responsible application.

The remaining installation step requires either a normal Finder replacement or
approval to temporarily enable Terminal's App Management permission, install the
signed build 58, and restore that permission to off. The Computer Use skill
requires confirmation for security-sensitive OS setting changes. No such setting
has been changed without approval.

The signed build 55 rollback remains at
`native/macos/dist/candidates/voice-picker-stability-2026-09-06/rollback/ClawDad-build55.app`.
Public npm, branch/tag pushes, public GitHub releases, external TestFlight, and
App Store submission are outside this repair.

## Workspace handoff

Only native request activity, its terminal integration and tests, the shared
protocol comment, and this report belong to this checkpoint. The prior desktop
voice-picker patch is already committed separately and included in the Mac build.

Eight pre-existing dirty groups remain for separate owner review and validation:
`.agents/skills/clawdad-release/SKILL.md`;
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`;
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`;
`assets/wordmark-explorations/`; `marketing-site/`; `native/macos/build-app.sh`;
`native/macos/package-release.sh`; `native/macos/storage-workflow.sh`.
The existing native build storage changes were used as present and are excluded
from this checkpoint. Preserve their separate review action. `git diff --check`
passes and ORP reports zero unclassified paths.
