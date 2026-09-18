# Release checkpoint

Final installed Mac: 0.7.0 build 167, signed and notarized. Runtime fingerprint: `714a4c9d8491ba747b2a6689c427b3f2929088004256594f251010e0a4146470`. iPhone 0.7.0 build 104 is VALID and IN_BETA_TESTING in the existing ClawDad Internal group.

All 1,033 tests passed. Installed Assistant and a fresh manual app-server conversation both wrote/read sentinel files and called the native display tool; the manual conversation also completed a native screenshot. Original Assistant identity, 1,245 messages, 2,312 jobs, selected account/epoch and six baseline Terminal processes were preserved. Agent access revision 1 survived the upgrade and is visible in Settings. See REPORT.md and acceptance.json.

Release artifacts: `native/macos/dist/releases/0.7.0-beta.20-macos-167-app-server/`. The previous build 166 is retained there as `installed-before-167.app`; its 1,984 files/symlinks were compared before removing the duplicate hidden Applications copy. Previous build 163/164/165 rollbacks remain in their corresponding candidate release directories.

Final logs: `/tmp/clawdad-appserver-167-complete-tests.log`, `/tmp/clawdad-mac167-complete-package.log`, `/tmp/clawdad-native-acceptance-167.log`. Detailed private receipts and preservation evidence: `~/Library/Application Support/ClawDad/Accounts/verification-2026-09-18/appserver167/`.

Mirroring's last result was iPhone Not Found. Windows Umbra SSH timed out. The owner explicitly deferred both checks on September 18, 2026 and approved completing the Mac release. These physical/platform acceptance checks remain pending; no parity claim is made for them. Temporarily enabled Mac Wi-Fi en1 was restored to Off.

Source destination: `origin/codex/hermes-hybrid-supervisor-ui`. This is the private native installation/internal TestFlight release; public npm, public appcast and external TestFlight were not published. Unrelated dirty work is explicitly classified in DIRTY_BUCKETS.md.
