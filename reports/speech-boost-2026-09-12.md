# Speech boost implementation lane

Status: **implemented in `3dd73e8`; iPhone 91 is available in ClawDad Internal. Mac 137 is signed and notarized; installation is deferred to the Terminal lane's combined Mac 138 release. Physical listening acceptance remains open.** Owner: speech/settings Codex lane, September 12, 2026.

Current release coordination: speech implementation is checkpointed in **`3dd73e8`**, on top of Terminal `564c53d`. Speech produced **Mac 137** and replacement **iPhone 91**. The Terminal lane subsequently reserved **Mac 138** for its native selection repair, explicitly preserving speech `3dd73e8`. It owns the next installed replacement. Mac 137 remains an isolated candidate and must not interrupt that QA or overwrite a later release. iPhone 90 has been removed from the internal group.

Coordination, 21:50 CDT: **Mac 137 is signed/notarized/stapled and Gatekeeper accepted.** The Terminal lane installed 136, observed a cold-selection defect and reserved **138**, explicitly including speech commit `3dd73e8`. Preserve that repair/release ownership; retain 137 as a candidate and do not install over the active native QA. The isolated export contains only committed application sources; the existing storage-aware build/package wrappers were copied as build tooling, with their hashes recorded in release evidence.

## Coordination and workspace boundary

This lane owns new speech-output DSP, local playback preferences, device control receipts, speech Settings UI and targeted integrations/tests. The existing Terminal prompt/authorization lane owns `MacAssistantBridge.swift`, `MacAssistantTerminalInput.swift`, `MacAssistantTerminalPrompt.swift` and its hunks in `lib/assistant-runtime.mjs`. Preserve those changes and every real Terminal tab, draft and queue. Runtime integration will be a separate import/early dispatch only. No release numbers are reserved and no installed app is replaced while the other lane's release state is unresolved. Recheck this report, Git diff, current release artifacts and installed versions before release.

Baseline HEAD: `5110956`, branch `codex/hermes-hybrid-supervisor-ui`; one worktree. ORP: dirty classified, zero unclassified paths. Existing unrelated buckets: release/storage (`.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`); plugin workflow (`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`); branding (`assets/wordmark-explorations/`); infrastructure/site (`cloud/native/`, `marketing-site/`). Their next action remains separate owner review/checkpoint. No broad staging or cleanup.

## Audit before implementation

* iPhone automatic Assistant replies, user/Assistant speaker replay and exact notification readback converge on `AssistantSpeechPlayback` → `AssistantReplyAudio` (`AVAudioPlayer`). Immutable downloaded bytes and recovery position belong to the existing playback controller.
* iPhone document reading, Terminal selected/latest speech, remote readback and voice preview converge on `MobileReadAloudController` in `CloudClient.swift` (`AVAudioPlayer`).
* Mac native shell uses web speech: `web/assistant.js` creates a player for each Assistant chunk; `web/app.js` uses one message/document/preview player. Raw cached audio comes from `lib/tts-cache.mjs`.
* Web Assistant currently falls back to `speechSynthesis`, changing the selected voice and bypassing controllable PCM processing. This path must report unavailable instead of silently substituting a voice.
* All supported generated engines share decoded output. Audio that the platform cannot decode is an honest playback error. OS notification sounds, OS accessibility announcements and remote desktop/media audio are outside app-generated speech.
* Capture/transcription live in `AssistantAudio.swift`, `MobileAudioSession.swift` and `assistant-audio-worklet.js`; leave their input processing and system volume unchanged.

## Source diagnosis

Existing complete 164.90-second synthetic Kokoro/Heart recording: `native/macos/dist/candidates/assistant-voice-consistency-2026-09-10/complete-recovered-heart.wav`, mono 24 kHz PCM16. FFmpeg loudnorm input analysis: **−25.60 LUFS integrated, −4.25 dBTP, 2.90 LU LRA**. This is a low average level with much less peak headroom than +10 or +20 dB. Start with fixed requested gain and lookahead limiting; avoid chunk normalization or upward AGC/noise amplification. Preserve source audio and the saved voice. 0 dB remains the initial preference.

The source analysis informed the output policy below. All measurements are digital; they are not measurements of the physical phone's acoustic loudness.

## Release coordination checkpoint — 21:18 CDT

