# ClawDad 0.7 Reliability Certification

Automated checks and physical-device checks are recorded separately. A row is
complete only when its evidence column names the command, artifact, or observed
result.

Run `npm run certify:snapshot` before and after a physical test pass. The
command writes a privacy-safe, mode-`0600` JSON snapshot under
`~/.clawdad/certifications/` with release, Mac service, cloud, pairing,
App Store, connected-device, and installed-build state. It does not collect
messages, project contents, credentials, serial numbers, or device filesystem
paths. Service-health fields are allow-listed so project paths are excluded.

Record each observed physical result in the private release-bound ledger:

```sh
node bin/clawdad-certify record \
  --check freshTestFlightInstall \
  --state pass \
  --evidence "Build 24 launched from a clean TestFlight install."
```

The beta 5 feature checks use `createProjectDirectory`,
`readSentMessageAloud`, `readCodexResponseAloud`, `macOnlyReadAloud`, and
`umbraReadAloudFallback` as their ledger names.

Inspect progress with `node bin/clawdad-certify status --json`. A `pass` record
is accepted only while the connected physical iPhone has the expected
TestFlight/App Store version and build and the installed Mac app matches the
candidate Mac version and build. The mode-`0600` ledger is preserved across
snapshots and automatically stops applying when either release identity
changes. Use `fail` or `blocked` with concrete evidence when a check exposes a
problem; use `pending` to clear a result for a fresh rerun.

## Beta 5 Candidate Automation

| Check | State | Evidence |
| --- | --- | --- |
| Node integration suite | Pass | `npm test`: 408 tests passed |
| iPhone Swift unit suite | Pass | `swift test --package-path apps/ios/ClawDadMobile`: 25 tests passed |
| Mac Swift unit suite | Pass | `swift test --package-path native/macos`: 27 tests passed |
| Simulator build | Pass | `npm run ios:build` completed for build 24 |
| Signed iPhone archive | Pass | `ClawDadMobile-Founder-24.xcarchive` is version 0.7.0, build 24, arm64, and passes strict signature validation |
| Local iPhone export | Pass | `AppStore-24/ClawDad.ipa` retains build 24, is Apple Distribution signed, and passes strict signature validation |
| Mac signed package | Pass | Local beta 5 app is version 0.7.0 build 22; the app signature and DMG/ZIP/appcast checksums validate |
| Mac notarization and stapling | Pending | Disabled for the local candidate; required before external Mac distribution |
| Package contents | Pass | `npm pack --dry-run --json` reports 216 entries for `clawdad@0.7.0-beta.5`; the local tarball SHA-256 is recorded in `docs/release-packet.md` |
| Project creation authority | Pass | Tests prove an authenticated phone can send only a name and the Mac creates under its configured default root while ignoring a phone-supplied root |
| Paired-Mac-first Read Aloud | Pass | Tests prove sent and received speech requests carry Mac-first policy and avoid Umbra when fallback is disabled |
| Connection recovery states | Pass | Source and behavior tests cover automatic reconnect wording, host-offline distinction, and bounded Remote Assist timeout |
| Candidate readiness identity | Pass | Snapshot logic requires exact npm beta, TestFlight build 24, installed iPhone build 24, and installed Mac build 22 before physical certification can become ready |
| Persisted event privacy | Pass | Integration coverage redacts credentials before event and live-checkpoint writes |
| Relay hibernation and TURN controls | Pass | Worker tests cover socket restoration, trusted-device issuance, pseudonymous attribution, bounded credentials, budget cutoffs, direct STUN fallback, and admin pause |

## Live Release Surfaces

The beta 5 candidate has not changed any live release surface. Refresh the
production snapshot immediately before release; prior beta 4 production,
App Store, TestFlight, TURN, public-health, and spend-alert evidence remains
historical evidence rather than beta 5 certification.

| Check | State | Acceptance |
| --- | --- | --- |
| Candidate source checkpoint | Pending | Audited beta 5 source is committed at one exact SHA |
| npm and Git release | Pending | Exact beta 5 tarball, tag, and GitHub prerelease agree |
| Mac notarization and update feed | Pending | Exact build 22 is notarized, stapled, Gatekeeper accepted, and published in the signed appcast |
| TestFlight processing | Pending | Exact build 24 is uploaded, `VALID`, export-compliance complete, and assigned only to the approved group |
| Cloud/public health refresh | Pending | Production `/healthz`, `/support`, `/privacy`, appcast, TURN controls, and logging posture are rechecked without exposing customer data |

## Physical iPhone And Mac

| Check | State | Acceptance |
| --- | --- | --- |
| Fresh TestFlight install | Pending | Build 24 launches to the subscription or pairing surface without stale workspace flash |
| Purchase monthly | Pending | Sandbox purchase grants iPhone access and syncs verified access to Mac |
| Restore purchase | Pending | Reinstall or sign-out path restores access |
| Cancel renewal | Pending | Access remains through expiration; status updates without exposing transaction data |
| Fresh QR pairing | Pending | One device appears in Mac inventory with a unique credential |
| Revoke and re-pair | Pending | Revoked phone is rejected; fresh QR restores access |
| Create project directory | Pending | Phone plus button creates one project under the configured Mac root, registers its first Codex thread, and selects it |
| Read sent message aloud | Pending | Speaker button prepares on demand and plays the selected sent message |
| Read Codex response aloud | Pending | Speaker button prepares on demand and plays the selected Codex response |
| Mac-only Read Aloud | Pending | With Umbra fallback off, Mac speech succeeds and remote speech receives no request |
| Umbra fallback | Pending | With fallback on and Mac speech unavailable, Umbra supplies the requested audio after the local attempt |
| Direct during active work | Pending | Message steers the active turn after the current tool call |
| Queue during active work | Pending | Message starts only after the active turn reaches a terminal response |
| Long turn | Pending | Heartbeats preserve a healthy turn for at least 30 minutes |
| App relaunch | Pending | Selected project/thread restore without Scratchpad flash |
| Mac lock and unlock | Pending | Thread transport survives lock; Remote Assist text unlock works |
| Mac sleep and wake | Pending | iPhone names the offline Mac, then reconnects without re-pairing |
| Voice | Pending | Recording animates, transcription appends, and requested response audio plays |
| Image | Pending | Up to four prepared images reach the selected Codex thread without terminating the worker |
| Remote Assist | Pending | Landscape, pointer, scrolling, keyboard, Enter, paste, copy, timeout, and retry work |
| Wi-Fi to cellular | Pending | Thread and Remote Assist recover without re-pairing or an indefinite spinner |
| Restrictive network | Pending | Production credentials are active; requires a forced-TURN physical iPhone pass |

## Certification Rule

Founding-customer distribution can begin when every physical row except
Restrictive network is Pass, the exact artifacts are published from one
approved source checkpoint, production relay enforcement is enabled, and Apple
approves the certified build for the private external TestFlight group. Public
App Store submission additionally requires the human gates in
`docs/app-store/review-handoff.md`.
