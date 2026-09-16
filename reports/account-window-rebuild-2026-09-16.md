# Account switching by recreating the chosen Terminal window

## Scope and baseline

Cody authorized implementation and the established signed Mac / internal TestFlight release after choosing a window-recreation workflow. Wait for active work to finish, exhaust allowance, or settle after interruption. Preserve exact saved conversations and recoverable unsent input. No automatic continuation, queue replay, new subscription, authentication ceremony, or public CLI release is part of this change.

Baseline: commit `3738b00`, installed Mac 0.7.0 (153), existing internal TestFlight 0.7.0 (97), Codex CLI 0.154.0. Physical iPhone installation is not inferred from TestFlight availability.

## Confirmed causes and changes

The previous adapter inspected each Terminal consumer's cached account through native `/status`, then retried preflight. Real operation `edb6f08b-2769-4b89-9008-89eb7eb68589` produced 48 observation requests and 18 status requests between 19:31 and 19:45 UTC. Its effects journal remained empty: no transition, agent stop, or launch occurred. The operation was cancelled through the supported API, with uncertain local-status receipts retained. Cancellation was held by those read-only/empty-original-draft receipts. The new adapter reconciles only their non-transition evidence; it does not turn them into successful dispatch receipts or repeat their keys.

Production now selects one exact physical window. A read-only process/transcript census waits without `/status` or focus sweeps while work is active. When ready, native capture verifies the chosen lineup and drafts, saves a private recovery record, verifies the destination's existing subscription sign-in, then closes and recreates that window. The shared ClawDad runtime follows the established managed account transition. Other Terminal windows stay open on their existing processes and accounts.

The recovery record lives in `Accounts/WindowSwitches`, separately from named manual snapshots. Each irreversible boundary is durable before dispatch. Lost creation acknowledgements reconcile a creation marker; an uncertain launch never repeats Enter. Lost close acknowledgements require proof that the original login lifetimes ended. Exact saved session IDs and project directories drive resume. TTY, process, login lifetime and current catalog bind live controls. Names never establish ownership. Repeated requests reconcile the same operation; manual edits invalidate closing. Restoration fills the usable display with a regular window.

Live disposable testing also exposed and repaired integration gaps: account capture was checking an unrelated focused working tab during inventory after the chosen window closed; retained profile histories needed their actual process-owned `CODEX_HOME` root; Terminal's closed Settings window can remain as a missing scripting entry and break the name-restoration loop. The latter fix enumerates real window IDs before locating the exact TTY. A one-tab window with its tab bar hidden exposes a composed window title, so restored-name verification now compares Terminal's exact custom/configured title rather than that composed label. Private profile routing flags are accepted only with the matching prior recovery receipt, not an environment marker alone.

Ownership census can race a short-lived profile process exiting between `ps` and `lsof`. It now discards all partial evidence and retries a fresh census at most three times for that specific failure. Persistent or other errors remain explicit failures. Regression tests cover both paths. Headless native QA also needed an initialized AppKit lifecycle and a main-queue wake timer; that test-harness repair is not presented as evidence of an installed-app defect.

Persisted model/effort lookup now scans backward with bounded memory instead of assuming a research turn's settings appear in its final 1 MiB. CLI launch options preserve the supported permissions/configuration and omit positional prompts/images. A supported Keychain storage flag is accepted without treating it as proof of an account.

The installed CLI can show an exhaustion notice with Add Credits / Continue with Luna Reserve. Account capture may dismiss only the exact observed informational notice with Escape, after verifying an idle exact owner and rechecking the notice. This does not choose a purchase, start work, or submit a prompt. Unrecognized dialogs and missing first-turn history remain visible recovery stops.

## Controls and limitations

Mac and iPhone retain one account dropdown and one set of actions. A window selector appears for the new strategy; exactly one visible window may be selected automatically. The UI explains waiting, capture, verification and recreation, shows per-tab restoration progress, and provides Cancel / Check recovery. Paused failures require explicit recovery; polling does not replay the capture sequence.

Hidden/attached or otherwise unverifiable drafts, unresolved native queues, unknown permissions/launch flags, missing drives/history, competing owners, and manual input during capture stop the transition before unsafe effects. Already accepted work and pending delivery receipts are preserved. A saved conversation restores persisted history, not an in-memory computation. Unsupported input must be resolved before closing; it is never guessed or silently discarded. Account selection does not activate research supervision or change budget authorizations.

## Verification checkpoint

