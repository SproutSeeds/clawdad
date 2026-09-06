# Voice Settings envelope repair

Released September 6, 2026: Mac 0.7.0 build 55 is installed, notarized, and
healthy. Existing iPhone build 46 remains compatible and assigned to ClawDad
Internal. Reopen Settings or choose Refresh voices on the iPhone to retry.

## Cause and repair

The phone sends `speech.voices.request` to load Settings and
`speech.voices.update` to save its selection. The Mac already had handlers for
both commands, but the shared protocol's allowlist omitted these commands and
the `speech.voices` reply. Validation rejected the request with “unsupported
cloud envelope type” before its handler ran.

The protocol now registers all three messages. Both reads and writes require a
signed request from a paired device; updates are classified as state changing.
The relay already forwards these messages, so this repair required the native
Mac host update. No iPhone binary or cloud relay deployment was required.

The previous release verified local Settings and the voice catalog, but its UI
fixture bypassed cloud envelope validation. That missed this failure. The new
regression test connects relay routing to the actual Mac envelope handler.

## Evidence

- Before the fix, all three new tests failed, reproducing the unsupported
  `speech.voices.request` error.
- After the fix, 62 transport tests passed. Read, save, and reload cross the real
  relay routing function and Mac handler with signed requests and replies. The
  test checks request correlation, saved choice, device targeting, and rejection
  of unsigned, unpaired, and tampered commands before the local API is reached.
- All 489 runtime tests passed with
  `CLAWDAD_CODEX_APP_SERVER_MODE=isolated node --test --test-concurrency=1 test/*.test.mjs`.
  Serial execution avoids the previously recorded unrelated dispatch timing and
  temporary-directory cleanup races.
- A post-install probe loaded the installed Mac handler and protocol, sent a
  signed read through in-process relay routing, and fetched the real authenticated
  API on port 4487. Its signed reply returned all three installed/enabled models:
  Kokoro 54 voices, Pocket 26, and Kitten 8. Existing selection and per-model
  preferences remained unchanged. Installed protocol and handler hashes match
  both the checkout and installed app bundle.
- The installed host reports healthy, the shared Codex app server is ready, and
  the live cloud-host process targets port 4487 with an established relay
  connection. The installed Mac UI loads and responds.
- Apple accepted submission `d6ccdf04-dce8-4e15-8cc0-e3454fe8e4a0`. The app was
  stapled and passed codesign verification and Gatekeeper assessment.
- TestFlight build 46 remains VALID and assigned to ClawDad Internal. Its test
  instructions were updated and read back to identify Mac build 55 as the fix.

The installed-host probe uses ephemeral test identities only in its own process;
it does not change production pairing or preferences. It exercises the installed
handler and live local API, with relay routing in process. It does not constitute
a physical iPhone check or a production WebSocket request from the paired phone.

Artifacts are in
`native/macos/dist/candidates/voice-settings-envelope-2026-09-06/`, including
`baseline.log`, `transport-tests.log`, `runtime-tests.log`,
`installed-host-probe.mjs`, `installed-host-probe.json`, `mac-build-final.log`,
`notary-submit.json`, and `notary-accepted.json`. The previous signed Mac build 54
is preserved in that candidate's `rollback/ClawDad-build54.app`.

## Local model storage

The first release build stopped at the existing 50 GiB free-space threshold.
Pocket and Kitten's newly downloaded model repositories and the Japanese UniDic
dictionary were copied to `/Volumes/Code_2TB/Models/ClawDad/`. Every file and
symlink was verified before replacing the original directories with links to
their preserved copies. This freed about 3.5 GiB on Main, bringing it above the
build threshold. Existing cache holds and active build caches were preserved.

Pocket, Kitten, and Japanese Kokoro therefore require Code_2TB to remain mounted.
The models remain local; no cloud storage or compute was added. Fresh Python
loads with network access disabled successfully generated actual Pocket, Kitten,
and Japanese Kokoro WAVs after the move. The relocation manifest and synthesis
evidence are `speech-cache-relocation.json` and `relocated-model-checks.log`, with
the generated WAVs beside them.

## Workspace handoff

This checkpoint contains only the protocol fix, its regression test, TestFlight
instructions/receipt, and these release notes. Public npm, GitHub release, and
external TestFlight publication remain outside this private native release.

Eight pre-existing ClawDad dirty groups are preserved for separate owner review
and validation: `.agents/skills/clawdad-release/SKILL.md`;
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`;
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`;
`assets/wordmark-explorations/`; `marketing-site/`; `native/macos/build-app.sh`;
`native/macos/package-release.sh`; `native/macos/storage-workflow.sh`.

Doc Reader source is unchanged in this repair. Its four pre-existing dirty paths
remain for separate owner review: `bin/read-docs.js`, `doc_reader/webapp.py`,
`macos/DocReaderApp/Sources/DocReaderApp/main.swift`, and
`tests/test_webapp_library.py`.

Final diff checks passed. ORP classifies all remaining unrelated dirty paths in
both repositories, with zero unclassified paths. Each group retains the separate
review action listed above.
