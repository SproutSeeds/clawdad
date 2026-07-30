# ClawDad 0.7 Reliability Certification

Automated checks and physical-device checks are recorded separately. A row is
complete only when its evidence column names the command, artifact, or observed
result.

Run `npm run certify:snapshot` before and after a physical test pass. The
command writes a privacy-safe, mode-`0600` JSON snapshot under
`~/.clawdad/certifications/` with release, Mac service, cloud, pairing,
App Store, connected-device, and installed-build state. It does not collect
messages, project contents, credentials, serial numbers, or device filesystem
paths.

## Automated

| Check | State | Evidence |
| --- | --- | --- |
| Node integration suite | Pass | `npm test`: 377 tests passed |
| iPhone Swift unit suite | Pass | `swift test --package-path apps/ios/ClawDadMobile`: 13 tests passed |
| Mac Swift unit suite | Pass | `swift test --package-path native/macos`: 8 tests passed |
| Simulator build | Pass | `npm run ios:build` completed for the final build-19 source |
| Certification snapshot | Pass | `npm run certify:snapshot` wrote a mode-`0600` privacy-safe artifact; npm, Mac, cloud, public pages, and TestFlight are ready, while the connected iPhone correctly reports build 15 instead of candidate build 19 |
| Signed iPhone archive | Pass | `npm run ios:archive`; `ClawDadMobile.xcarchive` is version 0.7.0, build 19, and passes strict code-signature validation |
| TestFlight processing | Pass | App Store Connect build 19 is `VALID`, export-compliance complete, localized, and assigned to `ClawDad Internal` |
| Mac signing and notarization | Pass | `npm run native:release`; beta.2 app, ZIP, and DMG are signed, notarized, and stapled |
| Package contents | Pass | `npm pack --dry-run --json` completed successfully |
| Cloud public health | Pass | Production `/healthz`, `/support`, and `/privacy` returned HTTP 200 after the final worker upload |

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
| Restrictive network | Blocked | Requires Cloudflare Calls Write TURN credential |

## Certification Rule

Founding-customer distribution can begin when every row except Restrictive
network is Pass and production relay enforcement is enabled. Public App Store
submission additionally requires the human gates in
`docs/app-store/review-handoff.md`.
