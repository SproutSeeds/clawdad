# Account runtime identity and retained-history checkpoint

The two saved subscription sign-ins work independently. The exact synthetic CLI conversation reopened under Cody → Sun → Cody and displayed the correct account each time without another login or model request. Production process switching is **unfinished and gated**. This checkpoint implements the next identity/layout layer; it does not install or release the switcher.

## Scope and current runtime

Cody authorized continuing the existing implementation and the two-account disposable test. The accounts are codyshanemitchell@gmail.com and playinthesunwithme@gmail.com. Browser ceremonies and retained-home registration were already complete; none was repeated.

Read-only verification on September 16: `/Applications/ClawDad.app` remains **0.7.0, Mac build 145**; installed Codex is **0.154.0**. **94** is the last reconciled iPhone release checkpoint, not a newly observed physical installation. No real Terminal tab/window was focused, created, closed, restarted or stopped for this checkpoint. The short-lived TUI children described below ran in private PTYs. Product authentication, named snapshots, research objectives and project work were left intact.

Source changes are unshipped. The actual native worker in build 145 does not contain the new inventory request protocol. Native source tests and disposable service transports are distinguished from installed behavior below.

## Implemented source

| Area | Behavior and boundary |
| --- | --- |
| Native process evidence | `MacCodexAccountProcess.swift` reads the exact foreground process, mapped executable/version, owning conversation, explicit home and safe launch flags. It returns only HOME/CODEX_HOME environment values and the **presence** of alternate authentication/provider variables. Transient environment bytes are cleared. Initial prompts/images are excluded from resume options. Unsupported modes/configuration overrides remain specific blockers. |
| Fresh inventory transport | `AssistantRuntime.accountConsumerInventory`, `MacAssistantBridge` and `inspectAccountConsumers` exchange a fresh nonce. An expired observation, missing worker or unknown owner stays unavailable. A request does not enable the Assistant, capture the microphone or create a job. The worker sends heartbeats during the read-only inventory. |
| Ownership versus history origin | Read-only account inspection permits retained history originally marked `vscode` when a unique current native foreground process actually holds it. The existing composer action policy remains unchanged. A directory, title or historical source never establishes current ownership. |
| Busy state | Account inventory now reads lifecycle events from the owning conversation instead of borrowing a cached Terminal badge. Fresh/no-history and unavailable-log states remain unknown. Exact configuration read from history is explicitly labeled `last_persisted_turn`; it is not claimed to be every current in-memory setting. |
| Runtime layout | `codex-account-layout.mjs` plans and journals shared **work resources**, including history, configuration and writer locks, while retaining separate authorization homes. It checks ownership, exact link targets and source identity; a conflicting profile resource is preserved. Interrupted links reconcile against the durable receipt, never overwrite another resource. |
| Configuration/launch guards | Effective configurations are compared without persisting raw values. Paths resolving to the same object are normalized; the intentional Keychain-store change alone is exempt. Permissions, provider and workspace requirements must match. Per-child launch options select the exact profile/common index and reject API/token/provider overrides or unsupported remote launches. |

The layout module is tested but is **not yet applied to production or the retained sign-in homes**. Those homes already contain generated resources such as `skills`, `plugins` and writer-lock directories; their existing synthetic-history links also differ from production history. The conflict-preserving planner intentionally refuses automatic replacement. Controlled inactive-home migration and recovery must be implemented before adoption. No credentials or live histories were copied or moved here.

A home identifies the credential source, not the account cached by an already-running process. The preview deliberately continues to return `accountVerified:false` and `recoverable:false` until real account adoption and exact draft capture are established.

## Live observations and fixtures

Candidate artifacts are under `native/macos/dist/candidates/codex-account-switch-2026-09-15/`. Private authorized-account receipts are under `~/Library/Application Support/ClawDad/Accounts/verification-2026-09-15/`.

### Native inspection, without input

