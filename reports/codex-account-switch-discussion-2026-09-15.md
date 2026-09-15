# Account switching and optional project limits: revised discussion

Status: proposal only. This clarification supersedes the global-reserve and first-version account-selection recommendations in the September 14 audit. No product code, live budgets, authentication, processes, or saved setups changed during this discussion.

## Cody's clarification

we dont want the 20% research pause anymore unless deliberately stated for a project I want to rid us of that being in the system. And ideally it would be a one click selection within the app or the desktop app for complete account switch and authentication would either be saved behind the scenes in some way where it remains authenticated into both accounts so we can easily switch back and forth or if we have our password saved in our keychain lets discuss

## Revised budget behavior

Remove the automatic app-wide 20%-remaining research reserve. The default becomes **no configured project allowance stop**. Represent that explicitly as no limit; do not disguise a remaining global reserve by changing its number to zero. There is no new account-wide stopping default or inherited project reserve.

Each explicitly selected project/supervisor can have an optional setting, for example “Pause this project at 15% weekly remaining.” Leave it off until Cody sets it manually or asks the main Assistant to set it. Show the exact project/thread scope; sharing a directory does not automatically select every conversation. All projects still consume their supplying account's shared subscription allowance. A project-specific percentage is a stopping point in that shared allowance, not a private allocation of it.

The eventual patch must update runtime admission logic, schema/migration, settings, Assistant tools/instructions and help text together. Remove inherited default-only 20% latches while preserving their historical records. Preserve deliberate project limits, manual pauses/stops, objectives, drafts and accepted deliveries. Removing an old budget rule must not launch work or silently resume a stopped supervisor. General 5% and 0% alerts remain informational; a proposed 1%/2% switching reminder must never become a hidden stopping rule.

Retain existing account-identity, fresh-evidence, uncertain-delivery and user-control protections. A provider denial/exhaustion is different from an application-imposed reserve. Define any explicitly configured project's account scope during the implementation review so switching neither removes its limit nor implicitly broadens its authorization. No old account's exception or grant should be used to authorize new work under another account.

Current source still contains `emptyAccount()` with `threshold:20` in `lib/research-budget.mjs`; it has not been removed from the running system in this discussion. The revised implementation prompt now requires its deliberate replacement rather than preserving it.

## Preferred account-selection experience

1. Add account. Cody completes supported sign-in for account A, then account B, with the correct workspace for each.
2. Retain each account's own supported authorization securely in the OS credential store, if the installed runtime can isolate and refresh these authorizations safely.
3. Show account email/workspace and which account is active in the existing allowance popover on iPhone and Mac. One tap on a previously added account requests the complete verified switch.
4. ClawDad runs preservation, safe-boundary waiting, required process transition and account verification deterministically. Show Switching / Waiting for current work / Active / Needs sign-in. One click should not mean forcibly ending a working turn or pretending the transition is instantaneous.
5. Request authentication interaction again only when the provider needs it: expired/revoked authorization, workspace consent, account selection, MFA/passkey or policy change. Do not promise perpetual authentication.

A selected account must remain verified as the intended account; an already-open browser session can otherwise choose the wrong one. A busy or unrecoverable session must be surfaced before any step that would end it. Once authenticated-account isolation is proven, repeated selection should not repeat the ordinary login ceremony unnecessarily.

## Saved Codex authorization versus saved password

| Saved material | What it enables | Limitation |
|---|---|---|
| Codex authorization, including its managed token lifecycle | Codex can reuse a signed-in session and refresh it; this is the desired foundation for fast account selection. | Official credential storage is established, but safe simultaneous multi-account slots, refresh ownership, hot switching and exact cross-account conversation resumption remain unproven in the installed integration. |
| Password in Apple's password manager / Keychain | User-controlled AutoFill can make an interactive sign-in easier. | A password is not an existing Codex authorization. Browser account/workspace choice, consent, SSO or MFA may still be required. ClawDad should not extract passwords to drive an unattended login. |

The refreshed [official authentication documentation](https://learn.chatgpt.com/docs/auth#credential-storage) confirms cached credentials, automatic refresh during use, and OS credential-store support. It does not establish a multi-account selector. Both installed schemas previously inspected expose managed browser/device login but no account-list/account-switch method, and restrict external-token injection to internal use. Those findings still constrain the design.

Investigate supported independent authentication storage and token-refresh ownership as the next feasibility gate, instead of settling immediately for sign-in on every switch. Do not implement a raw auth-file rotator, duplicate refresh tokens, treat configuration profiles as authenticated accounts, or switch a shared credential store while deferred consumers may still depend on it. A separate Codex home also changes history/config/socket scope; a disposable tab alone does not isolate credentials.

The baseline controller requires no AI model allowance. Password AutoFill and browser/device-code authentication remain supported user interactions. AI computer use is not needed to select a stored account, wait for a callback, verify identity, or restore already-approved session state.

## Next reviewed step

Use the revised [implementation proposal](codex-account-switch-next-phase-2026-09-14.txt). First build/test the deterministic controller and optional project-limit migration with offline fixtures. Before a live account-storage/switching experiment, approve the exact two accounts/workspaces and an isolated test environment. Prove that testing cannot modify the real credential store or interrupt working agents. Keep implementation, live authentication and release held pending Cody's next instruction.

Workspace classification: this file and edits to the existing audit/next-phase prompt are documentation-only. Original received audit prompt and recorded observed facts remain preserved. Existing release scripts/skills, plugin metadata, artwork, cloud and marketing work remain unrelated and untouched.
