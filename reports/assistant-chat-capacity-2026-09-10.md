# Assistant long-message capacity — 2026-09-10

Delivered: signed, notarized **Mac build 119** installed at `/Applications/ClawDad.app`; **iPhone build 84** is `VALID`, assigned to **ClawDad Internal**, and `IN_BETA_TESTING`. Both use app version `0.7.0` / runtime `0.7.0-beta.20` as appropriate. Update the iPhone through TestFlight. Mac build 118 was an intermediate local installation; 119 includes the final Unicode and whitespace-caption fidelity fixes.

The main Assistant now accepts **131,072 UTF-8 bytes (128 KiB) per text message**, eight times the former 16,384-byte limit. Images remain separate attachments. Byte limits are transport/storage limits; they do not measure model tokens or guarantee that every message fits every conversation's remaining context.

## Confirmed cause and limits

The original failure's exact text length and error are unknown. A synthetic reproduction against the original runtime accepted 16,384 bytes and rejected 16,385, 65,536 and 131,072 bytes with `Invalid message`. The main conversation reused a 16 KiB validation cap associated with smaller native tool messages. Image-bearing chat had a separate check with the same cap. No new receipt was created for these rejected messages. This establishes an application failure path without claiming it conclusively identifies Cody's specific paste.

During simulator verification, the old SwiftUI vertical TextField also displayed a blank end of a 128 KiB pasted draft even though its complete saved value existed. The new bounded native UITextView keeps large drafts visible, scrollable, editable and selectable. This second issue was reproduced in the simulator, not on Cody's physical phone.

| Layer | Previous behavior | Delivered behavior / retained limit |
|---|---|---|
| Main Assistant text validation | 16,384 UTF-8 bytes; generic rejection | 131,072 UTF-8 bytes; matching iPhone/Mac validation, exact byte count and recoverable error |
| Composer and local draft | No explicit paste cap; SwiftUI vertical editor; atomic local manifest | Native bounded editor; full text and images retained; size guidance before upload; invalid text is rejected without alteration |
| Older connected Mac | No advertised text capability | New phone honors the legacy 16 KiB cap until the Mac advertises its larger limit, with an update explanation |
| Decoded Assistant request payload | 1 MiB | Unchanged; 128 KiB of worst-case valid JSON-escaped text plus request metadata fits |
| Encoded native request / RemoteFileFrame | 2 MiB; 8 KiB frames | Unchanged; framing and base64 round-trip verified |
| Local Assistant HTTP body | 2 MiB | Unchanged; receives exact serialized text and image metadata |
| Image selection | Up to four images totaling 20 MiB | Unchanged; binary data uploaded separately and bound to the accepted message |
| Main coordinator input | `codex exec --json`, exact session resume, stdin text | Same owning subprocess and model settings; no application splitting, rewriting or summarizing of the message |
| Coordinator event handling | Events over two million JavaScript code units silently skipped | Explicit failure above 8 MiB per event; original CLI transcript remains on the Mac |
| Saved response text | Clipped at 100,000 JavaScript UTF-16 code units | Full response retained in Assistant state and presentation |
| Recent phone history | Latest 40 messages and 20 task cards; full projection repeated on polls | Same recent-history window, full original durable history on Mac; revision-based delta avoids repeating unchanged large text |
| Native response/reassembly | 64 MiB aggregate | Unchanged; distinct from input-message allowance |
| Timing | 15-second framed send, 30-second command deadline, 180-second coordinator response deadline | Unchanged; acceptance is asynchronous, generation does not hold the send request open; stable receipts reconcile retries |
| Long-message playback | Existing formatting-aware speech batches | Preserved; batches cover the complete spoken text without changing saved message text |

The actual authenticated runtime was Codex **0.154.0**, `/opt/homebrew/bin/codex`, Main Assistant **gpt-6-astra / low**. The live fixture's rollout reported a **258,400-token model context window**. Its largest turn reported **74,170 input tokens**, including accumulated context and instructions. These are observations from that particular fixture, not a bytes-to-tokens conversion or a universal remaining allowance. Other selected models and longer conversation histories can reach a genuine context limit sooner. The runtime owns its normal context management; this patch does not modify the user's model settings or discard saved history to force a message through.

