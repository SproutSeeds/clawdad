# Remote Assist Terminal targeting repair

This Mac repair restores independent verification of the input selected when the
iPhone menu opens. Dictation, photo insertion, and Quick Chat use that native
control identity. Terminal response lookup tolerates unrelated shell metadata
gaps while continuing to require an unambiguous agent conversation.

## Observed incident

- ClawDad recorded 15 consecutive `layout_unavailable` catalog failures around
  12:05 local time on September 7. The generic window-layout message covered
  changed selection, a native/scripting tab-count mismatch, and duplicate TTYs.
- An iPhone image was saved locally on the Mac at 12:06. The user confirmed that
  both images and transcribed text reached clipboard/storage fallback instead of
  entering the selected Terminal input.
- Input capture swallowed a failed catalog lookup and acknowledged a capture
  with no terminal identity. That immutable capture could never pass delivery
  validation, including after catalog recovery.
- Latest-response reading required the same catalog before requesting speech.
  It also discarded a correctly targeted response if another window changed the
  global topology revision while text was being read.
- The Assistant launcher encoded filesystem paths using optional JSON slash
  escapes inside TOML configuration overrides. The installed Codex parser rejected
  the resulting MCP argument array. The repaired serializer passed that same
  parser, including paths containing spaces, quotes, and backslashes.

The exact native/scripting mismatch in the original live window layout was not
observable in the old logs. Direct Terminal inspection was blocked by the
computer-control tool. This release fixes the independently reproduced failure
mechanisms and records metadata counts for future diagnosis; it does not claim a
live Terminal reproduction that was not performed.

## Implementation

- Focused input verification reads the focused native window and selected tab
  control twice on the existing serialized native worker. It does not inventory
  unrelated windows or require a scripting shell catalog. Captured identities
  distinguish same-directory tabs, control replacement, and window replacement.
- The visible native controls remain the tab inventory. Missing or reused TTYs
  stay unbound; a unique selected shell can still enrich its own control. A
  focused-selection change during discovery retries the observation. Background
  window order/count changes do not invalidate the selected shell.
- An unavailable capture is returned as a failure, distinct from a successful
  capture with no focused input. Failed captures cannot later adopt a new input.
- Delivery retries temporary identity reads only for an already captured target,
  at most three attempts. Input generation, expiry, window, caret, and native tab
  identity are rechecked. Retries do not repeat input actions. Existing text and
  image delivery receipts continue preventing duplicate insertion.
- Photo identity reads avoid waiting on a queued focus operation that is itself
  waiting for image paste to finish. A focus request invalidates the old capture.
- Read-aloud accepts an unchanged native target across unrelated topology
  revisions, then rechecks selection and shell identity after retrieving the
  response. Unknown, replaced, and ambiguously bound shells cannot supply audio.
- Assistant MCP overrides use TOML-compatible string escaping. Recovered
  coordinator conversations must belong to the Assistant directory and, when
  known, the same session ID; stale TTYs cannot adopt a different project.

No iPhone protocol changes, speech-model changes, cloud resource additions, or
file retransmission changes are needed. The existing iPhone build 53 is compatible.
The proposed call-style Assistant UI is a separate follow-up to this repair.

## Validation

| Check | Result |
| --- | --- |
| Full runtime suite | 513 passed |
| Full Mac suite | 169 passed; six opt-in live Terminal tests skipped |
| Mobile compatibility suite | 101 passed |
| Installed Codex configuration parser | Two path round trips passed; no Terminal launched |
| Mac arm64 Release build | Passed, build 67 / version 0.7.0 |
| Developer ID signature | Strict verification passed |
| Apple notarization | Accepted: `ccaff495-cfa6-40f1-aa00-0cd6b8bc1fd1` |

The added tests cover finished Assistant windows, absent and reused TTYs,
background window order, selection changing during capture/discovery, recovery
limited to the original input, truthful capture failure, unrelated windows closing
during response retrieval, replaced shells, and stale coordinator conversations.
Existing image receipt, clipboard, tab focus/reorder/close, and selected-text tests
also passed as part of the suites above.

Evidence and the signed package are under
`native/macos/dist/candidates/terminal-targeting-2026-09-07/`.
Physical iPhone insertion and audio playback remain a separate hands-on check.

## Release and workspace

Build 67 was installed at 19:02 UTC on September 7. The candidate's
`install-verification.json` records the binary hash, one running native app,
strict signature verification, Gatekeeper acceptance, and HTTP 200 checks for
health, native capabilities, and Assistant state. The restarted service selected
port 4488; verification followed its advertised connection address. The bundled
JavaScript runtime sources match the previous release.

Mac build 66 is retained as `ClawDad-Mac-66-rollback.app` in the candidate directory.
The installed ClawDad window was hidden after startup while its host remains
running. This is a private native Mac update; the iPhone does not need a new
TestFlight build.

The scoped paths are recorded in `scoped-paths.txt`. Eight existing dirty groups
remain outside this patch: both release skill copies, `native/macos/build-app.sh`,
`native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, the plugin
manifest, `assets/wordmark-explorations/`, and `marketing-site/`. Their next action
is review/checkpoint in their existing release-workflow, plugin, artwork, and
marketing lanes. No unrelated paths are staged with this repair.
