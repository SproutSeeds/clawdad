# Compact weekly allowance — iPhone build 81

The iPhone main screen and Remote Assist menu now use the same compact allowance row: the actual percentage followed by “weekly remaining” and a circled info icon. The shared `WeeklyUsageButton` supplies both locations.

## Behavior

- The info icon opens a native dismissible popover. Reset date/time, last successful refresh, and stale/unavailable explanations appear inside it. Done remains visible while the details scroll; native outside dismissal and Escape use the presentation's dismissal path.
- Reset and refresh times use the phone's current timezone and locale. Last refresh comes from the account reading's `observedAt`, including fractional-second ISO timestamps, rather than the time the UI rendered or requested a refresh.
- A stale reading retains its last known percentage in the compact row. The popover explains that the amount may have changed and presents recovery guidance. Missing or invalid percentages show “Weekly allowance unavailable”; they never become a fabricated 0%.
- The visible info symbol is 16 points inside a 44-by-44-point touch target. VoiceOver exposes “Weekly allowance details,” the percentage/status, and a hint describing the details. Text wraps with Dynamic Type; the popover adapts to available width and height and scrolls at large sizes.
- Existing polling, refresh requests, notification handling, 5%/0% allowance alerts, and research budget protections retain their existing paths. Opening details still requests a refresh, and Check allowance remains available inside the details.

## Verification

Evidence is under `native/macos/dist/candidates/weekly-allowance-popover-2026-09-10/` (ignored native release artifacts).

| Check | Result |
| --- | --- |
| Swift `WeeklyUsageTests` | 6 passed: current/stale/unavailable values, invalid numbers, percentage formatting, expiry, notification targeting, local reset and refresh formatting, DST and midnight boundaries |
| Swift `ResearchBudgetInputTests` | 2 passed |
| Runtime `codex-weekly-usage.test.mjs` | 10 passed, including alert thresholds and persisted deduplication |
| Runtime `research-supervisor.test.mjs` | 47 passed, including shared reserve, stale readings, latched pauses, overrides and restart safeguards |
| `app-store-connect.test.mjs` | 11 passed with build 81 metadata |
| Compact iPhone SE (3rd generation), iOS 26.5 | 3 UI flows passed: both locations, details dismissal, largest accessibility text, stale/unavailable details |
| Large iPhone 15 Pro Max, iOS 26.5 | 2 UI flows passed: both locations and largest accessibility text |
| Additional largest-text scrolling check | Passed on both phones: last-refresh details reachable with Done still accessible |

Screenshots were inspected for the compact row, both popover locations, fresh/stale/unavailable states, and large accessibility text. The initial fixed popover dimensions could crop content when iOS placed it beside the anchor; the final implementation allows both dimensions to shrink and the body to scroll. UI touch-size assertions allow only a 0.001-point floating-point measurement tolerance; the actual target remains 44 points.

Physical iPhone touch, outside-tap dismissal, VoiceOver reading/focus return, and the user's preferred text size still need hands-on confirmation. Simulator accessibility identifiers, labels, values, hints and hit areas are verified; this is not a physical VoiceOver test.

## Release

ClawDad Mobile 0.7.0 (81) is signed, uploaded, processed as `VALID`, and assigned to the existing **ClawDad Internal** group with `internalBuildState: IN_BETA_TESTING`. App Store Connect build ID: `36beae69-981b-4084-8580-81ee281d9455`. Internal test notes were updated for this build.

The archive bundle identity and version were checked, and `codesign --verify --deep --strict` passed. The executable SHA-256 is `54ebfcf1ec33b5714669691be1e89fda94bb0619f91a18bab597e5f6af9d78f6`. Apple accepted the upload with the existing third-party WebRTC missing-dSYM warning; that limits symbolication of that vendor framework and did not block the build.

Installed Mac version was rechecked as 0.7.0 (101); this presentation-only iPhone change requires no Mac replacement. Physical iPhone installation has not been verified. TestFlight availability is confirmed in `testflight81-release.json`; archive and upload evidence is in `ios-81-archive-verification.json` and `ios-81-upload.log`.

## Workspace preservation

This checkpoint covers the shared iPhone allowance UI, preview fixtures, focused tests and build metadata. The prior nine unrelated dirty paths remain preserved:

- Native release/storage workflow: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`. Next action: review in their existing workflow lane.
- Plugin integration metadata: `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`. Next action: separate plugin checkpoint.
- Design and site work: `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`. Next action: review with those workstreams.

The pre-release hygiene result is `dirty_classified`, with zero unclassified paths. The scoped source, tests, metadata and this report are checkpointed together; final hygiene evidence is saved as `hygiene-final.json`. No broad branch push, CLI publication, infrastructure changes, or supervisor activation is part of this release.
