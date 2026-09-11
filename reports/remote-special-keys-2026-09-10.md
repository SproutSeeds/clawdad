# Custom Remote Assist Special Keys — September 10, 2026

Status: signed, notarized **Mac build 125 installed**. **iPhone build 86** is `VALID`, assigned to **ClawDad Internal**, and `IN_BETA_TESTING`.

## Delivered behavior

Remote Assist → three-dot controls → **Special keys** now includes **Shift + Left Arrow** (`⇧←`). The existing eleven shortcuts retain their original wire actions and Mac/Windows behavior. Shift + Left Arrow and custom combinations use an advertised Mac capability, so an older or unsupported host receives an explanation instead of an unrecognized command.

Tap **Edit** to:

- Add a labeled combination with **Add combination**.
- Select one key plus any combination of Control, Option, Shift, and Command.
- Edit an existing entry. Built-in entries offer **Restore default**; custom entries offer **Delete combination** with confirmation.
- **Save** the entry without sending a key. **Cancel** or the editor's Back arrow discards that unsaved edit. From the list, Back first leaves editing and then returns to the Remote Assist controls; Escape follows that same path.

The key picker includes arrows, Enter, Tab, Escape, Backspace, Forward Delete, Space, Home/End, Page Up/Down, F1–F12, letters, digits, and supported punctuation. A combination is one key press with modifiers, not a macro or submitted string. There can be up to **40 custom entries** alongside the built-ins; labels support up to 60 characters. They are stored in this iPhone's local preferences, independently from Quick Chat presets, and survive reopening/restart. Invalid saved data is preserved and reported rather than overwritten.

## Native control and compatibility

`RemoteKeyChord` validates a bounded key vocabulary, known modifiers and unique modifiers. The production input codec rejects malformed chords and payloads mixing text/key/shortcut/chord actions. A new optional `supportsKeyChords` session capability resets on reconnect and ignores replies from an older session.

The Mac routes chords through the existing Remote Assist input queue, Accessibility/lock checks, focused editable target resolution, native keyboard-layout mapping, and balanced modifier down/key down/key up/modifier up events. Existing Command-T/Command-Tab behavior retains its system delivery path. Saving, editing or deleting a button never calls the input sender. The phone suppresses sending during a display/tab transition or disconnect and does not automatically retry an uncertain key press.

The current Windows companion retains the original built-ins; custom combinations are unavailable until that host advertises support. Unsupported keyboard-layout characters report an error. Effects still depend on the focused application's key bindings. No native Assistant Terminal input, queue, trust, ownership or draft-validation rules were expanded. The broader Terminal-control audit remains paused for review.

## Verification

Evidence is local under `native/macos/dist/candidates/special-keys-2026-09-10/`.

| Check | Evidence/result |
|---|---|
| Complete runtime suite | **693 passed**, zero failures (`runtime-tests-final.log`) |
| Mobile Swift suite | **234 tests**, one skipped, zero failures (`mobile-tests.log`) |
| Shared wire protocol | **69 passed**, zero failures (`protocol-tests.log`) |
| Final Mac Swift suite | **284 tests**, 13 skipped, zero failures (`mac-tests-final.log`) |
| Persistence and editing | Add/edit/cancel/restore/delete/reload, Unicode labels, limits, invalid storage, built-in preservation |
| Wire compatibility | Legacy built-ins retain exact requests; Shift-Left encodes the exact chord; unsupported hosts do not receive it |
| Native selection | Decoded Shift-Left request → native key plan → AppKit interpretation selected `E` in an unshown disposable `ABCDE` editor, leaving the text unchanged |
| Modifier lifecycle | Shift down, Left down/up, Shift up; compound modifiers released in reverse order with neutral final flags |
| iPhone UI | All four scenarios passed on both compact and large iPhone simulators: exact Shift-Left payload, add/edit/cancel/restore/delete/persistence, older-host messaging, and keyboard/accessibility-text navigation |
| Existing application state | Install preserved the Assistant conversation, user instructions, supervisor settings, allowance preferences and eight Terminal-associated Codex processes |

