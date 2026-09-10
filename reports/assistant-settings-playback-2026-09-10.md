# Assistant model settings, message playback and latest-message navigation

Delivered September 10, 2026, through the private native release workflow.

- **Mac 0.7.0 (102):** signed, notarized, stapled and installed in `/Applications/ClawDad.app`. Embedded runtime matches the audited source. Native connection recovered in **5.754 seconds**.
- **iPhone 0.7.0 (82):** uploaded successfully; App Store Connect reports **VALID / IN_BETA_TESTING**, assigned to **ClawDad Internal**. Build ID: `96cdd132-896b-45b1-84c5-19e9e68955c2`.
- Public CLI publication, public Sparkle publication and infrastructure changes were outside this release.

## Settings and actual request behavior

Gear → **Assistant** contains Main Assistant, Research Supervisors defaults, and each configured supervisor identified by its project/thread. Individual reviewers can inherit defaults, use an override, or restore inheritance. The information button explains reasoning latency/usage and the separation from project agents.

The prior request implementations fixed Main Assistant to GPT-6-Astra / Low and the research reviewer to GPT-6-Astra / Medium. Migration reads the saved main coordinator configuration and preserves the actual previous reviewer default. Installed build 102 was verified through the authenticated `/v1/assistant/request` `settings.read` path:

| Scope | Preserved configuration |
| --- | --- |
| Main Assistant | `gpt-6-astra`, `low` |
| Research reviewer default | `gpt-6-astra`, `medium` |
| Configured ClawDad supervisor | Inherits defaults; remains completed and disabled |

