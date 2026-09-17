# Account switching: unsent drafts do not block

## Incident and agreed behavior

Mac build 158 operation `21bffa6b-7f06-4359-a172-87934b5bd4b2` stopped during `window.capture` at 2026-09-17 07:46:14.472 UTC, before authentication or closure (`effects={}`). Receipt `6b30006e661c31e5a0fb0fbc6bc34653ac1c8f77e3984c9289182be33355ea62` reports `native_account_control_unavailable` and “This tab's input cannot be recovered (rendered_text).”

The nine-tab window starts with Ran the Credit Man, TTY `/dev/ttys014`, exact conversation `01a087cb-63cc-7ba3-b0af-be74942720ff`. Its visible unsent text is `please implement this` (21 characters). The previous native preview also saved that exact text. The account-only guard in `MacCodexAccountWindow` required an empty rendered composer or a retained Assistant paste, so it rejected a readable manually typed draft. The preceding build's live test exercised ordinary workspace capture, not this stricter account guard. That was a verification gap; full switching was never established by that test.

Cody then explicitly directed that unsent drafts be ignored as a switching blocker. The implemented policy is: resume the exact conversations with empty inputs; save recoverable unsent text separately in private account recovery; skip unreadable drafts. Unrecoverable unsent text or attachment associations can be lost when the old window closes. No draft is submitted or queued automatically.

## Implementation

- New account recovery records carry `draftPolicy: retainOnly`. Readable single-line text and exact retained collapsed pastes can be saved. Opaque pastes, multiline visual-wrap ambiguity and attachments do not prevent capture. Their hidden contents are never inferred.
- The native capture guard returns the actual optional recovery payload, keeping account validation and capture consistent. Queue visibility, current activity and exact conversation checks remain required.
- Capture and the JavaScript record reader accept absent draft text under this explicit policy. Account-window comparisons ignore draft changes while preserving window membership, TTY/lifetime, process, session and directory checks. Ordinary named-workspace behavior remains unchanged.
- Restoration still repairs names and verifies the exact resumed owner; it supplies no draft to the input-restoration path. Saved draft data remains in the original recovery record. Existing legacy records keep their original restoration semantics.
- The preflight status now prioritizes a genuinely busy or uncertain owner instead of reporting uncaptured idle tabs as draft failures. Already accepted work and queues remain protected.
- Desktop and iPhone explanatory text describes empty restored inputs and optional separate draft retention.

## Verification

Confirmed live evidence is the original native capture failure and the current exact Ran the Credit Man composer. The previous nine-tab capture has verified session IDs, directories, model/effort, histories and no identity issue for all nine entries. Current saved delivery records contain no prepared pending/uncertain Ran the Credit Man receipt that would conflict with its unsent text.

Automated account-controller and private native-transport tests: **187 passed**. They cover readable and unavailable drafts through capture/authentication/recreation/verification, preserved account ownership, retries and one-time native calls, and correct busy-owner reporting.

Focused Swift checks: **84 executed, 3 opt-in checks skipped, zero failures**. New cases use the production draft classifier in window capture, durable record reload, empty restoration and duplicate-safe retries. They cover the reported text, Unicode, empty input, retained collapsed text, unreadable pastes, multiline text and images. Busy agents, accepted queues, fresh unidentified sessions, changed owners and uncertain close/creation receipts remain guarded. These are fixture tests, not a claim that the real working window was closed or a physical iPhone switch completed.

An initial test compilation exposed an exclusive-access mistake in the fixture and a missing async annotation; both were corrected before the passing run. No product release occurred from a failing test build.

## Release and continuation checkpoint

Mac 159 and iPhone 101 release/install evidence will be appended here. The real nine-tab window, agents, draft, queues and named snapshots have not been closed or altered as a test. A complete real-account switch remains a separate verification gate; do not describe a capture or fixture result as full real-world success.

This lane owns the account draft policy, native account capture/restore code, corresponding tests, account status copy, desktop/iPhone help copy and this report. Inherited release/build/storage scripts, plugin metadata, artwork, cloud/native and marketing-site work remain preserved and classified. No CLI publication, new infrastructure, spending or research task is part of this patch.
