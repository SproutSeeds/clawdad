# ClawDad app-server unification and capabilities

Status: implemented and verified on installed Mac 167; iPhone 104 available in internal TestFlight. This source checkpoint contains the release and acceptance record. Physical iPhone acceptance and Windows host verification remain unavailable; see REPORT.md. Authorized September 18, 2026: implement, verify, install and push the native production release. Default app-owned access should be broad, saved once in Settings and shared by Assistant and manual requests. Existing Terminal sessions remain independently owned.

## Required behavior

- Main Assistant and supervisor model reviews use app-server conversations authenticated with the computer's selected ChatGPT subscription. Missing or mismatched subscription authentication stops before a model turn. No API-key/provider fallback.
- Preserve the existing Assistant conversation, messages, drafts, attachments, model choices, project histories and durable request receipts. Account changes preserve accepted work and exact ownership.
- A persistent, revisioned host permission setting governs subsequent Assistant and manual requests. Default broad local access with automatic review where supported; clear narrower choices and computer-control status. Platform or organization restrictions remain accurately reported.
- Carry current ClawDad tools, computer/Terminal controls, installed skills/plugins, native approvals and reconnect handling into the app-server path. Per-request authorization and target/receipt checks remain effective.
- App-server account selection and permission defaults are independent of ordinary Terminal launches. Bind native permission and tool requests to the exact thread/turn.
- Keep platform-dependent launch, paths, credential storage and native control capabilities behind explicit adapters. Verify the available native host; report any unavailable Windows/device acceptance separately.

## Implementation sequence

1. Capture baseline, classify inherited changes, inspect version-specific native protocol and existing request routes.
2. Repair argument routing and enforce subscription identity at app-owned admission.
3. Implement shared app-server turn runner and migrate Assistant/reviews with durable request/turn identity, streaming, interruption, recovery and tool context.
4. Implement host permission settings and apply to both manual and Assistant-created/resumed turns; integrate approval and native capability status in Settings.
5. Verify realistic tool/auth flows, permission application, persistence, no replay, ownership and account transitions. Run focused regressions, full suite and native UI checks.
6. Build signed native candidate, preserve rollback, notarize/install, verify installed runtime and real subscription-backed Assistant/manual responses, then commit/push scoped source and sanitized evidence.

## Inherited workspace classification

- Assistant turn-control source and tests overlap this objective and will be audited, integrated and verified: lib/assistant-app-server.mjs, lib/assistant-coordinator.mjs, lib/assistant-mcp.mjs, lib/assistant-presentation.mjs, lib/assistant-runtime.mjs, lib/codex-account-work-evidence.mjs, lib/codex-app-account-runtime.mjs, lib/codex-thread-control.mjs, lib/assistant-turn-control.mjs, lib/assistant-turn-control-instructions.mjs, test/assistant-coordinator.test.mjs, test/assistant-presentation.test.mjs, test/assistant-turn-control.test.mjs.
- Native build/storage tooling is an existing release prerequisite; inspect separately and include only if required by this release: native/macos/build-app.sh, native/macos/package-release.sh, native/macos/storage-workflow.sh.
- Unrelated skill/plugin metadata, cloud/native, marketing-site, assets/wordmark-explorations and existing audit/report directories remain in their original lanes. Baseline hashes/status preserve the exact starting inventory.
- Release target is the private native app and its embedded runtime. Public npm publication and unrelated cloud deployment are separate products.

## Acceptance

- Actual selected ChatGPT identity agrees with the runtime for Assistant, manual requests and reviews; rejected API/missing/mismatched authentication has no model dispatch.
- Existing Assistant ID/history preserved across migration and relaunch; same request never sent twice after uncertain delivery.
- Persistent settings survive restart and apply consistently to new and resumed work; in-flight requests retain captured settings.
- Files/commands/network, installed tool discovery, native computer inspection/capture, exact thread control, approvals and phone reconnect are exercised at appropriate fixture/live levels.
- Terminal process identities, unrelated drafts/state and inherited unrelated edits are preserved.
- Native install/version/hash readback, signature/notarization and repository hygiene verified before completion.
