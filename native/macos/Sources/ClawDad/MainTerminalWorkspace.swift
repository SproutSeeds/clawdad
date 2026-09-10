import Foundation
import Darwin
import ClawDadRemoteAssistProtocol

struct MainWorkspaceDraft: Codable, Equatable {
  var text: String?
  var limitation: String?
  var capturedAt: Date
  var transcriptOffset: UInt64?
}
struct MainWorkspaceLiveTab: Codable, Equatable {
  var tabId: String
  var group: String
  var tty: String
  var owner: String
  var directory: String
  var kind: String
  var sessionId: String?
  var conversationPath: String?
  var executable: String?
  var name: String
  var position: Int
  var selected: Bool
  var fullScreen: Bool
  var draft: MainWorkspaceDraft?
  var model: String? = nil
  var effort: String? = nil
  var pendingReceipts: [String]? = nil
}
struct MainWorkspaceEntry: Codable, Equatable, Identifiable {
  var id: String
  var directory: String
  var kind: String
  var sessionId: String?
  var conversationPath: String?
  var executable: String?
  var name: String
  var draft: MainWorkspaceDraft?
  var binding: MainWorkspaceLiveTab?
  var model: String? = nil
  var effort: String? = nil
  var pendingReceipts: [String]? = nil
}
struct MainWorkspaceRoster: Codable, Equatable {
  var entries: [MainWorkspaceEntry] = []
  var selectedId: String?
  var fullScreen = false
  var savedAt: Date?
}
struct MainWorkspaceStep: Codable {
  var phase: String
  var marker: String?
  var beforeOwners: [String]?
  var binding: MainWorkspaceLiveTab?
  var message: String?
}
struct MainWorkspaceState: Codable {
  var version = 1
  var revision = 1
  var roster = MainWorkspaceRoster()
  var previous: [MainWorkspaceRoster] = []
  var progress: [String: MainWorkspaceStep] = [:]
  var receipts: [String: String] = [:]
  var activeRequest: String?
  var status = "not_saved"
  var message: String?
  var observedAt: Date?
}
struct MainWorkspaceWindowSnapshot {
  let anchorId:String
  let tabs:[MainWorkspaceLiveTab]
}

@MainActor protocol MainWorkspaceNative: AnyObject {
  func inventory(captureDrafts: Bool) async throws -> [MainWorkspaceLiveTab]
  func snapshot(windowContaining tabId: String) async throws -> MainWorkspaceWindowSnapshot
  func beginRestore(entries:[MainWorkspaceEntry]) async throws
  func endRestore() async
  func checkDirectory(_ entry: MainWorkspaceEntry) throws
  func create(marker: String, anchor: MainWorkspaceLiveTab?) async throws -> MainWorkspaceLiveTab
  func configure(_ tab: MainWorkspaceLiveTab, entry: MainWorkspaceEntry, requestId: String, allowLaunch: Bool) async throws -> MainWorkspaceLiveTab
  func recoverDraft(_ tab: MainWorkspaceLiveTab, entry: MainWorkspaceEntry) async throws
  func finish(_ ordered: [MainWorkspaceLiveTab], selectedId: String?, fullScreen: Bool) async throws
}

extension MainWorkspaceNative {
  func snapshot(windowContaining tabId: String) async throws -> MainWorkspaceWindowSnapshot {
    MainWorkspaceWindowSnapshot(anchorId:tabId,tabs:try await inventory(captureDrafts:true))
  }
  func beginRestore(entries:[MainWorkspaceEntry]) async throws {}
  func endRestore() async {}
}