- Runtime: 927 tests passed, zero failures (`/tmp/clawdad-account-window-final-runtime2.log`).
- Native focused run: 58 checks, one opt-in live test skipped, zero failures (`/tmp/clawdad-account-window-final-swift2.log`). This includes 11 window-rebuild tests and both desktop web checks. Window tests cover changed drafts, busy work, opaque input, pending queues, missing directory, cancellation, uncertain close/create, restart reconciliation, same-directory distinct threads, unrelated window preservation, large history and quoted commands.
- iPhone UI: normal and accessibility-text controls passed on compact and large simulators, including exact window arguments, duplicate taps, lost acknowledgements, scrolling and cancellation. Screenshots inspected under `native/macos/dist/candidates/account-window-rebuild-2026-09-16/`.
- Actual native Assistant transport: the disposable `window-final-20260916` fixture completed Cody → Sun → Cody between 21:42:08 and 21:44:10 UTC. Both transitions used native capture, close, recreation and observed identity verification; the exact thread `01a0a848-cb86-7033-ae6f-ce006f5b51bb`, project directory, model `gpt-6-astra`, and effort `low` matched after each transition. New process owners were verified; exactly one fixture owner remained. This test performed zero model turns, zero `/status` commands and zero sign-in actions.
- Accepted synthetic message-history SHA-256 was unchanged before/after: `acc6ab99e0f6d046fab8759215a99025c32175e7bb51c117195255fb3f116c8b`. Canonical manual-snapshot semantic SHA-256 was unchanged: `bf95abf934940e3da17ea5c4342493883627cdcbcfe40f52ca0f51a0943543a7`. Cleanup of the sole disposable fixture window was reconciled at 21:46:00 UTC after the read-only census race; the original failure evidence is retained.
- Earlier disposable recovery runs exercised worker restarts and uncertain-close reconciliation. One interrupted close required a deliberate fixture-only close before recovery continued; that evidence is separate from the uninterrupted final round trip. Real working windows, project drafts and accepted queues were preserved.

Sanitized live evidence and UI screenshots are retained under ignored `native/macos/dist/candidates/account-window-rebuild-2026-09-16/`. The live round trip covers one disposable tab and two existing retained subscription logins; automated fixtures cover multiple tabs and same-directory distinct conversations. It is not a claim that Cody's real multi-tab window, physical iPhone flow, or a reboot has been exercised.

## Delivered release

- Code commit `6d84339` pushed to `origin/codex/hermes-hybrid-supervisor-ui`.
- Mac **0.7.0 (154)** installed and launched at 21:54:59 UTC. App and DMG passed Developer ID signing, notarization, stapling and Gatekeeper. Notary submissions: app `6cfe5308-8992-4e08-8042-0047fb49254c`; DMG `91b4b159-f0bf-430b-8c15-2fd9a845d310`. The installed binary matches the signed package and changed embedded runtime files match the committed source. Prior build 153 remains recoverable at `/Applications/.ClawDad-before-154.app`.
- Installed runtime hash `ad01b2ae5303c01528d32be01bbb5d33bda5b7aa6462bce8a0b5f14178c13354` exposes `windowRebuild: true` and disables the old per-session skip flow. The real cancelled operation reconciled to `cancelled`, `fenced: false`, with zero transition effects. All observed Terminal process/thread owners and scripting window/tab identities survived installation unchanged. Native read-only inventory then verified one physical working window with 13 tabs.
- iPhone **0.7.0 (98)** is **IN_BETA_TESTING** in **ClawDad Internal**, verified at 21:56:01 UTC. Apple build ID `7ddf1f5f-3953-4d75-a80c-99e519a5108b`, processing `VALID`, internal group assignment confirmed. The existing vendor WebRTC dSYM upload warning did not prevent acceptance; it is not a claim that every vendor frame can be symbolicated.
- Native artifacts: `native/macos/dist/releases/0.7.0-beta.20-macos-154-account-window/`. This release did not publish the CLI, switch Cody's working account/window, or enable supervision.

Update the iPhone through Internal TestFlight, select the saved account and intended Terminal window, then start the switch. It waits for work to settle and pauses before closing if an input/session cannot be safely recovered. Physical iPhone installation, touch/VoiceOver behavior and a user-initiated real multi-tab workspace transition remain user checks. A physical restart/power loss was not tested.

## Workspace classification

This lane owns account-window controller/native adapter, related account routing/UI/guidance/tests, the minimal workspace reuse hooks, and release metadata/report. Preserve these inherited buckets: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, plugin manifest/release skill, `assets/wordmark-explorations/`, `cloud/native/`, and `marketing-site/`. They are not staged as part of this repair. Temporary verification is in ignored `native/macos/dist/candidates/account-window-rebuild-2026-09-16/` and explicitly disposable `/private/tmp/clawdad-terminal-coverage-account-*` roots. No real working window or project draft is a destructive fixture.

Final hygiene: `dirty_classified`, nine inherited paths/buckets, zero unclassified paths, `safe_to_expand: true`. These changes remain with their existing lanes for review; no cleanup or reversion was performed. `git diff --check` passed.
