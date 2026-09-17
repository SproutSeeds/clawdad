# Account-window capture: historical receipts — September 17, 2026

## Confirmed incident

Mac build 155 stopped operation `8e0cf96b-6454-4b2b-aea7-eb1d0c4e688b`, targeting `codyshanemitchell@gmail.com`, during `capturing_window`. Accepted **05:09:44.478 UTC**; native capture failed **05:10:08.540 UTC**, controller retained the failure **05:10:08.625 UTC**. Native receipt: `d8b635d46dbd41994f344ebad1106586d84e19259ff39c9a9222e03ae8729642`.

The message was `clawdad: Resolve its pending deliveries or resumable conversation before switching. Its tab stays open.` The effects map was empty. Authentication and window closing were never reached. A subsequent read verified the current BackToFort account and the original nine-tab window.

`MacMainWorkspaceNative.inventory` selected every `attention` Terminal job for the same saved session as a pending delivery, including historical failures. The managed account inventory already distinguished inactive errors from live work, so it passed and the native capture disagreed. `MainWorkspaceAccountSwitch.capture` then reported one generic message for pending receipts and missing identity/settings.

The affected exact ClawDad conversation is `01a06f70-051d-76e2-ab41-0d816990fcd8`, `/dev/ttys011`. Its saved directory, executable and model/effort were present. Five original failures were misclassified:

| Request | UTC creation | Action/evidence |
|---|---|---|
| `4b1f67cc-bb87-43aa-b008-c5e561503dde` | Sep 8 18:23:09 | Queue rejected before native prepare: unsupported-version check. |
| `bd4a5243-ed34-48fe-96e5-0b60e7776142` | Sep 10 22:40:31 | Queue verification failed; historical audit confirms neither Tab nor Enter was sent. |
| `d634f3e0-63da-4903-9dc7-21e8736c9801` | Sep 10 22:53:05 | Existing-draft queue failed before Tab. |
| `ace71105-38a2-4ab4-a2da-b2f9b9747382` | Sep 10 23:13:29 | Prepared draft-only insertion could not be confirmed; no Enter/Tab. |
| `59d13ea1-8191-4ae9-ad98-158982e29412` | Sep 11 00:29:59 | Send rejected before prepare for missing exact process identity. |

Original records stay in `Assistant/state.json`. The September 10 Terminal audit supplies additional evidence for the two queue failures. Neither receipt status nor accepted history was rewritten.

## Scoped repair

- Account-window capture now distinguishes active/potentially submitted deliveries from proven unprepared failures and inactive draft-only insertion failures. Contradictory dispatched/accepted evidence always remains blocking. Exact session identity survives catalog-ID changes; a different explicit session cannot match by tab name or stale tab ID.
- Original inactive receipt IDs are retained in the private recovery record. No old input or queue is replayed. Current exact draft, idle process and empty native queue checks remain required.
- Ordinary manual workspace snapshot classification and membership are unchanged. Unreadable account receipt history stops safely.
- Pending/uncertain delivery failures have `account_window_delivery_unresolved` and specific receipt IDs. They are checked again immediately before closing, including a delivery appearing after capture.

## Verification and release

- **932 runtime tests passed**, zero failures: `/tmp/clawdad-switch-receipts-runtime.log`.
- **92 native checks**, three unrelated opt-in live checks skipped, zero failures: `/tmp/clawdad-switch-receipts-final-native.log`.
- The native test loaded the actual local receipt history read-only: **all five reported failures retained, zero current active/uncertain receipt blockers** for that exact conversation. This proves receipt classification; it does not claim a new whole-window transition.
- Disposable native window fixtures verify capture, durable receipt retention, restart/readback and restore; active/uncertain dispatch refusal; contradictory acceptance evidence; same-session/new-catalog targeting; and a new uncertain delivery before closing. Existing draft, busy-state, ownership, duplicate/restoration tests passed.
- Production artifact/installation status follows after signed Mac packaging. iPhone 99 needs no change for this repair. The stopped user request is preserved for explicit Check recovery; no automatic switch or real Terminal closure is a QA step.

## Workspace classification

This lane: `MacMainWorkspaceNative.swift`, `MainTerminalWorkspace.swift` (optional retained-receipt field), `MainWorkspaceAccountSwitch.swift`, `MainWorkspaceAccountSwitchTests.swift`, and this report. Existing release/storage scripts, release skills/plugin manifest, wordmark experiments, cloud/native and marketing-site changes remain untouched. Build/evidence artifacts use ignored native distribution paths.
