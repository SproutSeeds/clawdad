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
  --evidence "Build 33 launched from a clean TestFlight install."
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

## Native Beta 12, Mac Build 34, And iPhone Build 33 Automation

| Check | State | Evidence |
| --- | --- | --- |
| Node integration suite | Pass | 464 tests passed on the release checkpoint |
| iPhone Swift unit suite | Pass | `swift test --package-path apps/ios/ClawDadMobile`: 46 tests passed |
| Remote Assist protocol suite | Pass | `swift test --package-path native/ClawDadRemoteAssistProtocol`: 28 tests passed |
| Mac Swift unit suite | Pass | `swift test --package-path native/macos`: 63 tests passed |
| Native runtime bundle and ownership | Pass | Release coverage verifies the Mac app embeds runtime `0.7.0-beta.12`, checksum-verified Node 24.20.0, and ORP |
| Mac system readiness | Pass | Swift and source coverage verify role selection, managed-runtime checks, consent-driven official Codex installation, shared `~/.codex` authentication, and controller-only completion without local Codex |
| Nonblocking startup | Pass | Integration coverage verifies the app control plane becomes healthy while a slow or unavailable Codex runtime initializes in the background |
| Mac signed package | Pass | The local beta 12 DMG and ZIP checksums pass for Apple silicon and Intel |
| Mac notarization and stapling | Pass | Both architecture-specific apps and DMGs are notarized, stapled, and accepted by Gatekeeper |
| Website delivery | Pending live verification | clawdad.earth will link to the final GitHub release assets because the managed-runtime DMGs exceed the website host's per-file limit |
| Distribution boundary | Pass | Public GitHub assets and the clawdad.earth download page are authorized for this native release; npm, the primary Apple-silicon appcast, and external iPhone channels remain unchanged |
| Mac project picker | Pass | Native inspection verified grouped search, selection, Add Existing, default-root quick create, name validation, Escape, and focus restoration |
| Mac Threads panel | Pass | Native inspection verified persistent Project/All scope, recent cards, conversation selection, and responsive two-column/one-column layouts |
| Mac Read Aloud surface | Pass | Native inspection found separate sent/response speaker controls; a sent-message request completed local preparation and became reusable playback |
| Project creation authority | Pass | Tests prove an authenticated phone can send only a name and the Mac creates under its configured default root while ignoring a phone-supplied root |
| Paired-Mac-first Read Aloud | Pass | Tests prove sent and received speech requests carry Mac-first policy and avoid Umbra when fallback is disabled |
| iPhone Read Aloud playback session | Pass | Source and regression coverage activate `.playback` with `.spokenAudio` and exclude incompatible explicit AirPlay or Bluetooth options; system routing remains automatic |
| Connection recovery states | Pass | Source and behavior tests cover automatic reconnect wording, host-offline distinction, and bounded Remote Assist timeout |
| Candidate readiness identity | Pass | Snapshot logic requires runtime beta 12, TestFlight build 33, installed iPhone build 33, and installed Mac build 34 before physical certification can become ready |
| Multi-computer routing | Pass | iPhone tests prove each paired host retains its own project and thread selection; all signed requests and Remote Assist use the selected host identity |
| Mac-to-Mac controller | Pass | Swift and source-contract tests cover separate controller identity, pinned host verification, Keychain relay credentials, paired-computer persistence, native Remote Assist, clipboard, commands, and display selection |
| Compact Remote Assist controls | Pass | Source and Swift coverage place a 36-point visual launcher inside a 44-point target at the lower-right viewport edge, constrain the main and shortcut panels to 168 and 216 points including padding, preserve a visible submenu back path, and collapse after each action |
| Remote Terminal tab switcher | Pass | Shared protocol, Mac, and iPhone tests cover bounded catalog requests, opaque IDs, explicit Back and Refresh controls, exact tab focus, catalog revision checks, busy/selected state, locked-Mac rejection, timeouts, explicit macOS Automation consent registration, final app signing with the Apple Events entitlement, and direct routing to the Automation pane after denial |
| Remote special commands | Pass | The shared protocol allow-lists Control-C, Control-J, Escape, Tab, arrows, Control-L, Command-Tab, and Command-T; Mac tests keep target commands scoped and use balanced system sequences for Command shortcuts |
| Persisted event privacy | Pass | Integration coverage redacts credentials before event and live-checkpoint writes |
| Relay hibernation and TURN controls | Pass | Worker tests cover socket restoration, trusted-device issuance, pseudonymous attribution, bounded credentials, budget cutoffs, direct STUN fallback, and admin pause |

## Release Surfaces

Native beta 12 combines the managed Node and ORP runtime, guided system setup,
shared Codex authentication, computer-scoped project and thread selection,
multi-display Remote Assist, Terminal tab switching, Command-T, composer Cut,
Read Aloud, and Mac-to-Mac pairing. Physical certification remains separate
from artifact and channel verification and must be recorded against exact Mac
build 34 and iPhone build 33.

| Check | State | Acceptance |
| --- | --- | --- |
| Native distribution mode | Pass | The signed Apple-silicon and Intel Mac installers are public on clawdad.earth while the iPhone remains confined to `ClawDad Internal` |
| Mac artifact and installation | Pending install | Beta 12 build 34 has separate arm64 and x86_64 artifacts with the required Node and Automation entitlements, notarized, stapled, checksum-verified, and Gatekeeper-approved; Studio installation is the remaining local artifact gate |
| Internal TestFlight companion | Pass | Build 33 is `VALID` and assigned only to `ClawDad Internal` |
| External TestFlight boundary | Pass | External build assignment and public link are false; Beta App Review is `NOT_SUBMITTED` |
| Native service topology | Pass | App-managed native services use port 4487 only and legacy labels are disabled |

## Physical iPhone And Mac

| Check | State | Acceptance |
| --- | --- | --- |
| Native Mac workspace parity | Pending visual read-back | Install build 34 and complete the setup assistant; fresh packaged-app UI inspection remains a physical gate |
| Mac laptop to Studio pairing | Pending | Install build 34 from clawdad.earth, pair with a fresh Studio code, and open the Studio in native Remote Assist |
| Studio to Mac laptop pairing | Pending | Repeat with a fresh laptop code and confirm the Studio can open the laptop independently |
| Fresh TestFlight install | Pending | Build 33 launches to the subscription or pairing surface without stale workspace flash |
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
| Remote Assist | Pending | Every connected display can be selected in one session; Terminal Tabs focuses the chosen Terminal window/tab after any one-time Automation approval; switching pauses input until commit; negative-origin click mapping, disconnect fallback, landscape, pointer, scrolling, commands, keyboard, clipboard, timeout, and retry work |
| Wi-Fi to cellular | Pending | Thread and Remote Assist recover without re-pairing or an indefinite spinner |
| Restrictive network | Pending | Production credentials are active; requires a forced-TURN physical iPhone pass |

## Certification Rule

The native artifact boundary is complete when the exact local and public Mac
artifacts match, installed build 34 passes, and TestFlight build 33 remains
`VALID` in `ClawDad Internal`. Physical certification is complete only after the
pending two-Mac, iPhone, and Remote Assist rows pass against installed Mac build
34 and TestFlight build 33. External TestFlight, Beta App Review, and App Store submission require
separate release authorization and the human gates in
`docs/app-store/review-handoff.md`.
