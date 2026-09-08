# Assistant contact links and verified input editing

Released September 8, 2026: **iPhone 0.7.0 (61)** in **ClawDad Internal TestFlight**,
with **Mac 0.7.0 (73)** installed, signed, notarized and healthy.

## Resulting behavior

Assistant responses in the visible iPhone conversation detect phone numbers and
street addresses on-device, preserving the original wording and text selection.
Phone links hand off to the iPhone's call flow. Address links first open Google
Maps; an unavailable app or failed launch falls back to Apple Maps. URL query
encoding preserves the complete address, including punctuation and Unicode.
No map SDK, API key, cloud lookup or new cloud storage is involved.

The handoff follows Apple's [phone-link documentation](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/PhoneLinks/PhoneLinks.html),
Google's [iOS Maps URL scheme](https://developers.google.com/maps/documentation/urls/ios-urlscheme),
and Apple's [map links](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html).
The iOS app declares `comgooglemaps` for its availability check. A failed handoff
keeps the response selectable and presents a dismissible explanation.

The Assistant toolkit now exposes four editing commands:

| Command | Target and prerequisites |
| --- | --- |
| `clear_tab_input` | Exact idle Codex Terminal tab, using `draft.token` and `draft.text` from `inspect_tab`. |
| `replace_tab_input` | Same target, plus the complete desired replacement text. |
| `clear_input` | Focused supported app input from a fresh `computer` inspection with `canEditText: true`. |
| `replace_input` | Same input, plus the complete desired replacement text. |

Deleting part of an input uses replacement with the complete desired remaining
text. All four commands require the exact inspected `expectedText` and a stable
request ID. Editing never presses Enter. Existing `insert_in_tab` continues to
insert into an empty draft; `send_to_tab` remains the distinct insert-and-submit
operation.

Terminal editing validates the native tab identity, owning Codex conversation,
idle request state, captured input and current draft. An inspected token is
single-use and expires after 45 seconds. It cannot be used for another tab or
after manual input. A nonempty idle draft is cleared with one Codex Ctrl-C,
followed by observed empty-composer verification. Replacement pastes once and
verifies the entire rendered composer. Clearing an already-empty input does
nothing, protecting the running Codex process from its quit shortcut.

Terminal's Select All is never used. Existing drafts that changed since
inspection are preserved. Attachments, collapsed paste placeholders, tall or
clipped composers, and unrecognized prompts do not grant an edit token. Terminal
verification accounts for visual line wrapping; it does not claim access to
hidden draft contents. These controls currently support the recognized idle
Codex composer.

Other app editing uses the focused writable Accessibility text value. It checks
the same app process/launch, window, focused element, control eligibility,
permission state, inspection expiry and exact existing text. Result verification
compares the full value including whitespace. Read-only, password and unsupported
controls are rejected. Generic input editing rejects Terminal and directs the
Assistant to the native tab tools.

All edits use the existing authorized local tool route, pause/manual-control
gate and durable receipts. Terminal text edits share FIFO ordering with inserts
and submissions. Uncertain mutations become attention receipts and are not
replayed after retries or worker restarts. Existing workspace instructions are
retained; only the managed capability block changes. Application permissions,
the conversation sandbox and general Computer Use restrictions are retained.

## Verification

| Check | Result |
| --- | --- |
| Full JavaScript/runtime suite | 547 passed |
| Mac Swift suite | 188 executed, 182 passed, six opt-in live tests skipped |
| Mobile Swift suite | 137 passed |
| Assistant iPhone UI suite | Nine passed; contact-link and map-fallback screenshots inspected |
| Release metadata suite | 11 passed |
| Live installed Mac: ordinary input controls | Clear and exact Unicode/whitespace replacement verified; stale text, changed focus, read-only and secure input rejected; neighboring draft preserved; zero Return keys |
| Live installed Mac: real Codex Terminal | Insert, multiline replacement, clear and empty-input no-op verified; wrong-tab tokens and stale expected text rejected; zero additional submitted turns from editing |
| Mac release | Strict signature, notarization, staple, Gatekeeper and installed runtime source hashes verified |
| iPhone release | Signed archive verified; VALID and IN_BETA_TESTING; internal group and release notes verified |
| Cleanup | Disposable apps/windows closed; original 12 native tab identities and selected tab restored |

The live AppKit fixture reads the active field editor, since the control's stored
value can lag while editing. It counts actual Return key events separately from
ordinary control change/end-edit actions. This distinguishes the requested
no-Enter behavior from normal app reactions to changed text.

A new idle Codex session had no saved conversation for the native reader, so the
disposable Terminal fixture was initialized with one `READY` response. All draft
checks ran afterward and verified no additional submitted request or task-start
events. The native checks operated on the installed signed app and the real
Terminal/Codex composer, not a simulated keyboard receiver.

The iPhone UI tests intercept external app launches with a Debug-only fixture;
they verify the tappable text and destinations without placing a real call.
**Physical iPhone acceptance remains:** update to build 61 and tap a business
phone number/address in a real Assistant response to confirm the Phone and Maps
handoffs on that device. Debug link fixtures are excluded from the release app.

Pre-existing WebRTC Sendable/deprecated Bluetooth warnings and the WebRTC dSYM
upload warning remain. The build and upload completed successfully.

## Release evidence and workspace

Logs, screenshots, live test fixtures/receipts, signed archives and the Mac build
72 rollback copy are stored in the ignored canonical candidate directory:
`native/macos/dist/candidates/assistant-links-edit-2026-09-08/`.

- Mac notarization: `f345b75f-8cae-4f27-8010-ed0c8e8be5a4`.
- Mac executable SHA-256: `c901bda330484aba4e611692a7e3bb1e8730b5d1ac34e288e4c4721482e5b717`.
- iPhone executable SHA-256: `84aad914311eb6f69cba5a338526a2371530b12a2cbe85196937193104fe427f`.
- Apple build ID: `062033ee-e5c5-4f0c-9e7d-92426613f51b`.
- TestFlight assignment reverified at `2026-09-08T07:23:25.141Z`.

This is the private native release. No public npm package, GitHub release,
external beta or App Store review was published.

The pre-existing nine dirty paths remain classified and outside this patch:

| Existing paths | Next action |
| --- | --- |
| `.agents/skills/clawdad-release/SKILL.md`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Reconcile release-skill revisions. |
| `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` | Review and commit plugin metadata. |
| `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh` | Audit and checkpoint storage/build workflow changes together. |
| `assets/wordmark-explorations/` | Curate branding artifacts. |
| `cloud/native/` | Review and canonicalize generated material. |
| `marketing-site/` | Review and release marketing work separately. |
