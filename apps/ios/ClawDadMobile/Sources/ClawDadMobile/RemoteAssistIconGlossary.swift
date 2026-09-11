import SwiftUI

struct RemoteAssistIconGlossary: View {
  @ObservedObject var assistant: MobileAssistantController
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 20) {
        Text("The same symbol can act on your iPhone conversation or your Mac. Its location and accessible name identify the action.")
          .font(.callout)
        section("Assistant call bar") {
          entry("rectangle.3.group", "Main Workspace", "Opens the saved Main Terminal window controls. Restore reuses verified live tabs and opens confirmed missing projects. Save / Update records the chosen window; removal is explicit.", "Restored and already open identify verified tabs. Waiting or needs attention explains missing drives, sessions or uncertain ownership. Previous snapshots and recoverable drafts remain available; restored work is never submitted automatically.")
          VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
              Image(systemName: "terminal").font(.system(size: 24)).frame(width: 44, height: 44)
              Image("ClawGlyph").resizable().scaledToFit().frame(width: 32, height: 32)
              Text("Work destination").font(.headline)
            }.accessibilityHidden(true)
            Text("Terminal means work in an exact Terminal tab. The ClawDad claw means work in an exact app-server thread. Tap to switch the preferred destination for future requested work. An explicit instruction can select a different destination.")
            Text("The outlined button shows the selected destination; VoiceOver announces its name. Switching creates and sends nothing. Running tasks, saved drafts, queues and research supervision stay with their original owners. This preference belongs to this conversation on this Mac and survives navigation and reopening.")
              .font(.callout).foregroundStyle(ClawDadTheme.cream.opacity(0.8))
          }.accessibilityElement(children: .combine).accessibilityLabel("Work destination")
          entry("infinity", "Think aloud", "Holds the current speaking turn until you explicitly send it from Assistant messages. Tap again to return to automatic turn ending.",
            "A steady light, thicker outline and checkmark mean On; an unfilled thin outline means Off. VoiceOver announces On or Off. The setting stays the same across call views.")
          Text("Normal mode sends after \(assistant.automaticTurnInterval.formatted(.number.precision(.fractionLength(0...2)))) seconds without new transcribed words. Repeated text and background noise do not reset the timer. Pending transcription preserves the final words.")
            .font(.callout).accessibilityIdentifier("clawdad.glossary.turn-timing")
          entry("bubble.left.and.bubble.right.fill", "Assistant messages", "Opens the conversation, live transcription and chat Send button without ending the call.", "Available from the call bar outside the conversation.")
          entry("mic.fill", "Mute or unmute Assistant", "Toggles microphone capture while keeping the call connected. Muting preserves speech already captured so it can finish transcribing and send.", "A slashed microphone means capture is off or paused during a reply or transcription review. While reviewing, tapping it resumes listening and the turn. The status distinguishes these states; unmute is a manual action.")
          entry("stop.circle.fill", "Interject", "Stops the Assistant's spoken reply so you can speak again.", "Appears during reply playback. Ordinary background sound does not interrupt the reply.")
          entry("phone.down.fill", "End voice conversation", "Ends the call and microphone capture. The written conversation remains available.", "Red handset; available while a call is connecting or connected.")
        }
        section("Assistant chat") {
          entry("speaker.wave.2", "Read message aloud", "Reads that user or Assistant message with one selected voice from beginning to end. Starting another message stops the previous one. It sends no conversation turn.", "A selected stop icon marks the preparing or playing message. A play icon means paused: Resume speech continues the same voice and saved place after a failure; Stop ends playback. Playback temporarily blocks call microphone input and preserves manual mute and Think aloud.")
          entry("arrow.down", "Jump to latest message", "Returns to the newest message and resumes following incoming responses.", "Appears above the composer while you read older history, then fades when you reach the bottom. It does not send a message.")
          entry("pencil", "Edit transcription", "Holds the unsent voice turn and pauses microphone capture while you correct its text. Save edits keeps it held; use chat Send to submit, or Resume listening to continue the turn.", "Editing and Held are explicit states. Once you correct or save the displayed words, late transcription cannot replace them. A manually muted microphone stays off when resuming the turn.")
          entry("trash", "Clear transcription", "Asks Clear this transcription? Clear discards the entire unsent voice turn; Cancel keeps it held for review. Typed drafts, images and sent conversation history are preserved.", "Automatic submission pauses as soon as the prompt opens. Cleared speech and late transcription results cannot return. The call stays connected for a fresh turn.")
          entry("bubble.left.and.bubble.right", "Message Assistant", "Opens a text conversation. Starting a voice call is a separate action.", "Your unsent text and images are restored when you reopen the conversation.")
          entry("headphones", "Call Assistant", "Starts a voice conversation using your iPhone microphone and the paired Mac's speech settings.", "The persistent call bar appears during connection and stays available across views.")
          entry("arrow.up.circle.fill", "Send", "Sends typed text and attached images, including an image without a caption. When the composer is empty, it finishes a held voice turn, including while muted.", "Disabled when there is nothing to send or an image is importing. A spinner means sending. Typed drafts and a held voice turn stay separate.")
          entry("photo.badge.plus", "Attach image to Assistant", "Selects images for the chat message. Preview or remove them before sending.", "Selected images stay in the unsent draft until successful delivery or explicit removal.")
          entry("doc.on.doc", "Copy message", "Copies the complete text of the adjacent message.", "A checkmark and brief Copied confirmation mean the text reached the iPhone clipboard.")
          entry("trash", "Clear draft", "Asks before deleting the unsent typed draft and its images.", "Sent conversation history and other drafts are preserved.")
        }
        section("Remote Assist: Mac input") {
          entry("keyboard", "Keyboard", "Shows or hides the iPhone keyboard for input to the remotely controlled Mac.", "A downward keyboard chevron means Hide keyboard. Input is disabled when the connection or control state prevents it.")
          entry("mic.fill", "Dictate to Mac", "Records a phrase, then inserts its transcription into the remembered Mac input. If that input is unavailable, the text remains available for copying or pasting.", "A square means Stop recording. A spinner means processing; a circular arrow means Retry. This is separate from the Assistant call microphone.")
          entry("arrow.turn.down.left", "Enter on Mac", "Presses Enter in the current Mac input. This can submit an agent request or execute a shell command.", "Available when remote input is connected and allowed.")
          entry("doc.on.clipboard", "Paste to Mac", "Transfers and pastes the iPhone clipboard into the targeted Mac input. Supported clipboard images use the image-transfer path.", "Disabled while another clipboard or image operation is running, or input is unavailable.")
          entry("doc.on.doc", "Copy to iPhone", "Copies the Mac's selected text to the iPhone clipboard.", "Requires an unlocked Mac and permitted remote input.")
          entry("list.bullet", "Quick Chat presets", "Opens saved phrases and commands. Tapping a preset sends it immediately; editing a preset is a separate action.", "Uses the current targeted Mac input. Check the destination before sending.")
          entry("keyboard.badge.ellipsis", "Special keys", "Opens built-in keys, including Shift + Left Arrow, and your saved combinations. Tap Edit to change a key or add a label, key and modifiers. Save changes the button without sending it.", "Tap a key to send it once to the focused Mac input. Combinations may select, submit, interrupt or navigate. Custom combinations are stored on this iPhone; built-in entries can be restored to their defaults.")
        }
        section("Remote Assist: workspace") {
          entry("flask", "Research autonomy", "Opens per-thread research authorization, pause/off controls, steering, weekly allowance settings and decision history in Assistant Workspace.", "Off until explicitly enabled for an exact agent and objective. The shared stopping default starts at 20% weekly allowance remaining. A custom supervisor override lasts through the current weekly cycle. 0% allows using the remaining allowance until exhausted. Resets never clear a pause; running tasks stay intact. The main Assistant can also manage these settings on your explicit instruction.")
          entry("terminal", "Terminal tabs", "Opens the tab picker, grouped by physical window and ordered left to right. Tap a card to focus that exact tab.", "A checkmark marks the selected tab. Busy means its agent is working; a dot marks unread activity.")
          entry("line.3.horizontal", "Reorder Terminal tab", "Hold and drag the handle to move the tab within its window. Scrolling the card list remains separate.", "The picker and physical Terminal order update together after verification.")
          entry("trash", "Close Terminal tab", "Swipe a tab card to reveal Close. Follow any confirmation needed for a tab with running processes.", "The row is removed after the Mac confirms closure; an uncertain result keeps the tab visible.")
          entry("speaker.wave.2.fill", "Read aloud", "Reads highlighted text first, otherwise the latest completed response from the targeted Terminal tab. Uses your selected ClawDad voice.", "A square means Stop; a spinner means preparing. Playback can continue while navigating tabs.")
          entry("photo.badge.plus", "Photo to Terminal", "Chooses photos or image files to transfer to the Mac and attach to the remembered Terminal input.", "Transfer progress, pause or retry describe delivery. Saved images can be pasted when automatic attachment could not finish.")
          entry("folder.fill", "Files", "Opens local shared deliverables on the paired Mac. Download a file to preview, share or save it on your iPhone.", "The Mac must be available for transfer. Shared files use the Mac's local storage.")
          entry("display.2", "Displays", "Chooses which Mac display Remote Assist shows.", "Appears when multiple remote displays are available; input pauses while switching.")
          entry("arrow.down.right.and.arrow.up.left", "Fit screen", "Resets the Remote Assist viewport zoom.", "Appears when the viewport is zoomed.")
        }
        section("Navigation and recovery") {
          entry("ellipsis", "Remote Assist controls", "Expands the controls menu.", "A downward chevron collapses it.")
          entry("chevron.left", "Back", "Returns one level, such as from the tab picker to controls or from Assistant messages to the previous screen.", "Leaving Assistant messages preserves the call and unsent draft.")
          entry("arrow.clockwise", "Refresh or retry", "Refreshes the nearby inventory or retries the named failed operation.", "Read the accessible name and nearby recovery message to identify what will retry.")
          entry("xmark.circle", "End Remote Assist", "Closes the screen-control session.", "The Assistant call has its own red hang-up control.")
        }
      }.padding(18)
    }.background(ClawDadTheme.background).foregroundStyle(ClawDadTheme.cream)
      .navigationTitle("Icon glossary").clawDadInlineNavigationTitle()
      .accessibilityIdentifier("clawdad.settings.icon-glossary.content")
      #if os(iOS)
      .navigationBarBackButtonHidden(true)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button { dismiss() } label: { Label("Back", systemImage: "chevron.left") }
            .keyboardShortcut(.cancelAction).accessibilityIdentifier("clawdad.settings.icon-glossary.back")
        }
      }
  }

  private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(title).font(.headline).foregroundStyle(ClawDadTheme.gold).accessibilityAddTraits(.isHeader)
      content()
    }
  }
  private func entry(_ symbol: String, _ name: String, _ action: String, _ states: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 12) {
        Image(systemName: symbol).font(.system(size: 24)).frame(width: 44, height: 44).accessibilityHidden(true)
        Text(name).font(.headline)
      }
      Text(action)
      Text("States: \(states)").font(.callout).foregroundStyle(ClawDadTheme.cream.opacity(0.8))
    }.fixedSize(horizontal: false, vertical: true).accessibilityElement(children: .combine)
  }
}
