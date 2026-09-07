# Assistant inside ClawDad

Assistant adds a persistent conversation inside the Mac and iPhone apps. A
dedicated, visible Codex CLI Terminal session coordinates the user's existing
Terminal workspace. Text, speech, task receipts, and navigation share that same
conversation.

## Using Assistant

On the iPhone, update ClawDad Internal TestFlight to build 53. Open **Assistant**
from ClawDad's main screen, or choose the headset in Remote Assist. Type a message
or choose **Start talking**. The paired Mac needs build 66, Codex installed and
signed in, and the existing Remote Assist permissions enabled. On first use,
complete any Codex startup/trust prompt in the new Assistant Terminal tab.
Keep ClawDad running and the Mac awake; computer input requires an unlocked Mac.

Speech uses the Mac's currently selected local STT model and TTS model/voice.
Voice remains active across navigation and when leaving Remote Assist; Mute and
End remain available. Speaking during playback interrupts the spoken response.
End stops this voice conversation; already running Terminal work continues.

The Assistant can inventory and inspect exact window/tab identities, read agent
context, focus a tab, submit a task, track completion, reorder/close tabs using
the existing native controls, and inspect or operate the desktop. The Workspace
view keeps tabs in the same directory distinct. Task cards show the exact prompt,
destination and delivery state, with Watch and queued-task cancellation controls.

## Execution and storage

- User messages enter the dedicated Codex CLI through real Terminal paste and
  Enter. Project tasks use the same route to the chosen existing agent tab. This
  feature does not dispatch Codex app-server turns. Existing app features retain
  their current routing.
- The shared Remote Assist catalog supplies native tab identity, physical order,
  agent activity and verified focus. Busy agents queue work; nonempty/multiline
  drafts, modal prompts, changing focus, and recent manual input stop insertion.
- The local ledger records request IDs before delivery and observes the exact
  CLI transcript. It supports both current `response_item/input_text` and older
  `event_msg/user_message` input records. Turn IDs attribute completion to the
  accepted prompt, including responses that finish before the input receipt.
- Repeated delivery IDs cannot submit twice. A lost receipt is retried without
  repeating native input. Unconfirmed acceptance after 45 seconds, worker
  replacement, and uncertain restart delivery require inspection. Completion
  updates return to the conversational coordinator as observed task output.
- Desktop input uses an expiring inspection token tied to the focused element,
  app and manual-input generation. Screenshots are bounded, transient memory
  results, excluded from the persistent ledger.
- Durable state is under
  `~/Library/Application Support/ClawDad/Assistant/`, with private directory/file
  permissions. The generated `AGENTS.md` is visible and preserved on later
  launches. Existing Codex session history stays in its normal local location.
- iPhone chat and speech use a separate paired WebRTC data session without screen
  capture. Existing authenticated signaling and TURN budget controls are reused.
  No SignalWire setup, new phone number, cloud speech provider or cloud file
  storage was introduced. Codex reasoning still uses the user's existing Codex
  access. Connection renewal preserves queued speech and stable request IDs.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | 513 passed |
| `swift test --package-path native/macos` | 154 passed, six opt-in live tests skipped |
| `swift test --package-path apps/ios/ClawDadMobile` | 101 passed |
| `swift test --package-path native/ClawDadRemoteAssistProtocol` | 60 passed |
| Native iPhone simulator UI suite | Two passed |
| iPhone Release archive and TestFlight upload | Succeeded |
| Mac arm64 Release build and strict signature check | Succeeded |
| Mac UI | Fixture navigation, text entry, workspace, pause, Back/Escape and focus restoration checked; installed app inspected |
| Local speech backend round trip | Kokoro `af_heart` generated 184,844 bytes of WAV; local STT returned a readable transcript in 2,951 ms total |