`native-account-process-2026-09-16T05-06-18Z.json` observed **14** Terminal Codex processes, all version 0.154.0: **13** exact established conversation bindings and **one** fresh process before its first persisted conversation. Lifecycle evidence showed one working, twelve idle and one unknown fresh process. No process-inspection errors were returned. Account identity was intentionally unverified for all real owners.

The earlier inventory initially rejected `/dev/ttys005`, PID 44141, whose exact root `01a054cb-466a-7723-bdee-f64730bf99e2` was historically marked `vscode` (created under 0.151.0). That process also held a Guardian rollout. The read-only inventory now recognizes the unique root and ignores the helper; normal native input adapters retain their existing policy. This is a history-origin distinction, not evidence of a shared live app-server owner.

### Effective configuration fixture

`layout-probe-0154-1/evidence.json` compares actual `config/read` from installed 0.154.0 in two disposable homes, using ephemeral versus Keychain credential-store configuration but **no login or model call**. Relative AGENTS path resolution, model/effort, sandbox and approval policy matched after exact filesystem-alias normalization. Both normalized hashes were `5a485bfa5d7d8de78fa72a9558056999c8736924be9849991c83d93d1b73bbda`. Both fixture homes resolved the same writer-lock directory. This proves the tested layout/configuration behavior, not adoption of every current production profile or managed-workspace policy.

### Real CLI retained-account round trip

`test/fixtures/codex-account-tui-status.py` resumes only the previously authorized synthetic conversation:

- Thread: `01a0a848-cb86-7033-ae6f-ce006f5b51bb`.
- Original accepted turn: `01a0a848-cbd2-7e92-8288-0c920cd858d6`.
- Model/effort: **gpt-6-astra / low**; explicit read-only/never fixture permissions.
- Project: `Accounts/verification-2026-09-15/thread-continuity-1/project`.

Each process uses its already retained Keychain home and runs local `/status`, with typing and Enter as separate input events. The fixture checks only its exact directory before accepting fixture trust. Its children are then stopped; real Terminal processes are excluded. Trust added only the synthetic directory to those isolated profile configurations. No authentication change, ordinary prompt, tool request or model turn was sent.

| Private receipt directory | UTC result | Evidence |
| --- | --- | --- |
| `thread-continuity-1/tui-status-cody-3` | 04:56:59 | Exact original thread and model/effort, local Account: codyshanemitchell@gmail.com |
| `thread-continuity-1/tui-status-sun-1` | 04:57:09 | Same thread/model/effort, Account: playinthesunwithme@gmail.com |
| `thread-continuity-1/tui-status-cody-4` | 04:57:43 | Same thread/model/effort back under Cody |

Two earlier failed fixture attempts remain preserved (`tui-status-cody-1`, `tui-status-cody-2`). The first matched a temporary loading composer; the second sent command plus Enter in one burst, leaving `/status` unsent in the composer. Neither failure established an authentication defect. The repaired fixture waits for the known history/composer, observes the typed local command, then sends Enter separately.

`thread-continuity-1/inspection-after-tui-status-1.json` subsequently used strict read-only app-server methods under Cody → Sun → Cody to inspect both the original and its existing fork. **All six complete message hashes and original accepted turn-ID lists matched**, with zero new model turns:

`4c4f269ea1d1b6ec81dcf3e147eec8ea0692fdd80cfd8aac769ef6d15800b0e5`

The only accepted turn remains the original synthetic test turn. The follow-up completed at **2026-09-16T05:04:21.865Z**. Cody's account then had **31%** remaining and ordinary usage allowed; Sun had **0%** and ordinary usage denied. Sun's previously verified reset is September 19 at 7:57:20 AM CDT. Local resume and account status work without model allowance; a new model response under Sun remains untested because of that denial. No additional account is needed for deterministic implementation or retained-sign-in testing.

