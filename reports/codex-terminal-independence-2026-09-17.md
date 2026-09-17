# Restore independent Codex Terminal launches

Status: **Verified / PASS** for fresh interactive-shell startup, September 17, 2026.

## User direction

Cody explicitly requested restoring ordinary Terminal Codex launches and removing ClawDad's ownership over the entire Codex Terminal space. Preserve this boundary during further account-switch work: ordinary `codex` must remain independent. Any future account routing should use an explicitly selected ClawDad workflow. Reinstalling the global shell override requires a new explicit user decision.

## Incident

The global `.zshrc` integration replaced `codex` with ClawDad's account launcher. Operation `b4d536af-126c-466f-ad73-b60309410f90` began at 08:48:25 UTC. Its `window.restore` request failed at 08:52:04 UTC with `Terminal window order changed during discovery`. Cancellation was subsequently requested, but the operation remained `needs_attention`, phase `transition`, `fenced=true`, because a transition had been dispatched. Every ordinary wrapped interactive launch consequently failed before Codex started.

## Applied rollback

Ran the existing supported removal command:

```sh
node bin/clawdad-codex-launcher-install --remove
```

It removed only the managed source block from `/Users/codymitchell/.zshrc`, retained a pre-removal backup, and marked the installation receipt `removed`. The restored `.zshrc` is byte-for-byte identical to the installer's original backup (SHA-256 `561cf73992b1b0115b2bbcba09f07ba166010d9121383c4905f1a7d28f2097ff`). The earlier bootstrap compatibility function remains: it directly invokes `/opt/homebrew/bin/codex -c features.code_mode_host=true` with the original arguments.

Source and installed-runtime searches found the installer only in its explicit CLI helper and tests, with no automatic reinstall caller. No product release or source rollback was necessary for this operational recovery.

## Verification record

- **PASS:** `zsh -n /Users/codymitchell/.zshrc`.
- **PASS:** `zsh -ic 'functions codex; codex --version; codex login status'` shows direct Codex invocation, CLI 0.154.0, and ChatGPT sign-in.
- **PASS:** `TERM=xterm-256color zsh -lic 'codex --no-alt-screen'` in `/Volumes/Code_2TB/code` reaches the normal fresh composer with `gpt-6-astra xhigh`. The isolated test process was then closed cleanly. No model prompt was submitted.
- **PASS:** The saved recovery contains nine tabs, all nine referenced conversation history files exist, and the saved nonempty draft remains present. Account credentials and switch recovery records were not changed.
- **PASS:** `git diff --check`; ORP hygiene remains classified with zero unclassified paths.
- **INCONCLUSIVE:** Full model-response execution and visual verification in the user's Terminal.app window were not performed. Computer Use disallows controlling Terminal.app; shell/PTY verification succeeded independently.

## Remaining state and next action

The failed ClawDad switch remains cancelled-but-unreconciled, with its recovery data preserved. ClawDad-managed controls may still show the hold. It no longer controls new ordinary Terminal shells. Existing shells keep already-loaded functions until the user runs `source ~/.zshrc` at their shell prompt, or opens a new Terminal window/tab. Do not clear the switch journal, replay its window restoration, or change authentication as a workaround.

Future account-switch redesign should begin from explicit per-workflow ownership and the preserved recovery receipts. A launch-only recovery is not proof that automatic switching or window recreation works.

This checkpoint owns only this report. The nine inherited dirty buckets remain preserved: the two release skills, native build/package/storage scripts, plugin manifest, artwork, `cloud/native/`, and `marketing-site/`. Their next action remains review/checkpoint by their respective existing work lanes; none were staged with this report.
