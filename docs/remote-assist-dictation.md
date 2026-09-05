# Remote Assist dictation

Implemented: Mac build 45 installed; iPhone build 37 available in ClawDad Internal
TestFlight. Verification and physical-device acceptance are recorded in
`../reports/remote-assist-dictation-2026-09-05.md`.

Approved flow, September 5, 2026:

1. Open the Remote Assist controls and tap the microphone beside the keyboard.
2. Record with the same tap-to-start, tap-to-stop behavior as the main composer.
   Show elapsed time, recording feedback, and a visible Cancel/Back control.
3. Transcribe through the existing paired-computer speech service and show an
   editable preview. Retain the recording for retry if transcription fails.
4. Use on Mac copies the reviewed text to the Mac clipboard and inserts it only
   when the currently focused Mac element accepts text. With no suitable input,
   report Copied to Mac clipboard. Enter remains a separate action.
5. Offer Copy to iPhone for pasting elsewhere. Preserve the draft through panel
   dismissal and connection loss; never automatically replay a delivery.

Implementation plan:

- Extract the current recorder for reuse by composer and Remote Assist.
- Route Remote Assist transcription replies to its own draft, keeping composer
  transcription ownership intact. Cancelled and superseded replies are ignored.
- Add an acknowledged insert-or-copy clipboard operation with bounded text and
  request IDs. Keep ordinary clipboard paste behavior compatible.
- Detect the current foreground input on the Mac at delivery time; do not revive
  a previously focused app. Uncertain or unavailable focus falls back to copying.
- Advertise host support so older hosts can still transcribe and copy to iPhone.
- Keep microphone cleanup, retry, draft ownership by computer, visible Back, and
  keyboard dismissal explicit in the mobile flow.

Verification: exercise transcription routing/cancellation, retry and draft
retention, insertion versus clipboard fallback, duplicate delivery, protocol
compatibility, native Mac/iPhone tests, the runtime suite, and an iPhone simulator
build and visual review. Actual microphone capture and focused-input behavior on
the paired phone remain physical-device acceptance checks.
