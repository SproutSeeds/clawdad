# Assistant text chat, images, and retained drafts

The native iPhone Assistant now has a separate **Message Assistant** button on the home screen and in Remote Assist. It opens the existing conversation without starting microphone capture. The headset and **Call Assistant** remain explicit voice actions, and opening messages during a call preserves that call.

The composer accepts up to four photos totaling 20 MB. Photos can be previewed and removed before sending, including messages containing only an image. The sent message records its image attachments in the conversation.

Unsent text, image bytes, and the stable message request ID are saved locally per account/workspace/Mac. Back, sheet dismissal, app restart, and failed sends retain the draft. Import completion still saves to its original Mac when navigation changes. A confirmed send clears only that exact draft; a late receipt preserves subsequent edits and other computers' drafts. Explicit deletion has a visible Keep draft option.

## Delivery and permissions

- The paired Assistant data connection carries resumable 128 KB image chunks. The native Mac session supplies the authenticated device identity; a phone cannot claim a different upload owner.
- The existing local image inbox validates filenames, size, PNG/JPEG type, owner, exact retry bytes, and SHA-256. Assistant images are stored under the Mac's `Assistant/Images` directory and supplied to the existing Codex CLI as actual `--image` attachments for both new and resumed conversations.
- A message is accepted only after all its images have transferred and their saved bytes are verified. Invalid or incomplete images cannot silently turn into a text-only message. Verification repeats before model execution.
- Retry fingerprints compare JSON contents independently of field order and recognize receipts written by earlier builds. The phone also accepts the durable message receipt when an earlier message has left the recent history window.
- Existing native Terminal targeting, application restrictions, pairing permissions, STT/TTS selections, and Codex model settings are retained. This change adds no cloud object store or cloud service. Codex receives the images through the existing Codex service, as it does other conversation input.

## Verification

- Full runtime suite: 553 tests passed.
- Mobile Swift suite: 145 tests passed, including interrupted uploads, missing image files, app recreation, per-Mac drafts, late receipts, image-only messages, and uncertain sends without duplicate delivery or microphone startup.
- Mac Swift suite: 189 executed, 183 passed, 6 existing opt-in device/UI checks skipped. The native HTTP bridge test verifies that the paired device identity overrides a claimed owner.
- Shared protocol suite: 64 tests passed.
- Assistant simulator UI: all 11 scenarios passed across the initial run and focused final reruns. Actual system Photos selection, preview, removal, Back/reopen, app termination/relaunch, failed-send retention, retry, explicit deletion, text entry from Remote Assist, and explicit voice start were exercised. The existing voice/transcription/contact-link scenarios also passed.
- Real Codex image acceptance: two test cards traveled through the local HTTP uploader and runtime into one continuing Assistant conversation. It correctly read **ORCHID 583** and **CEDAR 946**, and identified the blue circle and orange triangle. Those contents were absent from the text prompt. First and resumed turns both passed, with saved-byte hashes verified.
- Simulator screenshots of the restored draft and image preview were visually inspected. The deletion alert was corrected after the first run exposed a hidden cancel action.

Evidence is in the ignored canonical candidate directory `native/macos/dist/candidates/assistant-chat-images-drafts-2026-09-08/`, including `actual-image-delivery.json`, test logs, simulator result bundles, and release receipts.

## Release

Mac **0.7.0 (74)** is installed, Developer ID signed, notarized, stapled, and healthy. The installed runtime matches the verified source; `imageAttachments` is enabled and all 12 Terminal tabs remain present. Notarization: `cf57085e-6497-4c54-a93d-2b75eedcf703`.

iPhone **0.7.0 (63)** is signed and available in **ClawDad Internal TestFlight**. App Store Connect reports `VALID` and `IN_BETA_TESTING`, with the intended group assignment and matching testing notes. Apple build ID: `e59a512e-be74-4b55-a06b-b369ce0f8435`, verified September 8 at 14:07 UTC. Build 62 was an intermediate upload; build 63 contains the final durable-receipt recovery check.

## Remaining physical iPhone verification

On iPhone build 63 paired with Mac build 74, tap the message bubbles and confirm microphone capture stays off. Select a real photo, preview it, close/reopen the conversation, then send it and verify the Assistant's description. Check a temporary network interruption during a larger photo transfer and confirm the draft survives and retries once. The simulator, native tests, and real Codex acceptance verify the implementation; the complete physical iPhone-to-Mac network path remains a hands-on acceptance check.

## Workspace

This change is scoped to the native mobile Assistant, its paired Mac transport/runtime, tests, and native release metadata. The nine pre-existing dirty paths remain outside this implementation's commit:

- Release workflow: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, and `native/macos/storage-workflow.sh`. Next action: review and checkpoint the existing storage/release workflow changes in their owning lane.
- Plugin integration: `plugins/clawdad-codex-integration/.codex-plugin/plugin.json` and `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`. Next action: review and checkpoint that integration's metadata and release guidance.
- Other product work: `assets/wordmark-explorations/`, `cloud/native/`, and `marketing-site/`. Next action: review the assets and finish/checkpoint each owning product lane separately.

No unclassified dirty paths remain.
