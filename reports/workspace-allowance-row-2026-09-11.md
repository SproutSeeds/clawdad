# Main Workspace beside weekly allowance — September 11, 2026

Status: iPhone build **87** is `VALID`, assigned to **ClawDad Internal**, and `IN_BETA_TESTING`. This change has no Mac component.

Main Workspace's yellow icon and label now sit on the right of the weekly allowance/info control on the home screen. Both keep their existing 44-point minimum touch targets and actions. The shared row removes the extra vertical row at standard text sizes. Accessibility text sizes use a readable stacked arrangement; the controls retain their state when the layout changes.

Only `ContentView.swift` changes product behavior. Allowance refresh, details, alerts, research budgets, workspace save/restore, drafts, calls and Remote Assist menu placement are unchanged. Release metadata advances the iPhone build to 87.

Verification evidence is in `native/macos/dist/candidates/workspace-allowance-row-2026-09-11/`:

- **693 runtime tests passed**, zero failures (`runtime-tests.log`).
- **234 mobile tests**, one skipped, zero failures (`mobile-tests.log`).
- **11 release-metadata tests passed** (`release-metadata-tests.log`, also included in the runtime suite).
- **Four compact-iPhone UI checks passed**: workspace navigation/fixture restore, allowance popovers in both locations, accessibility text, stale/unavailable explanations (`ios-small.xcresult`).
- **Two large-iPhone UI checks passed**: Main Workspace navigation/fixture restore and allowance popovers in both locations (`ios-large.xcresult`).
- Screenshots in `visual-small/` and `visual-large/` verify the shared row. Both normal layouts and compact-phone accessibility text were visually inspected. Tests use synthetic preview data and do not restore or modify Cody's real Terminal workspace.

The existing simulator build caches were reused from the preceding Special Keys candidate; signed archives and this release's verification artifacts have their own paths. Physical iPhone layout and VoiceOver confirmation remain after installing the update.

The signed archive is `ClawDadMobile-87.xcarchive`, app version 0.7.0, build 87. `codesign --verify --deep --strict` passed. Archived executable SHA-256: `a10f264b0f4f84f75e064a95a734f23afc8655e2cc4b5400b9d11b24b6e6df7d`. The interruption left the completed archive intact; release resumed from that artifact without rebuilding it or repeating the passed checks. Upload succeeded on September 11 at 13:04 UTC (08:04 CDT). The existing missing WebRTC dSYM warning was non-blocking. Apple subsequently marked build `c9d3b7be-11ce-4c37-bf07-c27f018a9e82` valid; the internal group relationship and `IN_BETA_TESTING` state were verified (`testflight87-release.json`). No external TestFlight, public App Store, npm or Mac publication was performed.

The nine pre-existing dirty entries are preserved outside this checkpoint: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, and `marketing-site/`. Their next actions remain with the release-workflow, integration, design, cloud and site lanes. No broad Terminal-control audit repair is included.

This checkpoint covers six audited files: the home view, iPhone project/spec, release catalog, release test fixtures and this report. `git diff --check` passed; final ORP hygiene evidence is `hygiene-final.json` in the candidate directory. The branch's unrelated commit backlog was preserved locally.
