# Account switch: Terminal foreground activation

## Confirmed incident

Operation `2f82d344-e171-402d-b785-fd936950e180` stopped at 2026-09-17 07:05:38.447 UTC (02:05:38 CDT), Mac 0.7.0 build 157. State: `needs_attention`, `preflight`, `capturing_window`, `native_account_control_unavailable`; effects empty. The returned text was “Show Terminal on the Mac and retry Main Workspace.” No authentication transition or window closure was reached.

`MacMainWorkspaceNative.activateForWorkspace()` made one AppKit activation request, ignored its result and polled the originally obtained application's `isActive` for 15 × 100 ms. The exact exception establishes failure of that foreground check. It does not establish whether macOS delayed/refused activation or the cached application state lagged. Terminal was foreground during later independent NSWorkspace and correctly parenthesized System Events checks. An earlier malformed AppleScript expression mentioning loginwindow is not evidence of a locked Mac.

## Scoped repair

Verify the actual frontmost process through NSWorkspace and the current Terminal PID. Observe the activation request result. Use one existing-permission Accessibility foreground request to that exact process if AppKit rejects activation or foreground has not arrived after 500 ms. Bound the polling to 3 seconds and the AX request to 1 second. Verify foreground after either request. A dispatch acknowledgement alone never permits the next capture step.

Recheck the original manual-input ticket, unlocked console, Accessibility permission and exact PID throughout. Preserve distinct errors for manual input, lock, permissions, process replacement, failed AX activation and unverified foreground. The fallback cannot launch a replacement Terminal. This changes foreground activation only; account quiescence, draft capture, ownership, receipts, authentication and closing protections remain intact.

## Verification checkpoint

`swift test --package-path native/macos --filter 'MainWorkspaceReviewTests|MainWorkspaceAccountSwitchTests|MainTerminalWorkspaceTests'`: 71 checks, 2 existing opt-in incident checks skipped, zero failures. New cases cover already-foreground, rejected activation/fallback, delayed foreground beyond the old deadline, manual/lock/process changes, bounded timeout and fallback failure. These are deterministic regressions; installed-app foreground/capture verification is recorded below when completed.

Release/install and live native-path verification pending at this source checkpoint. No iPhone changes are required for this native foreground repair. Build 100 remains the existing Internal TestFlight client. Actual account-switch completion is separate from capture verification and must not be claimed from these tests.

## Workspace classification

This lane owns `MacMainWorkspaceNative.swift`, `MainWorkspaceReviewTests.swift` and this report. Existing release skill/build/package/storage changes, plugin metadata, assets/wordmark-explorations, cloud/native and marketing-site are inherited and preserved. ORP reports zero unclassified paths. No Terminal task, draft, accepted queue or saved workspace was used as a destructive fixture.
