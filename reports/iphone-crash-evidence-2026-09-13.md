# iPhone exit/crash evidence

Status: **recurring notification-tap crash confirmed, symbolicated, reproduced and repaired in iPhone 0.7.0 (93), now available in ClawDad Internal TestFlight**. Apple reports VALID / IN_BETA_TESTING and internal assignment was read back successfully. The USB connection supplied the missing physical evidence on September 13 at 23:20 UTC. The earlier unavailable-device findings are retained below as the pre-retrieval checkpoint.

## Confirmed physical evidence and repair

Live USB inspection verified CodyVerse as an iPhone 15 Pro Max (`iPhone16,2`), iOS 26.6.1 (`23G83`), with ClawDad 0.7.0 **build 92** installed. All requested reports were copied locally before Cody unplugged. Twelve retained reports (ten ClawDad crashes and two recent JetsamEvents) have SHA-256 manifest entries; raw private reports remain in the ignored candidate directory with restrictive file permissions. The three bounded app diagnostic files were copied separately. No microphone, call, live project, or device preference was changed to retrieve them.

Seven recent physical crashes have the same `EXC_CRASH / SIGABRT` signature:

| Local time (CDT) | App build | Faulting queue / signature |
| --- | --- | --- |
| Sep 11, 9:30:42 PM | 89 | Cooperative worker → notification completion → UIKit snapshot assertion |
| Sep 12, 3:51:44 PM | 89 | Same |
| Sep 12, 4:40:58 PM | 89 | Same |
| Sep 12, 9:37:25 PM | 89 | Same |
| Sep 13, 12:51:48 AM | 91 | Same |
| Sep 13, 1:58:11 AM | 91 | Same |
| Sep 13, 5:35:28 PM | 91 | Same |

Exact timestamps and incident IDs are retained in `device-reports/summary.json` and the original IPS files. Symbolication used the matching retained release dSYMs: build 89 UUID `5FA3FA7C-29A7-3841-966B-AC07FDB910E5` and build 91 UUID `8D19CF0E-6DDD-39AE-A6EE-5CEED1C09B84`. Their app offsets 2,114,456 and 2,116,096 resolve to `@objc closure #1 in ClawDadPushAppDelegate.userNotificationCenter(_:didReceive:)`. UIKit's `_performBlockAfterCATransactionCommitSynchronizes:` asserts while updating state restoration/snapshot on the cooperative background worker.

The nonisolated async notification delegate hopped to `MainActor.run` to update navigation, but Swift's generated Objective-C completion bridge resumed afterward on its cooperative executor. The system completion callback itself therefore ran off the main thread. The identical implementation was still present in build 92; the retrieved crash records do **not** establish a build-92 crash. Build-92 local lifecycle evidence begins at 22:35:50 UTC, shortly after the last build-91 crash.

The repair uses the explicit supported completion-handler delegate APIs. Payloads are parsed into existing typed targets before crossing executors; navigation and **the completion callback** run in one MainActor task. `defer` completes each invocation once, including dismiss, malformed and unsupported action paths, and never awaits history, a Mac connection, or speech. Foreground presentation also explicitly completes on MainActor. Existing routing, exact reply identity, durable cold-launch target, playback deduplication, notification suppression, Terminal/research/allowance notifications and microphone consent remain intact. Two fixed-name local diagnostic events record receipt and handling; no notification payload, private text, audio or credentials are logged.

