import AppKit
import ApplicationServices
import Foundation
import Darwin
import ClawDadRemoteAssistProtocol

/// Account-transition controls share the ordinary native focus, input and
/// manual-interaction guards. They never create tabs or send an agent task.
/// The service owns approval and one-time dispatch; private recovery is written
/// before temporary /status input replaces a recoverable draft.
@MainActor final class MacCodexAccountNative {
  private let tabs=MacTerminalTabController.shared
  private let interaction=MacAssistantInteractionGate.shared
  private let input=MacInputController()
  private let shellInput=MacAssistantTerminalInput()
  private let root:URL
  private var restored=MacAssistantDraftProvenance()
  private var exactPastes:[String:(context:MacAssistantDraftProvenance.Context,text:String)]=[:]
  var diagnosticStep:((String)->Void)?
  var retainedDraft:((MacCodexInputBinding,String,MacAssistantForeground,String,UInt64)->String?)?
  private struct StatusCache {let owner:String,generation:UInt64;let value:MacCodexAccountStatus}
  private var statuses:[String:StatusCache]=[:]
  private struct Observed {
    let tabId:String,tab:MacTerminalTabSnapshot,identity:String,lifetime:String,window:String
    let foreground:MacAssistantForeground,binding:MacCodexInputBinding?,screen:String
    var fields:[String:AssistantValue]
  }
  init(root:URL){self.root=root}
  private func binding(tty:String) throws -> MacCodexInputBinding {
    var reader=MacTerminalResponseReader();reader.acceptedConversationSources=["cli","vscode"]
    guard tty.range(of:#"^/dev/tty[A-Za-z0-9]+$"#,options:.regularExpression) != nil else{throw fail("exact_tty_required")}
    let owner=try MacTerminalResponseReader.inputOwner(reader.run("/bin/ps",["-t",String(tty.dropFirst(5)),"-o","pid=,pgid=,tpgid=,stat=,lstart=,comm="]))
    guard let facts=MacCodexAccountProcess.readFacts(owner.pid),let home=facts.codexHome ?? facts.home.map({$0+"/.codex"}) else{throw fail("authorization_home_unavailable")}
    // The actual foreground owner's home selects its history root. Continue
    // requiring a live rollout handle and exact header; never search a project
    // directory for some other conversation with a matching name.
    reader.sessionRoot=URL(fileURLWithPath:home,isDirectory:true).appendingPathComponent("sessions",isDirectory:true)
    let result=try reader.inputBinding(tty:tty)
    guard result.pid==owner.pid,MacCodexAccountProcess.readFacts(owner.pid)==facts else{throw fail("process_home_changed")}
    return result
  }
  private func fail(_ code:String)->MacCodexInputFailure {MacCodexAccountHandoffEvidence.failure(code)}
  private func ensure(_ ticket:UInt64) throws {
    guard !Task.isCancelled,!MacConsoleSessionState.isLocked(),AXIsProcessTrusted(),interaction.isCurrent(ticket) else{throw fail("manual_input_or_permission_changed")}
  }
  private func screen(shell:Bool=false) throws -> String {
    guard let app=NSWorkspace.shared.frontmostApplication,app.bundleIdentifier=="com.apple.Terminal" else{throw fail("terminal_not_focused")}
    var raw:CFTypeRef?
    guard AXUIElementCopyAttributeValue(AXUIElementCreateApplication(app.processIdentifier),kAXFocusedUIElementAttribute as CFString,&raw) == .success,
      let raw,CFGetTypeID(raw)==AXUIElementGetTypeID() else{throw fail("input_unavailable")}
    let element=unsafeBitCast(raw,to:AXUIElement.self)
    var role:CFTypeRef?,value:CFTypeRef?
    guard AXUIElementCopyAttributeValue(element,kAXRoleAttribute as CFString,&role) == .success,role as? String==kAXTextAreaRole as String,
      AXUIElementCopyAttributeValue(element,kAXValueAttribute as CFString,&value) == .success,let text=value as? String else{throw fail("input_unavailable")}
    if shell {
      var selected:CFTypeRef?
      if AXUIElementCopyAttributeValue(element,kAXSelectedTextRangeAttribute as CFString,&selected) == .success,
        let selected,CFGetTypeID(selected)==AXValueGetTypeID() {
        var range=CFRange()
        if AXValueGetValue(unsafeBitCast(selected,to:AXValue.self),.cfRange,&range),range.length==0 {
          return String(assistantShellScreen(text,cursor:range.location,allowEmptyTrim:false).suffix(24_000))
        }
      }
      return String(text.suffix(24_000))
    }
    return MacAssistantComposerRendering.shared.normalized(String(text.suffix(24_000)))
  }
  private func observe(_ source:[String:AssistantValue],ticket:UInt64) async throws -> Observed {
    try ensure(ticket)
    diagnosticStep?("catalog")
    guard let tty=source["tty"]?.string,tty.range(of:#"^/dev/tty[A-Za-z0-9]+$"#,options:.regularExpression) != nil else{throw fail("exact_tty_required")}
    // Reuse only the inventory's identity mapping. The focused native control
    // is re-observed below on every check. Re-enumerating every unrelated
    // Terminal window for each paste/status step is unnecessary and can stall
    // a transition behind another window's scripting response.
    let catalog:RemoteTerminalTabState
    if let known=tabs.assistantKnownCatalog,known.tabs.contains(where:{tabs.assistantSnapshot(tabID:$0.id)?.tty==tty}) {catalog=known}
    else {catalog=try await tabs.catalog()}
    let matches=catalog.tabs.filter{tabs.assistantSnapshot(tabID:$0.id)?.tty==tty}
    guard matches.count==1,let descriptor=matches.first,let original=tabs.assistantSnapshot(tabID:descriptor.id) else{throw fail("tab_binding_unavailable")}
    let lifetime=try MacTerminalTitleMetadata.currentLifetime(tty)
    guard source["tabLifetime"]?.string.map({$0==lifetime}) ?? true else{throw fail("tab_lifetime_changed")}
    diagnosticStep?("focus")
    if (try? await tabs.assistantVerifiedInputIdentity(tabID:descriptor.id)) == nil {
      _=try await tabs.focus(tabID:descriptor.id,expectedRevision:catalog.revision)
    }
    try ensure(ticket)
    guard let tab=tabs.assistantSnapshot(tabID:descriptor.id),tab.tty==tty,tab.groupID==original.groupID,
      let app=NSWorkspace.shared.frontmostApplication,app.bundleIdentifier=="com.apple.Terminal",let launch=app.launchDate,
      let identity=try await tabs.assistantVerifiedInputIdentity(tabID:descriptor.id) else{throw fail("window_or_input_changed")}
    let window=MacCodexAccountHandoffEvidence.digest("\(app.processIdentifier)|\(launch.timeIntervalSince1970)|\(tab.groupID)")
    guard source["windowIdentity"]?.string.map({$0==window}) ?? true else{throw fail("physical_window_changed")}
    let foreground=try MacAssistantForeground.read(tty:tty)
    diagnosticStep?("binding")
    let binding:MacCodexInputBinding?
    do{binding=try self.binding(tty:tty)}catch let error as MacCodexInputFailure where error.code=="no_codex_process" {binding=nil}
    let value:String
    if binding==nil {value=try screen(shell:true)}
    else {value=try await MacAssistantComposerRendering.shared.read(ticket:ticket){try self.screen()}}
    diagnosticStep?("draft")
    var fields:[String:AssistantValue]=["tabId":.string(descriptor.id),"tty":.string(tty),"tabLifetime":.string(lifetime),"windowIdentity":.string(window)]
    if let binding {
      guard let conversation=binding.conversation else{throw fail("resumable_conversation_pending")}
      guard let facts=MacCodexAccountProcess.readFacts(binding.pid),!facts.alternateAuthentication,
        let home=facts.codexHome ?? facts.home.map({$0+"/.codex"}),let shell=MacCodexAccountHandoffEvidence.parentShell(tty:tty,agentPID:binding.pid) else{throw fail("persistent_shell_or_subscription_unverified")}
      let view=assistantObserveDraft(value,viewportRows:assistantTerminalRows(tty))
      guard let representation=view.text else{throw fail(view.reasonCode)}
      let context=MacAssistantDraftProvenance.Context(input:identity,process:binding.instanceId,session:conversation.sessionId,foreground:foreground.identity,generation:ticket)
      let ownPaste=exactPastes[tty].flatMap{receipt in receipt.context==context &&
        (assistantDraftMatches(value,expected:receipt.text,viewportRows:assistantTerminalRows(tty)) || assistantCollapsedPasteMatches(value,payload:receipt.text)) ? receipt.text:nil}
      let retained=ownPaste ?? restored.text(context:context,screen:value) ?? retainedDraft?(binding,identity,foreground,value,ticket)
      // AX text can hide soft wraps or trailing spaces. Only an empty input or
      // our unchanged, exact native paste is safe for automatic recovery.
      let exact=retained ?? (!view.requiresWholeDraftAuthorization && representation.isEmpty ? "":nil)
      guard let exact,exact.utf8.count<=16*1024 else{throw fail("exact_draft_text_unavailable")}
      var activity=MacCodexRequestActivityLog();let busy=try activity.read(conversation.path)
      let queueVisible=value.components(separatedBy:.newlines).contains{$0.trimmingCharacters(in:.whitespaces)=="• Queued follow-up inputs"}
      let history=try MacCodexAccountHandoffEvidence.acceptedHistory(conversation.path)
      let cache=statuses[tty].flatMap{$0.owner==binding.instanceId && $0.generation==ticket ? $0.value:nil}
      let managedRouting=try verifiedLaunch(facts.accountTransitionId,binding:binding,home:home)
      fields.merge(["kind":.string("agent"),"processIdentity":.string(binding.instanceId),"pid":.number(Double(binding.pid)!),
        "shellIdentity":.string(shell.identity),"shellWillRemain":.bool(true),"sessionId":.string(conversation.sessionId),
        "directory":.string(binding.directory),"executable":.string(binding.executable),"authorizationHome":.string(home),
        "busy":.bool(busy),"queueEmpty":.bool(!busy && !queueVisible),"acceptedTurnsHash":.string(history),
        "draft":.object(["text":.string(exact),"hash":.string(MacCodexAccountHandoffEvidence.digest(exact)),"verified":.bool(true),
          "provenance":.string(retained==nil ? "rendered-composer":"unchanged-native-paste")]),"images":.array([]),
        "settingsVerified":.bool(cache != nil),"status":try cache.map(AssistantValue.encode) ?? .null,
        "launchPolicyVerified":.bool(false),"launchRequestId":managedRouting ? .string(facts.accountTransitionId!):.null],uniquingKeysWith:{$1})
      do{fields["resumeOptions"] = .array(try MacCodexAccountProcess.options(facts.arguments,allowVerifiedAccountRouting:managedRouting).map(AssistantValue.string));fields["launchPolicyVerified"] = .bool(true)}
      catch let error as MacCodexInputFailure{fields["launchReasonCode"] = .string(error.code)}
      if let cache {fields["model"] = .string(cache.model);fields["reasoningEffort"] = .string(cache.reasoningEffort)}
      guard try self.binding(tty:tty)==binding else{throw fail("agent_owner_changed")}
    } else {
      guard foreground.shell != nil else{throw fail("shell_line_editor_unverified")}
      guard let shell=MacCodexAccountHandoffEvidence.parentShell(tty:tty,agentPID:nil) else{throw fail("persistent_shell_unverified")}
      guard let draft=MacAssistantShellDraft.read(value) else{throw fail("shell_prompt_unreadable")}
      guard draft.text.isEmpty else{throw fail("shell_draft_not_empty")}
      fields.merge(["kind":.string("shell"),"shellIdentity":.string(shell.identity),"draft":.object(["text":.string(""),
        "hash":.string(MacCodexAccountHandoffEvidence.digest("")),"verified":.bool(true),"provenance":.string("rendered-composer")])],uniquingKeysWith:{$1})
    }
    guard try await tabs.assistantVerifiedInputIdentity(tabID:descriptor.id)==identity else{throw fail("selected_input_changed_during_observation")}
    guard try MacAssistantForeground.read(tty:tty)==foreground else{throw fail("foreground_members_changed_during_observation")}
    guard try MacTerminalTitleMetadata.currentLifetime(tty)==lifetime else{throw fail("tab_lifetime_changed_during_observation")}
    try ensure(ticket)
    diagnosticStep?("observed")
    return .init(tabId:descriptor.id,tab:tab,identity:identity,lifetime:lifetime,window:window,foreground:foreground,binding:binding,screen:value,fields:fields)
  }
  private func persist(_ requestId:String,_ data:[String:AssistantValue]) throws {
    guard requestId.range(of:#"^[A-Za-z0-9_.:-]{1,160}$"#,options:.regularExpression) != nil else{throw fail("invalid_request")}
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
    let attrs=try FileManager.default.attributesOfItem(atPath:root.path)
    guard attrs[.type] as? FileAttributeType == .typeDirectory,(attrs[.ownerAccountID] as? NSNumber)?.uint32Value==getuid(),
      ((attrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o077 == 0 else{throw fail("private_recovery_unavailable")}
    let file=root.appendingPathComponent(requestId+".json")
    try JSONEncoder().encode(data).write(to:file,options:.atomic)
    try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
    let handle=try FileHandle(forWritingTo:file);try handle.synchronize();try handle.close()
    let dir=open(root.path,O_RDONLY);guard dir>=0 else{throw fail("private_recovery_unavailable")};defer{close(dir)}
    guard fsync(dir)==0 else{throw fail("private_recovery_unavailable")}
  }
  private func verifiedLaunch(_ id:String?,binding:MacCodexInputBinding,home:String) throws -> Bool {
    guard let id else{return false}
    let file=root.appendingPathComponent(id+".json")
    guard let attrs=try? FileManager.default.attributesOfItem(atPath:file.path),attrs[.type] as? FileAttributeType == .typeRegular,
      (attrs[.ownerAccountID] as? NSNumber)?.uint32Value==getuid(),((attrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o077==0,
      (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= 256*1024,
      let record=try? JSONDecoder().decode([String:AssistantValue].self,from:Data(contentsOf:file)),
      ["launch_enter_prepared","verified"].contains(record["stage"]?.string ?? ""),
      record["source"]?.object?["sessionId"]?.string==binding.conversation?.sessionId,
      record["source"]?.object?["directory"]?.string==binding.directory,
      record["target"]?.object?["authorizationHome"]?.string==home else{return false}
    if let owner=record["result"]?.object?["processIdentity"]?.string,owner != binding.instanceId {throw fail("launch_receipt_owner_changed")}
    return true
  }
  private func checked(_ before:Observed,ticket:UInt64,text:String) async throws -> Observed {
    let next=try await observe(before.fields,ticket:ticket)
    guard next.binding==before.binding,next.foreground==before.foreground,next.identity==before.identity,
      next.fields["busy"]?.bool==false,next.fields["queueEmpty"]?.bool==true,
      next.fields["acceptedTurnsHash"]==before.fields["acceptedTurnsHash"],next.fields["draft"]?.object?["text"]?.string==text else{throw fail("owner_work_or_draft_changed")}
    return next
  }
  private func capture(_ before:Observed,ticket:UInt64) async throws -> String {
    guard let input else{throw fail("native_input_unavailable")};try ensure(ticket)
    let token=UUID().uuidString
    let result=await input.captureDictationTarget(.request(.captureTarget,requestId:token)){[tabs] in try await tabs.inputIdentity()}
    guard result.ok==true,try await tabs.inputIdentity()==before.identity else{throw fail("input_capture_changed")};return token
  }
  private func paste(_ text:String,into before:Observed,ticket:UInt64) async throws {
    guard let input,let binding=before.binding else{throw fail("agent_input_unavailable")}
    _=try await checked(before,ticket:ticket,text:"");let token=try await capture(before,ticket:ticket)
    var refused:String?
    let ok=await input.insertAssistantDraft(text,targetToken:token,isAllowed:{
      if !self.interaction.isCurrent(ticket){refused="manual_input_changed";return false}
      if (try? self.binding(tty:before.tab.tty)) != binding {refused="agent_owner_changed";return false}
      if (try? MacAssistantForeground.read(tty:before.tab.tty)) != before.foreground {refused="foreground_changed";return false}
      guard let screen=try? await MacAssistantComposerRendering.shared.read(ticket:ticket,raw:{try self.screen()}) else{refused="screen_unavailable";return false}
      let view=assistantObserveDraft(screen,viewportRows:assistantTerminalRows(before.tab.tty))
      if view.text != "" {refused="input_not_empty_"+view.reasonCode;return false}
      if (try? await self.tabs.assistantVerifiedInputIdentity(tabID:before.tabId)) != before.identity {refused="selected_input_changed";return false}
      if !self.interaction.isCurrent(ticket) || (try? self.binding(tty:before.tab.tty)) != binding ||
        (try? MacAssistantForeground.read(tty:before.tab.tty)) != before.foreground {refused="owner_changed_after_screen_read";return false}
      return true
    },verifyPaste:{
      guard self.interaction.isCurrent(ticket),let screen=try? await MacAssistantComposerRendering.shared.read(ticket:ticket,raw:{try self.screen()}) else{return false}
      self.diagnosticStep?("paste-verification:"+assistantObserveDraft(screen,viewportRows:assistantTerminalRows(before.tab.tty)).reasonCode)
      return assistantDraftMatches(screen,expected:text,viewportRows:assistantTerminalRows(before.tab.tty)) || assistantCollapsedPasteMatches(screen,payload:text)
    },terminalIdentity:{[tabs] in try await tabs.inputIdentity()})
    guard ok else{throw fail(refused.map{"paste_not_dispatched_"+$0} ?? "draft_paste_unverified")}
    let context=MacAssistantDraftProvenance.Context(input:before.identity,process:binding.instanceId,session:binding.conversation?.sessionId,foreground:before.foreground.identity,generation:ticket)
    restored.remember(text,context:context);exactPastes[before.tab.tty]=(context,text)
    _=try await checked(before,ticket:ticket,text:text)
  }
  private func localCommand(_ command:String,_ before:Observed,requestId:String,ticket:UInt64) async throws -> [String:AssistantValue] {
    guard ["/status","/quit"].contains(command) else{throw fail("unsupported_account_local_command")}
    guard let input,let binding=before.binding,let text=before.fields["draft"]?.object?["text"]?.string,
      before.fields["busy"]?.bool==false,before.fields["queueEmpty"]?.bool==true,
      MacCodexComposerCapabilities(screen:before.screen,version:binding.version).canSubmit else{throw fail("status_requires_idle_supported_composer")}
    let file=root.appendingPathComponent(requestId+".json")
    // If an effect started, its original receipt must be reconciled. Reusing an
    // id never repeats a clear or /status Enter after an uncertain worker exit.
    guard !FileManager.default.fileExists(atPath:file.path) else{throw fail("status_recovery_requires_reconciliation")}
    var recovery:[String:AssistantValue]=["requestId":.string(requestId),"source":.object(before.fields),"command":.string(command),"stage":.string("captured")]
    try persist(requestId,recovery)
    if !text.isEmpty {
      guard MacCodexComposerCapabilities(screen:before.screen,version:binding.version).canClear else{throw fail("draft_clear_adapter_unverified")}
      _=try await checked(before,ticket:ticket,text:text);let token=try await capture(before,ticket:ticket)
      recovery["stage"] = .string("clear_prepared");try persist(requestId,recovery)
      var clearRefused:String?
      guard await input.clearAssistantDraft(targetToken:token,isAllowed:{
        guard let screen=try? await MacAssistantComposerRendering.shared.read(ticket:ticket,raw:{try self.screen()}) else{clearRefused="screen_unavailable";return false}
        guard MacAssistantSubmissionDraft(screen,rows:assistantTerminalRows(before.tab.tty))==MacAssistantSubmissionDraft(before.screen,rows:assistantTerminalRows(before.tab.tty)) else{clearRefused="draft_changed";return false}
        guard (try? await self.tabs.assistantVerifiedInputIdentity(tabID:before.tabId))==before.identity else{clearRefused="selected_input_changed";return false}
        guard self.interaction.isCurrent(ticket) else{clearRefused="manual_input_changed";return false}
        guard (try? self.binding(tty:before.tab.tty))==binding else{clearRefused="agent_owner_changed";return false}
        guard (try? MacAssistantForeground.read(tty:before.tab.tty))==before.foreground else{clearRefused="foreground_changed";return false}
        return true
      },terminalIdentity:{[tabs] in try await tabs.inputIdentity()}) else{throw fail(clearRefused.map{"clear_not_dispatched_"+$0} ?? "draft_clear_uncertain")}
      try await Task.sleep(for:.milliseconds(180));_ = try await checked(before,ticket:ticket,text:"")
    }
    recovery["stage"] = .string("local_command_paste_prepared");try persist(requestId,recovery)
    // A trailing space closes the slash-command suggestion menu while keeping
    // this the fixed local status command, with no model prompt arguments.
    try await paste(command+" ",into:before,ticket:ticket)
    _=try await checked(before,ticket:ticket,text:command+" ")
    recovery["stage"] = .string("local_command_enter_prepared");try persist(requestId,recovery)
    let commandScreen=try await MacAssistantComposerRendering.shared.read(ticket:ticket){try self.screen()}
    guard try await tabs.assistantVerifiedInputIdentity(tabID:before.tabId)==before.identity else{throw fail("local_command_selected_input_changed")}
    try ensure(ticket)
    guard try self.binding(tty:before.tab.tty)==binding,
      assistantObserveDraft(commandScreen,viewportRows:assistantTerminalRows(before.tab.tty)).text?.trimmingCharacters(in:.whitespacesAndNewlines)==command else{throw fail("local_command_input_changed")}
    guard let pid=NSWorkspace.shared.frontmostApplication?.processIdentifier,input.sendAssistantKey("enter",modifiers:[],targetPID:pid) else{throw fail("status_enter_uncertain")}
    return recovery
  }
  private func status(_ before:Observed,requestId:String,ticket:UInt64) async throws -> Observed {
    guard let binding=before.binding,let text=before.fields["draft"]?.object?["text"]?.string else{throw fail("status_source_unavailable")}
    var recovery=try await localCommand("/status",before,requestId:requestId,ticket:ticket)
    var parsed:MacCodexAccountStatus?
    let priorPanels=before.screen.components(separatedBy:">_ OpenAI Codex (v").count
    for _ in 0..<30 {
      try await Task.sleep(for:.milliseconds(150));try ensure(ticket)
      guard try self.binding(tty:before.tab.tty)==binding else{throw fail("status_owner_changed")}
      let value=try await MacAssistantComposerRendering.shared.read(ticket:ticket){try self.screen()}
      if assistantObserveDraft(value,viewportRows:assistantTerminalRows(before.tab.tty)).text=="",
        value.components(separatedBy:">_ OpenAI Codex (v").count>priorPanels,
        let status=MacCodexAccountStatus.read(value,expectedSession:binding.conversation!.sessionId,expectedDirectory:binding.directory,home:FileManager.default.homeDirectoryForCurrentUser.path){parsed=status;break}
    }
    guard let parsed else{throw fail("fresh_status_unverified")}
    // Local /status must not have created any accepted model turn.
    _=try await checked(before,ticket:ticket,text:"")
    statuses[before.tab.tty] = .init(owner:binding.instanceId,generation:ticket,value:parsed)
    recovery["status"] = try .encode(parsed)
    if !text.isEmpty {
      recovery["stage"] = .string("restore_draft_prepared");try persist(requestId,recovery)
      try await paste(text,into:before,ticket:ticket)
    }
    let after=try await checked(before,ticket:ticket,text:text)
    recovery["stage"] = .string("verified");recovery["result"] = .object(after.fields);try persist(requestId,recovery)
    return after
  }
  func execute(action:String,args:[String:AssistantValue],requestId:String) async throws -> [String:AssistantValue] {
    let ticket=try interaction.ticket();try ensure(ticket)
    guard let source=args["source"]?.object else{throw fail("source_required")}
    let before=try await observe(source,ticket:ticket)
    if action=="observe" {return before.fields}
    if action=="status" {
      guard before.fields["processIdentity"]==source["processIdentity"],before.fields["sessionId"]==source["sessionId"],
        before.fields["directory"]==source["directory"],before.fields["draft"]?.object?["hash"]==source["draft"]?.object?["hash"] else{throw fail("status_target_changed")}
      return try await status(before,requestId:requestId,ticket:ticket).fields
    }
    if action=="stop" {
      guard let binding=before.binding,before.fields["processIdentity"]==source["processIdentity"],
        before.fields["sessionId"]==source["sessionId"],before.fields["acceptedTurnsHash"]==source["acceptedTurnsHash"],
        before.fields["shellIdentity"]==source["shellIdentity"],before.fields["draft"]?.object?["hash"]==source["draft"]?.object?["hash"],
        before.fields["model"]==source["model"],before.fields["reasoningEffort"]==source["reasoningEffort"],
        before.fields["busy"]?.bool==false,before.fields["queueEmpty"]?.bool==true,before.fields["settingsVerified"]?.bool==true,
        Int32(binding.pid) != nil else{throw fail("idle_source_changed")}
      // The supported local exit command allows the TUI to restore its screen
      // and terminal mode. SIGTERM can leave a stale composer painted into the
      // shell, which is not a safe launch target. The original draft is durable
      // before it is temporarily replaced; no model message is submitted.
      _=try await localCommand("/quit",before,requestId:requestId,ticket:ticket)
      var pending="source_exit_unconfirmed"
      for _ in 0..<40 {
        try await Task.sleep(for:.milliseconds(150))
        do {
          let after=try await observe(source,ticket:ticket)
          if after.fields["kind"]?.string=="shell",after.fields["shellIdentity"]==source["shellIdentity"] {
            guard try MacCodexAccountHandoffEvidence.acceptedHistory(binding.conversation!.path)==source["acceptedTurnsHash"]?.string else{throw fail("accepted_history_changed_during_exit")}
            try persist(requestId,["stage":.string("verified"),"source":.object(source),"result":.object(after.fields)]);return after.fields
          }
        } catch let error as MacCodexInputFailure {pending=error.code}
      }
      throw fail("source_exit_unconfirmed_"+pending)
    }
    if action=="draft" {
      guard before.fields["processIdentity"]==source["processIdentity"],before.fields["sessionId"]==source["sessionId"],
        before.fields["acceptedTurnsHash"]==source["acceptedTurnsHash"],let text=args["text"]?.string,!text.isEmpty,text.utf8.count<=16*1024 else{throw fail("draft_target_changed")}
      try persist(requestId,["stage":.string("paste_prepared"),"source":.object(source),"text":.string(text)])
      try await paste(text,into:before,ticket:ticket);let after=try await observe(source,ticket:ticket)
      try persist(requestId,["stage":.string("verified"),"result":.object(after.fields)]);return after.fields
    }
    if action=="launch" {
      guard let input,let target=args["target"]?.object,before.fields["kind"]?.string=="shell",before.fields["shellIdentity"]==source["shellIdentity"] else{throw fail("launch_shell_changed")}
      let command=try MacCodexAccountHandoffEvidence.launchCommand(source:source,target:target,requestId:requestId)
      let inspected=try await shellInput.inspect(tabId:before.tabId,input:input,ticket:ticket,verifiedSelection:before.identity)
      guard inspected["kind"]?.string=="shell",inspected["draftText"]?.string=="" else{throw fail("launch_shell_not_empty")}
      try persist(requestId,["stage":.string("launch_paste_prepared"),"source":.object(source),"target":.object(target),"command":.string(command)])
      _=try await shellInput.execute("terminal.native.type",args:["tabId":.string(before.tabId),"inputToken":inspected["inputToken"]!,"inputSessionId":inspected["inputSessionId"]!,"mode":.string("insert"),"expectedText":.string(""),"text":.string(command)],input:input)
      let fresh=try await shellInput.inspect(tabId:before.tabId,input:input,ticket:ticket,verifiedSelection:before.identity)
      guard fresh["draftText"]?.string==command else{throw fail("launch_command_changed")};try ensure(ticket)
      try persist(requestId,["stage":.string("launch_enter_prepared"),"source":.object(source),"target":.object(target),"command":.string(command)])
      _=try await shellInput.execute("terminal.key",args:["tabId":.string(before.tabId),"inputToken":fresh["inputToken"]!,"inputSessionId":fresh["inputSessionId"]!,"key":.string("enter"),"intent":.string("submit")],input:input)
      for _ in 0..<50 {
        try await Task.sleep(for:.milliseconds(200))
        if let after=try? await observe(source,ticket:ticket),after.fields["kind"]?.string=="agent" {
          guard after.fields["sessionId"]==source["sessionId"],after.fields["directory"]==source["directory"],after.fields["authorizationHome"]==target["authorizationHome"],
            after.fields["acceptedTurnsHash"]==source["acceptedTurnsHash"] else{throw fail("resumed_owner_or_history_changed")}
          let result=try await status(after,requestId:requestId+".status",ticket:ticket)
          try persist(requestId,["stage":.string("verified"),"source":.object(source),"target":.object(target),"result":.object(result.fields)]);return result.fields
        }
      }
      throw fail("resume_startup_pending")
    }
    throw fail("unsupported_account_native_action")
  }
}
