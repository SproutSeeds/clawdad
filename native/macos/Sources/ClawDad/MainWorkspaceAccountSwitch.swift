import Foundation
import CryptoKit
import Darwin
import ClawDadRemoteAssistProtocol

enum AccountWindowReceiptEvidence {
  static func collect(_ jobs: [[String: AssistantValue]], sessionId: String, tabId: String) -> (pending: [String], retained: [String]) {
    var pending: [String] = [], retained: [String] = []
    for row in jobs {
      let args=row["args"]?.object ?? [:], target=row["sessionId"]?.string ?? args["sessionId"]?.string
      guard let action=row["action"]?.string,action.hasPrefix("terminal."),
        target==sessionId || target==nil && args["tabId"]?.string==tabId,
        let id=row["id"]?.string else { continue }
      let status=row["status"]?.string ?? "unknown", result=row["result"]?.object ?? [:]
      if ["terminal.inspect","terminal.observe","terminal.context","terminal.native.inspect"].contains(action) { continue }
      if ["completed","cancelled","inserted","cleared","replaced","not_dispatched"].contains(status) { continue }
      if ["attention","interrupted"].contains(status) {
        let enter=action=="terminal.key" && args["key"]?.string=="enter" && args["intent"]?.string=="submit"
        let guarded=["terminal.send","terminal.queue","terminal.insert","terminal.prompt"].contains(action) || enter
        let unprepared=guarded && status=="attention" && row["preparedAt"]?.string==nil && row["error"]?.string != nil
        let unsent=enter && result["keySent"]?.bool==false && result["turnAccepted"]?.bool != true ||
          action=="terminal.queue" && result["tabSent"]?.bool==false && result["queueAccepted"]?.bool != true
        // Insert is draft-only, including failures after paste. The account
        // capture separately verifies the current exact draft, idle owner and
        // empty native queue. Keep its receipt; never repeat the old paste.
        let dispatched=["keySent","tabSent","turnAccepted","queueAccepted","submitted"].contains{result[$0]?.bool==true}
        if !dispatched && (unprepared || unsent || action=="terminal.insert") { retained.append(id);continue }
      }
      pending.append(id)
    }
    return (pending,retained)
  }
}

/// Account recovery is independent from the user's named snapshot library.
/// Every irreversible boundary is saved before dispatch. A retry reconciles
/// original owners/creation markers; it never replays an uncertain close/launch.
@MainActor final class MainWorkspaceAccountSwitch {
  struct Launch: Codable, Equatable {
    var authorizationHome: String
    var options: [String]
  }
  struct Target: Codable, Equatable {
    var authorizationHome: String
    var sqliteHome: String
    var accountKey: String
  }
  struct Record: Codable {
    var version = 1
    var operationId: String
    var selection: String
    var tabs: [MainWorkspaceLiveTab]
    var entries: [MainWorkspaceEntry]
    var launches: [String: Launch]
    var capturedAt = Date()
    var generation: UInt64
    var captureHash: String
    var stage = "captured"
    var target: Target?
    var progress: [String: MainWorkspaceStep] = [:]
    var message: String?
    var draftPolicy: String?
  }
  let root: URL
  let native: any MainWorkspaceNative
  let generation: () throws -> UInt64
  var inspectLaunch: (MainWorkspaceLiveTab) async throws -> Launch?
  var setLaunch: (String, Target, [String: Launch]) throws -> Void
  var verifyOwner: (MainWorkspaceLiveTab, Target, String) async throws -> Void
  var permit: (String) async throws -> Void
  var diagnosticStep: ((String)->Void)?
  private var running = false
  private func lock() throws -> Int32 {
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
    let fd=open(root.appendingPathComponent("window-switch.lock").path,O_CREAT|O_RDWR|O_NOFOLLOW,0o600)
    guard fd>=0 else { throw MacAssistantError("The account window recovery lock is unavailable.") }
    guard flock(fd,LOCK_EX|LOCK_NB)==0 else { close(fd);throw MacAssistantError("The original window operation is still running. Keep its request ID.") }
    return fd
  }

