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
  --evidence "Build 19 launched from a clean TestFlight install."
```

Inspect progress with `node bin/clawdad-certify status --json`. A `pass` record
is accepted only while the connected physical iPhone has the expected
TestFlight/App Store version and build. The mode-`0600` ledger is preserved
across snapshots and automatically stops applying when the release identity
changes. Use `fail` or `blocked` with concrete evidence when a check exposes a
problem; use `pending` to clear a result for a fresh rerun.

## Automated

| Check | State | Evidence |
| --- | --- | --- |
| Node integration suite | Pass | `npm test`: 397 tests passed |
| iPhone Swift unit suite | Pass | `swift test --package-path apps/ios/ClawDadMobile`: 15 tests passed |
| Mac Swift unit suite | Pass | `swift test --package-path native/macos`: 8 tests passed |
| Simulator build | Pass | `npm run ios:build` completed for the final build-19 source |
| Certification snapshot | Pass | `npm run certify:snapshot` writes a mode-`0600`, path-free artifact and fails readiness closed when published, installed, or connected-device versions differ |
| Signed iPhone archive | Pass | `npm run ios:archive`; `ClawDadMobile.xcarchive` is version 0.7.0, build 19, and passes strict code-signature validation |
| TestFlight processing | Pass | App Store Connect build 19 is `VALID`, export-compliance complete, localized, and assigned to `ClawDad Internal`; private external group `ClawDad Founding Customers` is prepared with no build or public link |
| Mac signing and notarization | Pass | `npm run native:release`; beta.4 app `0.7.0 (19)`, ZIP, and DMG are signed, notarized, stapled, Gatekeeper-accepted, and checksum-verified |
| Persisted event privacy | Pass | Integration coverage redacts credentials before event and live-checkpoint writes; the local JSONL history scan contains no token-shaped or plaintext authorization values |
| Relay hibernation and TURN controls | Pass | Worker tests prove socket restoration after Durable Object eviction, trusted-device issuance, pseudonymous customer attribution, 15-minute credentials, analytics caching, per-customer and global cutoffs, direct STUN fallback, and admin pause |
| Production TURN control plane | Pass | Production reports TURN enabled with healthy account analytics and zero measured egress; a guarded live exercise activated the global pause, observed it through the status route, and restored the original unpaused state |
| External spend alert | Pass | Cloudflare shows the account-wide `ClawDad Beta $5 Guard` at a `$5.00` budget with one verified recipient; the alert is informational and the Worker cutoff remains the enforcement path |
| Package contents | Pass | The immutable published beta.4 artifact is 207 files with shasum `b38f32333bcb60ef55d853c69c0bdb2a00cf5bfc`; the post-release branch dry run is a distinct 209-file package containing release-certification and TURN-budget operations tooling while excluding wordmark explorations |
| Cloud public health | Pass | Production `/healthz`, `/support`, `/privacy`, and `/mac/appcast.xml` returned HTTP 200 after the final Worker upload; script settings report Logpush off and observability absent/disabled |

## Physical iPhone And Mac

| Check | State | Acceptance |
| --- | --- | --- |
| Fresh TestFlight install | Pending | Build 19 launches to the subscription or pairing surface without stale workspace flash |
| Purchase monthly | Pending | Sandbox purchase grants iPhone access and syncs verified access to Mac |
| Restore purchase | Pending | Reinstall or sign-out path restores access |
| Cancel renewal | Pending | Access remains through expiration; status updates without exposing transaction data |
| Fresh QR pairing | Pending | One device appears in Mac inventory with a unique credential |
| Revoke and re-pair | Pending | Revoked phone is rejected; fresh QR restores access |
| Direct during active work | Pending | Message steers the active turn after the current tool call |
| Queue during active work | Pending | Message starts only after the active turn reaches a terminal response |
| Long turn | Pending | Heartbeats preserve a healthy turn for at least 30 minutes |
| App relaunch | Pending | Selected project/thread restore without Scratchpad flash |
| Mac lock and unlock | Pending | Thread transport survives lock; Remote Assist text unlock works |
| Mac sleep and wake | Pending | iPhone shows Mac unavailable, then reconnects without re-pairing |
| Voice | Pending | Recording animates, transcription appends, and response audio plays |
| Image | Pending | Up to four prepared images reach the selected Codex thread |
| Remote Assist | Pending | Landscape, pointer, scrolling, keyboard, Enter, paste, and copy work |
| Wi-Fi to cellular | Pending | Thread reconnects and sends without manual Connect |
| Restrictive network | Pending | Realtime and production credentials are active; requires a forced-TURN physical iPhone pass |

## Certification Rule

Founding-customer distribution can begin when every row except Restrictive
network is Pass, production relay enforcement is enabled, and Apple approves
the certified build for the private external TestFlight group. Public App Store
submission additionally requires the human gates in
`docs/app-store/review-handoff.md`.
