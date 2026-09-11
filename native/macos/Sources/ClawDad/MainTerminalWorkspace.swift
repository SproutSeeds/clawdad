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
  var nameIsExplicit: Bool? = nil
  var lifetime: String? = nil
  var identityIssue: String? = nil
  var historical: Bool? = nil
  var isBusy: Bool? = nil
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
  var identityIssue: String? = nil
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
  // Optional for lossless v1 decoding. The roster/previous fields are a
  // compatibility projection of the selected snapshot, never a live inventory.
  var snapshots: [MainWorkspaceSavedSnapshot]?
  var selectedSnapshotId: String?
  var operations: [String: MainWorkspaceRestoreOperation]?
  var observations: [MainWorkspaceLiveTab]?
  var requests: [String: String]?
  var closePlans: [String: MainWorkspaceClosePlan]?
  var migrationBackup: String?
}
struct MainWorkspaceSavedSnapshot: Codable, Identifiable {
  var id: String
  var name: String
  var revision: Int = 1
  var roster: MainWorkspaceRoster
  var previous: [MainWorkspaceRoster] = []
  var imported: Bool = false
}
struct MainWorkspaceRestoreOperation: Codable {
  var id: String
  var snapshotRevision: Int
  var status: String
  var progress: [String: MainWorkspaceStep] = [:]
  var anchor: MainWorkspaceLiveTab?
  var separateWindowConfirmed:Bool? = nil
  var message:String? = nil
}
struct MainWorkspaceClosePlan: Codable {
  var token: String
  var capturedAt: Date
  var tabs: [MainWorkspaceLiveTab]
  var status = "confirmation_required"
  var requestId: String?
  var savedSnapshotId: String?
  var message: String?
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
  func finish(_ ordered: [MainWorkspaceLiveTab], selectedId: String?) async throws
  func closeWindow(_ tabs: [MainWorkspaceLiveTab]) async throws
  func areClosed(_ tabs: [MainWorkspaceLiveTab]) async throws -> Bool
}

extension MainWorkspaceNative {
  func snapshot(windowContaining tabId: String) async throws -> MainWorkspaceWindowSnapshot {
    MainWorkspaceWindowSnapshot(anchorId:tabId,tabs:try await inventory(captureDrafts:true))
  }
  func beginRestore(entries:[MainWorkspaceEntry]) async throws {}
  func endRestore() async {}
  func closeWindow(_ tabs: [MainWorkspaceLiveTab]) async throws { throw MacAssistantError("Update the Mac to close a verified whole window.") }
  func areClosed(_ tabs:[MainWorkspaceLiveTab]) async throws -> Bool {
    let live=try await inventory(captureDrafts:false)
    return tabs.allSatisfy{old in !live.contains{$0.tty==old.tty && $0.lifetime==old.lifetime}}
  }
}

