import AppKit
import ApplicationServices
import ClawDadRemoteAssistProtocol
import Foundation

@MainActor final class MacMainWorkspaceNative: MainWorkspaceNative {
  private let tabs=MacTerminalTabController.shared
  private let controls=MacAssistantTerminalInput()
  private let interaction=MacAssistantInteractionGate.shared
  private let input=MacInputController()
  private let runtime: MacAssistantRuntime
  private var exitedFullScreen:(tty:String,owner:String,ticket:UInt64)?
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
  private func customTitles() async throws -> [String:String] {
    try await Task.detached {
      let source="""
      tell application "Terminal"
        set resultRows to {}
        repeat with w in windows
          repeat with t in tabs of w
            set labelText to custom title of t
            if labelText is missing value then set labelText to ""
            set end of resultRows to {tty of t, labelText as text}
          end repeat
        end repeat
        return resultRows
      end tell
      """
      guard let script=NSAppleScript(source:source) else { throw AssistantProtocolError.invalid }
      var failure:NSDictionary?
      let result=script.executeAndReturnError(&failure)
      guard failure==nil,result.numberOfItems<=128 else { throw MacAssistantError("Terminal tab names could not be read safely. Refresh its windows.") }
      var rows:[(String,String)]=[]
      for index in 0..<result.numberOfItems {
        guard let row=result.atIndex(index+1),let tty=row.atIndex(1)?.stringValue,let name=row.atIndex(2)?.stringValue,
          tty.hasPrefix("/dev/tty") else { throw MacAssistantError("Terminal tab names have unavailable identities. Refresh before restoring.") }
        rows.append((tty,name))
      }
      return try Self.uniqueTitles(rows)
    }.value
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
    _=try ensure()
    if NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Terminal").isEmpty {
      // Launch first, then discover macOS-restored windows before requesting
      // any new window. Never combine launch and creation in a blind retry.
      _=try await script("tell application \"Terminal\" to launch")
      try await Task.sleep(for:.milliseconds(750))
    }
    guard let app=NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Terminal").first else { throw MacAssistantError("Terminal is still starting. Retry after its windows appear.") }
    if !app.isActive {
      app.activate(options:[.activateIgnoringOtherApps])
      for _ in 0..<15 { if app.isActive { return };try await Task.sleep(for:.milliseconds(100)) }
      throw MacAssistantError("Show Terminal on the Mac and retry Main Workspace.")
    }
  }
  private func exposeFullScreen(entries:[MainWorkspaceEntry]?,savingTabId:String?) async throws {
    try await activateForWorkspace()
    guard fullScreen() else { return }
    let ticket=try ensure(),state=try await tabs.catalog()
    guard let id=state.selectedTabId,let selected=tabs.assistantSnapshot(tabID:id),!selected.tty.isEmpty else { throw MacAssistantError("Show the Main Terminal window and retry so its full-screen identity can be verified.") }
    let owner=try await Task.detached{try MacAssistantForeground.read(tty:selected.tty)}.value
    if let savingTabId {
      guard savingTabId==id else { throw MacAssistantError("Leave full screen or choose its selected tab before saving that window.") }
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
      try await exposeFullScreen(entries:nil,savingTabId:tabId)
      let original=exitedFullScreen
      var anchor=tabId
      if let original {
        let identified=try await inventory(captureDrafts:true)
        guard let current=identified.first(where:{$0.tty==original.tty}) else { throw MacAssistantError("The selected Main tab changed during inspection.") };anchor=current.tabId
      }
      _=try await tabs.catalog()
      guard let group=tabs.assistantSnapshot(tabID:anchor)?.groupID else { throw MacAssistantError("The chosen Main window changed. Refresh and choose it again.") }
      var captured=try await inventory(captureDrafts:true,captureGroup:group)
      if original != nil { for i in captured.indices where captured[i].group==String(group) { captured[i].fullScreen=true } }
      await endRestore()
      return MainWorkspaceWindowSnapshot(anchorId:anchor,tabs:captured)
    } catch { await endRestore();throw error }
  }
  func inventory(captureDrafts: Bool) async throws -> [MainWorkspaceLiveTab] {
    try await inventory(captureDrafts:captureDrafts,captureGroup:nil)
  }
  private func focusForSnapshot(_ id:String,ticket:UInt64) async throws {
    for attempt in 0..<3 {
      guard interaction.isCurrent(ticket) else { throw MacAssistantError("You changed Terminal during the snapshot. Save again when ready.") }
      let current=try await tabs.catalog()
      guard current.tabs.contains(where:{$0.id==id}) else { throw MacAssistantError("The tab identity changed. Refresh before saving.") }
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
    let names=NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Terminal").isEmpty ? [:] : try await customTitles()
    guard !captureDrafts || initial.tabs.count==names.count else { throw MacAssistantError("Some Terminal tabs are hidden by macOS. Show their windows or leave full screen and retry. The saved roster and hidden tabs were preserved.") }
    let jobsURL=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ClawDad/Assistant/state.json")
    let jobState=(try? Data(contentsOf:jobsURL)).flatMap{try? JSONDecoder().decode([String:AssistantValue].self,from:$0)}
    let pending=(jobState?["jobs"]?.array ?? []).compactMap(\.object).filter { row in
      ["agent_queued","submitted","attention","queued"].contains(row["status"]?.string ?? "") && (row["action"]?.string?.hasPrefix("terminal.") ?? false)
    }
    let selected=initial.selectedTabId
    let selections=Dictionary(uniqueKeysWithValues:initial.tabs.map{($0.id,tabs.assistantSnapshot(tabID:$0.id)?.isSelectedInWindow ?? $0.isSelected)})
    let ticket=captureDrafts ? try ensure() : nil
    do {
      for descriptor in initial.tabs {
        let snapshot=tabs.assistantSnapshot(tabID:descriptor.id)
        let requiresIdentity=captureDrafts && (captureGroup==nil || snapshot?.groupID==captureGroup)
        // Save explicitly captures every draft in its chosen window. Restore
        // only needs to visit unbound tabs; known live inputs remain untouched.
        let shouldCapture=requiresIdentity && (captureGroup != nil || snapshot?.tty.isEmpty != false)
        if let ticket,shouldCapture {
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
        let agent=try? await Task.detached{try MacTerminalResponseReader().inputBinding(tty:tab.tty)}.value
        let directory: String
        if let agent { directory=agent.directory } else { directory=(try? await shellDirectory(tab.tty)) ?? "" }
        var draft:MainWorkspaceDraft?
        let focused = shouldCapture || (!captureDrafts && selected==descriptor.id)
        let expectedIdentity=focused ? try? await tabs.inputIdentity():nil
        if focused,NSWorkspace.shared.frontmostApplication?.bundleIdentifier=="com.apple.Terminal",
          let expectedIdentity,(try? await tabs.catalog())?.selectedTabId==descriptor.id,
          let readTicket=try? interaction.ticket(),
          let value=try? await MacAssistantComposerRendering.shared.read(ticket:readTicket,raw:{ try self.focusedText() }),
          interaction.isCurrent(readTicket),(try? await tabs.inputIdentity())==expectedIdentity,
          (try? await tabs.catalog())?.selectedTabId==descriptor.id {
          let observation=agent != nil ? assistantObserveDraft(value,viewportRows:assistantTerminalRows(tab.tty)) : nil
          let text=observation?.requiresWholeDraftAuthorization==true ? nil : observation?.text ?? (owner.shell != nil ? MacAssistantShellDraft.read(value)?.text:nil)
          let offset=agent?.conversation.flatMap{try? MacAssistantSubmissionLog.capture($0.path).offset}
          draft=MainWorkspaceDraft(text:text,limitation:text==nil ? (observation?.reason ?? "This input cannot be recovered automatically."):nil,capturedAt:Date(),transcriptOffset:offset)
        }
        let config=agent?.conversation.flatMap{Self.resumeConfiguration($0.path)}
        var receiptIds:[String]=[]
        if let conversation=agent?.conversation {
          for row in pending {
            let target=row["sessionId"]?.string ?? row["args"]?.object?["sessionId"]?.string
            if target==conversation.sessionId,let id=row["id"]?.string { receiptIds.append(id) }
          }
        }
        output.append(MainWorkspaceLiveTab(tabId:descriptor.id,group:String(tab.groupID),tty:tab.tty,owner:agent?.instanceId ?? owner.identity,
          directory:directory,kind:agent != nil ? "codex":owner.shell != nil ? "shell":"unsupported",sessionId:agent?.conversation?.sessionId,
          conversationPath:agent?.conversation?.path.path,executable:agent?.executable,name:MacTerminalProjectTitles.shared.explicitName(tty: tab.tty) ?? (names[tab.tty]?.hasPrefix("ClawDad Restore ")==true ? names[tab.tty]! : (tab.generatedTitle && !directory.isEmpty ? URL(fileURLWithPath: directory).lastPathComponent : descriptor.title)),
          position:tab.position,selected:selections[descriptor.id] ?? false,fullScreen:focused ? fullScreen():false,draft:draft,model:config?.model,effort:config?.effort,pendingReceipts:receiptIds,nameIsExplicit:MacTerminalProjectTitles.shared.explicitName(tty: tab.tty) != nil))
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
    }
  }
  static func quoted(_ text:String)->String { "'"+text.replacingOccurrences(of:"'",with:"'\\''")+"'" }
  static func resumeConfiguration(_ path:URL)->(model:String,effort:String?)? {
    guard let handle=try? FileHandle(forReadingFrom:path) else { return nil };defer{try? handle.close()}
    guard let end=try? handle.seekToEnd() else { return nil }
    // Bounded tail; missing historical settings stay inherited by Codex resume.
    try? handle.seek(toOffset:end>1024*1024 ? end-1024*1024:0)
    guard let data=try? handle.readToEnd() else { return nil }
    for line in data.split(separator:10).reversed() {
      guard let row=try? JSONSerialization.jsonObject(with:line) as? [String:Any],row["type"] as? String=="turn_context",
        let p=row["payload"] as? [String:Any],let model=p["model"] as? String,!model.isEmpty,model.utf8.count<128 else { continue }
      let effort=p["effort"] as? String
      return (model,effort?.range(of:#"^[a-z_]{1,24}$"#,options:.regularExpression) != nil ? effort:nil)
    }
    return nil
  }
  static func appleString(_ text:String)->String { "\""+text.replacingOccurrences(of:"\\",with:"\\\\").replacingOccurrences(of:"\"",with:"\\\"").replacingOccurrences(of:"\n",with:"\\n")+"\"" }
  private func script(_ source:String) async throws -> String {
    try await Task.detached { try MacTerminalResponseReader().run("/usr/bin/osascript",["-e",source]).trimmingCharacters(in:.whitespacesAndNewlines) }.value
  }
  private func title(_ value:String,tty:String) async throws {
    guard tty.range(of:#"^/dev/tty[A-Za-z0-9]+$"#,options:.regularExpression) != nil else { throw AssistantProtocolError.invalid }
    let result=try await script("tell application \"Terminal\"\nset matches to {}\nrepeat with w in windows\nrepeat with t in tabs of w\nif tty of t is \(Self.appleString(tty)) then set end of matches to t\nend repeat\nend repeat\nif (count matches) is not 1 then error \"Target changed\"\nset t to item 1 of matches\nset custom title of t to \(Self.appleString(value))\nreturn custom title of t\nend tell")
    guard result==value else { throw MacAssistantError("The saved tab name could not be verified.") }
  }
  func create(marker:String,anchor:MainWorkspaceLiveTab?) async throws -> MainWorkspaceLiveTab {
    let ticket=try ensure();let before=try await inventory(captureDrafts:false)
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
    let after=try await inventory(captureDrafts:false)
    let additions=after.filter{tab in !before.contains{$0.tty==tab.tty}}
    guard additions.count==1,let created=additions.first,created.tty==tty,created.name==marker,
      anchor==nil || created.group==anchor?.group,
      before.allSatisfy({old in after.contains{$0.tty==old.tty}}) else {
      throw MacAssistantError("Creation was requested once. Its window or tab identity needs review; it will not be repeated automatically.")
    }
    return created
  }
  func configure(_ tab:MainWorkspaceLiveTab,entry:MainWorkspaceEntry,requestId:String,allowLaunch:Bool) async throws -> MainWorkspaceLiveTab {
    let ticket=try ensure();let state=try await tabs.catalog()
    _=try await tabs.focus(tabID:tab.tabId,expectedRevision:state.revision)
    if let agent=try? await Task.detached{try MacTerminalResponseReader().inputBinding(tty:tab.tty)}.value {
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
      let receipt=try await runtime.json("/v1/assistant/main-workspace/claim",["id":.string(requestId),"sessionId":.string(session)])
      guard receipt["allowed"]?.bool==true,let token=receipt["token"]?.string else { throw MacAssistantError("The saved thread's live ownership could not be verified.") };lease=token
    }
    do {
      let settings=(entry.model.map{" --model \(Self.quoted($0))"} ?? "") + (entry.effort.map{" -c \(Self.quoted("model_reasoning_effort=\"\($0)\""))"} ?? "")
      let command="cd -- \(Self.quoted(entry.directory))" + (entry.kind=="codex" ? " && \(Self.quoted(entry.executable!)) resume \(Self.quoted(entry.sessionId!)) --cd \(Self.quoted(entry.directory))\(settings)":"")
      var target:[String:AssistantValue]=["tabId":.string(tab.tabId),"inputToken":inspected["inputToken"]!,"inputSessionId":inspected["inputSessionId"]!,"mode":.string("insert"),"expectedText":.string(""),"text":.string(command)]
      _=try await controls.execute("terminal.native.type",args:target,input:input)
      let fresh=try await controls.inspect(tabId:tab.tabId,input:input,ticket:ticket)
      guard fresh["draftText"]?.string==command,interaction.isCurrent(ticket) else { throw MacAssistantError("The launch draft changed. It was preserved.") }
      target=["tabId":.string(tab.tabId),"inputToken":fresh["inputToken"]!,"inputSessionId":fresh["inputSessionId"]!,"key":.string("enter"),"intent":.string("submit")]
      if let lease { _=try await runtime.json("/v1/assistant/main-workspace/check",["token":.string(lease)]) }
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
  func finish(_ ordered:[MainWorkspaceLiveTab],selectedId:String?,fullScreen:Bool) async throws {
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
    let state=try await tabs.catalog()
    guard state.tabs.filter({currentOrder.map(\.tabId).contains($0.id)}).map(\.id)==currentOrder.map(\.tabId) else { throw MacAssistantError("The saved tab order has not been confirmed. Show the full tab bar and retry.") }
    _=try await tabs.focus(tabID:currentOrder.first{$0.owner==selectedOwner}?.tabId ?? currentOrder[0].tabId,expectedRevision:state.revision)
    let window=try focusedWindow()
    if self.fullScreen() != fullScreen {
      guard interaction.isCurrent(ticket),AXUIElementSetAttributeValue(window,"AXFullScreen" as CFString,fullScreen ? kCFBooleanTrue:kCFBooleanFalse) == .success else { throw MacAssistantError("Set the Main window's full-screen preference manually, then retry verification.") }
      for _ in 0..<20 { if self.fullScreen()==fullScreen { exitedFullScreen=nil;return };try await Task.sleep(for:.milliseconds(100)) }
      throw MacAssistantError("Terminal has not confirmed its full-screen state yet.")
    }
    exitedFullScreen=nil
  }
}