The TUI fixture uses a candidate-only Python environment with `pyte 0.8.2` for terminal rendering and the existing `pexpect`. These are test dependencies; no product/runtime dependency or global Python installation was added.

## Regression results

- `launch-inventory-final.tap`: **48/48** account, authorization, layout and service/MCP tests passed. Includes unchanged disabled-Assistant state, fresh nonce after worker change, expired inventory, separate same-directory threads, primary versus helper rollout, unknown busy state, explicit alternate-auth route, profile conflict preservation, partial-layout recovery and changed source/link rejection.
- `runtime-launch-layout-final.tap`: **790/790** full runtime checks passed, 57.482 seconds.
- `native-account-process-final.log`: **28** native checks, **23 passed / 5 opt-in skips / 0 failures**. Includes existing input identity, fresh/established binding and response-reader regressions.
- `native-account-process-live-final.log`: **7/7** passed, including the explicit read-only live inventory described above. No focus or input actions.
- Syntax checks and `git diff --check` passed. The stricter fixture accepted-turn assertion was also checked against every saved post-TUI history observation without another network or model request.

No new iPhone UI changed in this checkpoint, so prior small/large and accessibility account-control evidence is retained without rerunning unrelated screens. Physical phone switching/recovery remains pending with the live transition feature. No signed Mac or TestFlight release occurred.

## Remaining implementation, in dependency order

1. Reconcile inactive retained-home resource conflicts with a durable, recoverable migration that preserves the exact Keychain namespace and original resource locations. Verify effective per-project/permission configuration before launch. Keep manual workspace snapshots separate.
2. Implement exact native recovery capture, including current effective model/effort and authorized account status. Preserve fully known drafts/images, wait for accepted native queues and running work, and expose precise blockers for unknown hidden input or a fresh nonresumable process. Never infer hidden text from a collapsed length.
3. Implement and reconcile native idle-process exit and exact UUID resume **inside the existing tab**. Keep window order/names/sizing, verify both process account and exact conversation, then restore only independently verified unsent input. Do not replay accepted queues, tasks or old launch prompts. A persisted historical origin is not authority to take an app-server owner.
4. Complete controlled shared app-server, coordinator and independent-supervisor launch/adoption. Extend the accepted-work ledger to legacy/manual dispatch and detached queue workers; the current early `/v1/dispatch` admission check alone does not close every staging race. Global shell launches also need an explicit supported selection strategy; changing one child's CODEX_HOME does not change every future `codex` command.
5. Supply the production `CodexAccounts` transition adapter and verify crash/uncertain receipts across capture, exit, launch, restore and return. Enable the gate only after all affected owners can be verified. Existing explicit research limits/manual pauses remain account-scoped; switching never authorizes spending or resumes supervisors.
6. Finish disposable same-tab A→B→A mutations, drafts/images/queue tests and actual model continuation under both accounts when allowance permits; then complete native UI/release acceptance. Authentication tests alone are insufficient to claim a complete one-click switch.

Sun's quota blocks the final model-continuation proof; it does **not** block the remaining deterministic implementation above. No new sign-in, purchase, real-session restart or owner transition is requested from Cody at this checkpoint.

## Workspace classification

This lane owns the account layout module/tests/fixtures; the read-only account process inspector/tests; inventory integration in `MacAssistantBridge`, `AssistantRuntime`, `codex-account-consumers` and `codex-accounts`; the explicit history-origin parameter in response/binding readers; the pure resume-configuration helper's `nonisolated` annotation; the existing continuity fixture's read-only follow-up; and this report/continuation checkpoint.

Nine inherited unrelated paths remain preserved for their existing lanes: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`. Do not stage them with this checkpoint; their owners retain verification/commit responsibility. Candidate/private test artifacts remain in their canonical ignored locations. Hygiene reported `dirty_classified`, zero unclassified, safe to expand. The scope/commit receipt is `runtime-layout-checkpoint.json` in the candidate directory.
