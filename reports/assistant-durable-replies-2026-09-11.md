# Durable Assistant replies — September 11, 2026

## Confirmed architecture and causes

The installed baseline was signed Mac build **133**, with iPhone build **88** available in internal TestFlight. The installed coordinator/runtime hashes matched the inspected source. Evidence is retained under `native/macos/dist/candidates/assistant-durable-replies-2026-09-11/`, including `audit-installed.json`.

The main Assistant runs a durable local message queue and a background `codex exec` coordinator. It does not own a Terminal window and is separate from app-server project runtimes. The native Mac bridge runs independently of an attached phone. Disconnecting the phone drops its transport callbacks; it does not cancel a durably accepted main message. `MobileAssistant.endVoice` already stopped capture/playback without sending a Mac cancellation, and `applicationForegroundChanged` only changed local foreground state. These findings are confirmed in source, native transport fixtures and an actual Codex run.

The reported failure was a separate coordinator policy: request `91ddb4c9-ab82-4287-9e2a-740221ed6662` started at `2026-09-11T20:49:07.347Z`, ended in attention at `20:52:07.515Z`, and recorded `responseMs=180168`. The old default `timeoutMs=180000` killed the child. The evidence does not establish phone disconnection as the cause.

Other confirmed gaps:

- Ordinary visible voice text could disappear when ending the call before acceptance; only certain held edits had recovery storage.
- An uncertain send needed a durable copy and lookup by its original request ID, independent of the recent history window.
- Existing completion notifications described Terminal project turns. iPhone routing opened a project destination and hid the Assistant. Background Assistant replies had no dedicated durable completion outbox or exact-reply notification route.
- A reply outside the recent 40-message projection needed an exact lookup and pinned history entry to remain visible across refreshes.

Primary implementation paths: `lib/assistant-runtime.mjs`, `lib/assistant-coordinator.mjs`, `lib/assistant-work-policy.mjs`, `lib/assistant-mcp.mjs`, `lib/cloud-host-connector.mjs`, `lib/notification-outbox-delivery.mjs`, `cloud/push-notifications.mjs`, and iPhone `MobileAssistant`, `AssistantChatDraft`, `AssistantReplyNotifications`, `MobileNotifications`, `ContentView` and chat history controls.

## Acceptance, lifetime and recovery

| State | Durable behavior | Phone interruption |
|---|---|---|
| Speech being captured/transcribed | Visible words are checkpointed locally; unfinished/late transcription is not claimed as accepted | Hang-up stops capture and preserves visible text for review; it never submits late results |
| Text/image draft or upload | Exact text, local image bytes and original request identity remain on the phone | Failed upload/send retains the draft; an upload alone is not an accepted conversation turn |
| Acceptance uncertain | Phone retains the original attempted message and request ID | Reconnect queries its receipt before recovery; it does not assume failure or generate a replacement request |
| Accepted, queued on Mac | User message and job are atomically saved with file/directory synchronization before acknowledgment | May run once when the Mac/native service is ready, even without the phone |
| Running on Mac | Owned coordinator saves messages and tool receipts independently of the phone | Hang-up, backgrounding or connection loss does not cancel it |
| Explicitly cancelled | Saved cancellation stops the matching coordinator and undispatched child work | Already accepted project tasks remain owned by their original agents |
| Mac/service interrupted | Running main job becomes visibly interrupted/recoverable | No automatic replay of the coordinator or uncertain side effects; inspect saved receipts before continuing |
| Completed | Final reply, completed job and notification event share one durable checkpoint | Phone may reconnect later or open the exact reply from its notification |

The Mac must remain awake, powered, and running ClawDad with Codex access for work to progress. This is durable acceptance and honest interruption recovery, not execution through a power outage. The patch does not restart real Terminal agents or infer shared ownership from saved history.

Acceptance-save failure rolls back the in-memory queued message so an unsaved job cannot launch or appear accepted. Final-checkpoint failure suppresses the completion event and reports an interrupted checkpoint; it never reruns the work. The same request ID and matching payload return the existing receipt. Changed payloads cannot reuse an existing request identity.

The coordinator's native MCP context carries its owning main request ID. New tool actions from cancelled, orphaned or previous-service coordinator contexts are rejected. Cancellation is an explicit **Cancel response** action on the request card; hanging up remains a call action. Requests that already reached Terminal/app-server agents retain their independent receipts and execution.

The final process-ownership review found an additional restart gap: the old conversation lock named only the Node service PID. A surviving Codex child could therefore outlive the lock's apparent owner. The release now records a durable child PID/request lease before delivering stdin. A dead service with a still-live child blocks a second coordinator; once both recorded processes have exited, a new explicitly requested turn can acquire the conversation. An incomplete startup/legacy lease without a child identity stays uncertain for manual process/receipt inspection rather than being automatically removed. PID reuse conservatively requires inspection; recovery never kills an unverified process. Ordinary shutdown/cancellation removes only its own lease.