  init(root: URL, native: any MainWorkspaceNative, generation: @escaping () throws -> UInt64,
       inspectLaunch: @escaping (MainWorkspaceLiveTab) async throws -> Launch?,
       setLaunch: @escaping (String, Target, [String: Launch]) throws -> Void,
       verifyOwner: @escaping (MainWorkspaceLiveTab, Target, String) async throws -> Void,
       permit: @escaping (String) async throws -> Void) {
    self.root=root;self.native=native;self.generation=generation;self.inspectLaunch=inspectLaunch
    self.setLaunch=setLaunch;self.verifyOwner=verifyOwner;self.permit=permit
  }
  private func file(_ id: String) throws -> URL {
    guard id.range(of:#"^[A-Za-z0-9_.:-]{1,160}$"#,options:.regularExpression) != nil else { throw AssistantProtocolError.invalid }
    return root.appendingPathComponent(id+".json")
  }
  func read(_ id: String) throws -> Record? {
    let url=try file(id)
    guard FileManager.default.fileExists(atPath:url.path) else { return nil }
    let attributes=try FileManager.default.attributesOfItem(atPath:url.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
      (attributes[.ownerAccountID] as? NSNumber)?.uint32Value==getuid(),
      ((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0o777)&0o077==0,
      (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= 16*1024*1024 else { throw MacAssistantError("Account window recovery storage needs inspection.") }
    let record=try JSONDecoder().decode(Record.self,from:Data(contentsOf:url))
    guard record.version==1,record.operationId==id,[nil,"retainOnly"].contains(record.draftPolicy),record.captureHash==Self.hash(record.tabs,record.launches) else { throw MacAssistantError("The account window recovery identity changed. Its data was preserved.") }
    return record
  }
  private func save(_ value: Record) throws {
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
    let attrs=try FileManager.default.attributesOfItem(atPath:root.path)
    guard attrs[.type] as? FileAttributeType == .typeDirectory,
      (attrs[.ownerAccountID] as? NSNumber)?.uint32Value==getuid(),
      ((attrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777)&0o077==0 else { throw AssistantProtocolError.invalid }
    let url=try file(value.operationId),data=try JSONEncoder().encode(value)
    guard data.count<=16*1024*1024 else { throw MacAssistantError("This window's recoverable input exceeds the private recovery limit. Its window remains open.") }
    try data.write(to:url,options:.atomic)
    try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path)
    let handle=try FileHandle(forWritingTo:url);try handle.synchronize();try handle.close()
    let fd=open(root.path,O_RDONLY);guard fd>=0 else { throw AssistantProtocolError.invalid };defer{close(fd)}
    guard fsync(fd)==0 else { throw AssistantProtocolError.invalid }
  }
  nonisolated static func hash(_ tabs: [MainWorkspaceLiveTab], _ launches: [String: Launch]) -> String {
    let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys]
    let bytes=(try! encoder.encode(tabs))+(try! encoder.encode(launches))
    return SHA256.hash(data:bytes).map{String(format:"%02x",$0)}.joined()
  }
  private func verifyReceipts(_ tab: MainWorkspaceLiveTab) throws {
    if let receipts=tab.pendingReceipts,!receipts.isEmpty {
      throw MacCodexInputFailure(code:"account_window_delivery_unresolved",message:"\(tab.name): \(receipts.count) pending or uncertain delivery receipt(s) need reconciliation (\(receipts.prefix(3).joined(separator:", "))). Nothing was closed.")
    }
  }
  func capture(operationId: String, windowId: String, tabId: String) async throws -> Record {
    let fd=try lock();defer{flock(fd,LOCK_UN);close(fd)}
    if let old=try read(operationId) {
      guard old.selection==windowId else { throw MacAssistantError("This switch already belongs to another window.") };return old
    }
    guard !running else { throw MacAssistantError("The original window operation is still running.") }
    running=true;defer{running=false}
    diagnosticStep?("capture-permit")
    try await permit(operationId)
    diagnosticStep?("capture-windows")
    let choices=try await native.windowChoices(observations:[])
    guard let choice=choices.first(where:{$0.id==windowId && $0.tabId==tabId}) else { throw MacAssistantError("The selected window changed. Refresh and choose it again.") }
    diagnosticStep?("capture-inputs")
    let ticket=try generation(),snapshot=try await native.snapshot(windowContaining:tabId)
    diagnosticStep?("capture-launches")
    guard let anchor=snapshot.tabs.first(where:{$0.tabId==snapshot.anchorId}) else { throw AssistantProtocolError.invalid }
    let tabs=snapshot.tabs.filter{$0.group==anchor.group}.sorted{$0.position<$1.position}
    guard Set(tabs.map(\.tabId))==Set(choice.tabs.map(\.tabId)),!tabs.isEmpty,
      Set(tabs.map(\.tty)).count==tabs.count else { throw MacAssistantError("The chosen window's membership changed. Nothing was closed.") }
    var launches:[String:Launch]=[:],entries:[MainWorkspaceEntry]=[]
    for tab in tabs {
      try verifyReceipts(tab)
      guard tab.identityIssue==nil,tab.lifetime != nil,["codex","shell"].contains(tab.kind),
        (tab.pendingReceipts ?? []).isEmpty,
        tab.kind != "codex" || tab.sessionId != nil && tab.model != nil && tab.effort != nil && tab.executable != nil else {
        throw MacAssistantError("\(tab.name): \(tab.identityIssue ?? tab.draft?.limitation ?? "Resolve its pending deliveries or resumable conversation before switching.") Its tab stays open.")
      }
      if let launch=try await inspectLaunch(tab) { launches[tab.tty]=launch }
      let entry=MainWorkspaceEntry(id:UUID().uuidString.lowercased(),directory:tab.directory,kind:tab.kind,
        sessionId:tab.sessionId,conversationPath:tab.conversationPath,executable:tab.executable,name:tab.name,
        draft:tab.draft,binding:tab,model:tab.model,effort:tab.effort,pendingReceipts:tab.pendingReceipts)
      try native.checkDirectory(entry);entries.append(entry)
    }
    guard try generation()==ticket else { throw MacAssistantError("You used Terminal while it was being captured. Its window and drafts remain unchanged; review before retrying.") }
    var record=Record(operationId:operationId,selection:windowId,tabs:tabs,entries:entries,launches:launches,generation:ticket,captureHash:Self.hash(tabs,launches))
    record.draftPolicy="retainOnly"
    try save(record);diagnosticStep?("capture-saved");return record
  }
  func restore(operationId: String, target: Target) async throws -> Record {
    let fd=try lock();defer{flock(fd,LOCK_UN);close(fd)}
    guard !running else { throw MacAssistantError("The original window operation is still running.") }
    running=true;defer{running=false}
    guard var record=try read(operationId) else { throw MacAssistantError("The account window capture is unavailable.") }
    if let old=record.target,old != target { throw MacAssistantError("This recovery belongs to another destination account.") }
    try await permit(operationId)
    try setLaunch(operationId,target,record.launches)
    if record.stage=="captured" {
      // The interaction generation is process-local. Reinspection also proves
      // exact owner/draft equality after native-worker restart; it is essential.
      let live=try await native.inventory(captureDrafts:false)
      guard let anchor=live.first(where:{current in record.tabs.contains{$0.tty==current.tty && $0.lifetime==current.lifetime && $0.owner==current.owner}}) else { throw MacAssistantError("The original window changed before closing. Its recovery is saved for review.") }
      let current=try await native.snapshot(windowContaining:anchor.tabId)
      guard let selected=current.tabs.first(where:{$0.tabId==current.anchorId}) else { throw AssistantProtocolError.invalid }
      let members=current.tabs.filter{$0.group==selected.group}.sorted{$0.position<$1.position}
      guard MainTerminalWorkspace.sameWindow(record.tabs,members,drafts:record.draftPolicy != "retainOnly") else { throw MacAssistantError("The captured window or draft changed. Nothing was closed. Cancel and review the current lineup.") }
      for tab in members { try verifyReceipts(tab);_=try await inspectLaunch(tab) }
      for entry in record.entries { try native.checkDirectory(entry) }
      try await permit(operationId)
      record.target=target;record.stage="closing";try save(record)
      do { try await native.closeWindow(members) }
      catch { record.message=error.localizedDescription;try save(record);throw error }
    }
    if record.stage=="closing" {
      guard try await native.areClosed(record.tabs) else { throw MacAssistantError("The original window has remaining tabs or an unresolved close. Review them; ClawDad will not repeat an uncertain close.") }
      record.stage="restoring";record.message=nil;try save(record)
    }
    guard ["restoring","verified"].contains(record.stage) else { throw AssistantProtocolError.invalid }
    var live=try await native.inventory(captureDrafts:false),found:[String:MainWorkspaceLiveTab]=[:]
    var anchor:MainWorkspaceLiveTab?
    for entry in record.entries {
      try await permit(operationId)
      var step=record.progress[entry.id] ?? MainWorkspaceStep(phase:"missing")
      var tab=step.binding.flatMap { old in live.first{$0.tty==old.tty && $0.lifetime==old.lifetime && ($0.owner==old.owner || $0.sessionId==entry.sessionId && entry.sessionId != nil)} }
      if tab==nil,let marker=step.marker {
        let matches=live.filter{$0.name==marker && !(step.beforeOwners ?? []).contains($0.owner)}
        guard matches.count<=1 else { throw MacAssistantError("A recovery creation marker is ambiguous. No duplicate was created.") }
        tab=matches.first
        if tab != nil,step.phase=="creating" { step.phase="created" }
        if tab==nil { throw MacAssistantError("A previous tab creation is uncertain. Inspect its original receipt; creation will not repeat.") }
      }
      if tab==nil {
        guard step.phase=="missing",!live.contains(where:{$0.sessionId==entry.sessionId && entry.sessionId != nil}) else { throw MacAssistantError("The saved conversation already has another owner or a restored tab disappeared. Inspect it before continuing.") }
        try native.checkDirectory(entry)
        step=MainWorkspaceStep(phase:"creating",marker:"ClawDad Restore \(entry.id)",beforeOwners:live.map(\.owner))
        record.progress[entry.id]=step;try save(record)
        tab=try await native.create(marker:step.marker!,anchor:anchor)
        step.binding=tab;step.phase="created";record.progress[entry.id]=step;try save(record)
      }
      guard let original=tab,anchor==nil || original.group==anchor?.group else { throw MacAssistantError("The restored tabs are in different windows. They were preserved for review.") }
      anchor=original
      if !["restored"].contains(step.phase) {
        let allowLaunch=step.phase=="created"
        step.phase="launching";record.progress[entry.id]=step;try save(record)
        let ready=try await native.configure(original,entry:entry,requestId:operationId,allowLaunch:allowLaunch)
        step.binding=ready;step.phase="draft_pending";record.progress[entry.id]=step;try save(record)
        diagnosticStep?("restore-verify-owner")
        try await verifyOwner(ready,target,operationId)
        diagnosticStep?("restore-recover-draft")
        var recoveryEntry=entry
        if record.draftPolicy=="retainOnly" {
          // Cody explicitly chose to ignore unsent input during account switches.
          // Keep known text in the durable recovery record, but resume empty.
          recoveryEntry.draft=nil
          if entry.draft?.text?.isEmpty==false { step.message="Unsent text saved in account recovery; the input was left empty." }
          else if entry.draft?.text==nil { step.message="Unsent input could not be copied; the input was left empty." }
        }
        try await native.recoverDraft(ready,entry:recoveryEntry)
        step.phase="restored";record.progress[entry.id]=step;try save(record);tab=ready
      }
      guard let ready=tab else { throw AssistantProtocolError.invalid }
      try await verifyOwner(ready,target,operationId)
      found[entry.id]=ready;anchor=ready
      live=try await native.inventory(captureDrafts:false)
    }
    let ordered=record.entries.compactMap{found[$0.id]}
    guard ordered.count==record.entries.count else { throw AssistantProtocolError.invalid }
    diagnosticStep?("restore-layout")
    try await native.finish(ordered,selectedId:record.entries.first{$0.binding?.selected==true}.flatMap{found[$0.id]?.tabId})
    record.stage="verified";record.message=record.draftPolicy=="retainOnly"
      ? "The window is restored with the same conversations and empty inputs. Recoverable unsent text remains in account recovery. No tasks were submitted."
      : "The chosen window is restored on the selected account. Its exact conversations and drafts are ready; no tasks were submitted."
    try save(record)
    return record
  }
}
