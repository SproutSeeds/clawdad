# Assistant infinity control and image-only messages

September 9, 2026. Items 1–2 are implemented and released through the private native workflow. **Mac 0.7.0 (84) is installed; iPhone 0.7.0 (73) is available in ClawDad Internal TestFlight.** The app-server access and destination-selector phase remains an audit and proposal for Cody's review: [capability matrix, ownership map and implementation plan](assistant-app-server-audit-2026-09-09.md).

## Call controls and glossary

The persistent black call bar now uses an icon-only **infinity** button in the previous extra Send position. It changes the existing shared `waitForSend` state, so Terminal, Remote Assist, Assistant messages, the main screen and Settings agree. It remains visible during a call and is disabled until the voice connection is active. Enabled state uses a steady gold fill, thicker outline and checkmark; disabled/off state uses an unfilled thin outline. The accessible name is Think aloud, its value is On/Off, and its selected trait and hint explain the action. The button's target is 44 points.

The old conversation-only toggle, label and explanatory subtext are removed. There is no added inline information button. Settings now has an **Icon glossary** covering actual Remote Assist and Assistant controls, their names, actions, meanings and states. Its automatic-turn explanation reads the controller's real interval, currently **two seconds without new transcribed words**. The future Terminal/ClawDad destination icons are not shown until that proposal is approved and implemented.

The chat composer's existing Send button now finishes a held voice turn when the typed/image composer is empty, including while muted and while final transcription is pending. From Terminal or another screen, tap the call bar's messages icon and then Send. If a typed or image draft exists, Send sends that draft first and preserves the held voice turn; a subsequent Send can finish the voice turn. This preserves the separation between Cody's typed draft/attachments and captured speech. Disabling infinity also restores the existing automatic ending behavior.

The two-second timer, pending-final-word handling, Think aloud holding, muted Send, microphone privacy boundary, connection recovery, images, contact links and native Terminal tools retain their existing implementations. At accessibility text sizes the call status moves above the icons so the controls keep their target sizes. Interject uses its accessible stop icon, and the microphone/hang-up symbols have bounded sizes to prevent enlarged text settings from overflowing their controls. Settings presents one call bar instead of leaving a duplicate accessible bar behind its sheet.

## Image-only root cause and repair

Cody's failed screenshot sends reached the Mac, passed image upload/storage, and were retained as image-bearing user messages. The coordinator then launched Codex with the image path and `-` to read the caption from stdin. **Codex 0.153.4 rejects an empty stdin prompt before loading its images**, with `No prompt provided via stdin.` A caption such as “How about this?” avoided that check, explaining the observed difference.

For an image-bearing message with no non-whitespace caption, the coordinator now passes an **explicit empty positional prompt** (`--`, empty argument). Fresh conversations and resumed conversations both accept this form. Captioned messages keep the original stdin path and exact user text. No caption or hidden instruction is invented on Cody's behalf.

Uploads still use the existing retained local-image store, hashes and stable message/upload IDs. The actual image path is supplied to the model; local message attachment references survive conversation restoration. Failed sends preserve the phone draft and attachments, and receipt reconciliation prevents duplicate user messages/model invocations after a retry. Previously failed pictures are retained, but are not automatically replayed as new work; Cody can resend a picture after updating.

## Verification

Private evidence root: `native/macos/dist/candidates/assistant-controls-images-2026-09-09/`.

| Check | Result / evidence |
| --- | --- |
| Full runtime suite | **580 passed, 0 failures**; `runtime-full-final.log`. Covers coordinator delivery, image storage, request deduplication, recovery and existing dispatch/queue protections. |
| Final build-73 release metadata | **11 passed** after the final version change; `release-metadata-final.log`. |
| Mobile package suite | **189 discovered, 188 passed, 1 opt-in live test skipped, 0 failures**; `mobile-full.log`. |
| Held voice Send, including muted/pending transcription and image-draft priority | New controller tests pass; existing mute-preservation/recovery tests pass. |
| Existing automatic turn timing | Measured **2,062 ms from the last new transcript to submission** in the controlled mobile test. This is test timing, not a physical microphone measurement. |
| Assistant UI coverage | Initial 20-scenario run passed 18; the two glossary/navigation scenarios exposed a real layout/accessibility issue and were repaired. Four corrective scenarios then passed on the large iPhone simulator. |
| Compact iPhone SE layout and maximum accessibility text | Four targeted scenarios passed, including navigation to the glossary, shared infinity state, Terminal access and muted Send. Visual review then caught oversized microphone/handset symbols; fixed and three affected scenarios passed again on final build-73 source. |
| Visual inspection | Reviewed simulator PNGs at regular and maximum accessibility text sizes; `ui-review/`, `ui-compact-review/`, `ui-73-review/`. Final symbols remain within their controls. VoiceOver labels/values and hittable targets are asserted by UI tests. |
| Image-only failure and retry UI | Image remains selected after a failed send, conversation close/reopen and retry. Existing preview/remove, persisted drafts, copying, links and navigation scenarios retain coverage. |
| Actual CLI failure reproduction | Blank stdin with an image failed; explicit empty positional prompt succeeded. `image-cli-probe/`. |
| Actual Assistant image/model delivery | Four real model turns completed in a disposable Assistant conversation, described below; `live-images/verification.json`. |
| Native install | Signed/notarized/stapled Mac build 84; Gatekeeper accepted. Installed coordinator/runtime/MCP hashes match the functional source. Thirteen Terminal tabs and the Assistant conversation were preserved. `install-verification.json`, `final-install-status.json`. |
| TestFlight | Build **73**, processing **VALID**, internal state **IN_BETA_TESTING**, assigned to **ClawDad Internal**, matching release notes; `testflight-verification.json`. |
| Repository checks | `git diff --check` passes. Hygiene reports classified changes with no unclassified paths. |