## Deliberate progress policy

- There is **no total wall-clock turn cutoff** during observable useful progress.
- Startup gets three minutes to produce valid runtime events.
- After two minutes without changed progress events, the request remains working with a concise quiet-progress notice.
- After **30 minutes without changed valid progress**, the owned coordinator stops with an actionable saved-request/receipt review state. A silent external tool could still be working; this is a conservative inactivity boundary, not proof that every silent tool has failed. Already accepted project work can continue.
- Repeated identical events, raw output bytes and synthetic heartbeats do not indefinitely reset the timer. Valid changed thread/turn/item lifecycle events do.
- Explicit cancellation terminates the exact owned process, with a bounded SIGKILL fallback if it fails to exit. In-flight externally accepted effects cannot be undone by cancelling a conversation response.

The policy preserves the installed model/effort selection and does not modify research budgets or project agent configuration. Progress diagnostics contain event/state timing rather than private prompt text.

## Notifications and exact readback

One `assistant_reply` event is generated after the final saved response, rather than for each commentary item, tool event or audio chunk. Its identity binds the original account, workspace, Mac, Assistant conversation, request and final reply. The original account scope is captured at acceptance. A later account/configuration change cannot silently redirect it.

The host uses the existing 30-second durable outbox delivery loop and existing APNs relay queue. Failures in allowance, research or Assistant delivery are isolated so one source cannot starve the others. Original event IDs survive retry/restart. Events expire after 24 hours, preserving the reply in history. The relay rejects mismatched original account/computer identities.

Notification title: **Assistant replied**. The alert contains a Mac label and local completion time; private conversation text/images are excluded. Relay acceptance is recorded separately from Apple's HTTP acceptance. Neither proves that a physical phone displayed the alert. Existing per-device relay retry, provider receipts, notification consent and Terminal/research/allowance paths are preserved.

When the exact Assistant conversation is visible at its latest reply in the foreground, the iPhone suppresses a redundant banner/sound while retaining the notification-center entry. Reading older history, another conversation, or a backgrounded app allows normal authorized notification presentation.

Notification taps persist across cold launch and delayed reconnect. They select the exact paired Mac, open Assistant messages, fetch the exact completed reply beyond the recent history window, scroll to it and begin existing high-quality message playback. This path does not start a voice call or microphone capture. Unavailable Mac/history leaves the intended destination pending with Retry/Cancel guidance.

Pause saves the current playback position; Resume uses the same message and pinned voice. Stop remains available. Existing voice-consistency retries, chunk cursor and cancellation epochs prevent late audio from replaying a stopped/superseded message. A durable per-event playback ledger prevents repeated OS callbacks from starting the same readback twice. A crash between that marker and playback can require Cody to use the message speaker button; it never blindly replays speech.

## Verification evidence

All mutation checks used disposable synthetic state or Simulator fixtures. Real Terminal windows, agents, drafts, queues, workspace membership and research tasks were preserved.

