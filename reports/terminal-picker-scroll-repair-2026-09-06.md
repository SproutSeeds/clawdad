# Terminal picker scroll repair

Status: iPhone 45 released to ClawDad Internal TestFlight, VALID and IN_BETA_TESTING.
The Mac host remains build 52. This is a native iPhone interaction repair.

## Problem and resulting behavior

Build 44 attached a long-press followed by a drag gesture to every tab card. The
baseline UI test reproduced the reported regression: a fast swipe over the left
side of a card left the picker at tabs 1–5. The recorded frame confirms the list
did not scroll.

Cards now accept ordinary tap selection and scrolling. A dedicated three-line
handle has a 44 × 44 point touch area, separated from the card by 12 points. A
0.35-second hold on that handle starts native interactive movement and haptic
feedback. Moving at an edge scrolls the list; drops remain within the source
window. Dropping outside the list cancels. VoiceOver has Move up and Move down
actions on the handle. Back and group expansion are preserved.

The list uses public UICollectionView movement APIs with the existing SwiftUI
cards. Its recognizer rejects touches outside the dedicated handle. Explicit begin,
end and cancel events replace the whole-card gesture observer. Apple's API defines
the movement lifecycle and cancellation behavior:
[interactive movement](https://developer.apple.com/documentation/uikit/uicollectionview/begininteractivemovementforitem(at:)),
[cancellation](https://developer.apple.com/documentation/uikit/uicollectionview/cancelinteractivemovement()).

The controller's existing revision checks and Mac acknowledgement path still own
the final order. Background catalogs pause only after native movement begins and
resume on completion, no-op, cancellation, app deactivation or picker teardown.
Terminals and agents continue running during that brief catalog pause.

## Verification

- New scroll regression failed against the prior implementation. Baseline evidence:
  apps/ios/ClawDadMobile/build/TerminalScrollBaseline.xcresult and
  build/terminal-scroll-baseline-review/after-swipe.png.
- Final iPhone simulator: four interaction tests passed in 70.5 seconds, covering
  left, center and right card swipes; hold-on-card then swipe; selection/order
  preservation; two window groups with duplicate names; handle movement and spacing;
  edge scrolling across a 20-tab group; no-op and outside-drop cancellation; Back
  and remembered expansion/scroll position.
- A debug wire-message fixture increments its displayed metadata only when a real
  catalog request arrives. The cancellation test verifies updates resume within six
  seconds after both a no-op and a canceled drag.
- Final runtime suite: 480 passed. Updated existing source-location checks for the
  extracted list and made the release test compare the Xcode build number with the
  release catalog instead of its stale hard-coded build 43.
- Mobile Swift package: 75 passed. The iOS views were separately compiled and
  exercised by the simulator tests.
- Reviewed screenshots show the separated handles and a successful edge-scroll move.
  Final UI bundle: apps/ios/ClawDadMobile/build/TerminalScroll45UITests.xcresult.
  Images: apps/ios/ClawDadMobile/build/terminal-scroll45-ui-review/.
- The additional settled-state visual check passed after the move notice cleared,
  confirming the visible Back/header controls and handle spacing. Evidence:
  build/TerminalScroll45Visual.xcresult and build/terminal-scroll45-settled-review/.

Physical iPhone thumb feel, haptics and VoiceOver remain hands-on acceptance checks.
This patch does not extend the Mac's ability to reorder overflowing/hidden native
tab strips: the existing host capability still controls whether a handle is enabled.

## Release and workspace

Archive: apps/ios/ClawDadMobile/build/TerminalScroll45.xcarchive.
Archive signature and identity verified: 0.7.0 (45), earth.frg.clawdad.ios.
Archived executable SHA-256:
3fb15fda6a0fdde406202c668c559c7f9f5528c5e51c3ee9d2b850a12f59aa40.
Upload succeeded; Apple's existing WebRTC dSYM warning did not block processing.

Apple build 196abb11-85a5-4c88-942d-4d5e1d9c6594 was verified VALID and
IN_BETA_TESTING on September 6. Its test instructions were read back, and assignment
to ClawDad Internal (bbba6b69-7ac4-4d56-bc41-e9456d56b02e) was confirmed. The
canonical release receipt is ops/app-store-release.json. External assignment is
false. Public npm, GitHub release, external TestFlight, cloud resources and Mac
installation are outside this patch.

Mac 52 remains installed; port 4487 reports healthy with the shared Codex app
server ready. No Mac restart was needed for this iPhone-only update.

Five pre-existing dirty groups remain for separate owner review and scoped commits:
.agents/skills/clawdad-release/SKILL.md;
plugins/clawdad-codex-integration/.codex-plugin/plugin.json;
plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md;
assets/wordmark-explorations/; marketing-site/.
Additional Mac storage-workflow edits appeared during this run and are also
preserved: native/macos/build-app.sh; native/macos/package-release.sh;
native/macos/storage-workflow.sh. Their next action is separate owner review and
validation of that storage workflow.

This repair stages only its source, UI fixtures/tests, release metadata and evidence.
ORP classifies all remaining paths, with zero unclassified entries.
