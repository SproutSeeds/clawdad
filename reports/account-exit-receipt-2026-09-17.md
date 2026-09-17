# Account switch: Codex multiline exit receipt — September 17, 2026

## Confirmed incident

Operation `bc137d3f-9cbb-4aaa-b62b-8ac2f9df87df` stopped in `capturing_window` at **06:05:18.237 UTC**, with `phase=preflight`, `status=needs_attention` and an empty effects map. It selected the nine-tab window. The reported blocker named `erdos-problems` and exact saved conversation `01a06f86-95ab-7ed0-aa7d-650e8cafa58d`.

Read-only Terminal inspection found `/dev/ttys000` at an empty `BackToTheFort> ` prompt. Its process census contained login and foreground zsh; no Codex process remained. Its native exit footer was:

```text
To continue this session, run:
  codex resume 01a06f86-95ab-7ed0-aa7d-650e8cafa58d
Or run codex resume and select Investigate problem 23 next steps.
BackToTheFort>
```

`MainWorkspaceAgentBindings.exitReceipt` accepted only the older one-line `To continue this session, run codex resume <UUID>` immediately before the empty prompt. The observed supported multiline format therefore failed. This was a format-recognition defect; the saved thread and history were present. The durable binding identifies Codex 0.154.0's executable, the same login lifetime, the exact project `/Volumes/Code_2TB/code/erdos-problems` and its original local history file.

## Scoped repair

- Recognize the legacy footer and the observed multiline command, with the optional named-picker hint and Terminal display wrapping.
- Require the complete final block directly before a supported empty shell prompt. Retain exact UUID matching, same TTY/login lifetime, verified saved history and native foreground/ownership checks. Names never supply thread identity.
- Reject a different thread, another subsequent exit block, intervening shell prompts, a nonempty shell draft, a title alone and interruption without a verifiable exit receipt. Missing evidence remains an actionable stop; no session is guessed or automatically replaced.
- Storage, manual snapshots, authentication, account budgets, Enter/Tab dispatch and existing receipt semantics are unchanged. No research prompt or queue was submitted as a test.

## Verification

- **82 focused native tests passed, zero failures**, covering workspace capture/restore, account-window receipt handling and native shell input. Final log: `/tmp/clawdad-exit-receipt-final-tests.log`.
- Added durable-journal reload and wrapping cases at 18, 40, 80 and 180 columns; wrong UUID, reused TTY/login, old receipt after shell commands, conflicting newer exit, nonempty draft and missing receipt cases.
- The explicitly opted-in read-only incident test loaded the actual saved Erdős binding and captured Terminal text. It verified the same current shell lifetime/owner, exact project, exact persisted conversation and acceptance by the repaired parser. It also verified that the old one-line form was absent. No UI input, draft mutation or history mutation was involved.
- The five prior historical receipt failures remain retained and produce zero active/uncertain blockers in their separate read-only regression.
- Evidence is in `native/macos/dist/candidates/exit-receipt-2026-09-17/`. A complete nine-tab account transition is separate from this read-only and disposable-fixture proof.

## Release and continuation

Mac **0.7.0 (157)** was signed, notarized, stapled and installed at **06:43:03 UTC**, from source commit `182d218c8fb97b9e8b7ca655d117b632e350c096`. The installed binary matches the signed package; build 156 remains recoverable at `/Applications/.ClawDad-before-157.app`. App notarization `e89218ad-9420-438e-9500-bd1f40cf8d58` and DMG notarization `5547a7dc-8b49-445a-a51c-e457ee6cc8dc` were accepted. Artifacts: `native/macos/dist/releases/0.7.0-beta.20-macos-157-exit-receipt/`.

Native HTTP health at **06:43:37 UTC** verified the existing runtime, window-rebuild capability, one nine-tab window and all original Terminal process/thread owners unchanged. iPhone **0.7.0 (100)** already contains the Cancel/reconnect repair and needs no change for this native parser fix.

The stopped operation has no completed window capture. This worker update refreshed its transient catalog IDs. Before installation, the original selection matched the current catalog; after installation, all nine exact native backing-window-ID/TTY pairs and all Terminal process/thread owners matched. Terminal's frontmost-first enumeration reordered those same pairs; membership was compared independently of that display order. The current catalog has exactly one corresponding physical window. Original destination remains `codyshanemitchell@gmail.com`.

Recovery uses the existing user-control endpoints: cancel and verify the undispatched obsolete preflight, then register the same requested destination with the verified current window and a fresh durable request. It does not rewrite the original operation or its selection. Exact request and acceptance receipts are retained in the candidate evidence directory. An account transition is not claimed complete merely because that replacement request is accepted; its controller must still capture, authenticate and verify restoration.

## Workspace classification

This lane owns `MainWorkspaceAgentBindings.swift`, its focused tests in `MainTerminalWorkspaceTests.swift`, and this report. Existing native build/storage scripts, release skills/plugin manifest, artwork, cloud/native and marketing-site changes are preserved. Candidate, archive and release artifacts remain in canonical ignored native distribution paths. No CLI publication or infrastructure change is included.

`git diff --check` passed. ORP hygiene remains `dirty_classified`, zero unclassified paths, `safe_to_expand=true`; the nine inherited dirty buckets are preserved.