Choices come from the authenticated Codex executable used by the coordinator/reviewer, using `account/read` and paginated `model/list`. This follows the official [Codex app-server model catalog](https://learn.chatgpt.com/docs/app-server). The installed authenticated catalog returned:

| Model | Supported reasoning efforts observed |
| --- | --- |
| gpt-6-astra | low, medium, high, xhigh, max, ultra |
| gpt-5.6-sol | low, medium, high, xhigh, max, ultra |
| gpt-5.6-terra | low, medium, high, xhigh, max, ultra |
| gpt-5.6-luna | low, medium, high, xhigh, max |
| gpt-5.5 | low, medium, high, xhigh |
| gpt-5.3-codex-spark | low, medium, high, xhigh |

This is an observed catalog, not a permanent allowlist. Saved unavailable models/combinations remain visible with recovery guidance; work does not silently switch models. Save validates the fresh catalog, supported effort and configuration revision. Image-bearing requests additionally validate image capability. Opening Settings can establish the data connection without starting the Assistant or microphone.

Settings are stored atomically on the paired Mac in `Assistant/model-settings.json`, with revision checks and stable save receipts. Failed writes do not become successful in-memory settings. The Mac owns persistence across phone navigation, reconnection and restarts. Switching paired hosts invalidates the open editor's target. The UI does not poll and rebuild a picker while it is being used.

Each main turn or research review captures its effective model/effort before execution, records that configuration, and passes it to the real Codex request. Changes apply to subsequent requests. Existing reviews finish with their captured configuration. Model changes do not enable supervision, alter supervisor authorization revisions, replace objectives, change project-agent models, submit continuations, or adjust allowance thresholds.

### Actual authenticated model requests

Disposable, ephemeral fixtures used the production settings and execution classes with the existing signed-in account. They did not send messages to Cody's conversation or project agents, and no live supervisor was enabled.

- Main Assistant: saved **gpt-5.6-sol / High**, observed those exact CLI arguments and durable job configuration, received `MODEL_SETTINGS_VERIFIED`; **6,407 ms** from request to completion.
- Research reviewer: inherited **gpt-5.6-sol / Medium**, observed the exact review arguments and recorded configuration; returned an evidence-cited completion decision for the supplied `2 + 2 = 4` fixture; **11,746 ms**.
- Automated request-path checks also verify a settings change during active work leaves the current invocation intact and reaches the next resumed main turn/review.

The first disposable attempts exposed fixture setup mistakes (missing fixture MCP connection and an incorrectly shaped evidence fixture). Those records remain in diagnostics. The successful main result and corrected review result are recorded separately; this report does not describe the original combined fixture as a successful run.

## Message playback

User and Assistant messages now have a speaker next to Copy. Task request/result text has the same actions. The active message displays a selected Stop icon and an accessible Preparing/Playing state. Starting another message stops the previous one. Speech reads the stored message text, removes presentation delimiters while retaining code/numbers/links/wording, and never submits a new Assistant turn.

Manual and automatic Assistant speech share the playback lifecycle. Generation/playback cancellation uses an identity guard so delayed results cannot restart canceled or superseded audio. The existing local voice settings, primary generation and device fallback path remain in use. Subsequent messages try the primary provider again after a fallback.

Text-only playback reserves output without requesting microphone access. During a call, playback gates new capture without changing the user's mute/Think aloud state. Already captured final words can finish transcription, and automatic turn submission resumes after playback. Typed drafts, images, held edits and the call remain intact. A short acoustic tail keeps speaker output out of newly resumed capture.

An installed-Mac generation check used the actual selected voice, **Kokoro 82M v1 / af_heart / speed 1**, with the harmless text “ClawDad message playback verification.” Audio became ready in **1,052 ms**: valid mono PCM WAV, 24 kHz, **2.875 seconds**, 138,044 bytes. No microphone or conversation turn was started. This verifies generated audio, not audible playback on a physical iPhone.

## Jump to latest and accessibility

A 44-point down-arrow control appears above the composer when the reader scrolls away from the bottom. Tapping it reaches the newest history and resumes following new messages. New content growth alone does not classify the reader as scrolling away, and intentional older-history reading remains in place during updates. Existing native selection freezes its text until selection ends. Reduced-motion settings remove the scroll/fade animations.

Speaker, Copy, information and latest controls have accessible names and comfortable targets. The playback state has a distinct Stop symbol as well as color. Small-phone accessibility layouts keep useful history space with the keyboard open; routine status/header content yields that space while the call controls remain available. Existing microphone consent, manual mute, infinity behavior and message actions are retained.

## Verification

- **Full runtime suite:** `npm test` — **672 passed, 0 failed** on the final source.
- **Focused runtime tests:** **82 passed** covering settings migration, exact overrides/inheritance, restarts, invalid/unavailable/authentication states, optimistic concurrency, duplicate IDs, failed persistence, image capability, in-flight configuration and actual execution arguments.
- **Mobile Swift suite:** **220 cases, 219 passed, 1 intentionally skipped**. The skipped opt-in live-conversation test was not run against Cody's conversation. Added cases cover Settings-only connection, text-only playback, stop/switch/canceled audio, muted calls, Think aloud, pending final words, echo suppression, fallback/recovery, long Unicode/formatting and history-following intent.
- **iPhone simulator:** final new-feature scenarios passed on iPhone SE (3rd generation) and iPhone 15 Pro Max with normal and Accessibility XL text, text-only and muted active calls, keyboard open/closed, supported model/effort selections, supervisor overrides/restored inheritance, streaming history, latest navigation and 44-point controls. Native partial selection/Copy for both participants and shared infinity/manual send while muted also passed.
- **Photo/draft regression:** passed, including preview/removal, reopening, restart, failed-send preservation, subsequent receipt acceptance and exactly one delivered message. The old assertion counted static labels; it was updated to match the actual native selectable message view, excluding UIKit's internal text elements. Combined with the new-feature and call regressions above, **11 simulator scenarios passed** across the two phone layouts.
- **Mac web UI:** actual application HTML/CSS/JS tested against a separate local fixture. Main model/effort saved and survived reload; supported-effort filtering and information popover worked. Playback switched with the old player paused and one active message, then stopped; latest reached exact bottom and disappeared under reduced motion. No actual Mac preference was changed by those fixture tests.
- **Installation:** signature, Gatekeeper and stapling passed. Runtime file hashes matched source. Assistant history/session, user instructions, supervisor state, account budget and all three observed Terminal agent processes were unchanged by installation. Local speech remained available; project inventory, health and cloud status responded normally.
- The first full-suite run had two timing-sensitive failures under concurrent build load (approval-dispatch fixture timing and a Watchtower fixture's partially written JSON). Both passed isolated checks; the final complete **672-test** run passed. No changes were made to those unrelated tests or runtime paths.
- Xcode upload succeeded with the existing WebRTC binary's missing-dSYM warning. Apple accepted and enabled internal testing; the warning limits symbolication for that third-party binary.

Evidence is retained under `native/macos/dist/candidates/assistant-settings-playback-2026-09-10/`: runtime/mobile/UI logs and xcresults; normal/large-text screenshots; `live-model-catalog.json`, `live-model-requests.json` (successful main subsection), `live-review-request.json`, `installed-settings-verification.json`, `install-102-verification.json`, `message-playback-audio.json`, and `testflight82-release.json`. The signed Mac artifacts are in `native/macos/dist/releases/0.7.0-beta.20-macos-102/`.

## Remaining physical iPhone checks

Update TestFlight to build 82, then check audible speaker/headphone playback and stop/switch behavior, microphone echo isolation during a real call, interruption/Bluetooth-route changes, VoiceOver announcements and rotor actions, and comfortable selection/scrolling on Cody's device. Simulator capture/playback uses fixtures; it cannot certify acoustic echo isolation, real microphone behavior or perceived voice quality. No physical microphone settings were enabled remotely and no reboot was performed.

## Workspace checkpoint

This lane covers model-settings runtime/UI, message playback, history following, relevant tests, build 82 metadata and this report. Preserved unrelated buckets:

- Native release/storage workflow: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`. Leave for their existing workflow owner/checkpoint; the current native scripts were used but those pre-existing edits are excluded from this feature commit.
- Plugin metadata/release guidance: `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`. Preserve for the separate plugin release lane.
- Brand/marketing/cloud artifacts: `assets/wordmark-explorations/`, `marketing-site/`, `cloud/native/`. Preserve for those owners; no publication or provisioning performed here.

Generated validation data and retained rollback app 101 remain in the canonical ignored candidate directory. Final hygiene must remain classified with zero unclassified paths.