The Terminal lane's `reports/assistant-terminal-coverage-2026-09-12.md` remains in live verification. It owns installed Mac replacement for its adapter release. Speech changes now also share `lib/assistant-mcp.mjs` and `lib/assistant-runtime.mjs`; preserve each lane's separate hunks. The speech lane has not staged those shared files, reserved a Mac build number, replaced `native/macos/dist/ClawDad.app`, or installed/restarted the live app. An authenticated read found the installed conversational coordinator actively thinking. Keep installed replacement deferred until the owning release lane and idle/coordinator guards are clear. Use isolated candidate build directories for verification. The source speech preference remains default 0 dB.

Current evidence: full runtime 719/719; mobile 248 tests, two opt-in skips, zero failures; Mac 320 tests, 15 skips, zero failures. Compact iPhone normal/Accessibility XL Settings checks pass; larger-phone regression checks are running. Native and web DSP output samples are byte-identical at all seven measured gains for the complete 164.9-second fixture. No physical listening acceptance is implied.

## Release coordination checkpoint — 21:32 CDT

The Terminal lane explicitly reserves Mac **136** and will package its own scoped source export. Speech reserves iPhone **90** only; Apple was read back at 02:31:39 UTC and its newest build is 89 VALID. The paired physical iPhone also reports 0.7.0 (89). iPhone 90 can be archived/uploaded independently of Terminal work. It provides local boost with existing Mac hosts; Assistant-native remote boost commands require the later speech-capable Mac runtime. Mac installation remains deferred to preserve the Terminal release and active Assistant. No Mac number is reserved by speech.

## Superseded iPhone candidate — 21:41 CDT

Build 90 uploaded and briefly reached ClawDad Internal. The subsequent opt-in complete-engine playback test exposed a finished fade retaining the next chunk at zero position. Build 90 was removed from the internal group, independently read back at 02:40:58 UTC; retain its archive as failed evidence. The finished-state guard was corrected. The new three-chunk fast regression, six complete engine chunks and full mobile suite now pass: **251 tests, two opt-in skips, zero failures** (`mobile-full-91.log`, 02:42:07 UTC). Speech reserves replacement iPhone **91**. Terminal commit `564c53d` is preserved; its Mac 136 is currently being notarized independently.

## Implemented behavior and scope

Settings → Speech boost provides whole-number **0…+20 dB**, including +2, +3, +4, +6 and +10, a visible dB value, immediate persistence, Reset to 0 dB, and preview using the saved voice. The initial preference stays 0. iPhone preview also toggles Stop preview and reports when the paired host is required. Slider changes ramp over 50 ms while playback continues. A final limiter also operates at 0 requested gain, so an already hot source can have peaks reduced.

On iPhone the preference belongs to the app installation, in `Application Support/ClawDad/Speech/output.json`, across accounts and paired computers. It does not synchronize gain to another phone or Mac. On Mac/web it belongs to the web profile **at the current ClawDad origin/address**, in `clawdad.speech-output.v1`. Tabs at that address share storage updates; another address, browser profile or fallback server port has its own setting. Clearing browser storage or uninstalling the phone app can reset that installation's preference. This scope is returned by the tool and explained in Settings.

`read_speech_boost` and `set_speech_boost` are native Assistant tools. Set supports absolute `boostDB`, relative `deltaDB`, or reset. It requires the observed revision, a stable request ID and the explicit current user-message quote. The originating phone is supplied by the authenticated paired transport, overriding a caller-supplied phone ID; web messages retain their actual profile ID. An explicit device ID can target another observed connected device. No inferred default device or account-wide volume exists.

The phone/profile persists and reads back the same preference that Settings edits, then acknowledges the exact request, gain and revision. Relative changes become one absolute CAS operation. Duplicate IDs return their receipt; conflicting IDs/revisions fail. Device leases expire after six seconds. Delivery waits up to five seconds; offline/unsupported devices receive no queued change. Missing acknowledgment returns **unverified**, including after a host restart; the host does not replay uncertain commands. The Assistant should read the same receipt and present current observed state. Host receipts persist (bounded at 10,000 before an explicit storage-full error); the local preference retains the latest 128 exact receipts. Microphone permissions and voice recognition are separate from this tool's authorization and delivery checks.

## Output policy and mapped playback