/// Manual snapshots are immutable between explicit saves. Runtime observations,
/// creation progress and destructive-operation receipts live in separate fields.
@MainActor final class MainTerminalWorkspace {
  let root: URL
  private let native: MainWorkspaceNative
  private var running = false
  private var lastAutomatic = Date.distantPast
  var beforeAtomicWrite:((MainWorkspaceState)throws->Void)?
  init(root: URL, native: MainWorkspaceNative) { self.root=root;self.native=native }
  private var file: URL { root.appendingPathComponent("main-workspace.json") }
  func read() throws -> MainWorkspaceState {
    guard FileManager.default.fileExists(atPath:file.path) else { return MainWorkspaceState() }
    let state = try JSONDecoder().decode(MainWorkspaceState.self,from:Data(contentsOf:file))
    guard [1,2].contains(state.version) else { throw MacAssistantError("This saved workspace needs a newer ClawDad version.") }
    return state
  }
  private func write(_ state: MainWorkspaceState) throws {
    var state=state
    if state.status=="restoring",let id=state.selectedSnapshotId,state.operations?[id] != nil {
      state.operations![id]?.progress=state.progress
    }
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
    let data = try JSONEncoder().encode(state)
    try beforeAtomicWrite?(state)
    try data.write(to:file,options:.atomic)
    try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
    let fd = open(file.path,O_RDONLY); if fd >= 0 { _ = fsync(fd);close(fd) }
    let dir = open(root.path,O_RDONLY);if dir >= 0 { _ = fsync(dir);close(dir) }
  }
  private func migrate(_ state: inout MainWorkspaceState) throws {
    guard state.version == 1 else { return }
    if FileManager.default.fileExists(atPath:file.path) {
      let backup=root.appendingPathComponent("migration-backups/v1-\(UUID().uuidString)/main-workspace.json")
      try FileManager.default.createDirectory(at:backup.deletingLastPathComponent(),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
      let bytes=try Data(contentsOf:file)
      try bytes.write(to:backup,options:.atomic)
      try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:backup.path)
      let fd=open(backup.path,O_RDONLY);if fd>=0 { _=fsync(fd);close(fd) }
      guard try Data(contentsOf:backup)==bytes else { throw MacAssistantError("Workspace backup verification failed. Migration stopped; the original is intact.") }
      state.migrationBackup=backup.path
    }
    let originals=([state.roster]+state.previous).filter{!$0.entries.isEmpty}
    state.snapshots=originals.enumerated().map { index,original in
      var roster=original
      for i in roster.entries.indices {
        let entry=roster.entries[i]
        if entry.kind != "codex" || entry.sessionId.flatMap(UUID.init(uuidString:)) == nil {
          roster.entries[i].identityIssue="Legacy identity needs review. This record does not prove a resumable agent or an intentional shell. Inspect the live tab and save a new named snapshot; the original remains in the migration backup."
        }
        if let id=entry.sessionId,roster.entries.filter({$0.sessionId==id}).count>1 {
          roster.entries[i].identityIssue="Multiple legacy entries claim this conversation. Review the exact session before restoring."
        }
      }
      return MainWorkspaceSavedSnapshot(id:UUID().uuidString.lowercased(),name:index==0 ? "Imported Main Workspace" : "Legacy recovery \(index)",roster:roster,imported:true)
    }
    state.version=2;state.selectedSnapshotId=state.snapshots?.first?.id
    if let first=state.snapshots?.first { state.roster=first.roster;state.previous=[] }
    // Carry interrupted creation/launch receipts into the imported setup. A
    // migration must never make an uncertain native dispatch look unattempted.
    state.operations=[:];state.requests=state.receipts;state.closePlans=[:]
    if let first=state.snapshots?.first,!state.progress.isEmpty {
      state.operations![first.id]=MainWorkspaceRestoreOperation(id:state.activeRequest ?? UUID().uuidString.lowercased(),
        snapshotRevision:first.revision,status:"needs_attention",progress:state.progress)
    }
    state.status=originals.isEmpty ? "not_saved":"needs_review"
    state.message=originals.isEmpty ? nil:"Legacy data was preserved as recoverable snapshots. Review flagged identities before restoring them; save a new named snapshot to capture the exact current lineup."
    try write(state)
  }
  private func lock() throws -> Int32 {
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
    let fd=open(root.appendingPathComponent("restore.lock").path,O_CREAT|O_RDWR,0o600)
    guard fd >= 0 else { throw MacAssistantError("The local workspace lock could not be opened.") }
    guard flock(fd,LOCK_EX|LOCK_NB)==0 else { close(fd);throw MacAssistantError("Main Workspace is already being updated. Check its progress.") }
    return fd
  }
  /// Rename only an already-approved exact member; never adopts a live tab.
  func renameExisting(name: String, sessionId: String?, directory: String?, owner: String, tty: String) throws -> Bool {
    // Renaming a live tab does not rewrite a manually captured setup. Save /
    // Update explicitly to capture the new name, with its previous version.
    return false
  }
  func fields() -> [String:AssistantValue] {
    do {
      let state=try read()
      return ["revision":.number(Double(state.revision)),"status":.string(state.status),
        "message":state.message.map(AssistantValue.string) ?? .null,
        "savedAt":state.roster.savedAt.map { .string(ISO8601DateFormatter().string(from:$0)) } ?? .null,
        "observedAt":state.observedAt.map { .string(ISO8601DateFormatter().string(from:$0)) } ?? .null,
        "fullScreen":.bool(false),"capturedFullScreen":.bool(state.roster.fullScreen),"windowPresentation":.string("fillAvailableDisplay"),"snapshotCount":.number(Double(state.previous.count)),
        "selectedSnapshotId":state.selectedSnapshotId.map(AssistantValue.string) ?? .null,
        "activeRequest":state.activeRequest.map(AssistantValue.string) ?? .null,
        "migrationBackup":state.migrationBackup.map(AssistantValue.string) ?? .null,
        "namedSnapshots":.array((state.snapshots ?? []).map { snapshot in .object([
          "id":.string(snapshot.id),"name":.string(snapshot.name),"revision":.number(Double(snapshot.revision)),
          "count":.number(Double(snapshot.roster.entries.count)),"imported":.bool(snapshot.imported),
          "needsReview":.bool(snapshot.roster.entries.contains{$0.identityIssue != nil}),
          "savedAt":snapshot.roster.savedAt.map{.string(ISO8601DateFormatter().string(from:$0))} ?? .null]) }),
        "snapshots":.array(state.previous.enumerated().map{.object(["index":.number(Double($0.offset)),"count":.number(Double($0.element.entries.count))])}),
        "entries":.array(state.roster.entries.map { entry in
          ["id":.string(entry.id),"name":.string(entry.name),"directory":.string(entry.directory),
           "kind":.string(entry.kind),"sessionId":entry.sessionId.map(AssistantValue.string) ?? .null,
           "status":.string(state.progress[entry.id]?.phase ?? "saved"),
           "message":Self.notice(entry,progress:entry.identityIssue ?? state.progress[entry.id]?.message).map(AssistantValue.string) ?? .null,
           "identityIssue":entry.identityIssue.map(AssistantValue.string) ?? .null,
           "pendingReceipts":.array((entry.pendingReceipts ?? []).map(AssistantValue.string)),
           "draftAvailable":.bool(entry.draft?.text?.isEmpty == false),
           "draftText":entry.draft?.text.map(AssistantValue.string) ?? .null,
           "draftLimitation":entry.draft?.limitation.map(AssistantValue.string) ?? .null] as [String:AssistantValue]
        }.map(AssistantValue.object))]
    } catch { return ["status":.string("needs_attention"),"message":.string("The saved workspace could not be read: \(error.localizedDescription). Its file was preserved.")] }
  }
  static func matches(_ entry: MainWorkspaceEntry, _ live: MainWorkspaceLiveTab) -> Bool {
    if let session=entry.sessionId { return live.historical != true && live.sessionId==session && live.directory==entry.directory }
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
      var state=try read();try migrate(&state)
      let live=try await native.inventory(captureDrafts:false)
      state.observations=live
      state.observedAt=Date();try write(state)
    } catch { /* Keep the last good snapshot; an unavailable inventory is not an empty roster. */ }
  }
  private func choose(_ state: inout MainWorkspaceState, id: String?) throws {
    guard let id=id ?? state.selectedSnapshotId else { return }
    guard let snapshot=state.snapshots?.first(where:{$0.id==id}) else { throw MacAssistantError("That saved snapshot is unavailable. Refresh the list.") }
    if id != state.selectedSnapshotId {
      let operation=state.operations?[id]
      state.status=operation?.status ?? (snapshot.roster.entries.contains{$0.identityIssue != nil} ? "needs_review":"saved")
      state.message=operation?.message;state.activeRequest=operation?.id
    }
    state.selectedSnapshotId=id;state.roster=snapshot.roster;state.previous=snapshot.previous
    state.progress=state.operations?[id]?.progress ?? [:]
  }
  private func commitSnapshot(_ state: inout MainWorkspaceState, name: String, updating: String?) throws {
    let name=name.trimmingCharacters(in:.whitespacesAndNewlines)
    guard !name.isEmpty,name.count<=80,!name.contains("\n") else { throw MacAssistantError("Give the snapshot a name of 1–80 characters.") }
    if let updating,let i=state.snapshots?.firstIndex(where:{$0.id==updating}) {
      state.snapshots![i].name=name;state.snapshots![i].roster=state.roster
      state.snapshots![i].previous=state.previous;state.snapshots![i].revision += 1
      state.snapshots![i].imported=false;state.selectedSnapshotId=updating
      state.operations?.removeValue(forKey:updating)
    } else {
      guard (state.snapshots?.count ?? 0)<64 else { throw MacAssistantError("The local library supports 64 named setups. Update an existing snapshot.") }
      let snapshot=MainWorkspaceSavedSnapshot(id:UUID().uuidString.lowercased(),name:name,roster:state.roster)
      state.snapshots=(state.snapshots ?? [])+[snapshot];state.selectedSnapshotId=snapshot.id;state.previous=[]
    }
  }
  private func capture(_ state: inout MainWorkspaceState, tabId:String, name:String, updating:String?) async throws -> [MainWorkspaceLiveTab] {
    let snapshot=try await native.snapshot(windowContaining:tabId)
    guard let anchor=snapshot.tabs.first(where:{$0.tabId==snapshot.anchorId}) else { throw MacAssistantError("The chosen window changed. Inspect it again.") }
    let group=snapshot.tabs.filter{$0.group==anchor.group}.sorted{$0.position<$1.position}
    guard !group.isEmpty,Set(group.map(\.tty)).count==group.count else { throw MacAssistantError("The complete window lineup is unavailable. The previous snapshot was preserved.") }
    var issues:[String]=[]
    for tab in group {
      if let issue=tab.identityIssue { issues.append("\(tab.name): \(issue)");continue }
      if tab.owner.isEmpty || !tab.directory.hasPrefix("/") { issues.append("\(tab.name): its exact owner/directory is unavailable.") }
      if tab.kind=="codex" {
        if tab.sessionId.flatMap(UUID.init(uuidString:))==nil || tab.conversationPath==nil || tab.executable==nil {
          issues.append("\(tab.name): Codex has no verified resumable conversation yet. Finish startup and your first intended turn, then save; no dummy message is needed.")
        }
      } else if tab.kind != "shell" { issues.append("\(tab.name): this foreground program cannot be saved as an agent or shell.") }
      if updating != nil,tab.kind=="shell",let lifetime=tab.lifetime,
        state.roster.entries.contains(where:{$0.kind=="codex" && $0.binding?.tty==tab.tty && $0.binding?.lifetime==lifetime}) {
        issues.append("\(tab.name): the previously saved agent has exited, but this shell does not verify its final conversation binding. Resume the exact saved session or inspect its native exit receipt before updating; the known project will not be replaced by a shell directory.")
      }
    }
    let sessions=group.compactMap(\.sessionId)
    if Set(sessions).count != sessions.count { issues.append("More than one tab claims the same conversation. Resolve ownership before saving.") }
    guard issues.isEmpty else { throw MacAssistantError(issues.joined(separator:"\n")+" The previous snapshot is intact.") }
    if let updating { try choose(&state,id:updating);archive(&state) } else { state.previous=[];state.roster=MainWorkspaceRoster() }
    let entries=group.map { tab in
      let existing=state.roster.entries.filter{Self.matches($0,tab)}
      return MainWorkspaceEntry(id:existing.count==1 ? existing[0].id:UUID().uuidString.lowercased(),directory:tab.directory,
        kind:tab.kind,sessionId:tab.sessionId,conversationPath:tab.conversationPath,executable:tab.executable,
        name:tab.name,draft:tab.draft,binding:tab,model:tab.model,effort:tab.effort,pendingReceipts:tab.pendingReceipts)
    }
    for entry in entries { try native.checkDirectory(entry) }
    // Exactly the chosen physical window, including intentional shell tabs.
    state.roster=MainWorkspaceRoster(entries:entries,selectedId:entries.first{$0.binding?.selected==true}?.id ?? entries.first{$0.binding?.tabId==snapshot.anchorId}?.id,
      fullScreen:anchor.fullScreen,savedAt:Date())
    try commitSnapshot(&state,name:name,updating:updating)
    state.progress=[:];state.status="saved";state.message="\(name) saved: \(entries.count) tabs. Update replaces this lineup; previous versions remain recoverable."
    return group
  }
  static func sameWindow(_ expected:[MainWorkspaceLiveTab],_ current:[MainWorkspaceLiveTab],drafts:Bool) -> Bool {
    guard expected.count==current.count,!expected.isEmpty,Set(current.map(\.group)).count==1 else { return false }
    return expected.allSatisfy { old in
      guard let tab=current.first(where:{$0.tty==old.tty}),tab.owner==old.owner,tab.lifetime==old.lifetime,
        tab.sessionId==old.sessionId,tab.kind==old.kind,tab.directory==old.directory,tab.position==old.position else { return false }
      return !drafts || (tab.draft?.text==old.draft?.text && tab.draft?.limitation==old.draft?.limitation && tab.isBusy==old.isBusy)
    }
  }
  private func closeFields(_ plan:MainWorkspaceClosePlan) throws -> [String:AssistantValue] {
    ["closePlan":try .encode(plan),"status":.string(plan.status),"message":plan.message.map(AssistantValue.string) ?? .null,
     "tabCount":.number(Double(plan.tabs.count)),"runningAgents":.number(Double(plan.tabs.filter{$0.isBusy==true}.count)),
     "unsentDrafts":.number(Double(plan.tabs.filter{$0.draft?.text?.isEmpty==false}.count)),
     "unrecoverableDrafts":.number(Double(plan.tabs.filter{$0.draft?.text==nil}.count)),
     "windowTitle":.string("Terminal Window \(plan.tabs.first?.group ?? "")"),
     "confirmation":.string("Close Terminal Window \(plan.tabs.first?.group ?? "") and its \(plan.tabs.count) tabs? \(plan.tabs.filter{$0.isBusy==true}.count) agents are working; \(plan.tabs.filter{$0.draft?.text?.isEmpty==false}.count) drafts are unsent. Closing stops work in this window. Reopening restores saved history, not an in-memory computation. Save recoverable drafts first. Other windows and snapshots remain intact.")]
  }
  func control(_ action: String,args:[String:AssistantValue],requestId:String) async throws -> [String:AssistantValue] {
    if action=="mainworkspace.status" { return fields() }
    guard !running else { var result=fields();result["status"] = .string("operation_in_progress");return result }
    let fd=try lock();defer { flock(fd,LOCK_UN);close(fd) }
    running=true;defer { running=false }
    var state=try read();try migrate(&state)
    let fingerprint=action+String(data:try JSONEncoder().encode(args.sorted { $0.key<$1.key }.map { [$0.key:$0.value] }),encoding:.utf8)!
    if let original=state.requests?[requestId] ?? state.receipts[requestId],original != fingerprint {
      throw MacAssistantError("This request ID belongs to different instructions. Nothing was dispatched.")
    }
    if action=="mainworkspace.close.inspect" {
      if let plan=state.closePlans?.values.first(where:{$0.requestId==requestId}) { return try closeFields(plan) }
      guard let id=args["tabId"]?.string else { throw MacAssistantError("Choose the exact window to inspect before closing.") }
      let snapshot=try await native.snapshot(windowContaining:id)
      guard let anchor=snapshot.tabs.first(where:{$0.tabId==snapshot.anchorId}) else { throw MacAssistantError("The window changed. Inspect it again.") }
      let members=snapshot.tabs.filter{$0.group==anchor.group}.sorted{$0.position<$1.position}
      guard !members.isEmpty,members.allSatisfy({!$0.owner.isEmpty && !$0.tty.isEmpty}) else { throw MacAssistantError("The whole window could not be identified. No close was requested.") }
      let plan=MainWorkspaceClosePlan(token:UUID().uuidString.lowercased(),capturedAt:Date(),tabs:members,requestId:requestId)
      state.closePlans=state.closePlans ?? [:];state.closePlans![plan.token]=plan
      state.requests=state.requests ?? [:];state.requests![requestId]=fingerprint
      try write(state);return try closeFields(plan)
    }
    if action=="mainworkspace.close" {
      guard let token=args["confirmationToken"]?.string,var plan=state.closePlans?[token] else { throw MacAssistantError("Inspect the window again to obtain a close confirmation.") }
      if ["closed","cancelled","uncertain"].contains(plan.status) { return try closeFields(plan) }
      if plan.status=="dispatching" {
        plan.status=try await native.areClosed(plan.tabs) ? "closed":"uncertain"
        plan.message=plan.status=="closed" ? "The exact window is closed.":"Close delivery is uncertain. Inspect the remaining tabs; this request will not repeat a destructive action."
        state.closePlans![token]=plan;try write(state);return try closeFields(plan)
      }
      guard args["confirm"]?.bool != nil else { throw MacAssistantError("Confirm closing the inspected window, including stopping its running work, or cancel.") }
      if args["confirm"]?.bool==false { plan.status="cancelled";state.closePlans![token]=plan;state.requests=state.requests ?? [:];state.requests![requestId]=fingerprint;try write(state);return try closeFields(plan) }
      guard Date().timeIntervalSince(plan.capturedAt)<300 else { throw MacAssistantError("The window confirmation expired. Inspect it again; no close was sent.") }
      let live=try await native.inventory(captureDrafts:false)
      // A Space transition may temporarily bind only the selected member.
      // Any exact inspected owner can anchor the complete window reinspection.
      guard let anchor=live.first(where:{current in plan.tabs.contains{old in
        current.tty==old.tty && current.lifetime==old.lifetime && current.owner==old.owner &&
          current.sessionId==old.sessionId && current.directory==old.directory
      }}) else { throw MacAssistantError("The inspected window identity changed. Nothing was closed.") }
      let fresh=try await native.snapshot(windowContaining:anchor.tabId)
      guard let selected=fresh.tabs.first(where:{$0.tabId==fresh.anchorId}) else { throw MacAssistantError("The inspected window changed.") }
      let members=fresh.tabs.filter{$0.group==selected.group}.sorted{$0.position<$1.position}
      guard Self.sameWindow(plan.tabs,members,drafts:true) else { throw MacAssistantError("The window's tabs, owners, running state or drafts changed. Inspect and confirm the current window; nothing was closed.") }
      if let name=args["saveName"]?.string {
        guard members.allSatisfy({$0.draft?.text != nil && ($0.pendingReceipts ?? []).isEmpty}) else {
          throw MacAssistantError("Save and close requires every draft to be recoverable and pending deliveries resolved. Inspect the flagged inputs or save without closing; the window remains open.")
        }
        let updating=args["snapshotId"]?.string
        guard args["expectedRevision"]?.number==Double(state.revision) else { throw MacAssistantError("Refresh the snapshot revision before saving and closing.") }
        _=try await capture(&state,tabId:anchor.tabId,name:name,updating:updating)
        plan.savedSnapshotId=state.selectedSnapshotId;state.revision += 1;try write(state)
      }
      // Persist the one-way boundary before touching the native close control.
      plan.tabs=members;plan.status="dispatching";plan.requestId=requestId
      state.closePlans![token]=plan;state.requests=state.requests ?? [:];state.requests![requestId]=fingerprint;try write(state)
      do {
        try await native.closeWindow(members)
        guard try await native.areClosed(members) else {
          throw MacAssistantError("Terminal has not confirmed every inspected tab closed. Review remaining tabs; close will not be repeated automatically.")
        }
        plan.status="closed";plan.message="The exact window is closed. Saved snapshots, project files and conversation histories are preserved."
      } catch { plan.status="uncertain";plan.message=error.localizedDescription }
      state.closePlans![token]=plan;state.receipts[requestId]=fingerprint;try write(state);return try closeFields(plan)
    }
    if state.receipts[requestId] != nil { return fields() }
    if !["mainworkspace.restore","mainworkspace.inspect"].contains(action),args["expectedRevision"]?.number != Double(state.revision) {
      throw MacAssistantError("The snapshot library changed. Refresh before updating it.")
    }
    if let id=args["snapshotId"]?.string { try choose(&state,id:id) }
    if action=="mainworkspace.inspect" { try write(state);return fields() }
    state.requests=state.requests ?? [:];state.requests![requestId]=fingerprint;try write(state)
    if action=="mainworkspace.save" {
      guard let anchor=args["tabId"]?.string else { throw MacAssistantError("Choose a tab in the intended window.") }
      let updating=args["snapshotId"]?.string
      let name=args["name"]?.string ?? state.snapshots?.first{$0.id==updating}?.name ?? "Main Workspace"
      _=try await capture(&state,tabId:anchor,name:name,updating:updating)
    } else if ["mainworkspace.remove","mainworkspace.recover"].contains(action) {
      guard let id=state.selectedSnapshotId,let name=state.snapshots?.first(where:{$0.id==id})?.name else { throw MacAssistantError("Choose a named snapshot.") }
      if action=="mainworkspace.remove" {
        guard let entry=args["entryId"]?.string,state.roster.entries.contains(where:{$0.id==entry}) else { throw MacAssistantError("Choose an existing saved project.") }
        archive(&state);state.roster.entries.removeAll{$0.id==entry}
        if state.roster.selectedId==entry { state.roster.selectedId=state.roster.entries.first?.id }
      } else {
        guard let index=args["snapshotIndex"]?.number,Int(index)>=0,Int(index)<state.previous.count else { throw MacAssistantError("Choose an available previous version.") }
        let recovered=state.previous[Int(index)];archive(&state);state.roster=recovered
      }
      try commitSnapshot(&state,name:name,updating:id);state.progress=[:];state.status="saved"
      state.message="Saved record updated. Live work was preserved. Restore explicitly to reopen this setup."
    } else if action=="mainworkspace.restore" {
      guard let snapshot=state.snapshots?.first(where:{$0.id==state.selectedSnapshotId}),!snapshot.roster.entries.isEmpty else { throw MacAssistantError("Choose a saved snapshot first.") }
      var operation=state.operations?[snapshot.id]
      if operation?.snapshotRevision != snapshot.revision { operation=nil }
      let live=try await native.inventory(captureDrafts:false)
      if let prior=operation,prior.status=="restored",!prior.progress.values.contains(where:{step in live.contains{tab in step.binding?.tty==tab.tty && step.binding?.owner==tab.owner}}) {
        operation=nil
      }
      if operation==nil { operation=MainWorkspaceRestoreOperation(id:requestId,snapshotRevision:snapshot.revision,status:"restoring") }
      if let reuse=args["reuseWindowTabId"]?.string {
        guard let anchor=live.first(where:{$0.tabId==reuse}) else { throw MacAssistantError("The chosen reuse window changed. Refresh before restoring.") }
        operation!.anchor=anchor
      }
      if args["newWindowConfirmed"]?.bool==true { operation!.separateWindowConfirmed=true }
      state.operations=state.operations ?? [:];state.operations![snapshot.id]=operation!
      state.progress=operation!.progress;state.activeRequest=operation!.id;state.status="restoring";state.message=nil;try write(state)
      do { try await native.beginRestore(entries:state.roster.entries);try await restore(&state,requestId:requestId) }
      catch { state.status="needs_attention";state.message=error.localizedDescription }
      await native.endRestore()
      state.operations![snapshot.id]?.status=state.status;state.operations![snapshot.id]?.progress=state.progress
      state.operations![snapshot.id]?.message=state.message
      // The operation ID remains durable while waiting, across phone retries.
      state.activeRequest=operation!.id
    } else { throw AssistantProtocolError.invalid }
    state.receipts[requestId]=fingerprint;state.revision += 1;try write(state)
    return fields()
  }

  private func restore(_ state: inout MainWorkspaceState,requestId:String) async throws {
    var live=try await native.inventory(captureDrafts:true)
    var found: [String:MainWorkspaceLiveTab]=[:]
    for entry in state.roster.entries {
      let matches=live.filter{tab in Self.matches(entry,tab) || (entry.kind=="shell" && state.progress[entry.id]?.binding?.owner==tab.owner && state.progress[entry.id]?.binding?.tty==tab.tty && entry.directory==tab.directory)}
      guard matches.count<=1 else { throw MacAssistantError("More than one live agent owns \(entry.name). Choose the intended runtime before restoring.") }
      if let tab=matches.first { found[entry.id]=tab }
    }
    guard Set(found.values.map(\.group)).count<=1 else { throw MacAssistantError("Saved projects are open in different windows. Choose which window to manage; no tabs were moved or closed.") }
    var anchor=found.values.first
    // A verified CLI exit receipt in the same login lifetime can reuse its
    // exact now-idle shell. The saved conversation ID remains the launch target.
    for entry in state.roster.entries where found[entry.id]==nil {
      let exited=live.filter{$0.historical==true && $0.sessionId==entry.sessionId && $0.directory==entry.directory && $0.draft?.text==""}
      if exited.count==1,let tab=exited.first,state.progress[entry.id]==nil {
        state.progress[entry.id]=MainWorkspaceStep(phase:"created",binding:tab)
        if anchor==nil { anchor=tab }
      }
    }
    if anchor==nil {
      for step in state.progress.values {
        if let binding=step.binding,let tab=live.first(where:{$0.tty==binding.tty && $0.owner==binding.owner}) { anchor=tab;break }
        if let marker=step.marker {
          let pending=live.filter{$0.name==marker && !(step.beforeOwners ?? []).contains($0.owner)}
          if pending.count==1 { anchor=pending[0];break }
        }
      }
    }
    if let saved=state.selectedSnapshotId.flatMap({state.operations?[$0]?.anchor}) {
      guard let current=live.first(where:{$0.tty==saved.tty && $0.lifetime==saved.lifetime}),anchor==nil || anchor?.group==current.group else {
        throw MacAssistantError("The selected reuse window no longer matches this setup. Inspect windows and choose again; no tabs were moved or closed.")
      }
      anchor=current
    }
    if anchor==nil,!live.isEmpty,state.selectedSnapshotId.flatMap({state.operations?[$0]?.separateWindowConfirmed}) != true {
      throw MacAssistantError("Another Terminal setup is open. Choose ‘Reuse chosen window’ to add missing tabs while preserving its work, save and close it first, or explicitly open a separate window. No new window was created.")
    }
    for entry in state.roster.entries {
      if let issue=entry.identityIssue { state.progress[entry.id]=MainWorkspaceStep(phase:"needs_attention",message:issue);try write(state);continue }
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
        step.phase="restored";step.binding=ready;step.message=entry.draft?.limitation
        state.progress[entry.id]=step
        found[entry.id]=ready;anchor=ready
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
      try await native.finish(ordered,selectedId:state.roster.selectedId.flatMap{found[$0]?.tabId})
    }
    let complete=state.roster.entries.allSatisfy{["restored","already_open"].contains(state.progress[$0.id]?.phase ?? "")}
    state.status=complete ? "restored":"waiting"
    state.message=complete ? "Main Workspace is open. Submitted work and native queue entries were not replayed." : "Some projects need a drive, session, trust decision or ownership review. Retry restores only verified missing work."
  }
}