Context errors now explain that earlier conversation also consumes context and point to **Unprocessed message · Review**. The complete accepted draft and image bytes remain recoverable. Rejection does not create a clipped substitute or an automatic second turn.

## Exact text, persistence and retry behavior

- Validation counts UTF-8 bytes, including multibyte characters. CRLF, line breaks, leading/trailing whitespace, combining accents, links and code are preserved. NUL or malformed surrogate input receives an explicit retained-draft error.
- The current draft is atomically saved per paired Mac with its stable request ID and local image files. Oversize rejection happens before image upload. Navigation and reopening load the same draft.
- A durable local accepted-draft outbox is written before the composer clears after acceptance. A queued receipt alone no longer discards recovery material. A later context/generation failure exposes the saved message for review; completion releases only no-longer-needed local image copies. Mac conversation image originals remain available.
- A late receipt cannot erase text typed after Send, another Mac's draft, or separately recovered voice words. Corrupt recovery metadata cannot replace a valid current draft. Recovery waits for an empty composer and preserves unrelated images and voice recovery.
- Uncertain transport retry keeps the same ID. Duplicate requests reconcile the existing receipt; changed payload with the same ID is refused. A failed accepted message is retained for deliberate review rather than automatically replayed. Editing recovered text creates a new draft ID.
- Codex's stdin decoder consumes an encoding BOM. A literal leading user U+FEFF is now framed so that the user character survives; live CLI evidence verifies this. Image-only whitespace captions are passed as their exact positional prompt rather than being replaced with an empty string.
- Native long-message views keep the complete text in a scrollable viewport with the existing selection, full-copy and speaker controls. Link detection and formatting are cached until the text or Dynamic Type size changes. On installed build 119, a read-only unchanged-history check reduced a 191,741-byte state response to 30,394 bytes. No message content was omitted from durable storage.

## Delivery evidence

All fixtures were synthetic. No biomedical material, research prompts or live project drafts were used. The live test used the actual `AssistantWireRequest` encoding, `MacAssistantRuntime.respond`, authenticated loopback Assistant HTTP service, runtime queue and real Codex coordinator. It was isolated from Cody's conversation and Terminal tabs. This verifies the native service/model path; it is separate from a physical iPhone WebRTC/cellular test.

For each size, the original text and the exact accepted `response_item` in the owning Codex rollout had matching SHA-256 hashes. Each appeared exactly once. Repeating the request returned its completed receipt without another turn. The model returned the requested distinctive beginning/middle/end markers. The 128 KiB turn included actual `input_image` data from the synthetic PNG.

| UTF-8 bytes | Exact accepted turns | Native acceptance | First response | Completion recorded by runtime | Original = rollout SHA-256 |
|---:|---:|---:|---:|---:|---|
| 16,384 | 1 | 3.08 ms | 6,171 ms | 7,423 ms | `5f3516163d91430c3990a8085070dda4efcc0734bbef409164c104ba50043cb2` |
| 65,536 | 1 | 8.94 ms | 4,527 ms | 5,757 ms | `6b831d635466a5dc42cd5f21a734dfe9c3d8d99c68c98c098005c781e38f8e65` |
| 131,072 + PNG | 1 | 16.90 ms | 6,349 ms | 7,602 ms | `5a0faa13644fb6151836806683ee8b4641892d774b6243b1183540eba916fad2` |

These are local fixture timings, not promised iPhone latency. Session `01a08d77-451b-7112-b34e-817ba0bae21d` contains the matching accepted records. A separate real-CLI fixture verified a literal BOM and a five-byte whitespace-only image caption, each with exactly one matching accepted user record and a completed response.

## Verification

| Verification | Result |
|---|---|
| Full Node/runtime suite | **689 passed**, zero failures |
| Mac native suite | **269 tests**, 11 explicit opt-in skips, zero failures; isolated chat live test subsequently enabled and passed |
| Shared protocol suite | **67 passed**, including maximum escaped text wire framing/reassembly |
| Mobile package suite | **224 tests**, one skip, zero failures; final chat recovery tests rerun after the corruption-isolation fix |
| UIKit text selection | **5 passed**, including large native viewport, actual partial clipboard content and selection preservation during incoming updates |
| Compact iPhone simulator, 375 × 667 | Maximum paste/restart/send and 131,073-byte rejection/preservation passed; visual inspection of editor, long history and accessibility-size warning |
| Large iPhone simulator | Maximum paste; oversize warning/details at Accessibility XL; photo preview/removal/failed-send/restart; playback/jump-to-latest; held-voice explicit Send all passed |
| Installed Mac 119 | Signed/notarized checks, one installed host process, source/runtime hashes match, advertised capacity and history delta verified |
| Native release | Signed iPhone 84 archive uploaded; Apple `VALID`, internal assignment and `IN_BETA_TESTING` verified |