The native selection test supplies the function-key characters normally added by the window server when a CGEvent becomes an NSEvent. It exercises AppKit text interpretation without displaying a window or sending input to Cody's apps. It is **not** a physical phone-to-Mac WebRTC delivery test. The simulator host exchanges the production wire messages and checks that Shift-Left has the exact key/modifier payload; it does not operate a real remote Mac.

Visual inspection caught and corrected cream text on a white editor field. The final field has the app's dark background and readable cream text. The Special Keys panel scrolls; its header controls remain outside that scroll region, tap targets are at least 44 points, modifier checkmarks communicate state beyond color, and icons/controls have accessible names. The Icon glossary explains editing, sending, states, and local persistence.

Final large-phone evidence: `ios-large-final.xcresult` / `.log`, four tests passed. Compact-phone evidence: the first three scenarios in `ios-small-final.xcresult` / `.log`, plus the corrected accessibility/navigation assertion in `ios-small-accessibility-final.xcresult` / `.log`, one test passed. Final screenshots were reviewed in `visual-small-final/` and `visual-large-final/`, including the editor with the keyboard and accessibility text size. The synthetic preview's Remote Assist loading backdrop is not a real remote video session.

Initial development failures are retained in logs: a SwiftUI expression needed a smaller view helper; two source-location tests needed to follow the moved legacy key-label extension; the large-text UI harness initially assumed an offscreen lazy menu item existed before scrolling. A direct CGEvent-to-NSEvent unit fixture lacked the window server's function-key characters and was corrected to model that translation explicitly. These were diagnosed rather than counted as passing checks.

## Release and remaining checks

- **Mac 125**, app 0.7.0 / runtime 0.7.0-beta.20, installed at `/Applications/ClawDad.app`, September 11 02:59 UTC (September 10 21:59 CDT).
- Executable SHA-256: `8af3817449181c880f8457a1da9ffd5427d59dd0d7bb5d51d08c0a2df5b79b67`.
- Runtime fingerprint: `df0d902168ec2f439a36d748bd5d5f62ce654a300c959b11de83149241bd6f14`.
- Signing, notarization, stapling, Gatekeeper checks and installed runtime/source checks passed. Native release artifacts are in `native/macos/dist/releases/0.7.0-beta.20-macos-125/`.
- **iPhone 86**, app 0.7.0: signed archive validated and upload succeeded at September 11 03:09 UTC (September 10 22:09 CDT). App Store Connect subsequently reported `VALID`; the **ClawDad Internal** group relationship and `IN_BETA_TESTING` state were verified at 03:12 UTC. Build ID: `880f0cf4-4dfe-49df-bb93-166ce4265d6b`. Evidence: `testflight86-release.json`. The existing missing WebRTC dSYM warning was non-blocking. No public App Store, external TestFlight, npm or infrastructure release is included.

Physical iPhone checks remain: update from TestFlight, connect to Mac 125, focus a disposable text field, press Shift-Left, create and use a custom combination, and reopen Special Keys. Confirm physical VoiceOver announcements, hardware-keyboard Escape, and the particular Terminal agent's own key bindings. Real research drafts, queue entries and tabs were not used as mutation fixtures.

## Preserved workspace work

The nine pre-existing dirty entries remain outside this change: `.agents/skills/clawdad-release/SKILL.md`, `plugins/clawdad-codex-integration/skills/clawdad-release/SKILL.md`, `native/macos/build-app.sh`, `native/macos/package-release.sh`, `native/macos/storage-workflow.sh`, `plugins/clawdad-codex-integration/.codex-plugin/plugin.json`, `assets/wordmark-explorations/`, `cloud/native/`, and `marketing-site/`. Their owning release-workflow, integration, design, cloud and site lanes retain responsibility for their next checkpoints. The broader icon layout is unchanged.

The scoped checkpoint includes only the 21 audited Special Keys source, test, project, release-metadata and report paths. `git diff --check` passed. ORP hygiene classifies all remaining changes; its final evidence is `hygiene-final.json` in the candidate directory. Native installation and internal TestFlight are this lane's delivery; the branch's unrelated local commit backlog was not pushed.

Cody's separate “Same voice throughout” listening confirmation is recorded in `reports/assistant-voice-consistency-2026-09-10.md`, checkpoint `4ceba66`, separately from this implementation.
