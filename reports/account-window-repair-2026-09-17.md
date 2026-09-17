# Account switch repair — September 17, 2026 UTC

Cody authorized a narrow repair and signed Mac/internal TestFlight release. Switch now starts with bounded verification, rather than polling indefinitely for idle work. Actual work, changed identity, drafts or uncertain receipts still stop unsafe closure with a specific reason. No research tasks, prompts, /status commands, new sign-ins or named-workspace changes are authorized by this repair.

## Evidence and causes

The real failed operation `8e7617e5-c86b-4784-a085-75f330342553` targeted the retained BackToFort subscription and was accepted at **03:41:02.705 UTC**. At **03:45:40.586 UTC** it reported an unbound Terminal process. Its effects map was empty, with no native-control receipts or WindowSwitches capture. No account transition or window close was dispatched. The original generic exception was not retained, so its exact exception cannot be reconstructed from the receipt. The operation was subsequently cancelled by Cody; the patch does not revive its old 11-tab selection.

A fresh read-only census reproduced the underlying preflight obstruction: résumé PID 4902 on `/dev/ttys005` had a verified Codex process and conversation, but no cached UI-tab/window binding. `lib/codex-account-window-switch.mjs` rejected that cold process before the native selected-window capture that establishes its binding. Known selected tabs and the cold process were consequently treated inconsistently. The current requested lineup is nine tabs; a new request captures the current selection, never the old eleven.

The repair permits one guarded capture of the exact selected physical window, then verifies its TTY, process, conversation and directory against a fresh census. Unrelated windows remain outside the transition. Changed owners fail before authentication. Native census now uses each process's own history root through `MacCodexAccountProcess.ownerReader`.

Live testing through the production controller also reached a second cold-inventory problem: `MacMainWorkspaceNative.verifiedCreation` counted previously unbound old tabs as new additions. Creation verification now compares complete native scripting TTY inventories before and after the one creation, plus the exact new TTY/marker and window anchor. Cold UI visibility cannot manufacture a second creation; an actual unexpected addition/removal still stops reconciliation.

`lib/codex-accounts.mjs` stops blocked window switches instead of repeatedly entering Waiting. It saves a privacy-safe failing stage/code/time without raw exception bodies. The desktop and iPhone show stopped/cancelled states, exact selected window/count even after reopening, and useful current stages. The background server's `??` TTY is hidden. Idle and verified-ready are distinguished. Cancelled operation rows no longer clutter the current session list. Assistant tool guidance matches immediate verification and explicit recovery.

## Verification

- Eleven controller regressions cover cold bindings, exact changed-owner refusal, nine tabs with distinct conversations in the same directory, controller restart/concurrency, smaller current lineups, cancellation, explicit retry, private failure diagnostics and one-time native dispatch.
- Native checks cover account recovery, exact creation, cold existing tabs, real unexpected extra/missing tabs, drafts, permissions, uncertain receipts and layout.
- Phone simulator checks cover compact layouts, accessibility text, exact selected-window persistence, lost acknowledgements, cancellation and visible stopped controls. Native desktop web controls use real HTTP fixtures.
- Actual native fixture uses the production CodexAccounts controller, switch adapter, authenticated HTTP route and native mailbox. Existing retained Cody/Sun logins are verified via supported account reads. Only one explicitly disposable synthetic conversation changes process/account; the real shared app server is inspected but excluded from this fixture's transitions. Normal shared-server transitions remain covered by dedicated automated tests.
- An initial live run paused during final layout while separate simulator UI automation was active. Its restored process remained intact; the original receipt resumed without repeating close/launch. A subsequent cold-visibility creation refusal retained its creation marker and recovered the existing tab. These are recorded separately from the final uninterrupted test.

Final counts and release receipts follow. Physical iPhone installation/VoiceOver and Cody's own nine-tab account switch remain separate user checks. No real window closure, power-cycle or account switch was used for QA.

## Workspace classification

