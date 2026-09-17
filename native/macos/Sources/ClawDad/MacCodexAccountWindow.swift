import Foundation
import ClawDadRemoteAssistProtocol

@MainActor final class MacCodexAccountWindow {
  let native: MacMainWorkspaceNative
  let runtime: MacAssistantRuntime
  let root: URL
  var diagnosticStep: ((String)->Void)? { didSet { native.diagnosticStep=diagnosticStep } }
  var retainedDraft: ((MacCodexInputBinding,String,MacAssistantForeground,String,UInt64)->String?)? {
    didSet { native.retainedDraft=retainedDraft }
  }
  init(runtime: MacAssistantRuntime,root:URL?=nil) {
    self.runtime=runtime;native=MacMainWorkspaceNative(runtime:runtime)
    self.root=root ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ClawDad/Accounts/WindowSwitches")
    native.accountCaptureGuard={binding,screen,retained in
      let text=Self.recoverableDraft(screen,retained:retained,viewportRows:assistantTerminalRows(binding.tty),
        target:"\(URL(fileURLWithPath:binding.directory).lastPathComponent) (\(binding.tty))")
      guard !screen.components(separatedBy:.newlines).contains(where:{$0.trimmingCharacters(in:.whitespaces)=="• Queued follow-up inputs"}) else {
        throw MacAssistantError("Native queued work remains. Let it finish or review it before switching; queued messages will not be replayed.")
      }
      guard let path=binding.conversation?.path else { throw MacAssistantError("This fresh agent has no saved conversation yet.") }
      var activity=MacCodexRequestActivityLog()
      guard try !activity.read(path) else { throw MacAssistantError("This agent is still working. Switch stopped; finish or explicitly stop its work, then check recovery.") }
      return text
    }
  }
  nonisolated static func recoverableDraft(_ screen:String,retained:String?,viewportRows:Int?=nil,target:String) -> String? {
    let draft=assistantObserveDraft(screen,viewportRows:viewportRows)
    guard let visible=draft.text else { return nil }
    if draft.requiresWholeDraftAuthorization {
      // The caller supplies retained text only after exact live process,
      // session, input generation and collapsed-paste verification.
      return retained
    }
    // One fully visible line has no visual-wrap/newline ambiguity. Preserve it
    // as an unsent draft even when Cody typed it rather than using our paste tool.
    guard !visible.contains("\n") else { return nil }
    return visible
  }
  private func permit(_ id:String) async throws {
    let result=try await runtime.json("/v1/assistant/accounts/native-permit",["operationId":.string(id)])
    guard result["allowed"]?.bool==true else { throw MacAssistantError("The account switch was paused or cancelled.") }
  }
  private func launch(_ tab:MainWorkspaceLiveTab) async throws -> MainWorkspaceAccountSwitch.Launch? {
    if tab.kind=="shell" || tab.historical==true { return nil }
    let savedRoot=root
    return try await Task.detached {
      let facts=try MacCodexAccountProcess.inspect(tty:tab.tty,reader:MacCodexAccountProcess.ownerReader(tty:tab.tty))
      guard facts["agentInstanceId"]?.string==tab.owner,facts["sessionId"]?.string==tab.sessionId,
        facts["directory"]?.string==tab.directory,facts["isBusy"]?.bool==false,
        facts["alternateAuthentication"]?.bool==false,let home=facts["authorizationHome"]?.string,
        let pid=facts["processId"]?.string,let process=MacCodexAccountProcess.readFacts(pid) else {
        throw MacAssistantError("\(tab.name)'s exact idle subscription process could not be verified. Its window remains open.")
      }
      // Parsed, supported flags preserve permissions/configuration; prompts and
      // initial image arguments are deliberately excluded from resume commands.
      let managed=try Self.verifiedRouting(process,tab:tab,home:home,root:savedRoot)
      let options=try MacCodexAccountProcess.options(process.arguments,allowVerifiedAccountRouting:managed)
      guard tab.model != nil,tab.effort != nil else { throw MacAssistantError("\(tab.name)'s persisted model and reasoning settings are unavailable. Its process stays open.") }
      return .init(authorizationHome:home,options:options)
    }.value
  }
  nonisolated static func verifiedRouting(_ process:MacCodexAccountProcess.Facts,tab:MainWorkspaceLiveTab,home:String,root:URL) throws -> Bool {
    guard let id=process.accountTransitionId else { return false }
    let paths=[root.appendingPathComponent(id+".json"),root.deletingLastPathComponent().appendingPathComponent("NativeRecovery/"+id+".json")]
    for file in paths {
      guard let attrs=try? FileManager.default.attributesOfItem(atPath:file.path),attrs[.type] as? FileAttributeType == .typeRegular,
        (attrs[.ownerAccountID] as? NSNumber)?.uint32Value==getuid(),((attrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777)&0o077==0,
        (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= 16*1024*1024 else { continue }
      let bytes=try Data(contentsOf:file)
      if let record=try? JSONDecoder().decode(MainWorkspaceAccountSwitch.Record.self,from:bytes),record.operationId==id,
        record.target?.authorizationHome==home,["restoring","verified"].contains(record.stage),
        record.captureHash==MainWorkspaceAccountSwitch.hash(record.tabs,record.launches),
        let entry=record.entries.first(where:{$0.sessionId==tab.sessionId && $0.directory==tab.directory}),
        let bound=record.progress[entry.id]?.binding,bound.tty==tab.tty,bound.lifetime==tab.lifetime,bound.owner==tab.owner { return true }
      if let record=try? JSONDecoder().decode([String:AssistantValue].self,from:bytes),
        ["launch_enter_prepared","verified"].contains(record["stage"]?.string ?? ""),
        record["source"]?.object?["sessionId"]?.string==tab.sessionId,record["source"]?.object?["directory"]?.string==tab.directory,
        record["target"]?.object?["authorizationHome"]?.string==home,
        record["result"]?.object?["processIdentity"]?.string==tab.owner { return true }
    }
    throw MacAssistantError("This managed account launch has no matching recovery receipt. Its running process stays open; inspect the original account switch.")
  }
  private func verify(_ tab:MainWorkspaceLiveTab,_ target:MainWorkspaceAccountSwitch.Target,_ operation:String) async throws {
    guard tab.kind=="codex" else { return }
    let row=try await Task.detached{try MacCodexAccountProcess.inspect(tty:tab.tty,reader:MacCodexAccountProcess.ownerReader(tty:tab.tty))}.value
    guard row["sessionId"]?.string==tab.sessionId,row["directory"]?.string==tab.directory,
      row["agentInstanceId"]?.string==tab.owner,row["authorizationHome"]?.string==target.authorizationHome,
      row["alternateAuthentication"]?.bool==false,
      let pid=row["processId"]?.string,
      MacCodexAccountProcess.readFacts(pid)?.accountTransitionId==operation else {
      throw MacAssistantError("The resumed process, conversation or account route needs verification. Its receipt was preserved.")
    }
  }
  static func command(_ entry:MainWorkspaceEntry,operation:String,target:MainWorkspaceAccountSwitch.Target,launch:MainWorkspaceAccountSwitch.Launch?) throws -> String {
    let q=MacMainWorkspaceNative.quoted
    var command="cd -- \(q(entry.directory))"
    if entry.kind=="shell" { return command }
    guard let session=entry.sessionId,let executable=entry.executable,let model=entry.model,let effort=entry.effort else { throw MacAssistantError("The exact saved Codex launch is incomplete.") }
    command=try MacCodexAccountHandoffEvidence.launchCommand(source:["executable":.string(executable),"directory":.string(entry.directory),
      "sessionId":.string(session),"model":.string(model),"reasoningEffort":.string(effort),"resumeOptions":.array((launch?.options ?? []).map(AssistantValue.string))],
      target:["authorizationHome":.string(target.authorizationHome),"sqliteHome":.string(target.sqliteHome)],requestId:operation)
    return command+MacTerminalProjectLaunch.titleOptions
  }
  private func engine() -> MainWorkspaceAccountSwitch {
    MainWorkspaceAccountSwitch(root:root,native:native,generation:{try MacAssistantInteractionGate.shared.ticket()},
      inspectLaunch:{[self] tab in try await launch(tab)},setLaunch:{[self] operation,target,launches in
        native.accountHistoryRoots=launches.values.map{URL(fileURLWithPath:$0.authorizationHome).appendingPathComponent("sessions")}
        native.accountPermit={try await self.permit(operation)}
        native.accountResumeCommand={entry in try Self.command(entry,operation:operation,target:target,launch:entry.binding.flatMap{launches[$0.tty]})}
        native.accountClaim={id,session in
          let result=try await self.runtime.json("/v1/assistant/main-workspace/claim",["id":.string(id),"sessionId":.string(session),"accountWindow":.bool(true)])
          guard result["allowed"]?.bool==true,let token=result["token"]?.string else { throw MacAssistantError("The saved thread has another owner.") };return token
        }
      },verifyOwner:{[self] tab,target,operation in try await verify(tab,target,operation)},permit:{[self] id in try await permit(id)})
  }
  func execute(action:String,args:[String:AssistantValue]) async throws -> [String:AssistantValue] {
    guard let id=args["operationId"]?.string else { throw AssistantProtocolError.invalid }
    let activity=ProcessInfo.processInfo.beginActivity(options:.userInitiatedAllowingIdleSystemSleep,reason:"Completing the requested Terminal account switch")
    defer { ProcessInfo.processInfo.endActivity(activity) }
    native.accountPermit={try await self.permit(id)}
    let engine=engine();engine.diagnosticStep=diagnosticStep
    let record:MainWorkspaceAccountSwitch.Record
    if action=="window.capture" {
      guard let selection=args["selection"]?.object,let window=selection["id"]?.string,let tab=selection["tabId"]?.string else { throw AssistantProtocolError.invalid }
      record=try await engine.capture(operationId:id,windowId:window,tabId:tab)
    } else if action=="window.restore" {
      guard let value=args["target"] else { throw AssistantProtocolError.invalid }
      let target=try JSONDecoder().decode(MainWorkspaceAccountSwitch.Target.self,from:JSONEncoder().encode(value))
      record=try await engine.restore(operationId:id,target:target)
    } else if action=="window.verify" {
      guard let saved=try engine.read(id),saved.stage=="verified",let target=saved.target else { throw MacAssistantError("The window restoration has not finished.") }
      let live=try await native.inventory(captureDrafts:false)
      for entry in saved.entries {
        guard let expected=saved.progress[entry.id]?.binding,
          let tab=live.first(where:{$0.tty==expected.tty && $0.owner==expected.owner && $0.lifetime==expected.lifetime}) else { throw MacAssistantError("A restored tab changed. Verify the remaining window.") }
        try await verify(tab,target,id)
      }
      record=saved
    } else { throw AssistantProtocolError.invalid }
    return ["stage":.string(record.stage),"captureHash":.string(record.captureHash),"count":.number(Double(record.entries.count)),
      "message":record.message.map(AssistantValue.string) ?? .null]
  }
}
