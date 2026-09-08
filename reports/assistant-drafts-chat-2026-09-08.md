# Assistant drafts, native queue repair, and readable chat — September 8, 2026

Mac **0.7.0 (80)** is installed, notarized, and healthy. iPhone **0.7.0 (68)** is VALID and IN_BETA_TESTING in **ClawDad Internal**, with matching testing notes. This is the private native release. The public npm package, public GitHub remote, cloud infrastructure, and broader Remote Assist icon layout were not changed.

The voice-turn implementation from `c7be99d` / Mac 79 / iPhone 67 is retained. Contact links, input editing, text chat, image attachments, persistent drafts, and connection recovery are retained from the preceding releases. Nine overlapping failed delivery receipts are archived from the visible presentation as superseded by this combined work or earlier completed work. Their original records remain in local diagnostics; none was replayed.

The Assistant can now use `inspect_tab` followed by `insert_in_tab(tabId, sessionId, text, requestId)` to place a draft immediately in a working agent's empty composer. This action presses neither Enter nor Tab. Existing drafts require explicit authorization and a fresh inspected token for `clear_tab_input` or `replace_tab_input`. Readable drafts can be edited while the verified Codex agent works; unrelated inputs, changed identities, existing attachments, and unreadable existing collapsed drafts remain protected. Generic Computer Use restrictions and macOS permissions remain in force.

The native queue rejection came from requiring exactly one Codex process on a TTY. The real Terminal had Codex 0.153.4 and a ChatGPT helper sharing its TTY. Version detection now selects the process holding the exact CLI conversation log, then checks its mapped executable. This also avoids inspecting a newly retargeted Homebrew shortcut when the running agent still uses the previous executable. The verified version remains explicitly limited to Codex 0.153.4. Unknown versions and ambiguous ownership remain unsupported.

`queue_in_tab` uses the inspected session, verifies the current Tab binding and empty composer, inserts the authorized message once, and presses Tab once. It observes the native queue entry and follows the matching message into its own turn. Neither an empty composer nor a posted key event alone establishes acceptance. Stable request IDs preserve receipts across retries and restarts. Uncertain deliveries are preserved for inspection without automatic replay.

| State | Meaning |
| --- | --- |
| Waiting for delivery | ClawDad has the request; native input delivery is pending. |
| Draft inserted | The draft was verified in the selected agent input. Cody can review and manually press Tab. |
| Queued in agent | The matching native queue entry was observed. |
| Submitted | Enter delivery was acknowledged; the matching turn is still being observed. |
| Working | That exact message was observed in its own agent turn. |
| Completed | That message's turn finished. |
| Draft replaced / cleared | A later authorized edit changed the inserted draft; its original receipt is retained. |
| Needs attention | A genuine failure or uncertain delivery requires inspection. |

Chat is now a projection over preserved local records. Internal inspections, polling, raw results, audited test prompts, expected fixture failures, and test completion updates stay in diagnostics. Existing history is filtered before the visible history limits, so test activity cannot push genuine entries out of the window. Task cards have readable directory names, the actual request, evolving status, and the associated readable Assistant result. A stable task ID updates the original card. Navigation receipts and spoken task updates remain available separately from visible chat cards.

Every user and Assistant message has a separate copy control. Task requests and associated results also have copy controls. Copy uses the complete text and briefly shows “Copied.” Message text remains selectable, contact links remain tappable, and attachment controls are preserved. Snapshot presentation no longer truncates message text to 8,000 characters. The iPhone history renders messages and task cards in chronological order.

Live verification used the installed Mac app, its authenticated native endpoints, and the actual Assistant MCP implementation against one disposable Codex Terminal window. The fixture was closed afterward. Its diagnostic requests do not appear in Cody's conversation.

- A working agent received a reviewable multiline Unicode draft in **1.31 seconds** from tool invocation to receipt, while its original task continued. Reusing the request ID did not paste again.
- A second insertion preserved the existing draft and required attention. Fresh, authorized replacement and clearing changed only that composer and did not interrupt the working agent.
- Idle-agent and wrong-session native queue requests were rejected without delivery.
- Two Tab-queued follow-ups were accepted once. Repeating the first request returned its original receipt.
- A **1,932-Unicode-scalar** draft appeared as a collapsed paste without Enter or Tab. The payload stayed on the clipboard until its native paste receipt and displayed count were verified. A fixture-only manual Tab then queued it.
- The original task, first follow-up, second follow-up, and long draft completed in that order, in four distinct turns, with the expected responses. The expanded long text matched every scalar, internal space, and line; Codex itself trimmed its final newline upon submission, producing a 1,931-scalar user message. Each follow-up appeared once in the actual CLI transcript.
- The live action sequence preserved the window/TTY identities and draft hashes of **14 other Terminal tabs**. The installer separately preserved its observed one-window / 13-tab catalog counts; its title-based comparison differed at restart, so that comparison is not claimed as exact layout proof.
- A read-only check of the existing `/dev/ttys000` session confirmed **0.153.4** using the production response-reader code despite the second inherited-TTY helper.
- The history audit preserved all **162 original messages**, retained **91 diagnostic jobs**, consolidated nine superseded receipts, and showed eight genuine task cards with unique IDs and readable names. The new voice probe remained hidden.

