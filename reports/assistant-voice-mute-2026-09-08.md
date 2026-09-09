# Assistant hands-free mute and unmute

The scoped iPhone implementation adds optional voice mute/reactivation to an
existing Assistant call. The Mac remains the authority for ordinary Assistant
transcription and replies. Voice-muted microphone input has its own transient
on-device command path. Mac build 81 is already installed; this change needs an
iPhone update only. Private TestFlight release status is recorded below.

## Using it

Open **Assistant → Voice controls**. Both **On-device voice commands** and
**Voice unmute while muted** start off. Enabling the first setting asks for
Speech Recognition permission on the phone; enabling either setting by itself
does not start microphone capture or a call.

- Say **ClawDad, mute** as a standalone command. With voice reactivation enabled,
  the call displays **Muted · voice unmute enabled**. Say **ClawDad, unmute** to
  resume the same conversation.
- **Please mute / please unmute** are separately optional and start off.
- Without voice reactivation, the mute command fully stops capture. The manual
  microphone button also always fully mutes; tap it again to unmute.
- The voice-muted call bar has **Turn microphone fully off**, which stops
  capture and disables the voice-reactivation preference. Full mute displays
  **Muted · microphone off**. The same control is in Voice controls.
- A successful transition gives haptic confirmation. Wait for that confirmation
  or the muted state before beginning a private conversation.
- Muting discards the entire current unsent voice turn, queued audio, pending
  final/preview transcription and pending automatic send. Typed drafts and
  attachments are retained. A request already delivered before mute continues.
- Four-second turn ending, manual Send, and Think aloud resume after unmute.
  Muting does not disconnect the call or stop an already playing spoken reply.

Voice commands pause during reply preparation/playback and for 0.5 seconds
afterward; use the microphone button during a reply. Whole-phrase matching,
300 ms stable recognition, and at least 350 ms of quiet reduce unintended
activation. Repeated partials do not produce repeated controls. Quoted text,
questions, and phrases embedded in longer recognized sentences are rejected.
These rules do not authenticate the speaker or guarantee immunity to another
person, a television, an inaccurate recognition result, or an isolated quoted
phrase that sounds identical to an intentional command.

## Privacy and lifecycle boundary

`AssistantOnDeviceCommands` uses English (US) `SFSpeechRecognizer` only when
authorization, runtime availability and `supportsOnDeviceRecognition` permit
it. Every recognition request sets `requiresOnDeviceRecognition = true`.
There is no online recognition fallback. Apple documents that both the
[request requirement](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition)
and [recognizer capability](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition)
are necessary to keep recognition on-device.

The local detector receives one bounded segment at a time, cancels/discards
requests and hypotheses between segments and transitions, and skips the rest
of a long utterance after eight seconds until a quiet boundary. Recognition
failure or failure to finalize within three seconds shuts capture off. The
recognizer adapter has no network, file, chat, diagnostics or analytics access;
its outward results are only a control enum or a content-free failure signal.

`AssistantCaptureBoundary` gates the real audio callback before conversation
VAD, WAV creation, transcription callbacks or level updates. Command-only input
cannot enter those paths. The timestamp fence uses the first sample of each
buffer; buffers spanning unmute and stale queued callbacks are discarded in
full. At most four audio-thread handoffs can wait for the UI actor, preventing
an unbounded private-audio backlog when the UI is busy.

The controller has an independent input generation. Muting cancels the current
voice worker, previews, timers and unsent data; late STT results cannot update
history or revive a turn. Transport cancellation also cancels an active upload
writer without disconnecting the peer. Already delivered pre-mute bytes cannot
be recalled. No post-mute surrounding speech is handed to that transport.

As a final safeguard, a standalone control found in the **ordinary unmuted**
Mac STT result is consumed before Assistant message submission. This uses the
existing authorized transcription path for open microphone audio; voice-muted
audio never takes that path. A late recognition therefore cannot create an
ordinary Assistant reply or Terminal task for a mute command.