- **Actual Codex 0.154.0:** a synthetic coordinator turn completed in **203,319 ms**, exceeding the old cutoff. Its harmless fixture tool ran once for 191 seconds. Reply was exactly `DURABLE_LONG_TURN_OK`; one completion event was saved; no phone/native heartbeat was attached during execution. Request `6294c118-52c3-4e87-b285-dd12a76d3e33`, session `01a092b5-74f1-7c91-9f06-c249e57ad614`. See `live-long-turn-verification.json`. This establishes real long-turn completion, not physical iPhone audio.
- **Actual process crash:** the disposable service was killed only after its synthetic child received the prompt and reported a live session. Recovery preserved the interrupted request, rejected its stale tool context, and refused a second process while the orphan remained alive. After the fixture child exited, one new explicit request completed; the original never replayed. Incomplete startup leases remain blocked. Cancellation and normal shutdown also release the exact lease (`orphan-final.log`). The initial crash fixture killed too early, before stdin delivery, and therefore did not exercise a surviving running turn; the corrected fixture waits for persisted session evidence.
- **Actual Codex with the child lease:** a fresh isolated Codex 0.154.0 request verified the durable child identity and completed exactly `DURABLE_LEASE_OK` in **16,721 ms**, with one harmless tool invocation and one saved completion event (`live-child-lease-verification.json`).
- **Actual native wire/URLSession bridge:** a synthetic text-plus-image request traveled through `AssistantWireRequest` and `MacAssistantRuntime` to an isolated HTTP runtime. Exact PNG bytes reached the deterministic coordinator; the original sending bridge was discarded; a new bridge found the completed receipt and exact reply; retry did not duplicate execution. See `native-bridge-verification.json` and `MacAssistantDurabilityLiveTests`.
- **Runtime suite:** the final **708 checks passed** (`runtime-final135-verified.log`), covering acceptance/checkpoint storage failures, dropped HTTP acknowledgment, original-ID reconciliation, cancellation and late-tool rejection, interrupted restart without replay, surviving child ownership, queued recovery, outbox retry/deduplication, scope changes, APNs payloads and existing notification paths. An earlier full run exposed four stale build-number fixtures and one unrelated timing-sensitive delegate test; updated build fixtures and an isolated rerun followed by full passing runs resolved those checks without changing delegate behavior.
- **Mobile controllers:** 243 checks, one environment-dependent skip, zero failures (`mobile-final-verified.log`). Durability cases cover restored tap/playback ledgers, exact old reply and refresh, foreground suppression, background while history loads, reconnect, wrong reply rejection, no microphone/call start, visible speech retained across hang-up, late transcription rejection, acknowledgment after hang-up, and image upload failure with exact bytes and request ID after restart. The existing turn-timer fixture measured 2,012 ms from the last new transcribed words to submission.
- **Native regression suite:** 306 tests, 13 environment-dependent skips, zero failures in `mac-tests.log`. Controlled fixture restart recovery is distinguished from restarting the actual Mac.
- **Simulator UI:** compact 375×667 layouts passed exact old-reply opening, cold-launch callback deduplication, Pause/Resume/Stop and no call start at normal and accessibility text sizes (`ui-compact-nativeanchor.xcresult`). The large 6.9-inch Simulator passed those two cases plus both normal/large-text playback, scrolling, keyboard/draft and muted-call checks: four tests, zero failures (`ui-large-verified.xcresult`). The compact existing playback/jump tests also passed in `ui-compact-clean.xcresult`. Screenshots in `ui-compact-proof/` and `ui-large-proof/` were visually reviewed. Initial checks exposed lazy-layout positioning drift; the final route materializes the exact row and aligns its measured native text, yielding immediately to manual scrolling or selection. These are synthetic preview readback controls, not audible iPhone proof.
- **UIKit selection:** five on-Simulator native text-range/clipboard tests passed, including long multiline passages, formatting/revision stability and links (`selection-final.xcresult`). Real selection handles and VoiceOver remain physical-device checks.

## Remaining physical checks

On the physical iPhone, verify an accepted reply completes after hang-up, screen lock, YouTube/background use, network loss and force-quit/relaunch; verify a pre-acceptance upload interruption stays recoverable. Verify actual APNs display with notification permissions on/off, cold/warm taps to the exact old reply, no orange microphone indicator/call start from readback, and audible high-quality playback, Pause/Resume/Stop, Bluetooth routes and VoiceOver. Simulator/controller proofs do not establish audible playback or real notification delivery.

No real Mac power cycle, logout, research tab closure or disruptive Terminal test was performed. A coordinated physical restart/power-loss exercise remains optional user-owned verification. Service interruption is explicitly recoverable, not seamless continuation.

## Release and workspace checkpoint

Final Mac **135** was signed, notarized and installed at `2026-09-12T00:06:58Z` (September 11 locally). The app/native bridge became ready in **9.599 seconds**. Installed runtime hashes match final source; health and speech availability passed. All six real Terminal agent processes, Assistant history/user instructions, research state and allowance preferences were verified unchanged (`install-135-verification.json`). Mac 134 was an intermediate installed checkpoint before the additional child-ownership guard; its verification is also retained. Signed builds 133 and 134 remain available as rollback artifacts. The original timeout receipt remains readable in attention; it was not replayed (`installed-receipt-check.json`).

iPhone **89** has a successful signed archive and upload to App Store Connect (`ios89-archive.log`, `ios89-upload.log`). Apple processed it as **VALID**, and it is assigned to **ClawDad Internal**, status **IN_BETA_TESTING** (`testflight89-release.json`, build ID `b64f37ea-df2d-4355-9be6-61beadd1424a`). TestFlight instructions explicitly identify the pending relay activation. The upload reported the existing vendor WebRTC dSYM warning; Apple accepted the package. The physical iPhone's installed build was not changed remotely or claimed verified.

**Relay deployment pending:** the source update and provider-queue tests are complete, but the existing Cloudflare worker has not been changed. Automatic approval review rejected clicking “Continue as codyshanemitchell@gmail.com using Google,” requiring explicit authorization for that account sign-in. The Chrome task tab is handed off and the approval question is pending. No alternate authentication path was used. The new Assistant APNs event is therefore not claimed live, and no Apple acceptance or physical device display is claimed. After authorized sign-in, inspect the actual deployed worker and apply only the scoped notification additions, preserving unrelated deployed differences.

No new infrastructure, subscription spending, CLI publication or unrelated cloud changes are part of this release.

Unrelated changes retained: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, its `skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`, and `native/macos/storage-workflow.sh`. These remain outside the scoped commit; next action is their existing owner/release-lane review. Hygiene currently classifies all dirty paths with no unclassified entries. Earlier Terminal-control audit implementation remains deferred; this patch does not implement that lane.
