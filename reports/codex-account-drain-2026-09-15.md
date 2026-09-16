# Accepted work at an account switch

Both browser sign-ins are complete and registered. See [live sign-in and history evidence](codex-account-signin-live-2026-09-15.md). This follow-up implements the accepted-work boundary in the unshipped controller. Full production account switching remains gated; no real owner or selected runtime account was changed.

## Confirmed code gap

The initial controller fenced every delivery while preflight waited for idle consumers. `AssistantRuntime.drain`, `nativePoll`, and the configured app-server queue used the same broad admission flag. This could hold a previously accepted request behind the very switch that was waiting for that request to finish. The earlier synthetic transition tests did not exercise an accepted main response calling an actual Assistant tool during the fence.

Checking a timestamp alone would also leave an acceptance/capture race: a request could pass an admission read and reach durable storage after the controller believed it had captured all work.

## Implementation

- `CodexAccounts.withWorkAdmission` serializes acceptance and the switch fence using the durable account journal. It records a hashed identity before the caller writes its own receipt, then confirms that matching receipt. Incomplete acceptance remains visible for reconciliation and blocks transition.
- The committed Assistant and app-server receipts are read independently of their in-memory jobs. Existing pending receipts are imported before fencing. Unreadable inventory, changed receipt identity, uncertain delivery and interrupted work remain blockers.
- Accepted main-Assistant work, its authorized native/app-server actions, and already accepted configured project queues may drain on their original account during preflight. New main messages can be retained as held; they cannot silently adopt a later account epoch. New project dispatch is held. Future process transitions still require the separate verified owner adapter.
- Continuing an accepted main response requires its exact current request context. Ending or cancelling it prevents stale tool activity. The tool instructions now tell the coordinator to finish its response after returning a switch receipt, rather than keeping itself open polling for completion.
- Research may finish a continuation already durably accepted, subject to its existing project budget and revision checks. New reviews/continuations remain blocked during switching. This does not resume paused/stopped supervisors or change their budgets.
- Cancelling a pre-transition switch releases held work on the original epoch. A later switch still waits for that work. Receipts are not replayed after an uncertain transition.
- Work bookkeeping has its own journal revision. It does not invalidate a reviewed account-selection revision. Changes to the selected operation/account still enforce revision checks.
- App-server job storage now syncs the written checkpoint and parent directory before publishing acceptance.

## Verification

`drain-checkpoint-focused.tap`: **105/105** account, authorization, project-thread and research checks passed. New fixtures cover acceptance concurrent with selection; a crash before job persistence; legacy pending receipts; unreadable/changed/malformed receipts; a cancelled switch followed by another switch; selected model/effort on queued app-server work; exactly one accepted client ID; local draft retention; and account-selection stability under receipt traffic.

The main-response fixture runs the actual MCP → HTTP handler → AssistantRuntime path with a synthetic coordinator and native worker. Its accepted native action completes during preflight; a later text message stays held and receives an account-reconciliation state after the fixture transition. This is transport evidence, not real Terminal process replacement or model execution.

Two intermediate complete suites passed **777/777**. `runtime-account-checkpoint-final.tap` then passed **777/778**: the existing shell-registry concurrency fixture counted 38 of 40 expected sessions. That test sources unchanged `common.sh`, `log.sh` and `registry.sh`; it does not load the account modules. Its complete standalone rerun passed **13/13** (`registry-concurrency-recheck.tap`). The intermittent failure remains recorded; its precise cause was not established or changed in this lane. The final confirmation after the malformed-receipt regression passed **779/779** in 57.145 seconds (`runtime-account-checkpoint-confirmation.tap`). No iPhone UI or microphone state was changed. No native binary was installed or released.

## Remaining implementation and acceptance

The drain ledger covers the main Assistant and its native/app-server tool jobs. A production adapter must still complete the exact consumer inventory for manual app-server dispatch, all Terminal owners, background coordinators and independent supervisors. It must capture effective configuration, exact recoverable input/images and queue receipts; establish the approved canonical history/configuration layout; transition only drained, verified owners; and verify each destination account and exact resumed thread. None of those facts follows from a saved authorization or shared history.

Use disposable owner fixtures before introducing the adapter into production. Reconcile restart boundaries, uncertain process exit/launch, same-directory distinct threads, user edits after capture, pending native queues, and configuration/permission differences. Keep named workspace snapshots untouched and preserve the actual Terminal windows. Restore no prompt or accepted queue entry from a guess.

The Sun authorization currently reports exactly 0% and provider-denied execution until September 19, 2026 at 7:57:20 AM CDT. That blocks proving an actual model continuation under that account. It does not block further deterministic code or read-only local history work. Do not reauthenticate, purchase usage or change a subscription to work around that evidence.

Mac build **145** remains installed. iPhone **94** remains the last reconciled release checkpoint; its physical installation was not inspected here. The switcher source is unshipped. The nine inherited unrelated dirty paths remain in their existing classified lanes.
