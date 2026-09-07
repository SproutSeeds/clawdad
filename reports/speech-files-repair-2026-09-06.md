# First-tap reading and iPhone file export repair

Follow-up: [Mac build 61 repairs the audio download handoff](speech-handoff-repair-2026-09-06.md).
The previous streaming checks missed the real server's full-manifest readiness
gate. Build 50's Terminal lookup, audio-route, and Files repairs remain in place.

iPhone 0.7.0 build 50 is available in ClawDad Internal TestFlight with repairs for
Remote Assist reading and Files. Installed Mac build 60 supports this update.

## Audit and behavior

The speaker's first Terminal catalog request used the picker's eight-second
timeout. A late reply was then discarded, while the separate reading action
continued waiting without another catalog request. A UI fixture delaying the
first catalog by nine seconds reproduced the failure before the repair.

One speaker tap now owns up to three catalog attempts within a 30-second lookup
window. Temporary selection-worker contention is retried within the same action.
Response retries revalidate the original tab; a changed focus cannot silently
redirect the reading to another answer. Highlighted text keeps priority, and
ambiguous selection errors do not fall back to unrelated Terminal text. Stop
cancels lookups and rejects late responses.

Audio startup previously discarded already-received audio after one activation
or player-start error. Startup now retains that audio and makes three bounded
retries while the audio route settles. Stop and dictation takeover cancel those
retries. The existing local models, saved voice, streaming playback, and playback
across navigation remain in place.

The Files download was correctly validated, but Preview, Share, and Remove
Download shared a SwiftUI List row with automatic button behavior. Tapping
Preview also invoked Remove Download. The failing UI test recorded the PDF
becoming unavailable with a "no such file" error. Each action now has an
independent tap target.

Preview, Save to Files, and Share use separately retained, checksum-verified
copies. Save to Files invokes Apple's document exporter with copy semantics and
reports success only after its completion delegate returns a destination.
Cancel is always visible and preserves the download. Share uses a native
activity controller with the actual file. Copies remain retained through dialog
dismissal, and rapid repeated actions cannot replace a file still being exported.

The local Documents directory is visible as On My iPhone > ClawDad for user
exports. Pairing-scoped downloads and private application data remain in
Application Support. Storage and speech processing remain local; this patch
changes no cloud storage, resource allocation, or relay budget.

Apple API references:
[document export](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller/init(forexporting:ascopy:)),
[file transfer representations](https://developer.apple.com/documentation/coretransferable/filerepresentation).

## Verification

- Runtime suite: 495 tests passed with isolated Codex app-server mode and serial
  execution.
- Mobile Swift suite: 96 tests passed. New coverage verifies automatic audio
  startup recovery, Stop during a retry, retained export bytes after removing the
  cached download, and rejection of same-size corruption.
- The slow-catalog UI regression failed before the repair and passed afterward.
- The file-action UI regression reproduced accidental deletion before independent
  button styling. The repaired download, visible PDF preview, system save, and
  cancellation path passes.
- Eleven distinct UI checks pass across the final targeted runs: slow initial
  catalog recovery, temporary selection contention, delayed capabilities/target
  capture, selected-text priority, ambiguous-selection rejection, early streaming
  playback, Stop during lookup, playback across navigation, dictation takeover,
  PDF download/preview/save/cancel, and Share > Save to Files. The older capture
  check was changed to require an advancing timer of at least ten seconds instead
  of sampling one exact second; its failure screenshot already showed 13 seconds
  of continuous recording. The Share test targets iOS 26's native action cell.
- The native system exporter wrote a PDF to the simulator's Documents directory.
  Its bytes and SHA-256 matched the downloaded file, and PDF text extraction
  confirmed the visible sentence "Hello from your Mac."
- The actual shared library test PDF remains 2,662 bytes with one readable page.
  Its live authenticated download matches SHA-256
  `cd791159dec49c613ada66b48ebe3984270ee7de94fd2b92377a531a3460c917`.
- The installed Mac's saved Kokoro Heart voice generated a fresh two-part WAV.
  The first part became available after 6.86 seconds and the job completed after
  7.62 seconds. These are local preparation measurements, excluding phone/network
  and audio-route latency.

The Files UI fixture supplies list/chunk payloads and a text-bearing PDF, while
the production download, checksum, preview, and system-export paths execute.
Speech UI fixtures exercise the production wire/state flow with silent PCM;
they verify startup and cancellation rather than voice quality. Physical iPhone
acceptance of the new build remains a hands-on check.

Evidence: `native/macos/dist/candidates/speech-files-2026-09-06/`.

The release archive targets production bundle `earth.frg.clawdad.ios`, version
0.7.0 (50), with the production cloud URL and founding-beta bypass disabled.
Signature validation passes, and the Release binary excludes all new DEBUG
fixtures. Executable SHA-256:
`b49278a30daef046d36ad41125d72d84db536f9ca47836b0c0d763d929919504`.
The shared Files guide was updated in place, preserving three versions.

## Release result

The signed build uploaded successfully on September 6, 2026 at 7:06 PM CDT.
Apple marked build `b4ee46eb-4fcb-4623-bd30-6892d3c12bfc` VALID. Assignment to
ClawDad Internal and the updated build-specific test instructions were read back
at 7:12 PM CDT. The separate build-beta-detail readback confirms
`internalBuildState: IN_BETA_TESTING` and automatic notification enabled.

The upload retained the existing vendored WebRTC missing-dSYM warning and
completed successfully. Apple configuration changed only this build's internal
group assignment and test instructions. The release receipt is
`ops/app-store-release.json`.

On the iPhone, update ClawDad to build 50 in TestFlight. In Remote Assist, use
the folder icon, open ClawDad Shared Files Test, then choose Download and Save
to Files. On My iPhone > ClawDad is available as a local save destination.

## Workspace and release scope

This is the private native iPhone release channel. Mac build 60 remains installed;
the runtime, public npm/GitHub distribution, public appcast, external TestFlight,
and App Store review do not require changes for this repair.

The eight existing dirty groups are preserved for separate owner review:
`.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`,
`native/macos/package-release.sh`, `native/macos/storage-workflow.sh`,
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`,
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`,
`assets/wordmark-explorations/`, and `marketing-site/`.

The final diff check passes. ORP classifies all dirty paths, with zero
unclassified paths and expansion permitted. The repair commit contains only the
audited iPhone implementation, regression checks, documentation, and release
receipt; the eight existing groups retain their separate owner-review next step.
