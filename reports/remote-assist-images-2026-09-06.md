# Remote Assist screenshots and photos

Mac 0.7.0 build 60 is installed and verified. iPhone 0.7.0 build 49 is processed,
valid and assigned to the existing ClawDad Internal TestFlight group.

## Behavior

- Paste recognizes copied iPhone images. The photo button offers multiple Photos
  selection and Browse Files, up to eight images, 20 MiB each and 80 MiB per group.
- A remembered Mac input, window, application instance and exact native Terminal
  tab authorize automatic insertion. Later input, tab/display changes, lock or
  disconnect invalidate that authorization. Saved images remain available for an
  explicit Paste into a freshly captured target.
- Image paths are pasted individually with Cmd-V and shell quoting. Existing draft
  text remains intact; no Enter event is generated. The clipboard remains stable
  between individual pastes. Queued input invalidates the batch before the next
  image, and the receipt identifies how many were already pasted.
- The compact transfer indicator offers progress, Pause, Retry and dismissal.
  Uploads resume from confirmed offsets. A repeated delivery request receives the
  original receipt, and reconnection requires an explicit fresh paste before input.
  The phone retains pending image bytes in memory while the app stays alive.
- Files has Documents and Received Images collections on Mac and iPhone. Completed
  images live under `~/Library/Application Support/ClawDad/Files/received/` and share
  the existing preview, download, pin and archive controls.

## Local transfer and limits

Images travel on the separate Files WebRTC connection. Control messages contain
only upload identifiers and remembered-input tokens; the host resolves its own
canonical paths. PNG screenshots retain their original bytes, while formats such
as HEIC are converted locally to an appropriate Terminal image format. Inputs are
bounded to 40 megapixels and SHA-256 is checked before finalization and attachment.

Uploads try direct ICE candidates first and may use the existing Cloudflare TURN
credentials after the existing per-customer/global budget check. Each upload
connection counts encoded application frames in both directions, stops at 256 MiB,
and expires after ten minutes. Existing ordinary Files downloads remain direct.
This patch provisions no resources, changes no monthly limits, and adds no cloud
object storage. TURN usage still consumes the existing relay allowance when used.

The Mac accepts 16 pending uploads and 160 MiB of reserved scratch, within the
existing 10 GiB library cap. Uncommitted scratch expires after 24 hours. Descriptor,
owner, filename, offset, chunk size, checksum, image signature and decoded image
dimensions are validated. Final files are committed atomically; interrupted
rename/catalog commits recover on retry. Received paths and ownership hashes are
excluded from public file listings.

## Verification

- Full runtime suite: 495 tests passed. The release fixtures were synchronized
  with build 49, and the existing release-signing/configuration checks pass.
- Mac suite: 131 executed, 125 passed, six opt-in live Terminal checks skipped,
  zero failures. Includes real paired WebRTC peers transferring fragmented bytes,
  media/relay policy rejection, byte limits, pasteboard contents and replay receipts.
- Shared protocol: 48 tests passed, including bounded uploads, image receipts,
  mixed-version capability decoding and lock-only capability preservation.
- Mobile suite: 92 tests passed, including exact PNG bytes, interrupted upload
  state, immediate pause/resume races, partial attachment receipts, lost replies,
  cross-computer isolation and explicit paste after reconnection.
- Runtime image/API checks cover authenticated upload and exact download,
  wrong-owner rejection, traversal, changed chunks, integrity failures, symlink
  substitution, cancellation, archive preservation and process-exit recovery.
- Installed Codex CLI 0.153.4 composer check: one paste containing multiple quoted
  paths becomes ordinary text. Separate bracketed-paste events produce Image #1
  and Image #2 while preserving an existing draft. This drove the individual
  Cmd-V delivery. The isolated CLI fixture submitted no prompt or agent request.
- iPhone simulator: four UI checks pass: image clipboard paste, Photos
  cancellation/return and a two-image selection, plus existing inline dictation
  insertion and clipboard/paste. The photo check uses Apple's real picker and
  requires exactly two images at the upload boundary; mic and speaker remain
  enabled after selection. The final visible-simulator screenshot confirms the
  compact thumbnail/receipt below the menu with no speech or image review sheet.
- The installed build's authenticated API accepted an upload in two pieces,
  resumed from the confirmed offset, returned one item for repeated finalization,
  and delivered identical image bytes through both local resolution and download.
  Its clearly named verification image was archived after the check. The existing
  Files guide was updated in place to two preserved versions.
  The installed Mac UI opens Received Images and previews that saved PNG correctly.
- Installed binary, bundled runtime and managed runtime match the audited sources.
  Health reports the shared Codex app server ready, and the managed host has an
  established TLS connection to the existing production relay. The signed
  installed-host probe passed and preserved all voice models and preferences.

Evidence is in `native/macos/dist/candidates/remote-images-2026-09-06/`, with iPhone
build products in `apps/ios/ClawDadMobile/build/`. Simulator hosts exercise real
wire messages but substitute the remote uploader; paired transport and actual
local HTTP/storage paths have separate integration checks. Physical iPhone-to-Mac
delivery, native Terminal consumption under load and restrictive-network relay
behavior still require hands-on acceptance on the released pair.

## Release

Mac build 60 was Developer ID signed and accepted by notarization submission
`e2623794-5cd4-4b88-a770-96293eacc22a`. The installed app passes strict signature,
stapled-ticket and Gatekeeper checks. Finder's normal Copy/Replace flow completed
after quitting the prior app; no security setting was changed. Candidate and
installed executable SHA-256 is
`b053752a935b312a10a19199cbadb56119d6a324f01089d95031cacd52cc741d`.

iPhone archive 49 was built for the production bundle/team and successfully
uploaded at 22:45:34 UTC. The release binary excludes the debug upload fixture.
Apple's upload reported the existing vendored WebRTC dSYM warning; upload succeeded,
but framework crash symbolication remains limited by that missing vendor artifact.
Apple marked build `e3fb23f5-7e22-4ee5-aab1-f737cb0a2703` VALID and the existing
ClawDad Internal group now includes build 49 with the current test instructions.
The public link and external beta submission remain disabled. The release command
changed only internal build assignment and build-specific TestFlight instructions.

Previous Mac build 59 is preserved in
`native/macos/dist/candidates/terminal-activity-prefetch-2026-09-06/ready/ClawDad.app`.

## Workspace

The existing branch is retained. This private native release is separate from the
public npm/GitHub distribution. Eight pre-existing dirty groups remain preserved
for separate owner review: `.agents/skills/clawdad-release/SKILL.md`;
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`;
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`;
`assets/wordmark-explorations/`; `marketing-site/`; `native/macos/build-app.sh`;
`native/macos/package-release.sh`; `native/macos/storage-workflow.sh`.
The storage guard is used as present and kept outside this feature's commit.

The feature, tests, user guide, native build metadata, release catalog and this
report form a 35-file scoped checkpoint. `git diff --check` passes. ORP reports
zero unclassified paths; the eight existing groups remain intentionally dirty
with their separate owner-review next action. The audited path manifest and final
hygiene receipt are in the candidate evidence directory.