### Real image delivery and later reference

The fixture used its own Assistant state/workspace and conversation, with no live Mac-control connection. It did not send test prompts into Cody's Assistant or project tabs. Each accepted request ID was replayed to verify that it produced one user-message record and one model invocation.

| Turn | What the model received / observed response | Completion latency |
| --- | --- | ---: |
| Fresh image-only, no caption | Black **47293** above a **blue triangle**, correctly described | 5,845 ms |
| Runtime closed/recreated; follow-up without reattaching | Correctly recalled **47293** and the blue triangle in the same conversation | 4,533 ms |
| Resumed image-only turn, no caption | Black **80651** above an **orange circle**, correctly described | 5,492 ms |
| Image plus caption | Correctly identified **47293** and the blue triangle | 5,708 ms |

All four used exact conversation `01a084c2-a123-7311-bd84-18d458d4bc45`; retained files were hash/byte verified. These measurements are message-to-model-completion times, separate from voice endpointing and audio playback. No physical voice/playback latency is claimed by this test.

## Release details

Mac 84 was installed after the Assistant was ready. Only ClawDad itself was relaunched for its authorized update; Terminal and its agents were preserved. The executable SHA-256 is `22795a06d1bda429a601ec9eada450016c80bee0cdcc67388e354c1658816d58`. Final health verification reports the native bridge online and the existing Assistant conversation intact.

iPhone build 72 was an intermediate uploaded candidate. The final accessibility symbol-size correction is in **73**, which supersedes it. Mac 84's embedded release catalog still names the intermediate beta 72; its coordinator image-only fix and functional runtime match current source. The final release metadata and TestFlight notes correctly select 73. No extra Mac restart was performed solely to change that metadata while Cody was using the Assistant.

Read-only device inventory at handoff still reported **iPhone build 71 installed**. Cody must update to **73 in TestFlight** for the new infinity button and glossary. This release did not remotely start a call, enable a microphone, change microphone preferences, or install onto the phone. The existing WebRTC missing-dSYM upload warning did not prevent successful App Store processing.

## Remaining physical iPhone checks

1. Update to 73. During a call, toggle infinity from Terminal, open messages and Settings, and confirm the same illuminated state. Confirm it stays steady and that the off state is distinguishable.
2. Speak, mute, open messages, and Send a held turn. Confirm the captured final words arrive once while later room audio stays excluded. Repeat with an existing typed/image draft and confirm it is sent separately.
3. Send a photo with no caption, ask about it later, close/reopen the conversation, and repeat after reconnect. Try an interrupted upload, verify the attachment stays selected, and retry once.
4. Check real VoiceOver navigation, large-text scrolling and comfortable touch targets on Cody's phone. Simulator accessibility assertions are not hands-on VoiceOver or microphone/privacy/audio evidence.

The broader app-server access and selector phase is paused for Cody's requested discussion. Its audit makes no claim of newly verified cross-runtime queuing.

## Preserved workspace buckets

This task started from `f148624de953b1292c94ccb34bcd8df2860a1bd7` on `codex/hermes-hybrid-supervisor-ui`, with one worktree and nine pre-existing dirty paths. Those paths remain outside the scoped commit:

- Native release/storage workflow: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`. Next action: review/checkpoint that workflow independently.
- Codex integration metadata: `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`. Next action: reconcile/checkpoint the integration lane.
- Existing product/creative surfaces: `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`. Next action: continue their owner lanes.

No npm publication, public GitHub release, Sparkle appcast publication, app-server write-tool implementation or broader Remote Assist layout reorganization is part of this checkpoint.