This lane owns the account controller/native/UI repair, tests, Assistant guidance, build metadata and this report. Inherited changes remain untouched and unstaged: `.agents/skills/clawdad-release/SKILL.md`, native build/package/storage scripts, plugin manifest/release skill, `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`. QA artifacts live in ignored `native/macos/dist/candidates/account-window-repair-2026-09-17/` and explicitly disposable `/private/tmp/clawdad-terminal-coverage-account-window-controller*` roots. Earlier failure receipts are retained.

## Delivered checkpoint

- **932 runtime tests passed**, zero failures. Final log: `/tmp/clawdad-switch-repair-release-runtime.log`.
- **79 native checks**, three opt-in live checks skipped, zero failures. Final log: `/tmp/clawdad-switch-repair-final-native.log`. The separate opt-in native/HTTP fixture was actually run as recorded below.
- **Three iPhone UI checks passed**: normal and accessibility text on the compact simulator, plus the larger iPhone simulator. Screenshot attachments were visually reviewed. The desktop HTTP/UI tests are included in the native count.
- Final uninterrupted **Cody → Sun → Cody** fixture ran **04:39:26.992–04:42:20.778 UTC**. Both account transitions used the production controller and native transport with a deliberately missing cached UI binding. The same exact synthetic session `01a0a848-cb86-7033-ae6f-ce006f5b51bb`, project, model `gpt-6-astra` and effort `low` were observed under each destination profile. Duplicate HTTP requests produced no duplicate window or launch. Only its fixture window was closed during cleanup.
- Accepted synthetic history SHA-256 stayed `acc6ab99e0f6d046fab8759215a99025c32175e7bb51c117195255fb3f116c8b`; canonical named-snapshot semantic SHA-256 stayed `bf95abf934940e3da17ea5c4342493883627cdcbcfe40f52ca0f51a0943543a7`. Zero model turns, zero status commands, zero sign-in actions. Multi-tab coverage uses disposable automated fixtures; this is not a claim that Cody's nine real tabs have been switched.
- **Mac 0.7.0 (155)** installed at **04:45:14 UTC** from source commit `9e278b8`. App and DMG were signed, notarized, stapled and Gatekeeper-accepted. App notarization: `55430809-6fb0-45f1-8032-8d9235d256c0`; DMG: `7c86d883-9978-4d29-beba-4066c871d5f0`. Build 154 remains recoverable at `/Applications/.ClawDad-before-155.app`.
- Installed health at **04:46:42 UTC** confirms runtime `4ff966b0ee5d878a0a7045a0780648fe5fc74680f1538a140f13737f586b58a9`, window-rebuild enabled, one physical window with **nine tabs**, all original Terminal process/thread owners preserved. The old failed operation remains cancelled and unfenced; its eleven-tab selection was not replayed. Accepted main-Assistant/app-server jobs were quiescent before installation.
- **iPhone 0.7.0 (99)** is `VALID` / `IN_BETA_TESTING`, assigned to **ClawDad Internal**, verified at **04:44:59 UTC**. Apple build ID `4027f34e-1e9b-4443-b788-9439b8edf0e4`. The existing vendor WebRTC dSYM warning remained; Apple accepted the upload. This does not establish physical-device installation.
- Release artifacts: `native/macos/dist/releases/0.7.0-beta.20-macos-155-account-window-repair/`; detailed local receipts/screenshots: `native/macos/dist/candidates/account-window-repair-2026-09-17/`.

Next user check: update Internal TestFlight to 99, choose the retained account and current nine-tab window, then Switch. It starts verification immediately. A real remaining blocker is reported as stopped with recovery guidance, rather than an idle waiting loop. Existing process/permission/draft/queue safeguards remain active. Physical iPhone touch/VoiceOver and the user-initiated real-window transition remain unverified; no reboot is needed for this update.

Final hygiene: `dirty_classified`, 9 inherited dirty paths/buckets, 0 unclassified; safe to expand `true`. `git diff --check` passed. No unrelated files were staged.
