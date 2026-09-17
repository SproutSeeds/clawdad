# Shared-server account switch repair

## Confirmed incident

Installed Mac 159 request `0820f9e7-4a48-4f1e-a6e1-e9d1babf3994`, created **2026-09-17 08:23:12.318 UTC**, successfully captured Cody's nine-tab window. It stopped in `checking_project_threads` at **08:23:50.552 UTC**, before account/process effects (`effects={}`), with `shared_launch_unverified`. Unsent drafts were no longer the blocker.

The exact shared-server owner is PID **1306**, started **September 11 08:00:54 local**, serving the managed socket with no loaded threads. `ps comm` is just `codex`; its kernel executable path is `/opt/homebrew/Caskroom/codex/0.154.0/bin/codex`. Native `MacCodexAccountActivity.allOwners` incorrectly used the short command column as the executable for reconstruction. `CodexAccountSharedProcess.observe` correctly required an absolute path, but collapsed all failed predicates into one error. Earlier disposable fixtures used absolute executable launches, so they missed this launch form.

Checking the subsequent real source-account stage also established a separate failure: PID 1306 still reported the old Sun account (`playinthesunwithme@gmail.com`), whose usage request returned **401 Unauthorized / token_revoked / invalidated oauth token**. This is a cached old server login, not evidence of a problem with the chosen destination's saved sign-in. The server had **zero loaded conversations**. Requiring that empty old process to authenticate successfully prevented replacing it with a verified destination.

## Changes

- Native server inventory now resolves the executable from the exact PID using `proc_pidpath`, verifies that it remains unchanged and executable, and retains the original `ps` column exclusively for the existing lifetime digest. It never looks up today's `codex` on PATH or substitutes an installed version.
- Shared launch validation identifies the precise missing field: native owner, server kind, authentication route, native launch reason, credential home, executable, lifetime or restart options.
- A revoked source login has a separate error. An explicitly authorized switch can capture an **empty** server with `accountKey=null`, `accountVerified=false`, and `emptySourceAccountUnavailable=true`. This requires exact process/socket/home/executable evidence, an active dispatch hold, no loaded threads or pending server requests, and another inventory read. The explicit marker survives durable account recovery and retries.
- This exception is for the original empty source only. A loaded server, changed process, missing permission, temporary network failure or unverified destination remains guarded. The destination must still authenticate and match the intended account; a new server never inherits the source exception. No account identity is invented. No old draft, task or queue is submitted.
- Terminal draft handling from Mac 159 remains unchanged: recoverable text is retained separately and restored inputs stay empty. Named snapshots are unchanged.

## Verification

- **192/192** account runtime tests passed, including the complete account controller and window/private native transport, durable expired-source recovery, exact destination verification, duplicate requests, busy work and uncertain delivery. Failed predicate tests verify no process signals or launches on rejected evidence.
- **28** focused native checks executed: **2 opt-in skips, zero failures**. Tests reproduce a bare `codex` command, exact running executable resolution, unchanged lifetime hashes, missing/replaced executable paths and existing window/draft protections.
- The actual production Swift census plus shared OS/protocol controllers completed a disposable **Cody → Sun → Cody** round trip from a PATH-launched server at **08:33:15.760 UTC**. Exact synthetic thread `01a0a848-de93-75e3-b69d-8158ebb54973`, history, settings and held fixture draft were preserved; zero model turns and zero login actions. The two transitions took **69.684 s** and **86.820 s**, including observed thread unloading. Destination PIDs were 83935 and 5190; the fixture was cleaned up and its census exited 0. These are disposable server results, not the user's Terminal-window switch.
- At **08:34:51.704 UTC**, read-only production Swift/JavaScript observation of the actual PID 1306 passed `validateSharedAccountCapture` with its exact full executable, matching dispatch lifetime digest, empty inventory and explicitly unverified expired source account. Allowed RPCs were limited to diagnostics, account reads and loaded-thread inventory. **No actual account change, process stop or Terminal action occurred.** The earlier 401 failure was retained as evidence rather than mislabeled a network glitch.

Evidence: `native/macos/dist/candidates/shared-launch-2026-09-17/`; disposable round-trip evidence: `~/Library/Application Support/ClawDad/Accounts/verification-2026-09-15/thread-continuity-1/shared-process-path-20260917/`. Runtime logs: `/tmp/clawdad-shared-launch-runtime-tests2.log`; native log: `/tmp/clawdad-shared-launch-native-tests.log`.

## Release checkpoint

Mac 160 installation evidence will be added after notarization and verification. iPhone 101 already carries the current controls and needs no additional change for these Mac-side fixes. Preserve the original captured nine-tab request; do not cancel and discard its recovery merely because native catalog IDs refresh during the app update. Restoration rebinds by exact TTY/lifetime/process evidence.

This patch owns the shared native census, shared-account process/RPC/handoff checks, account recovery projection, targeted tests/fixture and this report. Inherited release/build/storage scripts, plugin metadata, artwork, cloud/native and marketing-site changes remain preserved and classified. No unrelated CLI publication or infrastructure changes. A complete switch of Cody's real working window remains a physical acceptance check after this implementing agent finishes.