Both platforms use `speech-output-v1`: fixed requested gain, a source activity envelope, linked stereo limiting with 5 ms lookahead, 4× windowed-sinc peak estimation and a conservative −3 dB detector ceiling. Limiter release is 150 ms. Low-level activity smoothly admits boost between −60 and −40 dBFS; exact silence stays zero and the low-noise fixture remains at unity. This is not a denoiser; audible noise above that activity region can still become louder. No per-chunk normalization or upward AGC is used. Native chunks retain gain/envelope/limiter dynamics and reuse the output engine. Start/stop/pause/tail envelopes are 5 ms. Replaced native speech releases the waiting controller instead of leaving a stalled continuation.

| Playback path | Processing and verification |
|---|---|
| iPhone automatic Assistant responses and streaming chunks | `AssistantSpeechPlayback` → `AssistantReplyAudio` → `SpeechOutputPlayer`; reply/cancellation/recovery tests, complete native chunks |
| iPhone speaker-button replay, both user and Assistant | Same reply output; immutable original bytes and recovery position, message playback/recovery UI regression |
| Exact notification readback | Same reply output; notification UI test verifies the selected old reply without starting a call |
| Documents, Terminal selected/latest responses, Remote Assist readback | `MobileReadAloudController` → `SpeechOutputPlayer`; ordered chunk, stale callback, pause/resume/audio-session regression |
| iPhone selected-voice preview | Same read-aloud output; offline availability, reset and saved-voice UI checks |
| Mac/web Assistant, user/Assistant speakers, document/readback/preview | `createSpeechAudio` → one shared speech AudioWorklet; Chromium and WebKit actual-graph checks, pause/replay/live change, storage and device acknowledgment |
| Raw cached audio and replay | Cache generator/manifests unchanged; one processing connection per browser media element; native decode always starts with source bytes. Full Swift/JS output comparisons and original-byte checks |
| Kokoro, Pocket and Kitten | All three installed/enabled engines generated real PCM16 mono 24 kHz fixtures through the existing TTS route, without changing the saved voice; source hashes and levels retained |

Unsupported/boundary paths: browser `speechSynthesis` fallback was removed because it changed the voice and bypassed processing; failure now asks the user to retry the selected voice. The production `/v1/tts/message` route already rejects non-local providers, including legacy OpenAI configuration, with `doc_reader_required`; no paid alternate was invoked. Native decoding supports platform-readable mono/stereo recordings at 8–192 kHz, up to 32 million frames per clip; malformed/unreadable or larger clips produce playback errors. A browser without working AudioWorklet support reports unavailable. OS notification sounds, OS accessibility announcements and remote desktop/unrelated media are outside app TTS. There are no changes to capture, transcription input, system volume, voice settings persistence or raw TTS caches.

## Measured range

Complete 164.90-second Kokoro/Heart fixture, FFmpeg loudness/true-peak analysis of rendered PCM; source SHA and exact commands are retained in the candidate. Native Swift and web Float32 outputs are **byte-identical at all seven gains**.

| Requested dB | Integrated LUFS | Sample peak dBFS | True peak dBTP | Maximum limiting dB | Frames limited |
|---:|---:|---:|---:|---:|---:|
| 0 | −25.60 | −4.37 | −4.25 | 0 | 0% |
| +2 | −23.60 | −3.11 | −3.00 | 0.74 | 0.40% |
| +3 | −22.60 | −3.00 | −3.00 | 1.74 | 0.80% |
| +4 | −21.61 | −3.00 | −2.99 | 2.74 | 2.91% |
| +6 | −19.70 | −3.00 | −2.94 | 4.74 | 16.46% |
| +10 | −16.57 | −3.00 | −2.88 | 8.74 | 75.71% |
| +20 | −13.16 | −3.00 | −1.73 | 18.74 | 99.47% |

+10 requested yielded +9.03 LU; +20 yielded +12.44 LU. At +20 this fixture is heavily limited, which changes dynamics and can sound compressed. No distortion-free +20 dB claim is made. On a deliberately 20 dB quieter source, +20 largely restores its original level without the same limiting demand. The 49-case matrix also covers loud speech, exact silence, low noise, an intersample-peak tone and an impulse. Its worst measured true peak is −1.73 dBTP. These are fixture results, not a mathematical guarantee for every possible source or downstream resampler.

