# ClawDad 0.7 Reliability Certification

Automated checks, native Mac inspection, and physical-device checks are
recorded separately. A row is complete only when its evidence column names the
command, artifact, or observed result.

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
  --evidence "Build 27 launched from a clean TestFlight install."
```

The feature checks use `createProjectDirectory`, `readSentMessageAloud`,
`readCodexResponseAloud`, `macOnlyReadAloud`, and
`umbraReadAloudFallback` as their ledger names.

Inspect progress with `node bin/clawdad-certify status --json`. A `pass` record
is accepted only while the connected physical iPhone has the expected
TestFlight/App Store version and build and the installed Mac app matches the
candidate Mac version and build. The mode-`0600` ledger is preserved across
snapshots and automatically stops applying when either release identity
changes. Use `fail` or `blocked` with concrete evidence when a check exposes a
problem; use `pending` to clear a result for a fresh rerun.

The iPhone inventory's `builtByDeveloper` value is retained as a diagnostic
fact only. Current Apple device inventory can report that value for a
TestFlight beta, so it does not prove whether an app was side-loaded. Release
provenance instead requires the exact installed version/build, the same exact
build in App Store Connect with `VALID` processing state, and a separately
recorded fresh-TestFlight-install observation.

## Beta 7 And iPhone Build 27 Candidate Automation

| Check | State | Evidence |
| --- | --- | --- |
| Node integration suite | Pass | `npm test`: 412 tests passed |
| iPhone Swift unit suite | Pass | `swift test --package-path apps/ios/ClawDadMobile`: 25 tests passed |
| Remote Assist protocol suite | Pass | `swift test --package-path native/ClawDadRemoteAssistProtocol`: 14 tests passed |
| Mac Swift unit suite | Pass | `swift test --package-path native/macos`: 30 tests passed |
| Targeted parity and release suite | Pass | 78 workspace, release, and certification tests passed |
| Mac signed package | Pass | Local beta 7 app is version 0.7.0 build 24; the app signature and DMG/ZIP/appcast checksums validate |
| Mac notarization and stapling | Pass | Build 24 app and DMG were accepted by Apple, stapled, and accepted by Gatekeeper |
| Package contents | Pass | `npm pack --json` reports 222 entries for `clawdad@0.7.0-beta.7`; the local tarball SHA-256 is recorded in `docs/release-packet.md` |
| Mac project picker | Pass | Native inspection verified grouped search, selection, Add Existing, default-root quick create, name validation, Escape, and focus restoration |
| Mac Threads panel | Pass | Native inspection verified persistent Project/All scope, recent cards, conversation selection, and responsive two-column/one-column layouts |
| Mac Read Aloud surface | Pass | Native inspection found separate sent/response speaker controls; a sent-message request completed local preparation and became reusable playback |
| Project creation authority | Pass | Tests prove an authenticated phone can send only a name and the Mac creates under its configured default root while ignoring a phone-supplied root |
| Paired-Mac-first Read Aloud | Pass | Tests prove sent and received speech requests carry Mac-first policy and avoid Umbra when fallback is disabled |
| Connection recovery states | Pass | Source and behavior tests cover automatic reconnect wording, host-offline distinction, and bounded Remote Assist timeout |
| Candidate readiness identity | Pass | Snapshot logic requires exact npm beta 7, TestFlight build 27, installed iPhone build 27, and installed Mac build 24 before physical certification can become ready |
| Compact Remote Assist controls | Pass | Source and Swift coverage place a 36-point visual launcher inside a 44-point target at the lower-right viewport edge, constrain the main and shortcut panels to 168 and 216 points including padding, preserve a visible submenu back path, and collapse after each action |
| Remote special commands | Pass | The shared protocol allow-lists Control-C, Control-J, Escape, Tab, arrows, Control-L, and Command-Tab; Mac tests keep target commands scoped and route Command-Tab through the system event stream |
| Persisted event privacy | Pass | Integration coverage redacts credentials before event and live-checkpoint writes |
| Relay hibernation and TURN controls | Pass | Worker tests cover socket restoration, trusted-device issuance, pseudonymous attribution, bounded credentials, budget cutoffs, direct STUN fallback, and admin pause |

## Release Surfaces

The beta 7 source checkpoint publishes the paired Mac shortcut handler together
with iPhone build 27's Remote Assist control surface. Physical certification
remains separate from channel publication and must be recorded against exact
Mac build 24 and iPhone build 27.

| Check | State | Acceptance |
| --- | --- | --- |
| Candidate source checkpoint | Pass | `v0.7.0-beta.7` points to audited Mac source checkpoint `ca8ccc2`; iPhone build 27 comes from follow-up checkpoint `b6cc759`; all are pushed |
| npm and Git release | Partial | GitHub prerelease, DMG, ZIP, and tag agree on beta 7; npm publication is blocked by the expired local registry login |
| Mac notarization and update feed | Pass | Exact build 24 is notarized, stapled, Gatekeeper accepted, installed, and served by a public appcast whose hash matches the signed local feed |
| Internal TestFlight companion | Pass | Build 27 is `VALID` and assigned only to `ClawDad Internal`; the external group is unassigned and Beta App Review is not submitted |
| Cloud/public health refresh | Pass | Public appcast and cloud health, beta 7 local/native health, one Mac app process, and the configured relay host all read back successfully |

## Physical iPhone And Mac

| Check | State | Acceptance |
| --- | --- | --- |
| Native Mac workspace parity | Pending visual read-back | Build 24 is installed and healthy and preserves the tested project picker, create form, Add Existing, Project/All threads, conversation, speaker-control, and responsive-layout source; fresh packaged-app UI inspection remains |
| Fresh TestFlight install | Pending | Build 27 launches to the subscription or pairing surface without stale workspace flash |
| Purchase monthly | Pending | Sandbox purchase grants iPhone access and syncs verified access to Mac |
| Restore purchase | Pending | Reinstall or sign-out path restores access |
| Cancel renewal | Pending | Access remains through expiration; status updates without exposing transaction data |
| Fresh QR pairing | Pending | One device appears in Mac inventory with a unique credential |
| Revoke and re-pair | Pending | Revoked phone is rejected; fresh QR restores access |
| Create project directory | Pending | Phone plus button creates one project under the configured Mac root, registers its first Codex thread, and selects it |
| Read sent message aloud | Pending | iPhone speaker button prepares on demand and plays the selected sent message through the paired Mac |
| Read Codex response aloud | Pending | iPhone speaker button prepares on demand and plays the selected Codex response through the paired Mac |
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
| Remote Assist | Pending | Landscape, pointer, scrolling, compact primary and shortcut panels, corner launcher, submenu back path, all ten special commands, Exit, keyboard, Enter, clipboard, zoom reset, timeout, and retry work |
| Wi-Fi to cellular | Pending | Thread and Remote Assist recover without re-pairing or an indefinite spinner |
| Restrictive network | Pending | Production credentials are active; requires a forced-TURN physical iPhone pass |

## Certification Rule

Founding-customer distribution can begin when every physical row except
Restrictive network is Pass, the exact artifacts are published from one
approved source checkpoint, production relay enforcement is enabled, and Apple
approves the certified build for the private external TestFlight group. Public
App Store submission additionally requires the human gates in
`docs/app-store/review-handoff.md`.
