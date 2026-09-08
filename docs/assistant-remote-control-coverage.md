# Assistant access to Remote Assist controls

The Assistant discovers this inventory through `remote_controls`. Each operation still requires Cody’s request and the application’s existing authorization. The icon layout is unchanged.

| Manual control | Assistant tool | Behavior and boundary |
| --- | --- | --- |
| Terminal picker: list, refresh, window groups, activity | `workspace`, `inspect_tab` | Uses the existing authorized native control path. |
| Terminal picker: select tab | `focus_tab` | Uses the existing authorized native control path. |
| Terminal picker: reorder tab | `move_tab` | Uses the existing authorized native control path. |
| Terminal picker: close and confirm/cancel | `close_tab`, `resolve_close` | Uses the existing authorized native control path. |
| Keyboard and dictation: agent draft | `insert_in_tab`, `clear_tab_input`, `replace_tab_input` | Uses the existing authorized native control path. |
| Keyboard and dictation: native shell draft | `inspect_terminal_input`, `type_terminal_input` | Uses the existing authorized native control path. |
| Keyboard and dictation: other authorized app input | `computer`, `clear_input`, `replace_input` | Uses the existing authorized native control path. |
| Enter | `press_terminal_key`, `send_to_tab` | Typing, submission and native queuing are separate. |
| Special Commands: control_c | `press_terminal_key`, `computer` | Uses the existing authorized native control path. |
| Special Commands: control_j | `press_terminal_key`, `computer` | Uses the existing authorized native control path. |
| Special Commands: escape | `press_terminal_key`, `computer` | Uses the existing authorized native control path. |
| Special Commands: tab | `press_terminal_key`, `computer` | A working Codex queue uses queue_in_tab or queue_tab_draft; completion in a shell is a separate key action. |
| Special Commands: arrow_up | `press_terminal_key`, `computer` | Uses the existing authorized native control path. |
| Special Commands: arrow_down | `press_terminal_key`, `computer` | Uses the existing authorized native control path. |
| Special Commands: arrow_left | `press_terminal_key`, `computer` | Uses the existing authorized native control path. |
| Special Commands: arrow_right | `press_terminal_key`, `computer` | Uses the existing authorized native control path. |
| Special Commands: control_l | `press_terminal_key`, `computer` | Uses the existing authorized native control path. |
| Special Commands: command_tab | `press_terminal_key`, `computer` | Uses the existing authorized native control path. |
| Special Commands: command_t | `new_terminal_tab`, `computer` | Terminal requires an anchor tab and catalog revision; creation returns the verified new identity. |
| Native agent Tab queue: new or already-present draft | `queue_in_tab`, `queue_tab_draft`, `task_status` | Uses the existing authorized native control path. |
| Quick Chat: pwd, ls, cd .., Continue implementation, Discuss next steps | `type_terminal_input`, `press_terminal_key`, `send_to_tab` | Use only the exact requested preset text and intended destination. Listing presets never authorizes running them. |
| Quick Chat: create/edit/delete personal presets | User control on iPhone | Custom presets are stored on that phone; share the desired text with Assistant or edit the preset in the phone UI. |
| Copy Mac selection / Mac clipboard text | `clipboard`, `read_terminal_context` | Copying the result into the phone clipboard uses its existing message-copy or Remote Assist Copy button. |
| Paste iPhone clipboard to Mac | `type_terminal_input`, `insert_in_tab`, `attach_images_in_tab` | The user first shares the clipboard text/image through the phone Paste control or chat. The Assistant cannot silently read the phone clipboard. |
| Read Aloud: selected text or latest response | `read_terminal_context` | Return the verified text through the current conversation, using the existing local voice pipeline. The phone owns speaker playback/Stop controls. |
| Photos: attach saved image in Terminal | `attach_images_in_tab` | No submission; requires a fresh empty composer inspection and observed image attachments. |
| Photos: choose, preview, remove before sending | User control on iPhone | The existing native photo picker and chat attachment draft remain user controls. |
| Files: browse, search, formats, pins, archive, rename | `files` | Uses the existing authorized native control path. |
| Files: read contents / publish requested deliverable | `files` | Local Mac library, same service as Remote Assist; no cloud object storage. |
| Files: iPhone preview, share, download, Save to Files | User control on iPhone | The existing Files transfer and document export UI remain user-owned. |
| Mac screen click, drag, scroll | `terminal_pointer`, `computer` | Terminal gestures are limited to the exact inspected tab text area; other apps use their authorized computer controls. |
| Displays and screen capture | `computer` | Assistant can list/capture displays and target their coordinates. The phone chooses its own displayed screen. |
| Fit screen, zoom, menu navigation, keyboard visibility | User control on iPhone | Viewport and presentation controls do not act on the Mac. |
| Assistant Chat, Call, microphone, Think aloud, Send, Stop/interject, hang up | User control on iPhone | Conversation entry, microphone consent, drafts/attachments and playback controls stay with the user. |
| Pause/resume Mac control; cancel waiting delivery | `assistant_control` | Accepted native queues and working tasks require their native controls. |
| End Remote Assist | User control on iPhone/Mac | The connected user owns the session and can disconnect or close ClawDad. |