Full mute removes the input tap, stops the capture engine and changes the
conversation's reserved audio session to output-only. Reply playback uses a
separate in-memory player, so it can continue without microphone capture.
Unmute creates or validates a fresh capture graph and starts a new timestamp
boundary. Haptics run only after the transition succeeds; the conversation audio
session explicitly permits [recording-time haptics](https://developer.apple.com/documentation/avfaudio/avaudiosession/setallowhapticsandsystemsoundsduringrecording(_:)).

Recognition failure, interruption, or backgrounding never automatically unmutes.
The call remains available with full mute and a plain-language explanation;
manual unmute remains accessible. A cancelled microphone recovery cannot later
stop a replacement call. The connection can recover without changing mute mode.

## Extended calls and platform limits

Voice reactivation is foreground-only. While voice commands are active and the
call is listening or voice-muted, ClawDad keeps the screen awake so automatic
locking does not silently remove hands-free reactivation. Full mute, hangup,
backgrounding, and disabling commands release that screen-awake request.
Manually locking the phone or leaving ClawDad fully mutes the microphone;
returning to the app does not reactivate it. iOS may suspend an idle background
connection, which then uses the existing recovery path.

The screen and local recognition both use battery. Battery drain, thermal
behavior, long-call reliability, recognition quality, and hardware routing have
not been measured on Cody's iPhone. Availability is checked dynamically for
English (US); no blanket claim is made about every phone or locale.

## Verification

| Check | Result and scope |
| --- | --- |
| iPhone Swift package | 186 tests discovered, **185 passed**, one optional live-service test skipped; zero failures. |
| Voice controls and privacy | Exact/alternate/quoted commands, partial stability, twenty cycles, manual controls, full-off overriding an in-flight unmute, stale final/preview results, muted callbacks, startup/recognition failures, interruptions, reconnects, foreground/background, screen-awake ownership and Think aloud covered. |
| Drafts and attachments | An actual PNG fixture and typed draft survive mute and late STT; fresh post-unmute speech submits once. Existing draft/history/image/link tests pass. |
| Audio handoff | Synthetic audio-thread buffers verify the first-sample fence and four-buffer mailbox bound. No real microphone was opened for these tests. |
| Native reply playback | Real zero-volume `AVAudioPlayer` tests decode and complete 16/24/48 kHz in-memory clips, reject invalid data, and prevent stale cancellation from stopping a replacement clip. These are native Mac framework tests, not audible iPhone proof. |
| Transport | Cancelling an active synthetic upload stops its writer and leaves the connection able to send another request. |
| Simulator UI | 15 distinct Assistant scenarios passed across the initial suite and focused rerun: privacy defaults, full-off control, call continuity, navigation, copy, links, photos, saved drafts, transcript display and manual send. |
| Release metadata | 11 Node tests passed. |
| Native archive | Signed iPhone 0.7.0 (69) archive built; signature, bundle identifier, build number and speech permission text verified. |

One initial UI test appended its message to a previously retained synthetic
draft. The exported hierarchy confirmed that persistence behavior. Its fixture
now explicitly resets only its own test draft before starting; the rerun passed.
Production draft deletion behavior was not changed.

The final twenty-cycle synthetic dispatch test measured at most **0.053 ms for
mute** and **20.02 ms for unmute** from a recognized control callback to the fake
capture-state acknowledgement. A preceding run under simultaneous simulator
load observed an unmute maximum of 45.74 ms. These measure application dispatch,
not spoken-command recognition or physical microphone stop/start latency.
The 300/350 ms recognition/quiet thresholds are policy settings, not measured
phone latency. Normal four-second submission and delayed-final-word tests pass;
no new real Assistant response/TTS generation benchmark was run for this patch.

### Remaining physical iPhone checks

1. Check Speech Recognition permission, English (US) on-device capability, and
   actual recognition with Wi-Fi/cellular disabled. Measure from the final
   command word to the state change and haptic, separately from normal turn
   submission, response generation and audible playback.
2. Repeat built-in microphone and headset cycles. Confirm the full-off privacy
   indicator and hardware capture behavior, haptics, reply continuity, and
   manual unmute after interruption or recognition failure.
3. With an agreed synthetic private phrase, observe the phone/network/Mac
   boundary while voice-muted and after unmuting: no muted audio or text in
   transfer, Assistant history, recordings or diagnostics, and no buffered
   replay. Automated routing tests and Apple's API contract are not a physical
   packet capture or an audit of opaque OS internals.
4. Try normal pauses, quoted discussion, another speaker/TV, Assistant playback,
   long foreground calls, screen lock/background/foreground, network recovery,
   battery use and heat. Confirm the safe full-mute fallback and manual escape.

## Release and workspace

**iPhone 0.7.0 (69) is VALID and IN_BETA_TESTING in ClawDad Internal.** Apple build
ID `ec0eaef6-1325-4051-b624-39b547f3862e`; verified at
`2026-09-09T01:30:35.541Z`, with internal-group assignment and matching testing
notes. Cody can install the update through TestFlight. No physical iPhone
installation is claimed. The installed Mac app remains 0.7.0 (81).

Upload succeeded with a vendor WebRTC dSYM warning. Apple accepted the app;
symbolic crash debugging inside that prebuilt framework remains limited.
Evidence is retained under
`native/macos/dist/candidates/assistant-voice-mute-2026-09-08/`.
The archive is
`apps/ios/ClawDadMobile/build/ClawDadMobile-69.xcarchive`.
Its executable SHA-256 is
`626e22c583c6aeb180e18509d4b1463e1d5b4f3bd1529ebe4d4df43d16641a1e`.

No listening preference or live microphone state was enabled remotely. The Mac
app, existing Terminal tools, cloud infrastructure and broader Remote Assist
icon arrangement remain outside this patch. This is the private native release
workflow; no public npm or public GitHub release is part of the handoff.

The nine baseline dirty paths are preserved for separate review:
`.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`,
`native/macos/package-release.sh`,
`plugins/clawdad-codex-integration/.codex-plugin/plugin.json`,
`plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`,
`assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`, and
`native/macos/storage-workflow.sh`. Their next actions remain in their existing
release, branding, cloud, website, or storage lanes. Final hygiene and the scoped
commit are recorded with the release evidence.
