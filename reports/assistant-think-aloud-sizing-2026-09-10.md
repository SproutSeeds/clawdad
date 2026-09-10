# Think aloud button sizing

The shared Assistant call bar now draws a 36-point circle and an 18-point infinity symbol, proportionally reduced from 44 and 22 points. An outer 44-by-44-point frame preserves the existing accessible touch target and alignment with microphone and hang-up controls. The gold fill, active stroke, selected-state checkmark, accessible name/value/traits and toggle behavior are retained.

The change is in `AssistantThinkAloudButton`, used by the shared call bar across Assistant chat, the main screen and Remote Assist. No call-state or transcription logic changed.

## Verification

- Existing UI tests: **3 passed**, zero failures, on iPhone SE (3rd generation) and iPhone 15 Pro Max simulators running iOS 26.5.
- Visually inspected enabled and disabled screenshots on both layouts: visible vertical padding, centered neighboring controls, readable infinity symbol and selected checkmark.
- The tests confirmed the 44-point target, On/Off accessibility values, shared state when navigating Terminal/chat, and explicit sending of a held voice turn while muted.
- Release metadata checks: **11 passed**. Signed archive verified as iPhone **0.7.0 (80)**, bundle `earth.frg.clawdad.ios`.
- Physical iPhone touch feel and VoiceOver interaction remain user checks; simulator screenshots and UI automation are the evidence above.

Evidence is in ignored `native/macos/dist/candidates/think-aloud-sizing-2026-09-10/`, including `compact.xcresult`, `large.xcresult`, exported enabled/disabled screenshots, release checks and the signed archive.

## Release and scope

Internal TestFlight build **80** is **VALID**, assigned to **ClawDad Internal**, and **IN_BETA_TESTING**. The verified build ID is `f4b576e5-ed3b-4d84-994f-94d8b5a45f44`; provider evidence is in `testflight80-release.json`. Mac build 101 remains installed.

The scoped changes are the shared button's visual dimensions, iPhone build metadata and this verification record. The nine pre-existing unrelated paths remain preserved in their classified buckets, documented in `reports/terminal-speech-app-server-release-2026-09-10.md`.
