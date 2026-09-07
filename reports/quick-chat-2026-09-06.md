# Remote Assist Quick Chat

Mac 0.7.0 build 62 is signed, notarized, and installed. iPhone 0.7.0 build 51 is
available in ClawDad Internal TestFlight (`VALID`, `IN_BETA_TESTING`).

## Behavior

The speech-bubble control opens Quick Chat inside the existing compact Remote
Assist menu. Tapping a preset sends its exact text and then Enter to the Mac input
captured when the controls opened. It does not add agent instructions, rewrite
the preset, open another terminal, or clear the current draft. Existing input
receives the preset just as it would receive pasted keyboard input and Enter.

The five initial presets are `pwd`, `ls`, `cd ..`, “Continue with the next
implementation steps.”, and “Let’s discuss the next steps. Break it down.”
Edit supports changing, adding, and deleting presets. Labels, exact text, and
order persist in local iPhone preferences, including an intentionally empty list.
The editor and list have visible Back controls; Escape uses the same Back handler.
Preset text is limited to 16 KiB, with up to 40 presets.

The routine green lock and “Secure session” header are removed from the iPhone
controls. The locked-Mac state still displays relevant feedback. The Mac floating
“Remote Assist active” panel is removed; the ClawDad application menu exposes
Stop Remote Assist while a session is active.

## Delivery and lifecycle

Quick Chat uses the existing encrypted WebRTC control connection. The Mac
advertises an optional capability so an older host cannot silently treat a preset
as separate unconfirmed keystrokes. The phone waits for capability and target
capture replies, then transmits an addressed text-and-submit request. A delayed
receipt retries the same request ID at five-second intervals, bounded to 20
seconds. The Mac retains outcomes so receipt retries do not insert or submit twice.

The Mac shares the dictation capture registry: input generation, focused app,
process launch, accessibility element, window, and native Terminal tab identity
must match. It rechecks identity after insertion before posting Enter. The caret
may move as a result of insertion; the app, element, window, and tab must remain
the same. A missing, expired, locked, or changed target cannot substitute another
input. If text was inserted before a focus change or disconnect, Enter is withheld
and the outcome is retained. Clipboard-backed insertion preserves the previous
Mac clipboard when no other writer has changed it.

Preset delivery and pending input are cancelled on disconnect. Existing host
cleanup is independent of the removed panel: phone Stop and app quit tear down
capture; a WebRTC disconnect gets a 15-second recovery window, cancelled if the
same peer reconnects. Failed or closed connections end the session directly.

Preset storage and transfer add no cloud object store or compute service.

## Verification

- Shared protocol: 51 tests pass, including exact Unicode/whitespace transfer,
  payload limits, required target tokens, and optional capability compatibility.
  The real local WebRTC handshake test also confirms that the production Mac
  advertisement negotiates Quick Chat after a lost initial state reply.
- Native Mac: 135 tests execute with zero failures; six existing hardware or
  permission-dependent checks are skipped. New delivery cases cover replayed
  receipts, changed destinations, partial insertion, and disconnect cancellation.
- Mobile models: 98 tests pass, including local persistence, edit/delete, exact
  custom text, and an intentionally empty list.
- iPhone UI: three Quick Chat tests pass for single-tap delivery despite delayed
  capture and a dropped receipt, changed-target rejection, and editing, adding,
  saving, Back navigation, and persistence across relaunch. The compact-menu
  screenshot was visually reviewed. Three related speaker tests also pass.
- Runtime: all 501 cases were exercised. The initial pass caught release metadata
  still pointing at build 50; after the metadata update, all 12 release-metadata
  checks passed. The complete rerun passed 500 cases and exposed an existing
  shell-registry concurrency flake (39 of 40 updates completed). All 13 cases in
  that unchanged registry test file then passed in an isolated rerun. No registry
  implementation or test expectations were changed.

The UI fixture exchanges production wire messages and the Mac tests exercise the
delivery policy; these do not constitute physical iPhone-to-Terminal acceptance.
The remaining hands-on check is one tap into the intended Mac input from the
updated iPhone, followed by verification that the text and Enter arrive once.

## Release and workspace

Release evidence is retained in
`native/macos/dist/candidates/quick-chat-2026-09-06/`. Native compilation and
candidate packaging use the development drive. Mac build 62 packages the new
release binary with the verified build 61 resources and updated release metadata,
then receives a fresh Developer ID signature and Apple notarization. Build 61 is
retained in the candidate's `rollback/ClawDad.app`.

Apple notarization: `009f5cfb-06e7-49ce-9eaf-3d39cde414ab`, Accepted. The app is
stapled and passes strict signature and Gatekeeper verification. Installed
executable SHA-256:
`114913b1bc3ac6dc08d93962804fdc94a7ac75a58786b888a69ed3329146f3ad`.
Stapled ZIP SHA-256:
`7dee2d0eb895b98e37837e667ee06d0b1fe166aa53541c43a2b00c1cc1604d9f`.
Runtime fingerprint:
`b81677b169aef3158d8dfdcc161fdb811263673e5c22c3f2efd35b3f7ce54aed`.

The installed app and active runtime match the source hashes for the server,
speech host connector, and release metadata. Authenticated native capabilities
report the matching runtime fingerprint and Remote Assist support. `/healthz`
reports healthy, with the shared Codex app server ready. The Mac interface loads
normally; its application menu hides the session-only Stop action while idle.

App Store Connect build `78de5b10-a652-4667-a928-ed6618f8a993` is assigned to the
existing internal group, with build-specific test instructions. External
TestFlight, App Store submission, public npm/GitHub release, and the public Mac
appcast are unchanged.

The scoped checkpoint excludes eight pre-existing groups:
`.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`,
`native/macos/package-release.sh`, `native/macos/storage-workflow.sh`,
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`,
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`,
`assets/wordmark-explorations/`, and `marketing-site/`. These remain for their
existing owners to review and checkpoint separately.

Whitespace verification passes, and ORP reports zero unclassified paths. All
build logs, screenshots, archives, and rollback artifacts remain in ignored
canonical build/candidate directories.
