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

Mac **0.7.0 (157)** is being signed/notarized. Final installation and recovery status will be recorded here. iPhone **0.7.0 (100)** already contains the Cancel/reconnect repair and needs no change for this native parser fix.

The stopped operation has no completed window capture. Native worker updates can refresh transient catalog IDs. Recovery must verify the exact selected window again; it must not overwrite its selection from names or silently treat a different window as the original.

## Workspace classification

This lane owns `MainWorkspaceAgentBindings.swift`, its focused tests in `MainTerminalWorkspaceTests.swift`, and this report. Existing native build/storage scripts, release skills/plugin manifest, artwork, cloud/native and marketing-site changes are preserved. Candidate, archive and release artifacts remain in canonical ignored native distribution paths. No CLI publication or infrastructure change is included.