The UIKit [notification delegate completion API](https://developer.apple.com/documentation/usernotifications/unusernotificationcenterdelegate/usernotificationcenter(_:didreceive:withcompletionhandler:)) is the supported integration boundary. The root-cause conclusion comes from the matching physical stacks and reproduced failure, rather than a claim that Apple's general documentation promises a particular callback queue.

### Reproduction and test gaps closed

The old code **reproduced an actual simulator app crash** when SpringBoard opened a scheduled synthetic Assistant notification. The simulator IPS has the same SIGABRT, UIKit snapshot frames, cooperative queue and generated notification-delegate closure as the seven phone reports. The identical warm-tap flow passes after the repair, opening the exact synthetic response and readback with no call/microphone activation.

Earlier notification tests called `AssistantReplyNavigation.receive` directly, so they bypassed the Objective-C system completion bridge. The new UI fixture uses real local OS notifications and SpringBoard taps. It is compiled only in DEBUG simulator builds and uses synthetic preview data; it never asks for consent on the physical phone. A cold-launch test first verifies an actual SpringBoard launch survives, then reconnects the synthetic fixture transport without resetting the saved target and verifies exact reply recovery. SpringBoard cold launches do not inherit XCTest preview arguments; this harness accommodation is explicit.

Hosted iOS tests additionally invoke production response handling from a detached worker for Assistant, Terminal, allowance and research notifications; malformed/dismissed/unknown actions; and 100 repeated callbacks. They check the main-thread, exactly-once completion boundary without waiting for external services. A first test revision inspected pending state too late, after SwiftUI consumed it; the corrected assertion observes state inside the completion boundary. This was a test observation race, preserved in the earlier result bundle.

### Other retrieved reports and correlation limits

The Sept 11 2:52 PM JetsamEvent lists ClawDad as suspended with reason `long-idle-exit`; it is distinct from the repeated aborts. The other recent JetsamEvent has no ClawDad process. Two older build-56 reports trapped in an audio-tap executor check, and a build-69 report trapped in a TCC permission callback executor check. These older signatures are retained separately and are not attributed to the notification repair. Matching old app symbols were not found in the retained candidate archives during this pass.

The current retained Mac cloud-host logs contain no timestamped entry within one minute of the seven matching crashes; native-server stdout/stderr do not provide comparable timestamped lifecycle events. No causal link to a relay socket failure or synthesis is established. The physical stack plus simulator reproduction identifies the callback fault directly. The previous first-chunk playback defect, speech boost and project-speaker reservation error remain separate. Cody confirmed on September 13 that the project/thread speaker error no longer appears.

### Verification and release checkpoint

- Full mobile SPM suite: **257 tests, four opt-in fixture skips, zero failures**. Includes conversation/draft/image persistence, voice turn/mute handling, speech recovery, notification identity and duplicate playback guards.
- Compact iPhone simulator: real warm notification tap, cold-launch target recovery, existing exact-reply readback and larger-text notification controls passed. Large iPhone simulator: both real notification flows passed again in build 93. **Three hosted iOS tests** passed, including all four notification families, ignored payloads and 100 repeated completions; every checked callback ran on the main thread within one second and exactly once. Six UI test executions passed across the two layouts.
- Build 93 archived successfully and passed code-signature validation. Its app and dSYM both have UUID `0638F548-A78C-3AA6-9938-59E25F2ABE99`. Symbol inspection confirms the explicit completion-handler delegate and MainActor handling closure; simulator-only fixture strings are absent from the release executable. Upload succeeded at **23:39:50 UTC**; Apple indexed the build at **23:40:44 UTC**, ID `223e42a9-4746-4afc-8634-ad6f605e9175`. API readback confirmed **VALID / IN_BETA_TESTING**, testing notes and membership of ClawDad Internal (`bbba6b69-7ac4-4d56-bc41-e9456d56b02e`). The existing third-party WebRTC dSYM warning remains; this crash signature symbolicates completely through the matching ClawDad symbols and system frames.
- Mac remains **141**; no native host/runtime changes, restart, Terminal mutations or cloud deployment are needed.
- Remaining physical checks: update to the repaired TestFlight build, open an Assistant reply and Terminal completion alert from foreground/background and a cold app, and verify the app remains open with correct reply/readback. Physical haptics/audio and sustained crash-free use remain user-device checks. The repaired phone build has not been installed over USB because Cody unplugged after retrieval.

Current candidate: `native/macos/dist/candidates/iphone-crashes-2026-09-13/`. Key evidence: `connected-device-details.json`, `connected-app.json`, `reports-manifest.json`, `device-reports/`, `*.symbolicated.txt`, `simulator-before.ips`, `before-notification-repro.xcresult`, `notification-regressions.xcresult`, `notification-final93.xcresult`, `mobile-full.log`, `mac-correlation.json`, `archive93-verification.json`, `upload93.log`, and `testflight93-evidence.json`.

### Workspace preservation

The scoped paths are the iOS notification delegate, bounded diagnostic event enum, DEBUG simulator notification fixture/hook, two notification test files, generated Xcode project/build number, and these two incident/release reports. The existing nine unrelated dirty paths remain classified and untouched: release/integration guidance (`.agents/skills/clawdad-release/SKILL.md`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`); Mac build/storage (`native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`); design (`assets/wordmark-explorations/`); cloud/marketing (`cloud/native/`, `marketing-site/`). Their next actions remain their own lane's review/checkpoint. No live Terminal, saved workspace, research supervisor, Mac service or relay infrastructure was modified by this repair.

## Earlier checkpoint: device unavailable

Cody reports genuine app exits followed by a crash-report sharing dialog, which he declines. Apple App Store Connect's `betaFeedbackCrashSubmissions` endpoint returned HTTP 200, zero submissions and no next page on September 13. Apple receives these TestFlight records only when the tester submits them; zero records does not mean zero crashes. The available Mac crash directories contain an older simulator UITest-runner crash, not a matching physical-phone incident.

Xcode/CoreDevice currently reports CodyVerse unavailable. Cached pairing metadata is iPhone 15 Pro Max (`iPhone16,2`), iOS 26.6.1 (`23G83`), last connection September 13 around 03:32 UTC. These are **cached**, not verified current device settings. The earlier first-chunk audit observed iPhone build 90; latest previously available TestFlight build was 91. Current installed phone build is unknown. The exact crash timestamps, termination reason, exception/backtrace, jetsam/watchdog record and matching physical build have not been retrieved. Therefore no strongest physical signature can yet be symbolicated or correlated reliably with Mac/relay/audio events.

The earlier first-chunk defect was a playback fade/completion problem corrected in 91. Intermittent relay socket errors also exist. Neither proves the cause of these exits. Recent volume/DSP changes remain preserved. Controlled regression tests did not reproduce a crash: full mobile suite, complete four-chunk native boosted output, compact/large iPhone simulator user/agent speakers and muted-call transitions passed. The new active-call speaker reservation conflict is an ordinary controlled error, separate from an operating-system crash.

## Bounded local collection

`MobileCrashDiagnostics` starts once and subscribes to MetricKit diagnostic payloads plus lifecycle/memory-warning notifications. It keeps at most 160 timestamp/build/OS/type event records and 12 sanitized system-diagnostic files in the app's internal Application Support `ClawDad/AssistantDiagnostics` directory. Files are atomic, private and excluded from backups. It accepts only typed event names, numeric crash/frame metadata, valid binary UUIDs and constrained version strings. It strips free-form exception reasons, binary names/paths and all unknown fields; array/depth/payload/file-size limits bound retention. It never accepts conversation text, transcripts, images, URLs or audio and never uploads data. MetricKit delivery is platform-dependent and can be delayed; these records are supporting evidence rather than a guaranteed immediate crash report.

Privacy tests verify removal of synthetic private strings while retaining symbolication UUID/offsets, bounded arrays and 160-record retention across a new collector. App 92 and dSYM share UUID `CFCD73B6-447A-3BF2-9D8C-C80A9FC2DEB4`. The existing third-party WebRTC archive lacks a matching dSYM; if a future signature lands there, full third-party symbolication may require that vendor's symbols.

## Next physical step

Connect Cody's iPhone to this Mac by USB and unlock it. Retrieve local crash, JetsamEvent and watchdog diagnostics via the existing trusted device connection, read its actual installed app/iOS build, and correlate exact incident times. If unavailable over that path, export the relevant ClawDad/JetSam entry from iPhone Settings → Privacy & Security → Analytics & Improvements → Analytics Data. Do not ask for broad private diagnostic exports. No microphone, call or live project needs to be enabled for this retrieval.

Use the exact report/build UUID to select symbols, establish the failing stack/termination category, then reproduce that specific scenario and implement a supported fix. Preserve current voice, conversations, drafts/images and ongoing Mac work. No report was invented or inferred from the ordinary speaker error.

Evidence: `native/macos/dist/candidates/iphone-crashes-2026-09-13/` (`device-details.json`, `crash-list.json`, `devices-latest.json`, `apple-readonly.json`, `build92-symbols.txt`) and the neighboring project-thread readback candidate. Apple references: [TestFlight crash feedback API](https://developer.apple.com/documentation/appstoreconnectapi/beta-feedback-crash-submissions?changes=_3_2), [MetricKit crash diagnostics](https://developer.apple.com/documentation/metrickit/mxcrashdiagnostic?changes=_3).
