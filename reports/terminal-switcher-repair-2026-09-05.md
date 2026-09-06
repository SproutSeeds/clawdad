# Terminal switcher repair

Status: Mac 52 installed and healthy; iPhone 44 available in Internal TestFlight.
This follows the [audit](terminal-switcher-audit-2026-09-05.md) of Mac 51 / iPhone 43.

## Findings confirmed on the actual Mac

The command tool can run the read-only Terminal scripting diagnostic. The earlier
Computer Use refusal applied to that UI tool; it did not prohibit this ordinary,
user-requested scripting query. No manual command from Cody was needed.

Terminal initially exposed 13 one-tab scripting windows sharing one native tab bar.
Scripting window indexes followed focus order. The native tab bar exposed the actual
left-to-right order and full directory metadata. Individual idle buttons sometimes
returned AXFailure for AXValue, while the tab group's AXValue reliably identified
the selected button.

The old catalog issued separate scripting requests per window. Five complete
catalogs using the repaired bulk query took 0.959 seconds total on this Mac, with
13 stable row IDs, one stable group, and the expected directory labels.

The live focus test initially caught a successful AXPress followed by an unconfirmed
selection. Avoiding an unnecessary raise of the already-focused window and waiting
on the tab group's selected control repaired the action. First, middle and last
selection plus restoration passed in 1.30 seconds of action time.

An early drag test overlapped with another tab opening and later selection changes.
The new tab was retained. A subsequent test exposed an overshooting drop point.
The final path drops at the destination center and avoids moving the cursor again
immediately after posting mouse-up. The final live adjacent move and restoration
passed with all 14 current tabs and the initial selection preserved. A further move
across three tab positions and restoration also passed in 2.52 seconds.

## Changes

- Build candidate catalogs without mutating the accepted control/group/shell
  registries. Validate both native reads and the shell catalog before committing.
  Retry short layout transitions within one bounded read budget.
- Use the group's selected control, per-element timeouts and an overall deadline.
  Read shell metadata in bulk and verify scripting window order remained stable.
- Preserve group identity through overlapping controls and known selected-shell
  identity. Rebind a replaced selected control to its verified shell. Learning a
  previously unknown shell never renames the row the phone just tapped.
- Sort complete usable tab frames left to right. Preserve native model order for
  overflow controls, whose old frames can overlap. Offer dragging only for a fully
  visible, geometrically verified strip.
- Show directory basenames; retain duplicate rows and tab positions. Paths and
  titles remain display metadata and are never used as production identifiers.
- Focus a previously verified shell by window ID and TTY. Confirm native presses
  through the selected-control attribute and then a fresh catalog.
- Reconcile failures and allow one phone retry for the same surviving row ID.
  An explicit tap can reassert a row even if the phone already highlights it.
- End the drag polling pause on completion, cancellation, no-op and dismissal.
  Retire in-flight polls at drag start so late replies cannot change the rows.
- Verify the native element under a drag's starting point, clear synthetic event
  modifiers, and abort if selection changes during the drag. Preserve an intervening
  user selection instead of restoring over it. Confirm resulting order and selection.
- Record operation type, outcome and elapsed milliseconds in local macOS logs.
  Terminal contents, clipboard text and TTYs are excluded from these timing records.

The shared high-quality speech path and local file storage remain as released.
The repaired selected-tab catalog also supplies speech and dictation ownership.

## Verification

- Runtime: 480 tests passed.
- Release metadata after the build-number update: 11 tests passed.
- Mobile Swift package: 75 tests passed.
- Final full Mac suite: 108 tests, four opt-in/live checks skipped, zero failures.
- Native AppKit fixture: two physical fixture windows, 20 duplicate-named tabs in
  one group, overflow and focus changes. The adapter now handles AppKit's legacy
  Accessibility proxies. Fixture windows live until the isolated test process exits
  to avoid asynchronous native-tab teardown errors.
- Actual Terminal: repeated read-only catalogs, first/middle/last focus and restoration,
  and real adjacent and three-position moves followed by restoration. These tests
  are opt-in and never type into or create/close shell sessions.
- iPhone simulator: grouped windows, duplicate rows, drag, Back and expansion retention
  passed twice, including the final polling lifecycle change. The retained screenshot
  was reviewed.

Remaining physical acceptance: phone/Mac side-by-side testing with two real Terminal
windows, 20+ tabs, open/close and hidden-tab-bar transitions; moves beyond the tested
three-position distance and overflow behavior; phone speech/dictation and input-target
preservation. Dragging requires all tab frames to be visible and verified. Automated
fixtures and host checks establish narrower evidence than that full phone walkthrough.
When all controls of an unselected tab are replaced, an unproven row is refreshed;
the adapter does not guess identity from a duplicate title or directory.

## Native release

Verified at 2026-09-06 04:54 UTC (September 5 local time).

- Mac 0.7.0 (52): installed at /Applications/ClawDad.app; Developer ID signature,
  Gatekeeper acceptance and notarization staple verified. Notary submission
  1827a17e-de17-4168-9a08-c2c01b113d2f is Accepted.
- Installed executable matches the release candidate, SHA-256:
  30f17036644a59362ba7283c3ef2674404f8a9821a5f0efad8a646808a2426db.
- Stapled ZIP SHA-256:
  b21b0f94d537c4a3f46b44c23d45be5c2bef81a05d0262188d884ac3dbf3cfae.
- Bundled and active runtime markers match:
  080930f9da2315fbb5e72d82799b9c43efa49c1d293f37315a2d4c3519ee4efb.
  The installed service is healthy on canonical port 4487, with the shared Codex
  app server ready. A second restart recovered the canonical port after the old
  listener's TIME_WAIT interval. The app UI rendered normally after installation.
- Mac 51 is retained in the existing App Backups directory for rollback.
- iPhone 0.7.0 (44): uploaded and VALID, build
  1575a567-e002-4382-a53b-93b0e761a2a9, assigned to ClawDad Internal
  (bbba6b69-7ac4-4d56-bc41-e9456d56b02e). Test instructions were read back.
  The upload reported the existing WebRTC dSYM warning and was accepted.
- Release receipts are mac52-installed-status.json and testflight44-status.json
  in the Mac candidate directory. Public npm, GitHub releases, appcast, external
  TestFlight and App Store publication were outside this native repair release.

## Local artifacts and workspace

Runtime and metadata evidence: .clawdad/diagnostics/terminal-layout/.
Mac test logs: native/macos/.build/terminal-*.log.
Mac candidate: native/macos/dist/candidates/terminal-repair-2026-09-05/.
iPhone archive: apps/ios/ClawDadMobile/build/TerminalRepair44.xcarchive.
UI bundles: TerminalRepair44UITests.xcresult and TerminalRepair44FinalUITests.xcresult
in the iPhone build directory. Reviewed attachment: terminal-repair-ui-review/.

Five pre-existing dirty groups are preserved for separate owner review:
.agents/skills/clawdad-release/SKILL.md;
plugins/clawdad-codex-integration/.codex-plugin/plugin.json;
plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md;
assets/wordmark-explorations/; marketing-site/.
The repair is checkpointed separately with explicit path staging.
Final hygiene must retain these five groups with zero unclassified paths; their
next action is separate owner review and a scoped checkpoint.