For collapsed pastes, `expandedTextReadBack: false` explicitly distinguishes the native paste receipt plus exact character count from a full accessibility readback. Full expansion was verified in the disposable agent's actual turn after manual Tab. An already-existing unreadable collapsed draft is preserved; the tools do not guess its contents to replace it.

The new recorded-audio test exercised the real mobile controller against the installed Mac's local STT, existing Codex Assistant conversation, and selected local TTS. It submitted once and kept the call connected. These are separate measurements:

| Measured stage | Time |
| --- | ---: |
| Last recorded speech → submission | **4.016 s** |
| Last new words → submission | **4.015 s** |
| Final audio → final transcript | **0.605 s** |
| Submission → readable response observed | **7.778 s** |
| Response observed → decoded audio ready | **0.793 s** |
| Submission → decoded audio ready | **8.571 s** |

The remaining wait in this sample was primarily response generation: the coordinator's first response took 7.506 seconds and its queue wait was 35 ms. Audio was decoded to PCM; this is a playback-readiness measurement, not proof of sound from a physical iPhone. The four-second policy, genuine resumed speech, repeated partials/noise, active-speech transcription stalls, delayed final words, manual Send, Think aloud, and duplicate prevention passed the existing controller/detector regression checks. Think aloud remains off by default and keeps a turn open until Send.

| Verification | Result |
| --- | --- |
| Full runtime suite | 569 passed, zero failures. Run serially after an unrelated approval-fixture timing failure under parallel build load. |
| Mac suite | 202 tests, six opt-in tests skipped, zero failures; additional live running-version test passed. |
| Mobile suite | 164 tests, one opt-in test skipped, zero failures; that live voice test separately passed against Mac 80. |
| Shared protocol suite | 65 passed. |
| iPhone UI | All 13 affected UI tests passed across the full run and the corrected copy-control retest. Photo preview/removal, failed-send draft retention, app restart, explicit calling, links, navigation, and voice controls passed. |
| Copy and task UI | Real simulator Copy → Paste preserved both text lines and Unicode; reopening retained the draft. The task changed from Working to Completed in place with one request and its result. Exported screenshot visually reviewed. |
| Distribution | Mac signature/notarization/staple and installed runtime hashes verified; iPhone signed archive uploaded and assigned to Internal TestFlight. |

During verification, one read-only inspection briefly lacked an editable token; a fresh inspection recovered. The first test attempt then finished its original task while paused for inspection, so that attempt was not used to claim busy replacement. The repeat verified replacement while still working. An initial exact transcript comparison also exposed Codex's own trailing-newline trim; the final read-only transcript audit recorded that normalization rather than repeating any delivery. An inherited accessibility identifier on the task card initially hid its result-copy identifier; removing that parent identifier fixed the simulator check. The shared protocol's old “Waiting for Mac” expectation was updated to the new “Waiting for delivery” label.

Physical iPhone acceptance remains: update to 68, copy a long message and use its contact links, reopen a text/image draft after a failed connection, insert a draft into a working tab and manually press Tab, queue two follow-ups, and speak/pause/resume with Think aloud both off and on. Confirm audible playback and microphone behavior on the actual iPhone network and audio route.

The broader Remote Assist layout remains discussion-only. Cody was offered the choice of refining the existing labeled groups and spacing, or using compact frequent controls with secondary actions under More. The first keeps meanings visible and takes more room; the second saves space and adds taps. No broader layout edit is included in this release.

Evidence is stored locally under `native/macos/dist/candidates/assistant-drafts-chat-2026-09-08/`, including live queue receipts, raw normalization evidence, history audit, timing measurements, UI results/screenshots, signature hashes, notarization, installation, and TestFlight verification. The preflight build remains in `initial-build/` and the incomplete first fixture attempt in `attempt-1/` for audit. These are diagnostics, not additional delivered work.

The nine unrelated baseline paths remain intentionally dirty: `.agents/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `assets/wordmark-explorations/`, `cloud/native/`, `marketing-site/`, and `native/macos/storage-workflow.sh`. Their next action is separate review in their existing release, branding, website, cloud, or storage lane. They are excluded from this commit. ORP classifies these buckets; final hygiene records whether any unclassified paths remain.
