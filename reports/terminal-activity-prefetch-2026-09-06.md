# Terminal activity on first opening Remote Assist

Mac 0.7.0 build 59 is installed at `/Applications/ClawDad.app`, running, healthy,
and connected to the production relay. Previous build
58 already derived Busy from request lifecycle events, but its cold native catalog
only supplies the selected tab's verified TTY. Activity for other tabs therefore
appeared after the user visited them.

## Repair

The Mac starts a read-only activity sweep when the Remote Assist control channel
opens and when the Mac unlocks. Opening and polling the picker also refreshes it.
The sweep is local, asynchronous, and uses the existing bounded process/log reader.
Its prefetch never changes the controller's accepted selection or topology.
Disconnect, lock, and session stop cancel pending prefetch work.

The bulk Terminal catalog now includes each single-tab scripting window's full
title. Native cards compare that metadata from the same validated catalog, with
normalization for the directory basename, window dimensions, spinner frame, and
transient child process suffix. The entire owner command and its arguments remain
part of the match. Both native observations must agree; incomplete matches expire
with the observation. No shell command, title change, tab selection, window raise,
or cursor operation is used to discover activity.

Activity candidates are separate from the verified TTY used for focus, dictation,
and response reading. They never become persistent tab identifiers or authorize
input. IDs, window groups, ordering, drag behavior, and the wire format are retained.
Only the owning Codex request's lifecycle events establish Busy. A spinner or an
open Codex process alone still does not establish work.

If several complete titles are indistinguishable, retain every possible owner and
show Busy only when every candidate has an active request. If those candidates have
mixed status, an unvisited ambiguous card remains unlabelled until its actual
identity is confirmed through selection. This conservative edge case preserves the
user's stronger requirement that an idle tab never borrow another agent's badge.
Legacy multi-tab scripting windows with no per-tab full title retain their existing
verified identity path. No cloud compute, storage, or additional iPhone build is
required for this Mac-side repair.

## Verification

- The new cold-catalog regression failed on the old discovery behavior: only one
  selected TTY appeared; two unvisited cards had no activity candidates. It now
  passes while both unvisited input identities remain empty.
- Coverage includes duplicate directories, identical full titles, incomplete
  metadata, changing titles, rotating spinners and child processes, first-picker
  prefetch, and conservative mixed-status handling with stable IDs and revisions.
- Full Mac suite: 128 executed, 125 passed, three opt-in physical actuation/response
  checks skipped, zero failures. Existing request start/completion/abort coverage,
  native two-window/20-tab fixture, and speech/input ownership checks pass.
- Read-only cold start on the actual Mac: all 17 cards covered, 16 never selected,
  two Busy requests. Full cold-check duration approximately 1.06 seconds; selection,
  order, group IDs, and revision remained stable across later reads. These are host
  integration timings, not physical iPhone latency measurements.
- The live lifecycle sampler independently checked 14 Codex TTYs and reported two
  active requests: approximately 0.35 seconds initially and 0.19 seconds next time.
- Shared Remote Assist protocol: 45 tests passed.
- Runtime suite: all 491 tests passed. Combined with the Mac and protocol suites,
  661 tests passed and three optional physical checks were skipped.
- Build 59 was Developer ID signed and accepted by Apple notarization submission
  `88ad6eed-085d-4652-8028-0fb2415239f3`. The installed app passes strict deep
  signature validation, stapled-ticket validation, and Gatekeeper assessment.
- Finder's normal Copy/Replace completed after quitting the old app. No App
  Management or other security setting was changed. The installed executable and
  notarized candidate share SHA-256
  `cb03af9fa0f0884a72fac80d6fc2cb56afba1052e67749cc8649a6a2fe378e95`.
- The app UI loaded from canonical port 4487. Authenticated health reports
  `ok: true` and the shared Codex app server ready. The managed host has an
  established TLS connection to the existing production relay, with no stderr
  errors after startup.
- The signed installed-host probe passed against the real local API. Bundled and
  managed protocol/connector/web sources match the audited workspace, the full
  voice catalog remains available, and saved voice preferences were preserved.
  That probe uses an in-process relay with ephemeral identities; it is not a
  physical iPhone Remote Assist session.

If the picker opens before its first background sample finishes, or after the
six-second activity snapshot expires, badges arrive with the existing two-second
picker polling. The remaining hands-on check is a physical iPhone reconnect and
first picker opening with several active agents, including duplicate-title cases.

## Release and workspace

Evidence is under
`native/macos/dist/candidates/terminal-activity-prefetch-2026-09-06/`.
The previous signed/notarized build 58 remains in
`native/macos/dist/candidates/terminal-request-activity-2026-09-06/ready/ClawDad.app`
for rollback. This native repair uses the existing private Mac installation flow;
public npm/GitHub/App Store distribution is outside this checkpoint.

Eight pre-existing dirty groups remain preserved for separate owner review:
`.agents/skills/clawdad-release/SKILL.md`;
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`;
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`;
`assets/wordmark-explorations/`; `marketing-site/`; `native/macos/build-app.sh`;
`native/macos/package-release.sh`; `native/macos/storage-workflow.sh`.
The existing native storage workflow is used as present and stays outside this
repair commit. Its 50-GiB internal-space guard initially deferred packaging.
Three inactive, generated `ClawDadMobile-*` Xcode DerivedData directories were
moved intact into `apps/ios/ClawDadMobile/build/DerivedData/` on the external drive,
with symlinks at their original locations. Every file was hash-verified, and the
guard passed at approximately 50.14 GiB free. The exact paths and verification
receipt are in `cache-relocation.json`; no project files, session history, archives,
or application backups were removed. Existing credentials and storage policy
remained unchanged.

Only the four native implementation files, two native test files, and this report
belong to this checkpoint. ORP classified all existing paths with zero unclassified
groups; the unrelated groups retain their separate owner-review next action.