Boundary regressions cover 16,384, 16,385, 65,536, 131,072 and 131,073 UTF-8 bytes; multibyte Unicode; multiline code and URLs; JSON escaping; exact full responses above the former response clipping boundary; images; restart before delivery; same-ID retries; changed-ID payload rejection; context failure; corrupted recovery metadata; and normal short chat/voice controls. The small and large simulator used actual clipboard Paste into the native editor, compared the complete resulting value, reopened the application, and verified one complete displayed user message. Simulator sends used the existing synthetic preview transport; real model delivery was verified independently through the native fixture above.

An early held-voice UI test inherited the deliberately retained oversize draft from the preceding test and correctly prioritized that draft. Explicit fixture reset fixed test isolation; the voice implementation was unchanged. Four release fixtures initially expected build 83; their build expectations were updated to 84 and the full 689-test suite passed. Early blank-editor visual evidence prompted the UITextView correction and was superseded by the final small/large simulator runs.

Detailed artifacts live in `native/macos/dist/candidates/assistant-chat-capacity-2026-09-10/`:

- `old-boundary.json`, `live-delivery-proof.json`, `native-live-chat.log`, `text-edge-proof.json`
- `full-node-final.log`, `full-mac-tests.log`, `protocol-final-tests.log`, `mobile-final-tests.log`, `chat-final-tests.log`
- `ios-small-final.xcresult`, `ios-large-final.xcresult`, `ios-controls-final.xcresult` and exported visual attachments
- `install-119-verification.json`, `installed119-chat-health.json`, `testflight84-release.json`
- `mac119-package.log`, `mac119-install.log`, `ios84-archive.log`, `ios84-upload.log`

## Release and remaining checks

Mac 119 became native-ready in **10.079 seconds** after launch. Post-install checks preserved Assistant conversation/session, user instructions, supervisor configuration, account-budget preferences and all **seven** existing Terminal Codex processes. Project loading, speech availability, local health and cloud connection health passed. No reboot, logout, Terminal closure or research-task submission was performed.

Apple reported a nonblocking missing dSYM warning for the bundled WebRTC framework during upload; the signed app was accepted and entered internal beta testing. This affects that framework's crash-symbol availability, not proof of chat delivery. Physical iPhone build installation remains Cody's TestFlight action.

Remaining physical checks: paste and edit a large message using Cody's actual keyboard/clipboard; inner long-message scrolling and selection handles; VoiceOver at larger text sizes; reconnect or cellular interruption during a large text/image send; and audible long-message playback/stop/switch during a call. Simulator and generated-audio tests do not establish those physical-device results. A real model context-exhaustion test was simulated at the coordinator error boundary rather than consuming an entire live context; the actual boundary-size message did reach the authenticated model unchanged.

The scoped source changes are checkpointed locally. This branch was already 71 commits ahead of its recorded remote before this task; no broad history push, public appcast publication, npm release, cloud infrastructure change or subscription change was performed for this native release.

## Preserved unrelated workspace buckets

The workspace remains intentionally dirty with these nine pre-existing entries, excluded from the scoped checkpoint:

| Bucket | Exact paths | Next action |
|---|---|---|
| Release workflow edits | `.agents/skills/clawdad-release/SKILL.md`; `native/macos/build-app.sh`; `native/macos/package-release.sh`; `native/macos/storage-workflow.sh` | Review/checkpoint their existing workflow and storage lane separately; build scripts were used as found |
| Plugin packaging/workflow | `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`; `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md` | Keep for the plugin lane's own review/publication |
| Brand exploration | `assets/wordmark-explorations/` | Keep for design review |
| Cloud and site work | `cloud/native/`; `marketing-site/` | Keep for their separate implementation/release lanes |

`git diff --check` passes. ORP hygiene classifies all dirty entries; no unclassified paths or destructive cleanup. Blood-cancer research projects and their workspaces were outside this implementation.