Fresh local engines differ materially: raw Heart measured −25.03 LUFS / −9.85 dBTP, Pocket −21.32 / −5.20 and Kitten −21.53 / −1.79. At +20 their processed short fixtures measured −13.28, −13.18 and −13.86 LUFS respectively, with true peaks −1.93, −2.44 and −2.93 dBTP. Kitten already requires some limiting at 0 requested gain. These comparisons reinforce retaining a user-selected gain rather than promising equal loudness across voices.

DSP delay is **5.667 ms at 24 kHz**, **5.333 ms at 48 kHz**, plus the platform output buffers and existing generation/network delay. Optimized Swift rendered the complete 164.9-second fixture in approximately 0.6–0.7 seconds; JS took approximately 0.9–1.5 seconds on this Mac. These are offline processing timings, not measured physical iPhone first-audible latency. Limiting adds no extra gain-dependent delay. Browser worklet execution was checked at 44.1 kHz; fixture analysis is at 24 kHz. The true-peak terminology follows [ITU-R BS.1770](https://www.itu.int/rec/R-REC-BS.1770); the custom detector is not claimed as a certified meter.

Repeat with `node scripts/verify-speech-output.mjs --input original.wav --output native/macos/dist/candidates/<unique-directory>` (requires FFmpeg/ffprobe). `--quick` measures a short source at 0, +6, +10 and +20. Native fixture opt-ins are documented in `SpeechOutputTests.swift`. Candidate evidence is under `native/macos/dist/candidates/speech-boost-2026-09-12/`, including original/processed WAVs, Float32 output, hashes, `measurements.json`, native parity renderer, test logs, screenshots and Apple receipts.

## Verification and remaining acceptance

The runtime suite passed **719/719**, with the final focused MCP/control suite **6/6**. Mac's isolated Swift suite passed **320 tests, 15 skips**, including authenticated phone identity tests. Chromium and WebKit both passed production AudioWorklet execution, +2/+3/+4/+6/+10/+20, persistence, reset, cross-tab updates, pause/resume, current-position preservation and exact device acknowledgment. The raw worklet analyser observed a 0.707946 linear peak in the live-change fixture, with no browser errors. Browser tests run muted in isolated profiles.

The compact iPhone simulator passed both new Settings tests, including Accessibility XL, relaunch persistence, reset and Done navigation. The 6.9-inch simulator passed **five UI tests**, covering those Settings scenarios plus exact notification readback, speech recovery/call-state preservation and message playback/jump-to-latest. Screenshots were visually inspected; the new section's contrast was corrected. The iPhone Release archive is signed; its existing WebRTC dSYM upload warning is separate from successful upload. Final native test and replacement release results follow below.

**Audible/physical acceptance remains open.** The full processed 164.9-second outputs exist at 0/+2/+3/+4/+6/+10/+20; no available tool supplied trustworthy listening access to them. Numerical metrics, muted engine execution and simulator screenshots do not establish naturalness, absence of pumping/clicks, or phone speaker performance. The paired iPhone 15 Pro Max was read back at build 89 before this release; it was not silently replaced or played louder during development.

On the physical iPhone, install the final internal build, retain the same voice/system-volume position, then compare full quiet/loud speech at 0, +2/+3/+4, +6, +10 and optionally +20. Listen through speaker and headphones for intelligibility, consonant harshness, breath/noise lift, limiting/pumping, clicks and chunk transitions. Exercise a short reply, a long streamed reply, cached user/Assistant replay, notification readback and a document; pause/resume/cancel and change gain mid-sentence. Check route changes, interruption/lock-screen recovery, persistence after relaunch and voice preservation. After the speech-capable Mac is installed, request “set speech boost to 6 dB,” “increase it by 2 dB,” and “reset speech boost”; confirm the intended phone's slider and returned revision. Repeat with the phone disconnected and confirm an offline/unverified result. Physical acoustic level, route behavior, microphone recognition and first-audible latency remain unmeasured.

## Workspace buckets and next actions

Speech owns the iOS `SpeechOutputDSP/Preference/Player`, `SpeechBoostSettings`, integrations in `AssistantReplyAudio`, `CloudClient`, `MobileAssistant`, `VoiceSettings`, `MobileAudioSessionTests`, `SpeechOutputTests`, `SpeechBoostUITests`, generated Xcode project and `project.yml`; `lib/speech-output-controls.mjs`, speech hunks in `assistant-runtime.mjs` and `assistant-mcp.mjs`, three asset routes in `server.mjs`; `MacAssistantRuntime.swift` and `MacSpeechOutputWireTests.swift`; web speech DSP/worklet/helper, integrations in `app.js`, `assistant.js`, `index.html`, `app.css`; `test/speech-output.test.mjs`, `scripts/verify-speech-output.mjs` and this report. Next action: checkpoint this verified set, then coordinate the later Mac speech release on top of the Terminal commit.

Terminal's changes were independently committed as `564c53d`, including its exact shared runtime/MCP hunks; speech's separate remaining hunks were then committed in `3dd73e8`. Preserve the Terminal lane's subsequent Mac 138 release ownership. The release/storage, plugin workflow, branding and infrastructure/site buckets listed at the top are unrelated and remain for their owners. Generated candidate evidence is in the canonical ignored candidate directory. No real Terminal tab, draft or queue was changed by this lane. Unrelated dirty buckets remain intentionally dirty rather than being swept into the speech commit.

## Final checkpoint — 21:56 CDT

- **iPhone 0.7.0 (91): VALID, IN_BETA_TESTING, assigned to ClawDad Internal.** Apple build `7073ee86-1458-4acd-b163-c2ec50d9c718`; group `bbba6b69-7ac4-4d56-bc41-e9456d56b02e`; assignment and exact testing notes independently read back at `2026-09-13T02:55:50Z`. Build 90 is superseded and unassigned to that group. Phone installation of 91 is a user TestFlight update, not verified by this run.
- **Mac 0.7.0 (137): signed, notarized, stapled, Gatekeeper accepted; retained as candidate.** App notarization `4ebbfd7c-8753-4c20-9670-21d104f0465b`; DMG notarization `9d4b0070-9e55-4bb4-bff1-a56597a56fba`. The packaged Node 24.20.0 runtime passed all six speech tests, and all 11 audited bundled speech/runtime assets matched the source checkpoint. `/Applications/ClawDad.app` was last read at **136**. The Terminal agent's 138 repair/release owns installed delivery of the shared speech commit. Therefore Assistant speech tools and Mac Settings are implemented/packaged, with installed availability pending that release.
- **Final native playback suite: 251 tests, two opt-in skips, zero failures.** This includes all six complete fresh Heart/Pocket/Kitten chunks, original-byte preservation, mid-playback preference changes, three consecutive short chunks and same/different-rate replacement. Muted engine execution proves completion and position behavior, not audible quality. `mobile-full-91.log` is decisive; earlier failed candidate logs are retained with their resolved causes above.
- **Code checkpoint `3dd73e8`: 29 scoped files.** Runtime/MCP coexistence with Terminal passed 11 focused tests. The speech source set is committed separately; this report is its release-evidence follow-up. ORP reports `dirty_classified`, **zero unclassified paths**, `safeToExpand=true`; `git diff --check` passes.
- The active Terminal repair bucket now includes `MacAssistantBridge.swift`, `MacCodexComposerCapabilities.swift`, `MacNativeTerminalTabs.swift`, their Terminal/capability/tab tests, and `reports/assistant-terminal-coverage-2026-09-12.md`. Its next action is the owning lane's verification and Mac 138 checkpoint/release. The pre-existing release/storage, plugin, branding and infrastructure/site buckets remain unchanged by speech. This lane created an ignored source export, not an additional Git worktree; the other lane's release worktree remains owned by that lane.

Full listening fixtures: [0 dB](../native/macos/dist/candidates/speech-boost-2026-09-12/speech-0.wav), [+6 dB](../native/macos/dist/candidates/speech-boost-2026-09-12/speech-6.wav), [+10 dB](../native/macos/dist/candidates/speech-boost-2026-09-12/speech-10.wav), [+20 dB](../native/macos/dist/candidates/speech-boost-2026-09-12/speech-20.wav). The +2/+3/+4 files are in the same directory. [Numerical provenance](../native/macos/dist/candidates/speech-boost-2026-09-12/numerical-provenance.json), [release hashes](../native/macos/dist/candidates/speech-boost-2026-09-12/release-evidence.json), [Apple 91 receipt](../native/macos/dist/candidates/speech-boost-2026-09-12/apple-91-status.json), and [Mac candidate DMG](../native/macos/dist/candidates/speech-boost-2026-09-12/package137/ClawDad-0.7.0-beta.20-mac-mac137.dmg) are retained locally. Do not install the older candidate over the Terminal lane's later release.
