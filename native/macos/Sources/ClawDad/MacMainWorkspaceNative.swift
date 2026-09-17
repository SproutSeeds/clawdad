import AppKit
import ApplicationServices
import ClawDadRemoteAssistProtocol
import Foundation

/// Terminal can retain a closed Settings window as a missing-value scripting
/// entry. Bulk reads represent it as empty tab lists; dereferencing it fails.
/// Fence both window order and TTY membership around the independent name read.
enum MainWorkspaceTitleCensus {
  static let source="""
  with timeout of 3 seconds
  tell application "Terminal"
    set idsBefore to id of windows
    set ttysBefore to tty of tabs of windows
    set titlesByWindow to custom title of tabs of windows
    set ttysAfter to tty of tabs of windows
    set idsAfter to id of windows
    return {idsBefore, ttysBefore, titlesByWindow, ttysAfter, idsAfter}
  end tell
  end timeout
  """
  private static func invalid(_ reason:String) -> MacAssistantError {
    MacAssistantError("Terminal's window inventory \(reason). Refresh its remaining windows.")
  }
  private static func items(_ value:NSAppleEventDescriptor?) throws -> [NSAppleEventDescriptor] {
    guard let value,value.descriptorType==typeAEList,value.numberOfItems<=128 else { throw invalid("has an unsupported list") }
    return try (0..<value.numberOfItems).map { index in
      guard let item=value.atIndex(index+1) else { throw invalid("has an unreadable item") };return item
    }
  }
  private static func missing(_ value:NSAppleEventDescriptor) -> Bool {
    value.descriptorType==typeType && value.typeCodeValue==0x6d736e67 // AppleScript 'msng'
  }
  private static func windowIDs(_ value:NSAppleEventDescriptor?) throws -> [Int32?] {
    try items(value).map { item in
      if missing(item) { return nil }
      guard [typeSInt16,typeSInt32,typeSInt64,typeUInt32].contains(item.descriptorType),item.int32Value>0 else { throw invalid("has an unverified window identity") }
      return item.int32Value
    }
  }
  private static func strings(_ value:NSAppleEventDescriptor,allowMissing:Bool) throws -> [String] {
    try items(value).map { item in
      if allowMissing && missing(item) { return "" }
      guard let text=item.stringValue else { throw invalid("has an unreadable tab field") };return text
    }
  }
  static func rows(_ descriptor:NSAppleEventDescriptor) throws -> [(String,String)] {
    let groups=try items(descriptor)
    guard groups.count==5 else { throw invalid("has an unsupported response") }
    let before=try windowIDs(groups[0]),after=try windowIDs(groups[4])
    let ttysBefore=try items(groups[1]).map { try strings($0,allowMissing:false) }
    let names=try items(groups[2]).map { try strings($0,allowMissing:true) }
    let ttysAfter=try items(groups[3]).map { try strings($0,allowMissing:false) }
    guard before==after,ttysBefore==ttysAfter,before.count==ttysBefore.count,before.count==names.count else { throw invalid("changed during inspection") }
    var result:[(String,String)]=[]
    for index in before.indices {
      let ttys=ttysBefore[index],titles=names[index]
      guard ttys.count==titles.count else { throw invalid("has mismatched tab fields") }
      guard before[index] != nil || ttys.isEmpty else { throw invalid("contains tabs without a verified window") }
      for (tty,title) in zip(ttys,titles) {
        guard tty.range(of:#"^/dev/tty[A-Za-z0-9]+$"#,options:.regularExpression) != nil else { throw invalid("has an unverified Terminal device") }
        result.append((tty,title))
      }
    }
    guard result.count<=128 else { throw invalid("exceeds the supported tab count") }
    return result
  }
}

@MainActor final class MacMainWorkspaceNative: MainWorkspaceNative {
  private let tabs=MacTerminalTabController.shared
  private let controls=MacAssistantTerminalInput()
  private let interaction=MacAssistantInteractionGate.shared
  private let input=MacInputController()
  private let runtime: MacAssistantRuntime
  private let bindings=MainWorkspaceAgentBindings(file:FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ClawDad/MainTerminalWorkspace/verified-agent-bindings.json"))
  var retainedDraft: ((MacCodexInputBinding,String,MacAssistantForeground,String,UInt64)->String?)?
  var captureProgress: ((Int,Int) throws -> Void)?
  var diagnosticStep: ((String)->Void)?
  // Used only by the private, explicitly accepted account-window controller.
  // Ordinary snapshot/restore behavior and its canonical storage are unchanged.
  var accountCaptureGuard: ((MacCodexInputBinding,String,String?) throws -> String?)?
  var accountPermit: (() async throws -> Void)?
  var accountResumeCommand: ((MainWorkspaceEntry) throws -> String)?
  var accountClaim: ((String,String) async throws -> String)?
  var accountHistoryRoots: [URL] = []
  private func inputBinding(_ tty:String) async throws -> MacCodexInputBinding {
    let account=accountCaptureGuard != nil
    let value=try await Task.detached { () -> (MacCodexInputBinding,URL) in
      let reader=try account ? MacCodexAccountProcess.ownerReader(tty:tty):MacTerminalResponseReader()
      return (try reader.inputBinding(tty:tty),reader.sessionRoot)
    }.value
    if account,!accountHistoryRoots.contains(value.1) { accountHistoryRoots.append(value.1) }
    return value.0
  }
  private var exitedFullScreen:(tty:String,owner:String,ticket:UInt64)?
  private var closingWindow=false
  init(runtime: MacAssistantRuntime) { self.runtime=runtime }
  private func ensure() throws -> UInt64 {
    guard AXIsProcessTrusted(),!MacConsoleSessionState.isLocked() else { throw MacAssistantError("Unlock the Mac and allow Terminal control to restore this workspace.") }
    return try interaction.ticket()
  }
  private func shellDirectory(_ tty:String) async throws -> String {
    try await Task.detached {
      let reader=MacTerminalResponseReader()
      let rows=try reader.run("/bin/ps",["-t",String(tty.dropFirst(5)),"-o","pid=,pgid=,tpgid=,comm="])
        .split(separator:"\n").map{$0.split(whereSeparator:\.isWhitespace).map(String.init)}
      guard let shell=rows.first(where:{$0.count==4 && $0[1]==$0[2] && ["zsh","bash","sh","-zsh","-bash","-sh"].contains(URL(fileURLWithPath:$0[3]).lastPathComponent)}),
        rows.filter({$0.count==4 && $0[1]==$0[2]}).count==1 else { throw MacAssistantError("This tab is running an unsupported foreground program. Its input was preserved.") }
      let values=try reader.run("/usr/sbin/lsof",["-a","-p",shell[0],"-d","cwd","-Fn"])
        .split(separator:"\n").filter{$0.hasPrefix("n/")}
      guard values.count==1 else { throw MacAssistantError("The exact shell directory is unavailable.") }
      return String(values[0].dropFirst())
    }.value
  }
  private func focusedWindow() throws -> AXUIElement {
    guard let app=NSWorkspace.shared.frontmostApplication,app.bundleIdentifier=="com.apple.Terminal" else { throw MacAssistantError("Focus the intended Terminal window.") }
    var raw:CFTypeRef?
    guard AXUIElementCopyAttributeValue(AXUIElementCreateApplication(app.processIdentifier),kAXFocusedWindowAttribute as CFString,&raw) == .success,
      let raw,CFGetTypeID(raw)==AXUIElementGetTypeID() else { throw MacAssistantError("The Terminal window is unavailable.") }
    return unsafeBitCast(raw,to:AXUIElement.self)
  }
  private func focusedText() throws -> String {
    guard let app=NSWorkspace.shared.frontmostApplication,app.bundleIdentifier=="com.apple.Terminal" else { throw AssistantProtocolError.invalid }
    var raw:CFTypeRef?
    guard AXUIElementCopyAttributeValue(AXUIElementCreateApplication(app.processIdentifier),kAXFocusedUIElementAttribute as CFString,&raw) == .success,
      let raw,CFGetTypeID(raw)==AXUIElementGetTypeID() else { throw AssistantProtocolError.invalid }
    let element=unsafeBitCast(raw,to:AXUIElement.self);var role:CFTypeRef?,value:CFTypeRef?
    guard AXUIElementCopyAttributeValue(element,kAXRoleAttribute as CFString,&role) == .success,
      role as? String==kAXTextAreaRole as String,AXUIElementCopyAttributeValue(element,kAXValueAttribute as CFString,&value) == .success,
      let text=value as? String else { throw AssistantProtocolError.invalid }
    return MacAssistantComposerRendering.shared.normalized(String(text.suffix(24000)))
  }
  private func fullScreen() -> Bool {
    guard let window=try? focusedWindow() else { return false };var value:CFTypeRef?
    return AXUIElementCopyAttributeValue(window,"AXFullScreen" as CFString,&value) == .success && (value as? Bool)==true
  }
  // This informational quota notice can appear after an exhausted turn or when
  // resuming. Escape dismisses it without buying credits or sending a turn.
  // Match the complete native choice/footer, never mentioned text in a reply.
  nonisolated static func accountQuotaNotice(_ screen:String)->Bool {
    let lines=screen.components(separatedBy:.newlines).map{$0.trimmingCharacters(in:.whitespaces)}.filter{!$0.isEmpty}
    guard lines.last=="Press enter to confirm or esc to continue working",lines.count>=4 else { return false }
    return lines[lines.count-3]=="› 1. Add Credits" && lines[lines.count-2]=="2. Continue with Luna Reserve"
      && lines.contains("• Automatically switched to Luna Reserve low due to usage limits.")
  }
  private func dismissAccountQuotaNotice(_ screen:String,binding:MacCodexInputBinding,tabId:String,identity:String,ticket:UInt64) async throws -> String {
    guard accountCaptureGuard != nil,Self.accountQuotaNotice(screen) else { return screen }
    guard let path=binding.conversation?.path else { throw MacAssistantError("This quota notice has no exact saved conversation. Its window stays open.") }
    var activity=MacCodexRequestActivityLog()
    guard try !activity.read(path),let input,interaction.isCurrent(ticket),try await inputBinding(binding.tty)==binding,
      try await tabs.assistantVerifiedInputIdentity(tabID:tabId)==identity,
      Self.accountQuotaNotice(try focusedText()),let app=NSWorkspace.shared.frontmostApplication,app.bundleIdentifier=="com.apple.Terminal" else {
      throw MacAssistantError("The quota notice or its owner changed. No key was sent.")
    }
    try await accountPermit?()
    guard input.sendAssistantShortcut(.escape,targetPID:app.processIdentifier) else { throw MacAssistantError("The quota notice could not be dismissed. Its window stays open.") }
    diagnosticStep?("quota-notice-dismissed")
    for _ in 0..<20 {
      try await Task.sleep(for:.milliseconds(100))
      guard interaction.isCurrent(ticket),try await inputBinding(binding.tty)==binding,
        try await tabs.assistantVerifiedInputIdentity(tabID:tabId)==identity else { throw MacAssistantError("The input changed after dismissing the quota notice. Its window stays open.") }
      let value=try await MacAssistantComposerRendering.shared.read(ticket:ticket,raw:{try self.focusedText()})
      if !Self.accountQuotaNotice(value) { return value }
    }
    throw MacAssistantError("The quota notice is still visible. Dismiss it manually, then check recovery. No credits or work were requested.")
  }
  func closeWindow(_ expected:[MainWorkspaceLiveTab]) async throws {
    closingWindow=true
    do {
      try await closeMembers(expected)
      closingWindow=false;await endRestore()
    } catch {
      closingWindow=false;await endRestore();throw error
    }
  }
  private func closeMembers(_ expected:[MainWorkspaceLiveTab]) async throws {
    let ticket=try ensure()
    guard !expected.isEmpty else { throw AssistantProtocolError.invalid }
    // Close the verified original members right to left. Terminal's whole-window
    // shortcut can remove shell tabs before presenting a later process dialog;
    // single-tab commands retain the exact native target through each confirmation.
    var remaining=expected.sorted{$0.position<$1.position}
    while let original=remaining.last {
      try await accountPermit?()
      let fresh=try await inspectRemainingForClose(original,ticket:ticket)
      guard let anchor=fresh.tabs.first(where:{$0.tabId==fresh.anchorId}) else { throw AssistantProtocolError.invalid }
      let current=fresh.tabs.filter{$0.group==anchor.group}.sorted{$0.position<$1.position}
      guard MainTerminalWorkspace.sameWindow(remaining,current,drafts:accountCaptureGuard == nil),interaction.isCurrent(ticket),
        let target=current.first(where:{$0.tty==original.tty}) else {
        throw MacAssistantError("The remaining window's tabs, owners or input changed. Earlier closures are preserved; inspect before continuing.")
      }
      try await tabs.assistantCloseInspectedWindowTab(tabId:target.tabId) { [self] in
        guard interaction.isCurrent(ticket),
          try await Task.detached(operation:{try MacTerminalTitleMetadata.currentLifetime(original.tty)}).value==original.lifetime else {
          throw MacAssistantError("The tab owner changed during its close confirmation. Close was cancelled.")
        }
        if original.kind=="codex",original.historical != true {
          let agent=try await inputBinding(original.tty)
          guard agent.instanceId==original.owner,agent.conversation?.sessionId==original.sessionId,agent.directory==original.directory else {
            throw MacAssistantError("The agent changed during its close confirmation. Close was cancelled.")
          }
        } else {
          guard try await Task.detached(operation:{try MacAssistantForeground.read(tty:original.tty)}).value.identity==original.owner else {
            throw MacAssistantError("The shell changed during its close confirmation. Close was cancelled.")
          }
        }
      }
      // AX can temporarily omit a tab while a modal dialog is open. Require an
      // independent scripting census and ended login lifetime, never absence from AX.
      var ended=false
      for _ in 0..<20 {
        if try await areClosed([original]) { ended=true;break }
        try await Task.sleep(for:.milliseconds(100))
      }
      guard ended else { throw MacAssistantError("The original Terminal session is still present. Review its dialog or remaining tab; close will not repeat automatically.") }
      remaining.removeLast()
    }
  }
  private func inspectRemainingForClose(_ original:MainWorkspaceLiveTab,ticket:UInt64) async throws -> MainWorkspaceWindowSnapshot {
    // After one member closes, AppKit can invalidate the window/strip while it
    // selects the next member. Only re-observe/re-focus; never repeat a close.
    for attempt in 0..<4 {
      guard interaction.isCurrent(ticket) else { throw MacAssistantError("You changed Terminal during closing. Inspect its remaining tabs before continuing.") }
      do {
        _=try await tabs.catalog()
        guard let id=tabs.assistantIdentifier(tty:original.tty) else { throw MacAssistantError("A remaining tab is still being identified. Inspect the window before continuing.") }
        return try await snapshot(windowContaining:id)
      } catch {
        guard attempt<3,interaction.isCurrent(ticket) else { throw error }
        try await Task.sleep(for:.milliseconds(250*(attempt+1)))
      }
    }
    throw MacAssistantError("Terminal's remaining window has not settled. Earlier closures are preserved; no close will repeat automatically.")
  }
  func areClosed(_ expected:[MainWorkspaceLiveTab]) async throws -> Bool {
    let names=try await customTitles()
    for old in expected {
      guard !names.keys.contains(old.tty) else { return false }
      if let lifetime=try? await Task.detached(operation:{try MacTerminalTitleMetadata.currentLifetime(old.tty)}).value {
        guard let previous=old.lifetime,lifetime != previous else { return false }
      }
    }
    return true
  }
  private func customTitles() async throws -> [String:String] {
    for attempt in 0..<3 {
      do {
        return try await Task.detached {
          guard let script=NSAppleScript(source:MainWorkspaceTitleCensus.source) else { throw AssistantProtocolError.invalid }
          var failure:NSDictionary?
          let result=script.executeAndReturnError(&failure)
          if let failure {
            let code=failure["NSAppleScriptErrorNumber"] as? Int ?? 0
            if code == -1743 { throw MacAssistantError("Allow ClawDad to control Terminal in System Settings > Privacy & Security > Automation.") }
            throw MacAssistantError("Terminal's window inventory could not be read (automation \(code)). Refresh its remaining windows.")
          }
          return try Self.uniqueTitles(MainWorkspaceTitleCensus.rows(result))
        }.value
      } catch {
        guard attempt<2 else { throw error }
        // Re-read only. A census retry never repeats a native close or creation.
        try await Task.sleep(for:.milliseconds(100*(attempt+1)))
      }
    }
    throw AssistantProtocolError.invalid
  }
  nonisolated static func uniqueTitles(_ rows:[(String,String)]) throws -> [String:String] {
    var names:[String:String]=[:]
    for (tty,name) in rows {
      // Terminal can expose a tab through both its old and new scripting
      // windows during a Space transition. Identical TTY/name aliases are one
      // tab; conflicting names remain ambiguous. Physical grouping stays AX-owned.
      if let previous=names[tty],previous != name { throw MacAssistantError("Terminal tab names have ambiguous identities. Refresh before restoring.") }
      names[tty]=name
    }
    return names
  }
  private func activateForWorkspace() async throws {
    let ticket=try ensure()
    if NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Terminal").isEmpty {
      // Launch first, then discover macOS-restored windows before requesting
      // any new window. Never combine launch and creation in a blind retry.
      _=try await script("tell application \"Terminal\" to launch")
      try await Task.sleep(for:.milliseconds(750))
    }
    guard let app=NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Terminal").first else { throw MacAssistantError("Terminal is still starting. Retry after its windows appear.") }
    let pid=app.processIdentifier
    try await Self.verifyTerminalActivation(ready:{
      guard self.interaction.isCurrent(ticket) else { throw MacCodexInputFailure(code:"manual_input_changed",message:"You used the Mac while Terminal was being activated. Your work was preserved.") }
      guard !MacConsoleSessionState.isLocked() else { throw MacCodexInputFailure(code:"mac_locked",message:"Unlock the Mac before continuing this Terminal operation.") }
      guard AXIsProcessTrusted() else { throw MacCodexInputFailure(code:"accessibility_required",message:"Allow ClawDad in System Settings > Privacy & Security > Accessibility, then check recovery.") }
      guard NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Terminal").first?.processIdentifier==pid else {
        throw MacCodexInputFailure(code:"terminal_process_changed",message:"Terminal restarted during activation. Refresh its exact window before continuing.")
      }
      return NSWorkspace.shared.frontmostApplication?.processIdentifier==pid
    },request:{app.activate(options:[.activateIgnoringOtherApps])},fallback:{
      // Address the already verified process, so an exited Terminal cannot be
      // relaunched by a bundle-targeted fallback. Reuse existing AX permission.
      let terminal=AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(terminal,1)
      let result=AXUIElementSetAttributeValue(terminal,kAXFrontmostAttribute as CFString,kCFBooleanTrue)
      guard result == .success else {
        self.diagnosticStep?("terminal-activation-ax-error:\(result.rawValue)")
        throw MacCodexInputFailure(code:"terminal_activation_failed",message:"macOS could not bring Terminal forward. Your window and account were preserved. Bring Terminal forward on the Mac, then check recovery.")
      }
    },pause:{try await Task.sleep(for:.milliseconds(100))},diagnostic:self.diagnosticStep)
  }
  static func verifyTerminalActivation(ready:() throws -> Bool,request:()->Bool,
    fallback:() async throws -> Void,pause:() async throws -> Void,diagnostic:((String)->Void)?=nil) async throws {
    if try ready() { diagnostic?("terminal-already-foreground");return }
    let accepted=request();diagnostic?(accepted ? "terminal-activation-requested":"terminal-activation-rejected")
    // One supported activation fallback; never retry input, tab creation or
    // closure. Recheck lock, manual control and exact PID before every step.
    for attempt in 0..<30 {
      if try ready() { diagnostic?("terminal-foreground-verified");return }
      if attempt==(accepted ? 5:0) {
        diagnostic?("terminal-activation-fallback")
        try await fallback()
        if try ready() { diagnostic?("terminal-foreground-verified");return }
      }
      try await pause()
    }
    if try ready() { diagnostic?("terminal-foreground-verified");return }
    throw MacCodexInputFailure(code:"terminal_activation_unverified",message:"ClawDad could not bring Terminal to the foreground. Your window and account were preserved. Bring Terminal forward on the Mac, then check recovery.")
  }
  private func exposeFullScreen(entries:[MainWorkspaceEntry]?,savingTabId:String?) async throws {
    try await activateForWorkspace()
    guard fullScreen() else { return }
    let ticket=try ensure(),state=try await tabs.catalog()
    guard let id=state.selectedTabId,let selected=tabs.assistantSnapshot(tabID:id),!selected.tty.isEmpty else { throw MacAssistantError("Show the Main Terminal window and retry so its full-screen identity can be verified.") }
    let owner=try await Task.detached{try MacAssistantForeground.read(tty:selected.tty)}.value
    if let savingTabId {
      guard savingTabId==id || tabs.assistantSnapshot(tabID:savingTabId)?.groupID==selected.groupID else { throw MacAssistantError("Choose the visible full-screen window or leave full screen before inspecting another window.") }
    } else {
      let agent=try? await Task.detached{try MacTerminalResponseReader().inputBinding(tty:selected.tty)}.value
      guard entries?.contains(where:{entry in
        if let session=entry.sessionId { return session==agent?.conversation?.sessionId && entry.directory==agent?.directory }
        return entry.binding?.tty==selected.tty && entry.binding?.owner==owner.identity
      })==true else { throw MacAssistantError("An unrelated Terminal window is full screen. Leave full screen or show the saved Main window before restoring; hidden tabs will not be recreated.") }
    }
    guard interaction.isCurrent(ticket),AXUIElementSetAttributeValue(try focusedWindow(),"AXFullScreen" as CFString,kCFBooleanFalse) == .success else { throw MacAssistantError("Leave full screen to expose the Main window's tabs, then retry.") }
    exitedFullScreen=(selected.tty,owner.identity,ticket)
    // macOS reports AXFullScreen=false before its Space transition has exposed
    // the other windows. Require a complete native/scripting count to settle.
    for _ in 0..<40 {
      try await Task.sleep(for:.milliseconds(100))
      guard interaction.isCurrent(ticket) else { throw MacAssistantError("You changed Terminal during its full-screen transition. Retry when ready.") }
      if let names=try? await customTitles(),!fullScreen(),(try? await tabs.catalog())?.tabs.count==names.count { return }
    }
    throw MacAssistantError("Terminal's other windows are still hidden by macOS. Show them or leave full screen, then retry; no missing tabs were created.")
  }
  func beginRestore(entries:[MainWorkspaceEntry]) async throws { try await exposeFullScreen(entries:entries,savingTabId:nil) }
  func endRestore() async {
    guard let prior=exitedFullScreen else { return };exitedFullScreen=nil
    guard interaction.isCurrent(prior.ticket),
      (try? await Task.detached{try MacAssistantForeground.read(tty:prior.tty)}.value)?.identity==prior.owner,
      let state=try? await tabs.catalog(),let selected=state.selectedTabId,
      let original=tabs.assistantIdentifier(tty:prior.tty),
      tabs.assistantSnapshot(tabID:original)?.groupID==tabs.assistantSnapshot(tabID:selected)?.groupID,
      let window=try? focusedWindow() else { return }
    _=AXUIElementSetAttributeValue(window,"AXFullScreen" as CFString,kCFBooleanTrue)
  }
  func snapshot(windowContaining tabId:String) async throws -> MainWorkspaceWindowSnapshot {
    do {
      diagnosticStep?("snapshot-activate")
      try await exposeFullScreen(entries:nil,savingTabId:tabId)
      let original=exitedFullScreen
      var anchor=tabId
      if let original {
        let identified=try await inventory(captureDrafts:true)
        guard let current=identified.first(where:{$0.tty==original.tty}) else { throw MacAssistantError("The selected Main tab changed during inspection.") };anchor=current.tabId
      }
      diagnosticStep?("snapshot-catalog")
      _=try await tabs.catalog()
      guard let group=tabs.assistantSnapshot(tabID:anchor)?.groupID else { throw MacAssistantError("The chosen Main window changed. Refresh and choose it again.") }
      diagnosticStep?("snapshot-inventory")
      var captured=try await inventory(captureDrafts:true,captureGroup:group)
      if original != nil { for i in captured.indices where captured[i].group==String(group) { captured[i].fullScreen=true } }
      if !closingWindow { await endRestore() }
      return MainWorkspaceWindowSnapshot(anchorId:anchor,tabs:captured)
    } catch { if !closingWindow { await endRestore() };throw error }
  }
  func inventory(captureDrafts: Bool) async throws -> [MainWorkspaceLiveTab] {
    try await inventory(captureDrafts:captureDrafts,captureGroup:nil)
  }
  func windowChoices(observations:[MainWorkspaceLiveTab]) async throws -> [MainWorkspaceWindowChoice] {
    let catalog=try await tabs.catalog()
    var groups:[Int]=[],members:[Int:[MainWorkspaceWindowMember]]=[:]
    for descriptor in catalog.tabs {
      guard let snapshot=tabs.assistantSnapshot(tabID:descriptor.id) else {
        throw MacAssistantError("Terminal's window list changed during inspection. Refresh its windows.")
      }
      if members[snapshot.groupID]==nil { groups.append(snapshot.groupID);members[snapshot.groupID]=[] }
      let known=observations.first{$0.tabId==descriptor.id && !snapshot.tty.isEmpty && $0.tty==snapshot.tty}
      members[snapshot.groupID]!.append(MainWorkspaceWindowMember(tabId:descriptor.id,name:known?.name ?? descriptor.title,
        directory:known?.directory,kind:known?.kind,sessionId:known?.sessionId,identityIssue:known?.identityIssue))
    }
    // Catalog rows are native left-to-right controls, even before process/TTY
    // association. Explicit Save (or optional inspection) visits inputs and binds owners.
    return try groups.enumerated().map { index,group in
      let rows=members[group]!
      return MainWorkspaceWindowChoice(id:try MainTerminalWorkspace.windowChoiceId(tabIds:rows.map(\.tabId)),
        tabId:rows[0].tabId,title:"Terminal window \(index+1)",count:rows.count,tabs:rows)
    }
  }
  private func focusForSnapshot(_ id:String,ticket:UInt64) async throws {
    for attempt in 0..<3 {
      guard interaction.isCurrent(ticket) else { throw MacAssistantError("You changed Terminal during the snapshot. Save again when ready.") }
      let current=try await tabs.catalog()
      guard current.tabs.contains(where:{$0.id==id}) else { throw MacAssistantError("The tab identity changed. Refresh before saving.") }
      if current.selectedTabId==id,NSWorkspace.shared.frontmostApplication?.bundleIdentifier=="com.apple.Terminal" { return }
      do { _=try await tabs.focus(tabID:id,expectedRevision:current.revision);return }
      catch let failure as MacTerminalTabFailure where attempt<2 && ["focus_failed","layout_unavailable"].contains(failure.code) {
        // Retry selection only, never creation or input. Native AX focus may
        // settle after the first acknowledgement when another window is raised.
        try await Task.sleep(for:.milliseconds(250))
      }
    }
  }
  private func inventory(captureDrafts: Bool,captureGroup:Int?) async throws -> [MainWorkspaceLiveTab] {
    let initial=try await tabs.catalog();var output:[MainWorkspaceLiveTab]=[]
    diagnosticStep?("inventory-titles")
    let names=NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Terminal").isEmpty ? [:] : try await customTitles()
    diagnosticStep?("inventory-receipts")
    guard !captureDrafts || initial.tabs.count==names.count else { throw MacAssistantError("Some Terminal tabs are hidden by macOS. Show their windows or leave full screen and retry. The saved roster and hidden tabs were preserved.") }
    let jobsURL=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ClawDad/Assistant/state.json")
    let jobState=(try? Data(contentsOf:jobsURL)).flatMap{try? JSONDecoder().decode([String:AssistantValue].self,from:$0)}
    if accountCaptureGuard != nil,jobState?["jobs"]?.array==nil {
      throw MacAssistantError("The delivery receipt history could not be read. Nothing was closed; check recovery after it is available.")
    }
    let jobs=(jobState?["jobs"]?.array ?? []).compactMap(\.object)
    let pending=jobs.filter { row in
      ["agent_queued","submitted","attention","queued"].contains(row["status"]?.string ?? "") && (row["action"]?.string?.hasPrefix("terminal.") ?? false)
    }
    let selected=initial.selectedTabId
    let selections=Dictionary(uniqueKeysWithValues:initial.tabs.map{($0.id,tabs.assistantSnapshot(tabID:$0.id)?.isSelectedInWindow ?? $0.isSelected)})
    let ticket=captureDrafts ? try ensure() : nil
    let capturing=initial.tabs.filter { captureDrafts && (captureGroup==nil || tabs.assistantSnapshot(tabID:$0.id)?.groupID==captureGroup) }
    var captureIndex=0,owners:[String:String]=[:],lifetimes:[String:String]=[:]
    do {
      for descriptor in initial.tabs {
        let snapshot=tabs.assistantSnapshot(tabID:descriptor.id)
        let requiresIdentity=captureDrafts && (captureGroup==nil || snapshot?.groupID==captureGroup)
        // Save explicitly captures every draft in its chosen window. Restore
        // only needs to visit unbound tabs; known live inputs remain untouched.
        let shouldCapture=requiresIdentity && (captureGroup != nil || snapshot?.tty.isEmpty != false)
        if let ticket,shouldCapture {
          diagnosticStep?("inventory-focus")
          captureIndex += 1;try captureProgress?(captureIndex,capturing.count)
          guard interaction.isCurrent(ticket) else { throw MacAssistantError("You changed Terminal during the snapshot. Your input was preserved; save again when ready.") }
          do {
            try await focusForSnapshot(descriptor.id,ticket:ticket)
          } catch {
            throw MacAssistantError("Could not inspect \(descriptor.detail): \(error.localizedDescription) The saved roster was preserved.")
          }
        }
        guard let tab=tabs.assistantSnapshot(tabID:descriptor.id),!tab.tty.isEmpty else {
          if requiresIdentity { throw MacAssistantError("\(descriptor.detail) is still being identified. Refresh and try again.") };continue
        }
        let owner=try? await Task.detached{try MacAssistantForeground.read(tty:tab.tty)}.value
        guard let owner else { if requiresIdentity { throw MacAssistantError("\(descriptor.detail)'s foreground process could not be identified. Complete startup before saving.") };continue }
        let lifetime=try? await Task.detached{try MacTerminalTitleMetadata.currentLifetime(tab.tty)}.value
        if requiresIdentity { owners[tab.tty]=owner.identity;lifetimes[tab.tty]=lifetime }
        var bindingIssue:String?
        let agent:MacCodexInputBinding?
        diagnosticStep?("inventory-binding")
        do { agent=try await inputBinding(tab.tty) }
        catch { agent=nil;if owner.shell==nil { bindingIssue=error.localizedDescription } }
        var directory: String
        if let agent { directory=agent.directory } else { directory=(try? await shellDirectory(tab.tty)) ?? "" }
        var draft:MainWorkspaceDraft?
        var screen:String?
        let focused = shouldCapture || (!captureDrafts && selected==descriptor.id)
        let expectedIdentity=focused ? try? await tabs.inputIdentity():nil
        if focused,NSWorkspace.shared.frontmostApplication?.bundleIdentifier=="com.apple.Terminal",
          let expectedIdentity,(try? await tabs.catalog())?.selectedTabId==descriptor.id,
          let readTicket=try? interaction.ticket(),
          let rawValue=try? await MacAssistantComposerRendering.shared.read(ticket:readTicket,raw:{ try self.focusedText() }),
          interaction.isCurrent(readTicket),(try? await tabs.inputIdentity())==expectedIdentity,
          (try? await tabs.catalog())?.selectedTabId==descriptor.id {
          var value=rawValue
          if let agent,requiresIdentity { value=try await dismissAccountQuotaNotice(value,binding:agent,tabId:descriptor.id,identity:expectedIdentity,ticket:readTicket) }
          screen=value
          let observation=agent != nil ? assistantObserveDraft(value,viewportRows:assistantTerminalRows(tab.tty)) : nil
          let known=agent.flatMap{retainedDraft?($0,expectedIdentity,owner,value,readTicket)}
          var text=observation?.requiresWholeDraftAuthorization==true ? known : observation?.text ?? (owner.shell != nil ? MacAssistantShellDraft.read(value)?.text:nil)
          if let agent,requiresIdentity,let validate=accountCaptureGuard { text=try validate(agent,value,known) }
          let offset=agent?.conversation.flatMap{try? MacAssistantSubmissionLog.capture($0.path).offset}
          draft=MainWorkspaceDraft(text:text,limitation:text==nil ? (observation?.reason ?? "This input cannot be recovered automatically."):nil,capturedAt:Date(),transcriptOffset:offset)
        }
        if requiresIdentity,agent != nil,accountCaptureGuard != nil,screen==nil {
          throw MacAssistantError("\(descriptor.title): its native queue could not be inspected. Show that tab before retrying; unsent drafts themselves do not block switching.")
        }
        var historical:MainWorkspaceAgentBindings.Record?
        diagnosticStep?("inventory-history")
        if let agent,let conversation=agent.conversation,let lifetime {
          try bindings.remember(.init(tty:tab.tty,lifetime:lifetime,process:agent.instanceId,directory:agent.directory,
            sessionId:conversation.sessionId,path:conversation.path.path,executable:agent.executable))
        } else if agent==nil,owner.shell != nil,let lifetime,let screen,
          let previous=bindings.exited(tty:tab.tty,lifetime:lifetime,screen:screen),
          (try? MacCodexConversation.load(path:URL(fileURLWithPath:previous.path),sessionRoot:MacTerminalResponseReader().sessionRoot))?.sessionId==previous.sessionId {
          historical=previous;directory=previous.directory
          draft=MainWorkspaceDraft(text:"",capturedAt:Date(),transcriptOffset:(try? MacAssistantSubmissionLog.capture(URL(fileURLWithPath:previous.path)).offset))
        }
        if agent==nil,historical==nil,owner.shell != nil,let lifetime,
          let known=bindings.known(tty:tab.tty,lifetime:lifetime) {
          bindingIssue="Codex previously owned this same live tab, but its final exit receipt cannot be verified. Resume exact conversation \(known.sessionId) or show its native exit receipt before saving. Its known project will not be replaced by the shell directory."
        }
        if agent != nil && agent?.conversation==nil { bindingIssue="Codex is fresh and has not persisted a resumable conversation. Finish your first intended turn, then save this window." }
        if requiresIdentity,lifetime==nil { bindingIssue="This tab's login lifetime could not be verified. Refresh before saving." }
        let config=(agent?.conversation?.path ?? historical.map{URL(fileURLWithPath:$0.path)}).flatMap{Self.resumeConfiguration($0)}
        var receiptIds:[String]=[],retainedReceiptIds:[String]?
        if let conversation=agent?.conversation {
          if accountCaptureGuard != nil {
            let receipts=AccountWindowReceiptEvidence.collect(jobs,sessionId:conversation.sessionId,tabId:descriptor.id)
            receiptIds=receipts.pending;retainedReceiptIds=receipts.retained
          } else {
            for row in pending {
              let target=row["sessionId"]?.string ?? row["args"]?.object?["sessionId"]?.string
              if target==conversation.sessionId,let id=row["id"]?.string { receiptIds.append(id) }
            }
          }
        }
        output.append(MainWorkspaceLiveTab(tabId:descriptor.id,group:String(tab.groupID),tty:tab.tty,owner:agent?.instanceId ?? owner.identity,
          directory:directory,kind:agent != nil || historical != nil ? "codex":owner.shell != nil ? "shell":"unsupported",sessionId:agent?.conversation?.sessionId ?? historical?.sessionId,
          conversationPath:agent?.conversation?.path.path ?? historical?.path,executable:agent?.executable ?? historical?.executable,name:MacTerminalProjectTitles.shared.explicitName(tty: tab.tty) ?? (names[tab.tty]?.hasPrefix("ClawDad Restore ")==true ? names[tab.tty]! : (tab.generatedTitle && !directory.isEmpty ? URL(fileURLWithPath: directory).lastPathComponent : descriptor.title)),
          position:tab.position,selected:selections[descriptor.id] ?? false,fullScreen:focused ? fullScreen():false,draft:draft,model:config?.model,effort:config?.effort,pendingReceipts:receiptIds,nameIsExplicit:MacTerminalProjectTitles.shared.explicitName(tty: tab.tty) != nil,
          lifetime:lifetime,identityIssue:bindingIssue,historical:historical != nil,isBusy:descriptor.isBusy,retainedReceipts:retainedReceiptIds))
      }
      if let ticket,captureGroup != nil {
        // One full pass, then checks that need no tab switching. User input
        // invalidates the capture; process/login changes cannot rebind a draft.
        guard interaction.isCurrent(ticket) else { throw MacAssistantError("You changed Terminal during saving. Your input and previous setup were preserved; save again when ready.") }
        for tab in output where tab.group==String(captureGroup!) {
          let current=try? await Task.detached { try MacAssistantForeground.read(tty:tab.tty) }.value
          let lifetime=try? await Task.detached { try MacTerminalTitleMetadata.currentLifetime(tab.tty) }.value
          guard current?.identity==owners[tab.tty],lifetime==lifetimes[tab.tty],lifetime != nil else {
            throw MacAssistantError("\(tab.name)'s process changed during saving. Its input and previous setup were preserved; save again after startup or exit finishes.")
          }
        }
        guard interaction.isCurrent(ticket) else { throw MacAssistantError("You changed Terminal during saving. Your input and previous setup were preserved; save again when ready.") }
      }
    } catch {
      if let ticket,interaction.isCurrent(ticket),let selected,let state=try? await tabs.catalog() { _=try? await tabs.focus(tabID:selected,expectedRevision:state.revision) }
      throw error
    }
    if let ticket,interaction.isCurrent(ticket),let selected,let state=try? await tabs.catalog() { _=try? await tabs.focus(tabID:selected,expectedRevision:state.revision) }
    return output
  }
  func checkDirectory(_ entry:MainWorkspaceEntry) throws {
    guard entry.directory.hasPrefix("/"),!entry.directory.contains("\0") else { throw MacAssistantError("The saved directory is invalid; review the roster.") }
    var directory:ObjCBool=false
    guard FileManager.default.fileExists(atPath:entry.directory,isDirectory:&directory),directory.boolValue else {
      throw MacAssistantError("Waiting for \(entry.directory). Mount its drive or restore the exact directory, then retry.")
    }
    guard ["shell","codex"].contains(entry.kind) else { throw MacAssistantError("This foreground program cannot be restored automatically. Its commands were not replayed.") }
    if entry.kind=="codex" {
      guard let id=entry.sessionId,UUID(uuidString:id) != nil,let path=entry.conversationPath,
        FileManager.default.fileExists(atPath:path),let executable=entry.executable,FileManager.default.isExecutableFile(atPath:executable) else {
        throw MacAssistantError("The saved Codex conversation or executable is unavailable. Restore that session or save its current identified tab; no substitute conversation was started.")
      }
      let roots=accountCaptureGuard == nil ? [MacTerminalResponseReader().sessionRoot]:accountHistoryRoots+[MacTerminalResponseReader().sessionRoot]
      let verified=roots.contains { root in
        guard case .conversation(let session)=try? MacCodexConversation.metadata(path:URL(fileURLWithPath:path),sessionRoot:root,
          acceptedSources:accountCaptureGuard == nil ? ["cli"]:["cli","vscode"]) else { return false }
        return session.sessionId==id
      }
      guard verified else {
        throw MacAssistantError("The saved transcript header does not verify this exact CLI conversation. If it was archived, restore its original history first; no replacement conversation was started.")
      }
      let help=try MacTerminalResponseReader().run(executable,["resume","--help"])
      guard help.contains("SESSION_ID"),help.contains("--cd") else {
        throw MacAssistantError("This saved Codex executable does not expose verified resume-by-session and directory options. Update or restore the original compatible executable; the conversation was not replaced.")
      }
    }
  }
  static func quoted(_ text:String)->String { "'"+text.replacingOccurrences(of:"'",with:"'\\''")+"'" }
  nonisolated static func resumeConfiguration(_ path:URL)->(model:String,effort:String?)? {
    guard let handle=try? FileHandle(forReadingFrom:path) else { return nil };defer{try? handle.close()}
    guard let end=try? handle.seekToEnd() else { return nil }
    // Research turns can produce many megabytes after their turn_context. Walk
    // backward with bounded memory and skip large tool records instead of
    // treating a one-megabyte tail as proof that model settings are absent.
    var offset=end,partial=Data(),discarding=false
    while offset>0 {
      let count=Int(min(offset,256*1024));offset-=UInt64(count)
      guard (try? handle.seek(toOffset:offset)) != nil,let data=try? handle.read(upToCount:count) else { return nil }
      var lines=Array(data+partial).split(separator:UInt8(10),omittingEmptySubsequences:false).map { Data($0) }
      partial=lines.isEmpty ? Data():lines.removeFirst()
      if discarding,!lines.isEmpty { lines.removeLast();discarding=false }
      if partial.count>2*1024*1024 { partial.removeAll();discarding=true }
      if offset==0,!discarding { lines.insert(partial,at:0) }
      for line in lines.reversed() where line.count<=2*1024*1024 && line.range(of:Data("\"turn_context\"".utf8)) != nil {
        guard let row=try? JSONSerialization.jsonObject(with:line) as? [String:Any],row["type"] as? String=="turn_context",
          let p=row["payload"] as? [String:Any],let model=p["model"] as? String,!model.isEmpty,model.utf8.count<128 else { continue }
        let effort=p["effort"] as? String
        return (model,effort?.range(of:#"^[a-z_]{1,24}$"#,options:String.CompareOptions.regularExpression) != nil ? effort:nil)
      }
    }
    return nil
  }
  static func appleString(_ text:String)->String { "\""+text.replacingOccurrences(of:"\\",with:"\\\\").replacingOccurrences(of:"\"",with:"\\\"").replacingOccurrences(of:"\n",with:"\\n")+"\"" }
  private func script(_ source:String) async throws -> String {
    try await Task.detached { try MacTerminalResponseReader().run("/usr/bin/osascript",["-e",source]).trimmingCharacters(in:.whitespacesAndNewlines) }.value
  }
  private func title(_ value:String,tty:String) async throws {
    guard tty.range(of:#"^/dev/tty[A-Za-z0-9]+$"#,options:.regularExpression) != nil else { throw AssistantProtocolError.invalid }
    let result=try await script(Self.titleScript(value,tty:tty))
    guard result==value else { throw MacAssistantError("The saved tab name could not be verified.") }
  }
  static func titleScript(_ value:String,tty:String)->String {
    // Terminal keeps a missing-value scripting window after its Settings panel
    // closes. Enumerate verified window IDs, as in the read-only census, before
    // locating the unique TTY. A real window/tab read failure still aborts.
    "tell application \"Terminal\"\nset matches to {}\nset windowIds to id of windows\nrepeat with windowId in windowIds\nif (contents of windowId) is not missing value then\nset w to window id (contents of windowId)\nrepeat with t in tabs of w\nif tty of t is \(Self.appleString(tty)) then set end of matches to t\nend repeat\nend if\nend repeat\nif (count matches) is not 1 then error \"Target changed\"\nset t to item 1 of matches\nset custom title of t to \(Self.appleString(value))\nreturn custom title of t\nend tell"
  }
  func create(marker:String,anchor:MainWorkspaceLiveTab?) async throws -> MainWorkspaceLiveTab {
    let ticket=try ensure();let before=try await inventory(captureDrafts:false)
    // AX inventory may omit cold, unbound controls. Terminal's scripting TTY
    // census is complete without visiting them; discovering an old tab after
    // creation must not count it as a second newly created tab.
    let physical=try await tabs.assistantAccountShells().map(\.tty)
    let existingTTYs=Set(physical)
    guard existingTTYs.count==physical.count,physical.allSatisfy({!$0.isEmpty}),interaction.isCurrent(ticket) else {
      throw MacAssistantError("The physical Terminal tab inventory changed before creation. Refresh; no tab was created.")
    }
    let tty:String
    if let anchor {
      let state=try await tabs.catalog()
      guard before.contains(where:{$0.owner==anchor.owner && $0.tty==anchor.tty}),interaction.isCurrent(ticket) else { throw MacAssistantError("The Main window anchor changed; inspect it before restoring.") }
      let (created,_)=try await tabs.createTab(anchorId:anchor.tabId,expectedRevision:state.revision)
      guard let snapshot=tabs.assistantSnapshot(tabID:created.id) else { throw MacAssistantError("The new tab needs identity reconciliation.") };tty=snapshot.tty
      try await title(marker,tty:tty)
    } else {
      tty=try await script("tell application \"Terminal\"\nlaunch\nset t to do script \"\"\nset custom title of t to \(Self.appleString(marker))\nactivate\nreturn tty of t\nend tell")
    }
    var after=try await inventory(captureDrafts:false)
    let observedTTYs=Set(try await tabs.assistantAccountShells().map(\.tty))
    if (try? Self.verifiedCreation(before:before,after:after,tty:tty,marker:marker,anchor:anchor,existingTTYs:existingTTYs,observedTTYs:observedTTYs))==nil {
      // New Tab and its marker title can replace native AX controls, leaving
      // the old standalone tab temporarily unbound. Re-identify those controls
      // by native focus/readback; never request another tab to repair visibility.
      after=try await inventory(captureDrafts:true)
    }
    guard interaction.isCurrent(ticket) else { throw MacAssistantError("Terminal input changed during creation. Inspect its saved receipt; no second tab will be created.") }
    return try Self.verifiedCreation(before:before,after:after,tty:tty,marker:marker,anchor:anchor,existingTTYs:existingTTYs,observedTTYs:Set(try await tabs.assistantAccountShells().map(\.tty)))
  }
  static func verifiedCreation(before:[MainWorkspaceLiveTab],after:[MainWorkspaceLiveTab],tty:String,marker:String,anchor:MainWorkspaceLiveTab?,existingTTYs:Set<String>?=nil,observedTTYs:Set<String>?=nil) throws -> MainWorkspaceLiveTab {
    let prior=existingTTYs ?? Set(before.map(\.tty))
    let additions=after.filter{!prior.contains($0.tty)}
    guard additions.count==1,let created=additions.first,created.tty==tty,created.name==marker,
      observedTTYs==nil || observedTTYs!.subtracting(prior)==[tty] else {
      throw MacAssistantError("Creation was requested once, but the new tab's exact TTY and restore marker are not uniquely visible. Reinspect this receipt; another tab will not be created.")
    }
    if let anchor {
      guard let current=after.first(where:{$0.tty==anchor.tty && $0.owner==anchor.owner && $0.lifetime==anchor.lifetime}),current.group==created.group else {
        throw MacAssistantError("The new tab exists, but its original window anchor is still unbound or changed. Refresh to reconcile its identity; no second tab will be created.")
      }
    }
    guard prior.isSubset(of:observedTTYs ?? Set(after.map(\.tty))) else {
      throw MacAssistantError("The new tab exists, but Terminal temporarily omitted an original tab. Reinspect to reconcile the complete window; creation will not repeat.")
    }
    return created
  }
  func configure(_ tab:MainWorkspaceLiveTab,entry:MainWorkspaceEntry,requestId:String,allowLaunch:Bool) async throws -> MainWorkspaceLiveTab {
    let ticket=try ensure();let state=try await tabs.catalog()
    _=try await tabs.focus(tabID:tab.tabId,expectedRevision:state.revision)
    if let agent=try? await inputBinding(tab.tty) {
      guard agent.conversation?.sessionId==entry.sessionId,agent.directory==entry.directory else { throw MacAssistantError("The pending tab owns another conversation. It was preserved.") }
      return try await verified(tab,entry:entry)
    }
    guard let input else { throw MacAssistantError("Native Terminal input is unavailable.") }
    let inspected=try await controls.inspect(tabId:tab.tabId,input:input,ticket:ticket)
    guard inspected["kind"]?.string=="shell",inspected["inputSessionId"]?.string==tab.owner,
      inspected["draftText"]?.string=="" else { throw MacAssistantError("The restore tab has an input draft or changed process. Review it; nothing was submitted.") }
    if entry.kind=="shell",try await shellDirectory(tab.tty)==entry.directory { return try await verified(tab,entry:entry) }
    guard allowLaunch else { throw MacAssistantError("A previous launch has uncertain delivery. Complete its visible startup or inspect the pending launch draft. ClawDad will not press Enter again automatically.") }
    var lease:String?
    if let session=entry.sessionId {
      if let accountClaim { lease=try await accountClaim(requestId,session) }
      else {
        let receipt=try await runtime.json("/v1/assistant/main-workspace/claim",["id":.string(requestId),"sessionId":.string(session)])
        guard receipt["allowed"]?.bool==true,let token=receipt["token"]?.string else { throw MacAssistantError("The saved thread's live ownership could not be verified.") };lease=token
      }
    }
    do {
      let latest=entry.conversationPath.flatMap{Self.resumeConfiguration(URL(fileURLWithPath:$0))}
      let settings=((latest?.model ?? entry.model).map{" --model \(Self.quoted($0))"} ?? "") + ((latest?.effort ?? entry.effort).map{" -c \(Self.quoted("model_reasoning_effort=\"\($0)\""))"} ?? "")
      let command=try accountResumeCommand?(entry) ?? ("cd -- \(Self.quoted(entry.directory))" + (entry.kind=="codex" ? " && \(Self.quoted(entry.executable!)) resume \(Self.quoted(entry.sessionId!)) --cd \(Self.quoted(entry.directory))\(settings)\(MacTerminalProjectLaunch.titleOptions)":""))
      var target:[String:AssistantValue]=["tabId":.string(tab.tabId),"inputToken":inspected["inputToken"]!,"inputSessionId":inspected["inputSessionId"]!,"mode":.string("insert"),"expectedText":.string(""),"text":.string(command)]
      _=try await controls.execute("terminal.native.type",args:target,input:input)
      let fresh=try await controls.inspect(tabId:tab.tabId,input:input,ticket:ticket)
      guard fresh["draftText"]?.string==command,interaction.isCurrent(ticket) else { throw MacAssistantError("The launch draft changed. It was preserved.") }
      target=["tabId":.string(tab.tabId),"inputToken":fresh["inputToken"]!,"inputSessionId":fresh["inputSessionId"]!,"key":.string("enter"),"intent":.string("submit")]
      if let lease { _=try await runtime.json("/v1/assistant/main-workspace/check",["token":.string(lease)]) }
      try await accountPermit?()
      _=try await controls.execute("terminal.key",args:target,input:input)
      var result:MainWorkspaceLiveTab?
      for _ in 0..<30 {
        if let ready=try? await verified(tab,entry:entry) { result=ready;break }
        try await Task.sleep(for:.milliseconds(300))
      }
      guard let result else { throw MacAssistantError("Resume was requested once. Finish any Terminal trust or startup prompt, then retry to verify the exact conversation. No message was submitted to the agent.") }
      if let lease { _=try? await runtime.json("/v1/assistant/main-workspace/release",["token":.string(lease)]) }
      return result
    } catch {
      if let lease { _=try? await runtime.json("/v1/assistant/main-workspace/release",["token":.string(lease)]) }
      throw error
    }
  }
  private func identifiedInventory(for originals:[MainWorkspaceLiveTab]) async throws -> [MainWorkspaceLiveTab] {
    let live=try await inventory(captureDrafts:false)
    // Title changes and native reordering can replace AX controls and invalidate
    // cached TTY bindings. Re-observe unbound controls before declaring a saved
    // process missing. This selects for inspection only; it never sends input.
    if originals.contains(where:{original in !live.contains(where:{$0.tty==original.tty})}) {
      return try await inventory(captureDrafts:true)
    }
    return live
  }
  static func verifiedIdentity(_ original:MainWorkspaceLiveTab,entry:MainWorkspaceEntry,live:[MainWorkspaceLiveTab]) throws -> MainWorkspaceLiveTab {
    let matches=live.filter{$0.tty==original.tty}
    guard matches.count==1,let tab=matches.first else { throw MacAssistantError("The restored tab's native identity is not available yet. Refresh Terminal and retry; no input was sent.") }
    guard tab.directory==entry.directory,tab.kind==entry.kind else { throw MacAssistantError("The restored tab has not reached its exact saved directory and input type. Complete any startup prompt, then retry.") }
    guard original.kind != entry.kind || original.owner==tab.owner else { throw MacAssistantError("The restored tab's process changed. Review its current identity before recovering a draft.") }
    guard entry.kind=="shell" || (tab.sessionId==entry.sessionId && entry.sessionId != nil && live.filter({$0.sessionId==entry.sessionId}).count==1) else { throw MacAssistantError("The exact resumed Codex conversation is not yet verified. Complete startup and retry.") }
    return tab
  }
  private func verified(_ original:MainWorkspaceLiveTab,entry:MainWorkspaceEntry) async throws -> MainWorkspaceLiveTab {
    try Self.verifiedIdentity(original,entry:entry,live:await identifiedInventory(for:[original]))
  }
  func recoverDraft(_ tab:MainWorkspaceLiveTab,entry:MainWorkspaceEntry) async throws {
    let identified=try await verified(tab,entry:entry)
    // A creation marker is reconciliation metadata, not the restored window's
    // permanent title. Replace only our exact marker after ownership is known.
    if try await customTitles()[identified.tty]=="ClawDad Restore \(entry.id)" {
      try await title(entry.name,tty:identified.tty)
    }
    let metadata = try await Task.detached { try MacTerminalTitleMetadata.read(identified.tty) }.value
    try await MacTerminalProjectTitles.shared.rename(tty: identified.tty, name: entry.name, expectedLifetime: metadata.lifetime)
    guard let draft=entry.draft,let text=draft.text,!text.isEmpty else { return }
    let tab=try await verified(identified,entry:entry)
    // Any accepted user turn after capture makes a saved draft unsafe to replay.
    if let path=entry.conversationPath {
      guard let offset=draft.transcriptOffset else { throw MacAssistantError("The saved draft has no transcript boundary. Review it in the saved snapshot instead of replaying it.") }
      let cursor=try MacAssistantSubmissionLog.capture(URL(fileURLWithPath:path))
      guard cursor.offset>=offset else { throw MacAssistantError("The transcript changed; review the saved draft before recovery.") }
      let handle=try FileHandle(forReadingFrom:URL(fileURLWithPath:path));defer{try? handle.close()}
      try handle.seek(toOffset:offset)
      guard cursor.offset-offset<=4*1024*1024 else { throw MacAssistantError("The draft's delivery history needs review.") }
      let tail=try handle.readToEnd() ?? Data()
      let userTurn=tail.split(separator:10).contains{line in
        guard let row=try? JSONSerialization.jsonObject(with:line) as? [String:Any],let payload=row["payload"] as? [String:Any] else { return false }
        return (row["type"] as? String=="event_msg" && payload["type"] as? String=="user_message") || (row["type"] as? String=="response_item" && payload["role"] as? String=="user")
      }
      guard !userTurn else { throw MacAssistantError("A user turn was accepted after this draft snapshot. Review its receipt; the draft was not replayed.") }
      let jobsURL=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ClawDad/Assistant/state.json")
      if let data=try? Data(contentsOf:jobsURL),let state=try? JSONDecoder().decode([String:AssistantValue].self,from:data),
        state["jobs"]?.array?.contains(where:{job in let row=job.object ?? [:];return row["sessionId"]?.string==entry.sessionId && ["running","queued","agent_queued","submitted","attention"].contains(row["status"]?.string ?? "") && row["preparedAt"] != nil})==true {
        throw MacAssistantError("This thread has a pending or uncertain delivery receipt. Review its accepted turns and native queue before recovering the saved draft.")
      }
    }
    guard let input else { throw AssistantProtocolError.invalid };let ticket=try ensure()
    let inspected=try await controls.inspect(tabId:tab.tabId,input:input,ticket:ticket)
    if inspected["draftText"]?.string==text { return }
    guard inspected["draftText"]?.string=="" else { throw MacAssistantError("The live draft was preserved. The saved draft remains available in the workspace snapshot.") }
    if entry.kind=="shell" {
      _=try await controls.execute("terminal.native.type",args:["tabId":.string(tab.tabId),"inputSessionId":inspected["inputSessionId"]!,"inputToken":inspected["inputToken"]!,"mode":.string("insert"),"expectedText":.string(""),"text":.string(text)],input:input)
    } else {
      let token=inspected["inputToken"]!.string!
      guard await input.insertAssistantDraft(text,targetToken:token,isAllowed:{self.interaction.isCurrent(ticket)},verifyPaste:{
        let checked=try? await self.controls.inspect(tabId:tab.tabId,input:input,ticket:ticket)
        guard let value=checked?["screenText"]?.string else { return false }
        return assistantEditableDraftMatches(assistantEditableDraft(value) ?? "",expected:text) || assistantCollapsedPasteMatches(value,payload:text)
      },terminalIdentity:{[tabs] in try await tabs.inputIdentity()}) else { throw MacAssistantError("Draft recovery was requested once but could not be verified. Inspect the tab; Enter and Tab were not sent.") }
    }
  }
  func finish(_ ordered:[MainWorkspaceLiveTab],selectedId:String?) async throws {
    guard !ordered.isEmpty else { return };let ticket=try ensure()
    let selectedOwner=ordered.first{$0.tabId==selectedId}?.owner ?? ordered[0].owner
    func rebound() async throws -> [MainWorkspaceLiveTab] {
      let live=try await identifiedInventory(for:ordered)
      let result=try ordered.map { original in
        let matches=live.filter{$0.tty==original.tty && $0.owner==original.owner && $0.sessionId==original.sessionId && $0.directory==original.directory}
        guard matches.count==1,let tab=matches.first else { throw MacAssistantError("A restored tab's process or conversation changed. Review its current identity before continuing.") }
        return tab
      }
      guard Set(result.map(\.group)).count==1 else { throw MacAssistantError("The restored tabs are now in different windows. No merging was attempted.") }
      return result
    }
    for index in ordered.indices {
      let currentOrder=try await rebound(),tab=currentOrder[index],first=currentOrder[0]
      let state=try await tabs.catalog()
      guard let group=state.tabs.first(where:{$0.id==first.tabId})?.windowGroupId else { throw MacAssistantError("The Main window changed.") }
      let current=state.tabs.filter{$0.windowGroupId==group}.map(\.id)
      let desired=currentOrder.map(\.tabId)
      let managed=current.filter({desired.contains($0)})
      guard managed.count==desired.count,interaction.isCurrent(ticket) else { throw MacAssistantError("The selected window changed during ordering.") }
      if managed[index]==tab.tabId { continue }
      _=try await tabs.move(.moveRequest(tabId:tab.tabId,neighborTabId:managed[index],placeBefore:true,expectedRevision:state.revision,requestId:UUID().uuidString))
    }
    let currentOrder=try await rebound()
    diagnosticStep?("layout-catalog")
    let state=try await tabs.catalog()
    guard state.tabs.filter({currentOrder.map(\.tabId).contains($0.id)}).map(\.id)==currentOrder.map(\.tabId) else { throw MacAssistantError("The saved tab order has not been confirmed. Show the full tab bar and retry.") }
    diagnosticStep?("layout-focus")
    let selected=currentOrder.first{$0.owner==selectedOwner}?.tabId ?? currentOrder[0].tabId
    if state.selectedTabId != selected || NSWorkspace.shared.frontmostApplication?.bundleIdentifier != "com.apple.Terminal" {
      _=try await tabs.focus(tabID:selected,expectedRevision:state.revision)
    }
    // Check every exact TTY/name before sizing the normal window.
    diagnosticStep?("layout-names")
    try await verifyNativeNames(currentOrder,ticket:ticket)
    diagnosticStep?("layout-frame")
    try await fillAvailableDisplay(ticket:ticket)
    diagnosticStep?("layout-verified")
    exitedFullScreen=nil
  }
  private func windowBounds(_ window:AXUIElement) throws -> CGRect {
    var positionRaw:CFTypeRef?,sizeRaw:CFTypeRef?
    guard AXUIElementCopyAttributeValue(window,kAXPositionAttribute as CFString,&positionRaw) == .success,
      AXUIElementCopyAttributeValue(window,kAXSizeAttribute as CFString,&sizeRaw) == .success,
      let positionRaw,let sizeRaw,CFGetTypeID(positionRaw)==AXValueGetTypeID(),CFGetTypeID(sizeRaw)==AXValueGetTypeID() else {
      throw MacAssistantError("Terminal's window size is unavailable. Its restored tabs remain intact.")
    }
    var position=CGPoint.zero,size=CGSize.zero
    guard AXValueGetValue(unsafeBitCast(positionRaw,to:AXValue.self),.cgPoint,&position),
      AXValueGetValue(unsafeBitCast(sizeRaw,to:AXValue.self),.cgSize,&size) else { throw AssistantProtocolError.invalid }
    return CGRect(origin:position,size:size)
  }
  private func fillAvailableDisplay(ticket:UInt64) async throws {
    var window=try focusedWindow()
    if fullScreen() {
      guard interaction.isCurrent(ticket),AXUIElementSetAttributeValue(window,"AXFullScreen" as CFString,kCFBooleanFalse) == .success else {
        throw MacAssistantError("Leave Terminal full screen, then retry sizing the restored window.")
      }
      for _ in 0..<30 { if !fullScreen() { break };try await Task.sleep(for:.milliseconds(100)) }
      guard !fullScreen() else { throw MacAssistantError("Terminal is still leaving full screen. Its restored tabs remain intact; retry after the transition.") }
      window=try focusedWindow()
    }
    let screens=NSScreen.screens
    guard let primary=screens.first,let target=MainWorkspaceDisplayGeometry.target(
      window:try windowBounds(window),screens:screens.map{($0.frame,$0.visibleFrame)},primaryTop:primary.frame.maxY) else {
      throw MacAssistantError("The current display's available area is unavailable. Resize the restored window manually.")
    }
    // AX uses a top-left origin, AppKit screen frames use a bottom-left origin.
    // Setting bounds avoids macOS Full Screen/Spaces and adapts to this display,
    // its current menu bar/Dock, and Terminal's character-grid size increments.
    for attempt in 0..<3 {
      guard interaction.isCurrent(ticket),CFEqual(window,try focusedWindow()),!fullScreen() else {
        throw MacAssistantError("The active window changed during sizing. Its tabs were preserved; inspect before retrying.")
      }
      var position=target.origin,size=target.size
      guard let sizeValue=AXValueCreate(.cgSize,&size),let positionValue=AXValueCreate(.cgPoint,&position),
        AXUIElementSetAttributeValue(window,kAXSizeAttribute as CFString,sizeValue) == .success,
        AXUIElementSetAttributeValue(window,kAXPositionAttribute as CFString,positionValue) == .success else {
        throw MacAssistantError("Terminal could not fill the display. Its tabs and drafts are restored; resize the window or retry.")
      }
      for _ in 0..<10 {
        guard interaction.isCurrent(ticket),CFEqual(window,try focusedWindow()),!fullScreen() else { throw MacAssistantError("The window changed during size verification. Its restored work was preserved.") }
        if MainWorkspaceDisplayGeometry.fills(try windowBounds(window),target:target) { return }
        try await Task.sleep(for:.milliseconds(100))
      }
      if attempt==2 { throw MacAssistantError("Terminal has not confirmed that its normal window fills the available display. Its restored tabs remain intact; check the window size and retry.") }
    }
  }
  private func verifyNativeNames(_ currentOrder:[MainWorkspaceLiveTab],ticket:UInt64) async throws {
    // The picker can already display a durable approved name while Terminal
    // still displays the shell's resume-command title. Verify native AX names
    // after launch/reordering settles before reporting the setup restored.
    let named=currentOrder.compactMap { tab -> (MainWorkspaceLiveTab,String)? in
      MacTerminalProjectTitles.shared.explicitName(tty:tab.tty).map{(tab,$0)}
    }
    for attempt in 0..<10 {
      guard interaction.isCurrent(ticket) else { throw MacAssistantError("You changed Terminal during restoration. Inspect its saved names before continuing.") }
      _=try await tabs.catalog()
      let unmatched=named.filter { tab,name in
        guard let id=tabs.assistantIdentifier(tty:tab.tty),let native=tabs.assistantSnapshot(tabID:id) else { return true }
        return !Self.restoredNameMatches(native,name:name)
      }
      if unmatched.isEmpty { return }
      if attempt==0 {
        for (tab,name) in unmatched {
          guard let lifetime=tab.lifetime else { throw MacAssistantError("The restored tab lifetime needs verification before naming.") }
          try await MacTerminalProjectTitles.shared.rename(tty:tab.tty,name:name,expectedLifetime:lifetime)
        }
      }
      try await Task.sleep(for:.milliseconds(200))
    }
    throw MacAssistantError("The conversations and drafts are restored, but Terminal has not confirmed its saved tab names. Refresh to verify the same tabs; they will not be recreated.")
  }
  static func restoredNameMatches(_ snapshot:MacTerminalTabSnapshot,name:String)->Bool {
    // A single-tab window without a visible tab bar exposes its composed
    // window title through AX. The independently read configured title remains
    // the exact tab name; substring matching would accept unrelated names.
    snapshot.customTitle==name || snapshot.configuredTitle==name
  }
}

enum MainWorkspaceDisplayGeometry {
  static func accessibilityRect(_ rect:CGRect,primaryTop:CGFloat) -> CGRect {
    CGRect(x:rect.minX,y:primaryTop-rect.maxY,width:rect.width,height:rect.height)
  }
  static func target(window:CGRect,screens:[(frame:CGRect,visibleFrame:CGRect)],primaryTop:CGFloat) -> CGRect? {
    guard window.width>0,window.height>0,!screens.isEmpty else { return nil }
    let valid=screens.filter{$0.frame.width>0 && $0.frame.height>0 && $0.visibleFrame.width>0 && $0.visibleFrame.height>0}
    func score(_ frame:CGRect) -> (CGFloat,CGFloat) {
      let rect=accessibilityRect(frame,primaryTop:primaryTop),overlap=window.intersection(rect)
      let area=overlap.isNull ? 0:overlap.width*overlap.height
      let dx=max(rect.minX-window.midX,0,window.midX-rect.maxX),dy=max(rect.minY-window.midY,0,window.midY-rect.maxY)
      return (area,-(dx*dx+dy*dy))
    }
    guard let screen=valid.max(by:{score($0.frame)<score($1.frame)}) else { return nil }
    return accessibilityRect(screen.visibleFrame,primaryTop:primaryTop)
  }
  static func fills(_ actual:CGRect,target:CGRect) -> Bool {
    // The character grid can round the requested size down by a row/column.
    abs(actual.minX-target.minX)<=2 && abs(actual.minY-target.minY)<=2 &&
      actual.width<=target.width+2 && actual.height<=target.height+2 &&
      actual.width>=target.width-48 && actual.height>=target.height-48
  }
}
