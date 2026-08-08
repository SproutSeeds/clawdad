# ClawDad 0.7 Beta 6 Rollout Packet

Prepared: 2026-08-07

## Candidate Identity

- Package: `clawdad@0.7.0-beta.6`
- Git tag: `v0.7.0-beta.6`
- Mac app: `0.7.0 (23)`
- iPhone app: existing `0.7.0 (24)`
- Status at preparation: the source, npm tarball, notarized Mac artifacts, and
  canonical Mac installation are ready; npm, GitHub, and Sparkle publication
  follow the audited source checkpoint

## Included Scope

- The Mac project selector is now a searchable, grouped picker with names,
  paths, current selection, and an Add Existing action.
- The project-row plus button opens New Project Directory directly. It shows
  the configured primary projects root, validates the folder name locally,
  and keeps creation status visible until the Mac responds.
- A dedicated thread plus button starts a new Codex session while the existing
  session dropdown, rename, conversation, import, terminal, delegation,
  artifact, and queue controls remain available.
- A visible Threads panel provides persistent Project and All scopes. It shows
  up to 20 recent cards and opens the existing conversation view.
- Conversation cards retain separate Copy and on-demand Read Aloud controls
  for sent messages and Codex responses.
- Escape and visible close actions share one back-one-step path, close the
  topmost surface, and restore focus to the control that opened it.
- Wide Mac windows use a two-column recent-thread grid; narrow windows collapse
  to one column and preserve the full composer workflow.
- No backend migration or iPhone protocol change is required. TestFlight build
  24 remains the compatible companion and is not rebuilt for beta 6.

## Local Candidate Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| npm package | `native/macos/dist/releases/0.7.0-beta.6/npm/clawdad-0.7.0-beta.6.tgz` | `0446e8e465175947ddfbdb7ea3f3ebca59884ce389c2f1ce9bb1aef1d02144fd` |
| Mac DMG | `native/macos/dist/releases/0.7.0-beta.6/ClawDad-0.7.0-beta.6-mac.dmg` | `2afc4d1e7024ce41e060d7d038bb151e80fc666801e79ae302d695057fbfde15` |
| Mac ZIP | `native/macos/dist/releases/0.7.0-beta.6/appcast/ClawDad-0.7.0-beta.6-mac.zip` | `de8cbad21602e75736c8d7a79bfa65b9d7f534686d3796bc9a5af0006920f3ee` |
| Local appcast | `native/macos/dist/releases/0.7.0-beta.6/appcast/appcast.xml` | `ccca4021a6e2c846dd5366b983a416523569fbae534245894450b3c2583dff09` |
| Existing iPhone IPA | `apps/ios/ClawDadMobile/build/AppStore-24/ClawDad.ipa` | `f352333d50fe1ecbf9c9f70a4e6ed4eb0a136a3232cea03cdece2c158876450e` |

The iPhone archive remains
`apps/ios/ClawDadMobile/build/ClawDadMobile-Founder-24.xcarchive`. Beta 6 release
notes are in `docs/releases/0.7.0-beta.6.md`.

## Verification Completed

- `npm test`: 411/411 passed.
- `swift test --package-path apps/ios/ClawDadMobile`: 25/25 passed.
- `swift test --package-path native/macos`: 27/27 passed.
- Targeted workspace/release coverage: 66/66 passed.
- JavaScript syntax, `git diff --check`, and release metadata checks passed.
- Mac package: version `0.7.0`, build `23`; the app and DMG were signed,
  notarized, stapled, and accepted by Gatekeeper. The ZIP, signed appcast, and
  checksums validate.
- npm dry run/package: 217 entries with beta 6 metadata.
- The canonical `/Applications/ClawDad.app` is build 23, its bundled runtime is
  `0.7.0-beta.6`, and its `index.html`, `app.css`, and `app.js` exactly match
  the audited source.
- Native Mac UI inspection passed project search, quick-create destination and
  validation, Add Existing, nested Escape/back behavior, focus restoration,
  Project/All switching, thread-card conversation opening, two-column and
  one-column layouts, and accessible labels.
- A sent-message Read Aloud request completed through the local Mac path and
  advanced from preparation to reusable playback. Both sent and response
  speaker controls are present in the native conversation view.
- ORP hygiene reports zero unclassified paths. Four unrelated pre-existing
  worktree buckets remain preserved and excluded from the release checkpoint.

## Rollout Boundaries

- The release changes only the Mac web workspace and Mac/package version
  metadata. The production relay Worker is unchanged.
- iPhone `0.7.0 (24)` stays assigned to the private internal TestFlight group;
  beta 6 does not upload a new iPhone build.
- Founding-customer assignment, Beta App Review, public App Store submission,
  and paid-access certification remain behind the existing human and
  physical-device gates.
- The temporary beta 5 rollback bundle stays outside `/Applications` until the
  installed beta 6 service and release surfaces are verified. LaunchServices
  sees one canonical ClawDad app.

## Physical Device Gates

- Confirm the paired iPhone build 24 sees Mac build 23 and can reopen this
  exact ClawDad conversation.
- Create a project from the iPhone and confirm its directory appears under the
  configured Mac projects root with a selectable Codex thread.
- Play Read Aloud from one sent message and one Codex response on the iPhone.
- Disable Umbra fallback, verify Mac-only speech, and confirm a clear failure
  when the Mac speech service is intentionally unavailable.
- Enable Umbra fallback and verify it is used only after Mac speech is
  unavailable.
- Exercise Wi-Fi-to-cellular reconnect, Mac sleep/wake, and Remote Assist
  timeout/retry behavior against Mac build 23.
- Recheck voice transcription, image delivery, Direct/Queue ordering, long
  turns, and fresh-launch selection restoration.
- Complete the purchase, restore, revocation, and forced-TURN matrix before
  founding-customer distribution.

## Remaining Release Actions

1. Commit and tag the audited source as `v0.7.0-beta.6`.
2. Publish the npm beta tarball and GitHub prerelease with the notarized DMG and
   ZIP.
3. Publish and read back the signed Sparkle appcast after the GitHub assets are
   available.
4. Install the published npm beta, restart the local services, and verify one
   canonical Mac host plus established relay health.
5. Record fresh build-23/build-24 physical-device evidence before expanding
   TestFlight distribution.

## Keep Out

- `assets/wordmark-explorations/`
- unrelated local Codex hook/plugin changes
- temporary screenshots outside canonical release assets
- credentials, pairing tickets, relay tokens, and Apple-signed transactions
- local logs and customer project data
