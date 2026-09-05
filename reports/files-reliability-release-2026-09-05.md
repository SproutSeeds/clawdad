# Remote Assist reliability and local Files release

September 5, 2026. Final native release: Mac 0.7.0 build 48 installed at
`/Applications/ClawDad.app`; iPhone 0.7.0 build 40 VALID and assigned to
ClawDad Internal. Physical iPhone acceptance is pending. The implementation
checklist is `docs/remote-assist-reliability-and-local-files-plan.md`.

## Changes delivered

Terminal selection accepts a new destination during background refresh and
retains the latest explicit choice. Matching request IDs prevent older replies
from overwriting newer selection. Focus uses cached stable tab identity, one
post-focus readback, and throttled unread-indicator work. A bounded host queue
preserves moves separately from the latest focus request. Control replies retry
when the data channel is congested instead of silently dropping the receipt.

The picker keeps stable window groups and mirrors their native tab positions.
Native macOS grouped windows are mapped from their visible tab labels when that
mapping is unambiguous. Drag handles and accessible Move up/down actions request
a move of the existing tab within its group. The Mac validates live identities,
revision, and tab geometry, performs the native tab drag, preserves the previous
selection, and confirms the resulting order. Duplicate/ambiguous native labels
do not advertise a guessed reorder capability. Cross-window moves are excluded.

Remote Assist Read Aloud now uses native iPhone speech once the selected tab's
complete response text arrives. It preserves exact text and source ownership,
supports pause/resume/stop, and no longer depends on a second cloud audio
connection. The general cloud connector also resets its reconnect backoff after
a successful connection. Response retrieval waits for Terminal work instead of
failing simply because a catalog refresh is active.

Use on Mac verifies the clipboard write first. It reports confirmed Accessibility
insertion, clipboard-only delivery, or a posted paste request accurately. The
receipt cache survives peer reconnects; retrying the same request cannot paste
twice. Failure retains the draft. The recording button uses explicit circular
clipping and removes the expanding overlay. The idle/review appearance was
visually inspected; actual recording and physical insertion remain acceptance
checks.

Files has one immutable snapshot library under
`~/Library/Application Support/ClawDad/Files`. Agents explicitly register finished
deliverables through `clawdad files add`; the Mac has Add files, selected legacy
import, and Copy agent instructions. Ordinary source edits create no entries.
Files groups revisions and formats, with project/type/search filters, pinning,
archive, and previous versions. The Mac previews text and offers downloads and
Show in Finder. Finder receives a separate copy, preserving the library snapshot.
Legacy artifact browsing no longer initiates automatic cloud uploads.

The iPhone opens Files from the workspace or Remote Assist, downloads on demand,
resumes partial transfers, checks SHA-256 before publishing the local copy,
previews through Quick Look, and exports through Share/Save to Files. Retained
copies and metadata are scoped to the paired computer and excluded from phone
backup. Removing a retained copy leaves the Mac library and user exports intact.

Files uses a separate signed, paired WebRTC data connection with no capture or
input channel. Transfers are direct/STUN only. TURN credentials and relay
candidates are excluded; bulk relay fallback remains disabled until its budget
accounting is verified. Restrictive networks can therefore prevent new Files
connections. There is no cloud file store, mirror, or document processing.
Limits are 100 MB/file, 10 GB/library, 5,000 documents, 200 versions/document,
32 KB chunks, bounded framing/backpressure, and final checksum verification.

## Verification

| Check | Evidence |
| --- | --- |
| Runtime tests | 480 tests passed; includes authenticated Files API and concurrent save/recovery tests |
| Mac Swift tests | 90 executed, one live Terminal test skipped, zero failures |
| iPhone Swift tests | 72 passed |
| Shared protocol tests | 39 passed |
| Real WebRTC peers | 190,000 bytes transferred and echoed exactly; no audio/video negotiated |
| File integrity | Immutable versions, deduplication, formats, resume offsets, invalid paths, symlink substitution, checksum failures, pairing isolation, and archive retention covered |
| iPhone UI | Files open/Back, reader source/copy/Back, dictation draft/copy/Back passed; final build 40 also passed Remote Assist → Files → Back |
| Mac UI | Final Files entry point, saved guide, text preview, Escape/Back, and Show in Finder exercised through Computer Use |
| Installed runtime | Port 4487 healthy, shared Codex app-server ready, bundle marker and source hashes match the candidate |
| Persistent library | Guide survived the final app replacement; downloaded and Finder-exported bytes match its saved checksum |
| Mac release | Signature valid, notarization Accepted, ticket stapled, Gatekeeper accepted |
| iPhone release | Archive and upload succeeded; Apple VALID, internal assignment and test instructions verified; external group remains unassigned |