/// One approved roster. Observations may update known members, never remove or
/// adopt projects. Every external creation/launch has a durable preflight step.
@MainActor final class MainTerminalWorkspace {
  let root: URL
  private let native: MainWorkspaceNative
  private var running = false
  private var lastAutomatic = Date.distantPast
  init(root: URL, native: MainWorkspaceNative) { self.root=root;self.native=native }
  private var file: URL { root.appendingPathComponent("main-workspace.json") }
  func read() throws -> MainWorkspaceState {
    guard FileManager.default.fileExists(atPath:file.path) else { return MainWorkspaceState() }
    let state = try JSONDecoder().decode(MainWorkspaceState.self,from:Data(contentsOf:file))
    guard state.version == 1 else { throw MacAssistantError("This saved workspace needs a newer ClawDad version.") }
    return state
  }
  private func write(_ state: MainWorkspaceState) throws {
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
    let data = try JSONEncoder().encode(state)
    try data.write(to:file,options:.atomic)
    try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
    let fd = open(file.path,O_RDONLY); if fd >= 0 { _ = fsync(fd);close(fd) }
    let dir = open(root.path,O_RDONLY);if dir >= 0 { _ = fsync(dir);close(dir) }
  }
  private func lock() throws -> Int32 {
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
    let fd=open(root.appendingPathComponent("restore.lock").path,O_CREAT|O_RDWR,0o600)
    guard fd >= 0 else { throw MacAssistantError("The local workspace lock could not be opened.") }
    guard flock(fd,LOCK_EX|LOCK_NB)==0 else { close(fd);throw MacAssistantError("Main Workspace is already being updated. Check its progress.") }
    return fd
  }
  func fields() -> [String:AssistantValue] {
    do {
      let state=try read()
      return ["revision":.number(Double(state.revision)),"status":.string(running ? "restoring" : state.status),
        "message":state.message.map(AssistantValue.string) ?? .null,
        "savedAt":state.roster.savedAt.map { .string(ISO8601DateFormatter().string(from:$0)) } ?? .null,
        "observedAt":state.observedAt.map { .string(ISO8601DateFormatter().string(from:$0)) } ?? .null,
        "fullScreen":.bool(state.roster.fullScreen),"snapshotCount":.number(Double(state.previous.count)),
        "entries":.array(state.roster.entries.map { entry in
          ["id":.string(entry.id),"name":.string(entry.name),"directory":.string(entry.directory),
           "kind":.string(entry.kind),"sessionId":entry.sessionId.map(AssistantValue.string) ?? .null,
           "status":.string(state.progress[entry.id]?.phase ?? "saved"),
           "message":Self.notice(entry,progress:state.progress[entry.id]?.message).map(AssistantValue.string) ?? .null,
           "pendingReceipts":.array((entry.pendingReceipts ?? []).map(AssistantValue.string)),
           "draftAvailable":.bool(entry.draft?.text?.isEmpty == false),
           "draftText":entry.draft?.text.map(AssistantValue.string) ?? .null,
           "draftLimitation":entry.draft?.limitation.map(AssistantValue.string) ?? .null] as [String:AssistantValue]
        }.map(AssistantValue.object))]
    } catch { return ["status":.string("needs_attention"),"message":.string("The saved workspace could not be read: \(error.localizedDescription). Its file was preserved.")] }
  }
  static func matches(_ entry: MainWorkspaceEntry, _ live: MainWorkspaceLiveTab) -> Bool {
    if let session=entry.sessionId { return live.sessionId==session && live.directory==entry.directory }
    return entry.binding?.owner==live.owner && entry.binding?.tty==live.tty && entry.directory==live.directory
  }
  static func notice(_ entry:MainWorkspaceEntry,progress:String?)->String? {
    let receiptMessage=(entry.pendingReceipts ?? []).isEmpty ? nil : "Pending or uncertain message receipts need review: \(entry.pendingReceipts!.joined(separator:", ")). Native queue messages are not replayed automatically."
    let parts=[progress,receiptMessage].compactMap{$0}
    return parts.isEmpty ? nil:parts.joined(separator:" ")
  }
  private func archive(_ state: inout MainWorkspaceState) {
    if state.roster.savedAt != nil, state.previous.last != state.roster {
      state.previous.append(state.roster);state.previous=Array(state.previous.suffix(8))
    }
  }
  private func meaningful(_ roster:MainWorkspaceRoster)->MainWorkspaceRoster {
    var value=roster
    for i in value.entries.indices {
      value.entries[i].draft?.capturedAt=Date(timeIntervalSince1970:0)
      value.entries[i].draft?.transcriptOffset=nil
      // Activity titles, selection and AX identifiers are observations. They
      // must not evict recoverable draft history merely because polling ran.
      value.entries[i].binding=nil
    }
    return value
  }
  func automaticSnapshot() async {
    guard !running,Date().timeIntervalSince(lastAutomatic)>30 else { return }
    lastAutomatic=Date()
    guard let fd=try? lock() else { return }; defer { flock(fd,LOCK_UN);close(fd) }
    do {
      var state=try read();guard !state.roster.entries.isEmpty else { return }
      let live=try await native.inventory(captureDrafts:false)
      let previous=state.roster
      for index in state.roster.entries.indices {
        let matches=live.filter { Self.matches(state.roster.entries[index],$0) }
        guard matches.count==1,let tab=matches.first else { continue }
        state.roster.entries[index].binding=tab
        state.roster.entries[index].pendingReceipts=tab.pendingReceipts
        if state.roster.entries[index].sessionId==nil,let session=tab.sessionId {
          state.roster.entries[index].sessionId=session;state.roster.entries[index].conversationPath=tab.conversationPath
          state.roster.entries[index].model=tab.model;state.roster.entries[index].effort=tab.effort
        }
        if let draft=tab.draft { state.roster.entries[index].draft=draft }
      }
      if meaningful(previous) != meaningful(state.roster) { state.previous.append(previous);state.previous=Array(state.previous.suffix(8)) }
      state.observedAt=Date();try write(state)
    } catch { /* Keep the last good snapshot; an unavailable inventory is not an empty roster. */ }
  }
  func control(_ action: String,args:[String:AssistantValue],requestId:String) async throws -> [String:AssistantValue] {
    if action=="mainworkspace.status" { return fields() }
    guard !running else { return fields() }
    let fd=try lock();defer { flock(fd,LOCK_UN);close(fd) }
    running=true;defer { running=false }
    var state=try read()
    let fingerprint=action+String(data:try JSONEncoder().encode(args.sorted { $0.key<$1.key }.map { [$0.key:$0.value] }),encoding:.utf8)!
    if let old=state.receipts[requestId] {
      guard old==fingerprint else { throw MacAssistantError("This workspace request ID belongs to different instructions.") }
      return fields()
    }
    if action != "mainworkspace.restore", args["expectedRevision"]?.number != Double(state.revision) {
      throw MacAssistantError("The saved workspace changed. Refresh before updating it.")
    }
    if action=="mainworkspace.save" {
      guard let anchor=args["tabId"]?.string else { throw MacAssistantError("Choose a tab in the intended Main window.") }
      let snapshot=try await native.snapshot(windowContaining:anchor),live=snapshot.tabs
      guard let selected=live.first(where:{$0.tabId==snapshot.anchorId}) else { throw MacAssistantError("The selected window changed. Refresh and save again.") }
      let group=live.filter{$0.group==selected.group}.sorted{$0.position<$1.position}
      guard !group.isEmpty,group.allSatisfy({!$0.directory.isEmpty && !$0.owner.isEmpty}) else { throw MacAssistantError("Some tabs could not be identified. Complete startup, then save this window again.") }
      archive(&state)
      // Keep absent approved members. Removal is a separate explicit operation.
      var entries: [MainWorkspaceEntry]=[]
      for tab in group {
        let old=state.roster.entries.filter{Self.matches($0,tab)}
        guard old.count<=1 else { throw MacAssistantError("Two saved entries claim one live tab. Review the roster.") }
        entries.append(MainWorkspaceEntry(id:old.first?.id ?? UUID().uuidString.lowercased(),directory:tab.directory,
          kind:tab.kind,sessionId:tab.sessionId,conversationPath:tab.conversationPath,executable:tab.executable,
          name:tab.name,draft:tab.draft ?? old.first?.draft,binding:tab,model:tab.model,effort:tab.effort,pendingReceipts:tab.pendingReceipts))
      }
      entries += state.roster.entries.filter { old in !entries.contains{$0.id==old.id} }
      let selectedTab=group.first(where:{$0.selected})?.tabId ?? snapshot.anchorId
      state.roster=MainWorkspaceRoster(entries:entries,selectedId:entries.first{$0.binding?.tabId==selectedTab}?.id,fullScreen:selected.fullScreen,savedAt:Date())
      state.progress=[:];state.status="saved";state.message="Main Workspace saved. Missing members remain until explicitly removed."
    } else if action=="mainworkspace.remove" {
      guard let id=args["entryId"]?.string,state.roster.entries.contains(where:{$0.id==id}) else { throw MacAssistantError("Choose an existing saved project.") }
      archive(&state);state.roster.entries.removeAll{$0.id==id};state.progress.removeValue(forKey:id)
      if state.roster.selectedId==id { state.roster.selectedId=state.roster.entries.first?.id }
      state.status="saved";state.message="Removed from the saved roster. Its live tab and files were preserved."
    } else if action=="mainworkspace.recover" {
      guard let index=args["snapshotIndex"]?.number,Int(index)>=0,Int(index)<state.previous.count else { throw MacAssistantError("Choose an available previous snapshot.") }
      let recovered=state.previous[Int(index)];archive(&state);state.roster=recovered;state.progress=[:]
      state.status="saved";state.message="Previous snapshot recovered. Restore explicitly to reopen its tabs."
    } else if action=="mainworkspace.restore" {
      guard !state.roster.entries.isEmpty else { throw MacAssistantError("Save the Main Terminal window first.") }
      state.activeRequest=requestId;state.status="restoring";state.message=nil;try write(state)
      do { try await native.beginRestore(entries:state.roster.entries);try await restore(&state,requestId:requestId) }
      catch { state.status="needs_attention";state.message=error.localizedDescription }
      await native.endRestore()
      state.activeRequest=nil
    } else { throw AssistantProtocolError.invalid }
    state.receipts[requestId]=fingerprint;state.revision += 1;try write(state)
    var result=fields();result["status"] = .string(state.status);return result
  }
  private func restore(_ state: inout MainWorkspaceState,requestId:String) async throws {
    var live=try await native.inventory(captureDrafts:true)
    var found: [String:MainWorkspaceLiveTab]=[:]
    for entry in state.roster.entries {
      let matches=live.filter{Self.matches(entry,$0)}
      guard matches.count<=1 else { throw MacAssistantError("More than one live agent owns \(entry.name). Choose the intended runtime before restoring.") }
      if let tab=matches.first { found[entry.id]=tab }
    }
    guard Set(found.values.map(\.group)).count<=1 else { throw MacAssistantError("Saved projects are open in different windows. Choose which window to manage; no tabs were moved or closed.") }
    var anchor=found.values.first
    for entry in state.roster.entries {
      if let tab=found[entry.id] {
        if ["launching","draft_pending"].contains(state.progress[entry.id]?.phase ?? "") {
          do {
            try await native.recoverDraft(tab,entry:entry)
            state.progress[entry.id]=MainWorkspaceStep(phase:"restored",binding:tab)
          } catch { state.progress[entry.id]?.message=error.localizedDescription }
        } else { state.progress[entry.id]=MainWorkspaceStep(phase:"already_open",binding:tab) }
        try write(state)
        continue // Preserve every live draft and agent, including new user edits.
      }
      do {
        try native.checkDirectory(entry)
        var step=state.progress[entry.id] ?? MainWorkspaceStep(phase:"missing")
        var tab=step.binding.flatMap{old in live.first{$0.owner==old.owner && $0.tty==old.tty}}
        if tab==nil, let marker=step.marker {
          let matches=live.filter{$0.name==marker}
          guard matches.count<=1 else { throw MacAssistantError("The creation marker is ambiguous. Review the pending tab; it will not be recreated.") }
          tab=matches.first
          if tab != nil,step.phase=="creating",!(step.beforeOwners ?? []).contains(tab!.owner) { step.phase="created" }
          if tab==nil,step.phase=="creating" { throw MacAssistantError("Tab creation was interrupted before its identity was confirmed. Review Terminal and this receipt before retrying; no duplicate was created.") }
        }
        if tab==nil {
          // An unbound same-directory shell may be an unsaved manual replacement.
          guard !live.contains(where:{candidate in candidate.kind=="shell" && candidate.directory==entry.directory && !found.values.contains(where:{$0.owner==candidate.owner && $0.tty==candidate.tty})}) else {
            throw MacAssistantError("An unbound shell is already open in this directory. Save the intended Main window to adopt it, or review it before restoring.")
          }
          step=MainWorkspaceStep(phase:"creating",marker:"ClawDad Restore \(entry.id)",beforeOwners:live.map(\.owner))
          state.progress[entry.id]=step;try write(state)
          tab=try await native.create(marker:step.marker!,anchor:anchor)
          step.binding=tab;step.phase="created";state.progress[entry.id]=step;try write(state)
        }
        guard let created=tab, anchor==nil || anchor?.group==created.group else { throw MacAssistantError("The pending tab is in another window. Review it; no merging was attempted.") }
        if anchor==nil { anchor=created }
        let allowLaunch=step.phase=="created"
        step.phase="launching";step.binding=created;state.progress[entry.id]=step;try write(state)
        let ready=try await native.configure(created,entry:entry,requestId:requestId,allowLaunch:allowLaunch)
        step.phase="draft_pending";step.binding=ready;state.progress[entry.id]=step;try write(state)
        try await native.recoverDraft(ready,entry:entry)
        step.phase="restored";step.message=entry.draft?.limitation
        state.progress[entry.id]=step
        found[entry.id]=ready;anchor=ready
        if let index=state.roster.entries.firstIndex(where:{$0.id==entry.id}) { state.roster.entries[index].binding=ready }
        live=try await native.inventory(captureDrafts:false)
      } catch {
        var step=state.progress[entry.id] ?? MainWorkspaceStep(phase:"waiting")
        // Retain the durable creation phase to reconcile it on the next attempt.
        if !["creating","created","launching","draft_pending"].contains(step.phase) { step.phase="waiting" }
        step.message=error.localizedDescription;state.progress[entry.id]=step
        if step.phase=="creating" { try write(state);throw error }
      }
      try write(state)
    }
    let ordered=state.roster.entries.compactMap{found[$0.id]}
    if !ordered.isEmpty {
      try await native.finish(ordered,selectedId:state.roster.selectedId.flatMap{found[$0]?.tabId},fullScreen:state.roster.fullScreen)
    }
    let complete=state.roster.entries.allSatisfy{["restored","already_open"].contains(state.progress[$0.id]?.phase ?? "")}
    state.status=complete ? "restored":"waiting"
    state.message=complete ? "Main Workspace is open. Submitted work and native queue entries were not replayed." : "Some projects need a drive, session, trust decision or ownership review. Retry restores only verified missing work."
  }
}
