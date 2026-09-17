# Account switch: Terminal foreground activation

## Confirmed incident

Operation `2f82d344-e171-402d-b785-fd936950e180` stopped at 2026-09-17 07:05:38.447 UTC (02:05:38 CDT), Mac 0.7.0 build 157. State: `needs_attention`, `preflight`, `capturing_window`, `native_account_control_unavailable`; effects empty. The returned text was “Show Terminal on the Mac and retry Main Workspace.” No authentication transition or window closure was reached.

`MacMainWorkspaceNative.activateForWorkspace()` made one AppKit activation request, ignored its result and polled the originally obtained application's `isActive` for 15 × 100 ms. The exact exception establishes failure of that foreground check. It does not establish whether macOS delayed/refused activation or the cached application state lagged. Terminal was foreground during later independent NSWorkspace and correctly parenthesized System Events checks. An earlier malformed AppleScript expression mentioning loginwindow is not evidence of a locked Mac.

## Scoped repair

Verify the actual frontmost process through NSWorkspace and the current Terminal PID. Observe the activation request result. Use one existing-permission Accessibility foreground request to that exact process if AppKit rejects activation or foreground has not arrived after 500 ms. Bound the polling to 3 seconds and the AX request to 1 second. Verify foreground after either request. A dispatch acknowledgement alone never permits the next capture step.

Recheck the original manual-input ticket, unlocked console, Accessibility permission and exact PID throughout. Preserve distinct errors for manual input, lock, permissions, process replacement, failed AX activation and unverified foreground. The fallback cannot launch a replacement Terminal. This changes foreground activation only; account quiescence, draft capture, ownership, receipts, authentication and closing protections remain intact.

## Verification checkpoint

`swift test --package-path native/macos --filter 'MainWorkspaceReviewTests|MainWorkspaceAccountSwitchTests|MainTerminalWorkspaceTests'`: 71 checks, 2 existing opt-in incident checks skipped, zero failures. New cases cover already-foreground, rejected activation/fallback, delayed foreground beyond the old deadline, manual/lock/process changes, bounded timeout and fallback failure. These are deterministic regressions; installed-app foreground/capture verification is recorded below when completed.

## Installed-app verification and recovery

Mac **0.7.0 (158)** was installed at 07:23:50 UTC from source `b5804a55bc7f03c4216549101d75a928e64841d3`. The installed executable matches the signed package; native runtime health passed at 07:24:11 UTC. App notarization `30919f30-c40d-4335-97ff-e53e7a371641` and DMG notarization `f98593b5-4516-467f-98a8-5881edab67d8` were accepted. Gatekeeper and signature verification passed. Backup: `/Applications/.ClawDad-before-158.app`. Signed artifacts: `native/macos/dist/releases/0.7.0-beta.20-macos-158-terminal-activation/`.

Two read-only, diagnostic `mainworkspace.preview` requests used the real authenticated `/v1/assistant/request` → runtime → native dispatcher → workspace snapshot path. Each began with ClawDad foreground and Terminal background. Both completed the nine-tab capture with Terminal foreground, no error and unchanged window/TTY pairs, live Codex process/thread owners and account operation. No save, restore, close, typing, Enter, Tab or authentication operation was issued by these inspection tests.

- `qa-foreground-preview-mac158-20260917`: accepted 07:24:26.402, native started 07:24:27.668, completed 07:24:47.391 UTC. The capture passed. Its test harness initially compared serialized Swift dictionaries in key order and falsely flagged snapshot preservation; this check is retained as inconclusive, not a product failure.
- `qa-foreground-preview-mac158-20260917-v2`: 07:25:56.344–07:26:18.206 UTC. Correct structural comparison confirmed unchanged canonical roster, named snapshots, previous versions, selected snapshot and restore operations. The other preservation checks also passed. Foreground acquisition latency was not measured separately from full capture.

Evidence and bounded scripts are in `native/macos/dist/candidates/terminal-activation-2026-09-17/`. The real rejected-AppKit fallback branch is covered deterministically; the live capture proves installed foreground acquisition, not that macOS exercised that fallback during the test. Physical iPhone end-to-end account recreation remains unverified. No iPhone update is needed; build 100 remains the existing Internal TestFlight client.

The app restart rebuilt transient catalog IDs. Before any retry, exact native window ID/TTY pairs and all Codex process/thread owners were compared with the pre-install record and matched. Using existing account controls, the original zero-effects request was verified cancelled, and `retry-2f82d344-mac158` was accepted at 07:27:41.661 UTC for the same target account and the same verified nine-tab physical window. This is a refreshed continuation of Cody's existing switch authorization; the original receipts remain retained.

That refreshed request reached `checking_window` and stopped while this ClawDad Terminal agent was still doing the patch. It was the only consumer reporting busy; all consumer pending-receipt lists were empty. Uncaptured recovery placeholders are still rendered ahead of the actual busy item by the existing three-row summary, which can misleadingly say unrelated drafts need verification. This presentation limitation is recorded rather than expanded into this foreground repair. Account effects remain empty. Check recovery after this turn finishes; no full switch success is claimed.

## Workspace classification

This lane owns `MacMainWorkspaceNative.swift`, `MainWorkspaceReviewTests.swift` and this report. Existing release skill/build/package/storage changes, plugin metadata, assets/wordmark-explorations, cloud/native and marketing-site are inherited and preserved. ORP reports zero unclassified paths. No Terminal task, draft, accepted queue or saved workspace was used as a destructive fixture.