The speech check caught HTTP 202 handling in the new native proxy: generation is
now accepted and polled until audio is ready. Regression coverage verifies that
202 succeeds while actual provider failures remain errors. The installed Mac UI
check caught inherited full-width button styling squeezing the composer. The
Assistant now sizes its buttons and text input explicitly; the full app stylesheet
was included in the follow-up visual check.

Evidence lives in
`native/macos/dist/candidates/assistant-2026-09-07/`, including complete test logs,
simulator and installed-Mac screenshots, local speech results, signing/notarization
receipts, native health, and TestFlight read-back. The exact source commit is
recorded with the installation manifest after the scoped commit.

These checks do not prove a physical iPhone microphone-to-Terminal conversation.
Direct Terminal access was previously rejected by the computer-control tool;
the implementation and fixture checks did not bypass that restriction. The
remaining hands-on acceptance is: start Assistant, complete any CLI startup
prompt, have a voice exchange, interrupt playback, leave/reopen Remote Assist,
then submit a harmless task to a disposable agent tab and observe its receipt
and completion. Keep an unsent draft in a neighboring tab to verify preservation.

## Release

iPhone build 53 is `VALID`, assigned to **ClawDad Internal**, and verified
`IN_BETA_TESTING`, with the Assistant release notes read back from App Store
Connect. Build ID: `2c85c3b0-28be-45cf-b611-29c06407bc86`. The vendor WebRTC
framework's missing dSYM produced an upload warning; upload and processing
succeeded. No external Beta App Review or public App Store submission was made.

Final Mac installation verification is recorded in `mac-install-verification.json`
in the candidate directory. The installed release is build 66, version 0.7.0;
the signed build 65 rollback is retained there. This is a private native rollout.
Public npm publication, GitHub releases and public appcasts are outside its scope.

Final notarization was accepted under `53409037-3318-48c3-90e9-dcbb15b30b5c`;
the ticket is stapled and Gatekeeper accepts the installed app. One ClawDad
process runs from `/Applications/ClawDad.app`. Authenticated health, native
capability and Assistant state return HTTP 200; the native Assistant worker is
online. Source, bundled and active copies of all ten changed runtime/UI files
match. The complete active runtime fingerprint is
`de023e1141c3976b1961d578baafb3bf92b5f02073ac59a1d8785a7271bd5712`.
Assistant remains unstarted until the user's first message or voice action.

## Workspace and local artifacts

The feature is scoped to its native sources, protocol, local runtime, Mac web UI,
tests, native build metadata, cache ignore and these implementation/release notes.
The eight pre-existing dirty groups remain preserved for their separate owners:

| Existing group | Next action |
| --- | --- |
| `.agents/skills/clawdad-release/SKILL.md` | Review and checkpoint the existing release workflow edits separately |
| `native/macos/build-app.sh` | Review the existing storage-routing changes separately |
| `native/macos/package-release.sh` | Review the existing storage-routing changes separately |
| `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Checkpoint with its existing plugin update |
| `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Keep aligned with its separate release-skill update |
| `assets/wordmark-explorations/` | Review/canonicalize the artwork in its own task |
| `marketing-site/` | Continue in its existing marketing-site lane |
| `native/macos/storage-workflow.sh` | Review/checkpoint with the existing packaging storage work |

Two existing build caches were moved reversibly to the external Code drive while
preserving their original paths as symlinks: Sparkle's `Sparkle_generate_appcast`
cache and Xcode's shared `ModuleCache.noindex`, now under `/Volumes/Code_2TB/cache/`.
File counts and byte totals were checked. No user documents or unrelated project
builds were deleted. Final native linking reused the full signed framework/runtime
package produced by the normal build, then refreshed the audited payload,
fingerprint and signature before notarization.

The ignored `.cache/assistant-*` paths contain simulator derived data and the
isolated UI fixture; the canonical candidate contains release evidence and the
rollback. Retain these until physical acceptance, then prune superseded generated
packages through the normal storage workflow. Fixture servers are stopped at
handoff. Final ORP hygiene must retain zero unclassified paths.