The live Mac preview check found a blank sandboxed frame after the API checks
had passed. The final build fetches authenticated preview content and renders
text safely as text, images as images, and PDFs through the native document
viewer. Oversized inline previews offer Download/Show in Finder. Live visual
acceptance in this run covered TXT; PDF and image preview still need hands-on
coverage.

Simulator fixtures and synthetic peer tests do not prove physical iPhone audio,
real remote typing, tab dragging, cellular connectivity, or iOS export behavior.
Computer Use explicitly denied access to Terminal, so the live drag and its
latency benchmark were not exercised. The implementation performs preflight and
post-move validation, but the plan's physical move proof and many-tab edge
scrolling checks remain open. A request-stage timing capture across both devices
also remains open; no measured median/p95 switching claim is made.

## Release identities and artifacts

- Apple build: `2fa77ef8-f549-4a6b-a729-33eabe4a2d91`, 0.7.0 (40), VALID.
- Internal group: `bbba6b69-7ac4-4d56-bc41-e9456d56b02e`, ClawDad Internal.
- Mac notarization: `26562420-447f-4101-8c92-7ccdc5a24d85`, Accepted.
- Mac candidate root:
  `native/macos/dist/candidates/files-reliability-2026-09-05/build48/`.
- Mac ZIP SHA-256:
  `d0cc51ffceffea4239adc0f8aa68de9ebbcd04fa4a70fef6289760bceee7ef48`.
- Installed/candidate Mac executable SHA-256:
  `7cb8788b5656940abd9731629f5d1810729c73e0b7c92b7449b3b57eda249900`.
- Installed runtime bundle marker:
  `794487c35fe6546dab080ead8bdd3d077b60a816b92a937de29e9c651ec96f37`.
- IPA: `apps/ios/ClawDadMobile/build/FilesReliability-IPA-40/ClawDad.ipa`.
- IPA SHA-256:
  `59d3038edfbf00a19daaf6d609db979ab79e97156d2c7b3abf51d43db3de3e26`.
- Live Files receipt and reviewed Mac screenshot: `live-files-receipt.json`
  and `mac-file-preview.png` in the Mac candidate root.
- UI results: `apps/ios/ClawDadMobile/build/FilesReliabilityUITests.xcresult`
  and `FilesNavigation40UITests.xcresult` in the same directory.
- Reviewed iPhone images:
  `apps/ios/ClawDadMobile/build/files-reliability-ui-review/`.
- First library item: ClawDad Files guide, 2,102 bytes, SHA-256
  `83c84ec7fade7d72140a09460a1e93cf037b3a9f0a6790448e2c93a935c4bfe7`.

Apple reported the existing missing WebRTC dSYM warning; upload succeeded, with
framework crash-symbolication coverage limited. The physical phone was not
available to CoreDevice for final installation readback. Build 40 distribution
is verified in TestFlight; installation on Cody's phone is unverified.

Mac build 46 is preserved in the normal App Backups directory. Intermediate
Mac 47/iPhone 39 were superseded during final navigation/preview checks. Public
npm, GitHub releases/tags, appcasts, cloud provisioning, external TestFlight,
and App Store submission were outside this native/internal release.

## Physical acceptance and workspace checkpoint

Cody was asked to update to build 40 and test switching/reordering two Terminal
tabs, Read Aloud, Use on Mac, and downloading the guide. Also verify no-input
clipboard fallback, receipt retry without duplicate insertion, reading after
dictation, headset interruptions, actual recording appearance, and offline
preview/export on iPhone. The request is pending; no physical success is assumed.

The scoped implementation, tests, metadata, plan, and this report belong in one
local checkpoint. Five pre-existing dirty groups are preserved for their owners'
separate review/commit: `.agents/skills/clawdad-release/SKILL.md`,
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`,
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`,
`assets/wordmark-explorations/`, and `marketing-site/`. Build/notary/IPA/UI
artifacts stay in the ignored canonical paths above. ORP reports all dirty paths
classified and zero unclassified paths.