## Targeting, delivery and verification

Typing leaves text for review. Enter is a separate submission action. Tab completion in a shell is a key action; queuing work in a busy agent uses the verified native queue tools. Cody can also review an inserted agent draft and press Tab manually.

The special keys keep their existing meanings: Control-C interrupts, Escape dismisses or interrupts, Control-J adds a newline or submits according to the input, arrow keys navigate, Control-L redraws, Command-Tab switches apps, and Command-T creates a tab. The Assistant must use the explicitly requested effect. Merely listing Quick Chat presets never runs their commands.

Use `workspace` for the current tab catalog. For creation, supply an existing anchor `tabId`, the catalog revision and a stable request ID. `new_terminal_tab` returns the verified new tab identity and window group, with an input inspection when the shell is ready. It invokes Terminal’s native New Tab command once and verifies exactly one added tab, existing tab order, and the intended physical window. It never runs a shell command to create the tab.

`inspect_terminal_input` binds the exact tab, foreground process/session, native input identity and manual-input generation to a short-lived single-use token. `type_terminal_input` supports local zsh/bash/sh line editors with a readable ordinary prompt. It preserves existing drafts until replacement is explicitly requested. Typing is single-line; Enter, Control-J and Tab are separate key operations. Password prompts, canonical terminal reads and unknown REPL/SSH line editors do not authorize automatic draft insertion. Explicit native keys and bounded pointer controls remain available where inspection succeeds.

Codex uses its existing dedicated draft and queue interfaces. `insert_in_tab` works while the verified agent is busy. Long collapsed pastes retain the exact-payload/visible-character-count verification and disclose when expanded text was not readable. `queue_in_tab` inserts a new message and presses Tab once; `queue_tab_draft` presses Tab once on an inspected existing readable draft, without another paste. Both verify the actual running Codex version/session and native queue acceptance. An existing-draft queue updates the original draft task card.

A waiting receipt means ClawDad has not delivered the action. Inserted means a verified draft. Native queued means an observed entry in the agent’s queue. Working and completed require that request’s own observed agent turn. A special-key or pointer receipt reports dispatch and available observation; it does not claim that a shell command or agent task completed. Retries use the same request ID and never blindly replay uncertain delivery. Terminal close confirmations retain their existing user decision and token.

New-tab, focus, reorder and close results publish their observed tab inventory immediately. A close refusal or a required confirmation remains an attention state; it does not claim that the tab closed. Resolving a confirmation updates the original request.

## Device-owned controls and remaining limits

The Assistant operates the Mac through ClawDad. Photo selection, microphone consent, call and playback controls, iPhone clipboard access, custom phone preset editing, screen zoom/navigation, and iPhone Save to Files remain in their current user interfaces. The Assistant can receive shared text/images, attach saved images to Terminal, return selected/latest response text through the current conversation voice, and manage the local Files library. It cannot silently select personal photos, read a phone clipboard or force an iPhone export.

The current local shell verifier covers visible single-line zsh/bash/sh input, including observable wrapping. Unknown prompts, unreadable prior multiline/collapsed drafts and unsupported line-editor bindings return an explicit limitation or uncertain verification. They do not trigger an automatic fallback to arbitrary desktop typing. Windows hosts retain their current manual Remote Assist support; this native Assistant toolkit targets macOS.

## Verification evidence

See [the implementation report](../reports/assistant-tool-parity-2026-09-08.md) for the exact tested build, native/MCP evidence, automated results and remaining physical iPhone checks.
