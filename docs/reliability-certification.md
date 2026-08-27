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
  --evidence "Build 30 launched from a clean TestFlight install."
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

## Beta 8 And iPhone Build 30 Candidate Automation

| Check | State | Evidence |
| --- | --- | --- |
| Node integration suite | Pass | `npm test`: 414 tests passed |
| iPhone Swift unit suite | Pass | `swift test --package-path apps/ios/ClawDadMobile`: 28 tests passed |
| Remote Assist protocol suite | Pass | `swift test --package-path native/ClawDadRemoteAssistProtocol`: 15 tests passed |
| Mac Swift unit suite | Pass | `swift test --package-path native/macos`: 36 tests passed |
| Targeted parity and release suite | Pass | 66 release and certification tests passed |
| Mac signed package | Pass | GitHub serves the exact beta 8 DMG and ZIP; build 25 is installed on the paired Mac |
| Mac notarization and stapling | Pass | The app and DMG are notarized and stapled; Gatekeeper accepts installed build 25 |
| Package contents | Pass | The verified beta 8 tarball has 228 entries and SHA-256 `783c1feffbc971f9b726d200cbecc6e31735d274ff5667a3ffa59786f76df252`; npm serves it through the public `beta` tag |
| Mac project picker | Pass | Native inspection verified grouped search, selection, Add Existing, default-root quick create, name validation, Escape, and focus restoration |
| Mac Threads panel | Pass | Native inspection verified persistent Project/All scope, recent cards, conversation selection, and responsive two-column/one-column layouts |
| Mac Read Aloud surface | Pass | Native inspection found separate sent/response speaker controls; a sent-message request completed local preparation and became reusable playback |
| Project creation authority | Pass | Tests prove an authenticated phone can send only a name and the Mac creates under its configured default root while ignoring a phone-supplied root |
| Paired-Mac-first Read Aloud | Pass | Tests prove sent and received speech requests carry Mac-first policy and avoid Umbra when fallback is disabled |
| iPhone Read Aloud playback session | Pass | Source and regression coverage activate `.playback` with `.spokenAudio` and exclude incompatible explicit AirPlay or Bluetooth options; system routing remains automatic |
| Connection recovery states | Pass | Source and behavior tests cover automatic reconnect wording, host-offline distinction, and bounded Remote Assist timeout |
| Candidate readiness identity | Pass | Snapshot logic requires exact npm beta 8, TestFlight build 30, installed iPhone build 30, and installed Mac build 25 before physical certification can become ready |
| Compact Remote Assist controls | Pass | Source and Swift coverage place a 36-point visual launcher inside a 44-point target at the lower-right viewport edge, constrain the main and shortcut panels to 168 and 216 points including padding, preserve a visible submenu back path, and collapse after each action |
| Remote special commands | Pass | The shared protocol allow-lists Control-C, Control-J, Escape, Tab, arrows, Control-L, Command-Tab, and Command-T; Mac tests keep target commands scoped and use balanced system sequences for Command shortcuts |
| Persisted event privacy | Pass | Integration coverage redacts credentials before event and live-checkpoint writes |
| Relay hibernation and TURN controls | Pass | Worker tests cover socket restoration, trusted-device issuance, pseudonymous attribution, bounded credentials, budget cutoffs, direct STUN fallback, and admin pause |

## Release Surfaces

The beta 8 source checkpoint defines the paired Mac modifier fix, Command-T,
composer Cut, keyboard-safe Remote Assist controls, and corrected Read Aloud
playback session. The published and installed Mac lane is beta 8 build 25.
Physical certification remains separate from channel publication and must be
recorded against exact Mac build 25 and iPhone build 30.

| Check | State | Acceptance |
| --- | --- | --- |
| Candidate source checkpoint | Pass | Release checkpoint `aefc633` and feature checkpoint `3d64694` are pushed; annotated tag `v0.7.0-beta.8` resolves to the release checkpoint |
| npm and Git release | Pass | The GitHub prerelease and exact assets are public; npm serves beta 8 through the public `beta` tag with shasum `ea47ff63de6f90e5fa0573012301c21b72d7a5f0` |
| Mac notarization and update feed | Pass | Beta 8 build 25 is installed, notarized, stapled, Gatekeeper-approved, and advertised by the byte-matched signed public appcast |
| Internal TestFlight companion | Pass | Build 30 is `VALID` and assigned only to `ClawDad Internal`; the external group is unassigned and Beta App Review is not submitted |
| Cloud/public health refresh | Pass | Public appcast, beta 8 global/native runtime health, one Mac app process, and the configured relay host all read back successfully |

## Physical iPhone And Mac

| Check | State | Acceptance |
| --- | --- | --- |
| Native Mac workspace parity | Pending visual read-back | Build 25 is installed; fresh packaged-app UI inspection remains a physical gate |
| Fresh TestFlight install | Pending | Build 30 launches to the subscription or pairing surface without stale workspace flash |
| Purchase monthly | Pending | Sandbox purchase grants iPhone access and syncs verified access to Mac |
| Restore purchase | Pending | Reinstall or sign-out path restores access |
| Cancel renewal | Pending | Access remains through expiration; status updates without exposing transaction data |
| Fresh QR pairing | Pending | One device appears in Mac inventory with a unique credential |
| Revoke and re-pair | Pending | Revoked phone is rejected; fresh QR restores access |
| Create project directory | Pending | Phone plus button creates one project under the configured Mac root, registers its first Codex thread, and selects it |
| Read sent message aloud | Pending | iPhone speaker button prepares the selected sent message on the paired Mac and plays the returned audio through the selected iPhone route |
| Read Codex response aloud | Pending | iPhone speaker button prepares the selected Codex response on the paired Mac and plays the returned audio through the selected iPhone route |
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
| Remote Assist | Pending | Landscape, pointer, scrolling, compact primary and shortcut panels, keyboard-safe corner launcher, tap-to-dismiss keyboard behavior, submenu back path, all eleven special commands including Command-T, Exit, keyboard, Enter, clipboard, zoom reset, timeout, and retry work |
| Wi-Fi to cellular | Pending | Thread and Remote Assist recover without re-pairing or an indefinite spinner |
| Restrictive network | Pending | Production credentials are active; requires a forced-TURN physical iPhone pass |

## Certification Rule

Founding-customer distribution can begin when every physical row except
Restrictive network is Pass, the exact artifacts are published from one
approved source checkpoint, production relay enforcement is enabled, and Apple
approves the certified build for the private external TestFlight group. Public
App Store submission additionally requires the human gates in
`docs/app-store/review-handoff.md`.
