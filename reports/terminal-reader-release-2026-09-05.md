# Remote Assist latest-response reader

September 5, 2026 (America/Chicago).

Implemented and released through the existing native channel: Mac 0.7.0 build
46 installed, signed, notarized, and healthy; iPhone 0.7.0 build 38 VALID and
assigned to ClawDad Internal. The connected iPhone last reported build 37.
Physical iPhone playback acceptance remains pending; Cody has been asked to
update to 38 and try two different terminal tabs.

## Delivered behavior

- Remote Assist → … → speaker requests the selected Terminal tab's latest
  completed Codex answer. Each new tap refreshes the answer.
- The phone displays the tab title, completion time, and exact response text.
  It reuses the existing paired-computer Read Aloud service and the user's
  existing remote fallback preference.
- Pause, Resume, Stop, and Copy text to iPhone are available in the panel. Back
  cancels unfinished text retrieval and returns to Remote Assist. Accepted audio
  can continue with a compact player on the remote screen.
- If a newer turn is running, the previous completed answer is labeled and
  requires an explicit Play action. Commentary, tool output, and an unfinished
  final message never replace a completed answer.
- Read selected text uses the existing copy protocol with an explicit current
  foreground requirement. It feeds the returned selection into speech without
  replacing the iPhone clipboard. This supports other agents and Mac text.
- Tab changes invalidate pending text and owned audio; chooser changes do so
  immediately, and changes outside the chooser are detected by a two-second
  catalog poll. Lock, disconnect, leaving Remote Assist, and starting dictation
  also cancel the relevant reading operation. Old hosts show an update message.

## Retrieval and isolation

The Mac resolves the chosen tab's terminal identity to attached Codex processes
and their open CLI conversation files. It deduplicates wrapper processes,
excludes subagent conversations, and rejects ambiguous matches. It checks both
the tab selection and the conversation binding after retrieval.

The reader seeks backward through the conversation file rather than traversing
the thread from its beginning. It uses completed-turn records and preserves the
answer text. Reads are bounded to a 64 MiB tail, individual parsing buffers are
bounded, and responses above 64 KiB receive an explicit selection fallback.
Initial automatic support is for CLI conversations under the Mac user's
`~/.codex/sessions`; unsupported/custom storage can use Read selected text.

Phone requests retain their request, tab, revision, and computer ownership.
Cancelled or superseded responses cannot initiate playback. Speech can use the
host's configured default project for its audio cache, independent of the
composer project and All Projects history rendering. No conversation content is
summarized or rewritten by the new retrieval path.

The Mac bundle fingerprint now includes the cloud speech connector. This makes
the updated connector replace the previously installed runtime cache.

## Verification

| Check | Result |
| --- | --- |
| Full runtime suite | 474 passed |
| Native Mac suite | 85 passed, including live read-only terminal verification |
| iPhone Swift suite | 68 passed |
| Shared protocol suite | 36 passed |
| Focused cloud/release checks | 39 passed |
| Bundle fingerprint regression | Passed after build-script update |
| iPhone UI test | Source, response text, Copy, Back, reopen, and Stop presence passed |
| Simulator visual review | Player inspected; title/time/text/actions readable in the sheet |
| Live native reader | 12 terminal conversations matched; 10 completed answers retrieved |
| Other live conversations | One had no completed answer; one was still in progress |
| Live speech service | HTTP 200; 224,444-byte mono WAV, 24 kHz, 4.675 seconds |
| Speech round trip | HTTP 200 transcription; sentence recovered with a different spelling of ClawDad |
| iPhone archive/export/upload | Build 38 succeeded; Apple processing VALID |
| Mac signature/notary/Gatekeeper | Valid, Accepted, stapled, accepted by Gatekeeper |
| Installed Mac UI/runtime | Editor and All Projects loaded; 4487 healthy; shared Codex app-server ready |
| Installed executable/runtime integrity | Matches signed candidate and current cloud connector source |
| Git whitespace/hygiene | Diff check clean; pre-existing changes remain classified |

The simulator UI test uses a DEBUG-only fixture; it does not demonstrate physical
iPhone audio output or an actual remote data-channel exchange. Live reader tests
used the implemented resolver and parser and did not print conversation text.
The synthetic speech receipt is `reports/terminal-reader-tts-smoke-2026-09-05.json`.
Its transcription check is not a claim of perfect pronunciation or recognition.

UI result bundle: `apps/ios/ClawDadMobile/build/TerminalReaderUITests.xcresult`.
Reviewed screenshot:
`apps/ios/ClawDadMobile/build/terminal-reader-ui-review/all-attachments/46C31F07-2D8B-419D-88F8-04C6EB41CFA8.png`.

## Release evidence

- Apple build: `3dcc9f1d-c98a-4dc5-88fa-e92f5ecf69f8`, 0.7.0 (38), VALID.
- Internal group: `bbba6b69-7ac4-4d56-bc41-e9456d56b02e`, ClawDad Internal.
  Build 38 is assigned internally; its test instructions are updated. The
  external beta group remains unassigned.
- Mac notarization: `b40989ac-21bf-43e3-852f-3ad91c0ab023`, Accepted.
  Receipt: `native/macos/dist/candidates/terminal-reader-2026-09-05/notary-app-46.json`.
- Mac ZIP: `native/macos/dist/candidates/terminal-reader-2026-09-05/ClawDad-0.7.0-46-mac.zip`.
  SHA-256 `b08e7ba9c78a15bb1cc75fc65e84a500174ef357756c8efe18ef250341687723`.
- IPA: `apps/ios/ClawDadMobile/build/TerminalReader-AppStore-38/ClawDad.ipa`.
  SHA-256 `eeefb251aa5ecb347ed8c62f81b9caedb948187162c40bde408c9cac5a3f4eb3`.
- Installed and candidate Mac executable SHA-256:
  `3c301e53cd5b3f21ee05eafe90c3e03313a00c09ccb0fff07254763100947b8b`.
- Installed runtime bundle fingerprint:
  `280b2d843fa52917edb124fc84642d9ab8835e5a2d0d5ee5d6abace624528883`.
- Source and installed cloud connector SHA-256:
  `82b4bb652a081f22e06c07d9397f8a716ba1a53ba70f9ed9fd9a6156b7654730`.

Mac build 45 is preserved in the existing App Backups directory. Apple accepted
the upload with the existing WebRTC dSYM warning, which limits framework crash
symbolication. Public npm, public GitHub releases, appcasts, external TestFlight,
and App Store review were outside this native/internal release.

## Physical acceptance

1. Update ClawDad to TestFlight build 38, retaining the existing pairing.
2. Select two different Codex terminal tabs and read each latest completed answer.
3. Switch tabs during preparation; confirm the old answer does not start playing.
4. Test Pause, Resume, Stop, Back/compact player, and Copy text to iPhone.
5. Select Mac text and verify Read selected text speaks that selection.

## Worktree checkpoint

The scoped commit contains this feature, its tests, native/iPhone release
metadata, the bundle fingerprint fix, and these docs/receipts. Five pre-existing
paths remain for separate review by their owners:

- `.agents/skills/clawdad-release/SKILL.md`
- `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`
- `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`
- `assets/wordmark-explorations/`
- `marketing-site/`

Generated build, notarization, IPA, audio, and UI artifacts remain in the ignored
native/iPhone artifact paths above. No unclassified dirty paths remain.
