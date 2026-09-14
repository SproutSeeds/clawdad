import SwiftUI
import ClawDadRemoteAssistProtocol

struct MainWorkspaceButton: View {
  @ObservedObject var controller: MobileAssistantController
  var anchorId: String? = nil
  @State private var presented=false
  var body: some View {
    Button { presented=true } label: { Label("Main Workspace",systemImage:"rectangle.3.group").font(.subheadline).frame(minHeight:44) }
      .accessibilityHint("Save named Terminal setups or restore their exact conversations")
      .sheet(isPresented:$presented) { MainTerminalWorkspaceView(controller:controller,anchorId:anchorId) }
  }
}

private struct MainWorkspacePending: Codable {
  var action:String
  var args:[String:AssistantValue]
  var id:String
}
private struct MainWorkspaceSnapshotChoice: Identifiable {
  var id:Int
  var count:Int
  var title:String { "Recover snapshot \(id+1) · \(count) projects" }
}
private struct NamedWorkspaceChoice:Identifiable {
  let id:String
  let title:String
}
struct MainTerminalWorkspaceView: View {
  @ObservedObject var controller:MobileAssistantController
  var anchorId:String?
  @Environment(\.dismiss) private var dismiss
  @State private var state:[String:AssistantValue]=[:]
  @State private var catalog:RemoteTerminalTabState?
  @State private var selectedTab=""
  @State private var pending:MainWorkspacePending?
  @State private var error:String?
  @State private var removing:[String:AssistantValue]?
  @State private var refreshing=false
  @State private var loaded=false
  @State private var selectedSnapshot=""
  @State private var reviewedState:[String:AssistantValue]?
  @State private var snapshotName="Main Workspace"
  @State private var updating=false
  @State private var reusing=false
  @State private var closeWindow=false
  @State private var separateWindow=false
  private var storageKey:String { "clawdad.main-workspace.pending."+controller.settingsScope }
  private var entries:[[String:AssistantValue]] { (reviewedState ?? state)["entries"]?.array?.compactMap(\.object) ?? [] }
  private var revision:AssistantValue { state["revision"] ?? .number(1) }
  private var status:String { (state["status"]?.string ?? "loading").replacingOccurrences(of:"_",with:" ") }
  private var namedSnapshots:[[String:AssistantValue]] { state["namedSnapshots"]?.array?.compactMap(\.object) ?? [] }
  private var namedChoices:[NamedWorkspaceChoice] {
    namedSnapshots.compactMap { item in
      guard let id=item["id"]?.string else { return nil }
      let name=item["name"]?.string ?? "Snapshot"
      let suffix=item["needsReview"]?.bool==true ? " · Review identities":""
      return NamedWorkspaceChoice(id:id,title:name+suffix)
    }
  }
  private var target:[String:AssistantValue] { selectedSnapshot.isEmpty ? [:]:["snapshotId":.string(selectedSnapshot)] }
  private var reviewedRevision:AssistantValue? { reviewedState?["snapshotRevision"] }
  private var reviewChanged:Bool {
    guard let reviewedState else { return false }
    return reviewedState["selectedSnapshotId"]?.string != selectedSnapshot ||
      namedSnapshots.first(where:{$0["id"]?.string==selectedSnapshot})?["revision"]?.number != reviewedRevision?.number
  }
  private var restoreReady:Bool { reviewedRevision?.number != nil && !reviewChanged && !entries.isEmpty }
  private var restoreTarget:[String:AssistantValue] {
    var args=target
    args["expectedSnapshotRevision"]=reviewedRevision
    return args
  }
  private var snapshots:[MainWorkspaceSnapshotChoice] {
    (state["snapshots"]?.array ?? []).compactMap { value in
      guard let item=value.object,let index=item["index"]?.number else { return nil }
      return MainWorkspaceSnapshotChoice(id:Int(index),count:Int(item["count"]?.number ?? 0))
    }
  }
  private var windowChoices:[RemoteTerminalTabDescriptor] {
    var groups=Set<String>()
    return (catalog?.tabs ?? []).filter { groups.insert($0.windowGroupId ?? $0.id).inserted }
  }
  var body: some View {
    NavigationStack {
      workspaceList
      .navigationTitle("Main Workspace")
      #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement:.confirmationAction) { Button("Done") { dismiss() }.frame(minHeight:44).keyboardShortcut(.cancelAction) } }
      .alert("Remove from Main Workspace?",isPresented:Binding(get:{removing != nil},set:{if !$0 {removing=nil}})) {
        Button("Remove",role:.destructive) { if let id=removing?["id"] { perform("mainworkspace.remove",target.merging(["entryId":id,"expectedRevision":revision]){$1}) };removing=nil }
        Button("Cancel",role:.cancel) { removing=nil }
      } message: { Text("Its live tab, files and conversation will remain intact.") }
      .alert("Replace this snapshot’s lineup?",isPresented:$updating) {
        Button("Update snapshot") { save(updating:true) };Button("Cancel",role:.cancel) {}
      } message: { Text("Only the chosen window’s current tabs will belong to this version. The previous version remains recoverable. Live work stays intact.") }
      .alert("Reuse the chosen window?",isPresented:$reusing) {
        Button("Reuse window") { perform("mainworkspace.restore",restoreTarget.merging(["reuseWindowTabId":.string(selectedTab)]){$1}) }
        Button("Cancel",role:.cancel) {}
      } message: { Text("Restore only missing saved tabs into this window. Its other tabs and unsaved work stay open. To switch to an exact lineup, save and close the current window first.") }
      .alert("Open a separate window?",isPresented:$separateWindow) {
        Button("Open separate window") { perform("mainworkspace.restore",restoreTarget.merging(["newWindowConfirmed":.bool(true)]){$1}) }
        Button("Cancel",role:.cancel) {}
      } message: { Text("Your existing windows remain open. Existing exact conversations are reused; only confirmed missing saved tabs are created. This choice does not close or move your work.") }
      .sheet(isPresented:$closeWindow) { TerminalWorkspaceCloseView(controller:controller,tabId:selectedTab) }
      .onChange(of:selectedSnapshot) { _,value in
        reviewedState=nil
        UserDefaults.standard.set(value,forKey:"clawdad.main-workspace.selection."+controller.settingsScope)
        if let name=namedSnapshots.first(where:{$0["id"]?.string==value})?["name"]?.string { snapshotName=name }
        Task { await refresh() }
      }
      .task(id:controller.settingsScope) { await monitor() }
    }
    .preferredColorScheme(.dark)
    .tint(ClawDadTheme.gold)
  }
  private var workspaceList:some View {
      List {
        Section {
          if !namedSnapshots.isEmpty {
            Picker("Saved setup",selection:$selectedSnapshot) {
              ForEach(namedChoices) { item in Text(item.title).tag(item.id) }
            }.accessibilityIdentifier("main-workspace-snapshot-picker")
          }
          Text(status.capitalized).font(.headline).accessibilityIdentifier("main-workspace-status")
          if let message=state["message"]?.string { Text(message).font(.callout) }
          Button { perform("mainworkspace.restore",restoreTarget) } label: {
            Label("Restore saved setup",systemImage:"arrow.counterclockwise").frame(minHeight:44)
          }.disabled(!loaded || !restoreReady || pending != nil).accessibilityIdentifier("restore-main-workspace")
          if reviewChanged {
            Text("This setup changed. Review its latest saved lineup before restoring.").font(.callout)
            Button("Review latest saved version") { reviewedState=state }.frame(minHeight:44)
              .accessibilityIdentifier("main-workspace-review-latest")
          }
          if pending != nil { ProgressView("Checking saved progress…") }
          if let error { Text(error).foregroundStyle(ClawDadTheme.gold).font(.callout) }
          if pending != nil,error != nil { Button("Check / retry this request") { Task { await resend() } }.frame(minHeight:44) }
        } footer: { Text("Reopens the same conversations with their latest history. Continue when ready. Tasks and native queues are never replayed.") }
        Section {
          Picker("Main Terminal window",selection:$selectedTab) {
            Text("Choose a window").tag("")
            ForEach(windowChoices,id:\.id) { tab in Text("\(tab.windowTitle ?? "Terminal window") · \(tab.title)").tag(tab.id) }
          }
          TextField("Snapshot name",text:$snapshotName).accessibilityIdentifier("main-workspace-name")
          Button("Save new named snapshot") { save(updating:false) }
            .frame(minHeight:44).disabled(selectedTab.isEmpty || pending != nil || !loaded)
            .accessibilityIdentifier("main-workspace-save-new")
          Button("Update selected snapshot") { updating=true }.frame(minHeight:44)
            .disabled(selectedSnapshot.isEmpty || selectedTab.isEmpty || pending != nil || !loaded || reviewChanged)
          Button("Reuse chosen window for restore…") { reusing=true }.frame(minHeight:44)
            .disabled(selectedSnapshot.isEmpty || selectedTab.isEmpty || pending != nil || !loaded || reviewChanged)
          Button("Restore in a separate window…") { separateWindow=true }.frame(minHeight:44)
            .disabled(!restoreReady || pending != nil || !loaded)
          Button("Close chosen window…",role:.destructive) { closeWindow=true }.frame(minHeight:44)
            .disabled(selectedTab.isEmpty || pending != nil || !loaded)
          Button("Refresh Terminal windows") { perform("mainworkspace.inspect") }.frame(minHeight:44).disabled(pending != nil)
        } header: { Text("Capture this window") } footer: { Text("Save captures exactly this window. Update replaces its saved lineup and keeps a previous version. Closing or observing Terminal never changes your saved setups.") }
        Section("Saved projects") {
          if entries.isEmpty { Text("Choose your Terminal window and save it here.").foregroundStyle(.secondary) }
          ForEach(Array(entries.enumerated()),id:\.offset) { _,entry in
            DisclosureGroup {
              Text(entry["directory"]?.string ?? "").font(.caption).textSelection(.enabled)
              if let id=entry["sessionId"]?.string { Text("Conversation \(id)").font(.caption).textSelection(.enabled) }
              if let message=entry["message"]?.string { Text(message).font(.callout) }
              if let limitation=entry["draftLimitation"]?.string { Text(limitation).font(.caption) }
              if let text=entry["draftText"]?.string,!text.isEmpty {
                Text("Saved unsent draft").font(.subheadline.bold())
                Text(text).font(.callout).textSelection(.enabled)
                HStack {
                  Text("Copy saved draft")
                  AssistantCopyButton(text:text,label:"saved workspace draft",id:"workspace-"+(entry["id"]?.string ?? "draft"))
                }
              }
              Button("Remove from saved workspace",role:.destructive) { removing=entry }.frame(minHeight:44).disabled(pending != nil)
            } label: {
              VStack(alignment:.leading) {
                Text(entry["name"]?.string ?? "Project").font(.headline)
                Text(entry["kind"]?.string=="codex" ? "Codex conversation":"Shell only").font(.caption)
                Text((entry["status"]?.string ?? "saved").replacingOccurrences(of:"_",with:" ")).font(.caption)
              }
            }
          }
        }
        if !snapshots.isEmpty {
          Section {
            ForEach(snapshots) { item in
              Button(item.title) { perform("mainworkspace.recover",target.merging(["snapshotIndex":.number(Double(item.id)),"expectedRevision":revision]){$1}) }
                .frame(minHeight:44).disabled(pending != nil)
            }
          } header: { Text("Recover a previous snapshot") }
          footer: { Text("Recovery updates the saved record. Tap Restore to reopen its projects. Closing Terminal never removes saved projects.") }
        }
      }
  }
  private func monitor() async {

        if let data=UserDefaults.standard.data(forKey:storageKey) { pending=try? JSONDecoder().decode(MainWorkspacePending.self,from:data) }
        selectedSnapshot=UserDefaults.standard.string(forKey:"clawdad.main-workspace.selection."+controller.settingsScope) ?? ""
        await refresh()
        while !Task.isCancelled { try? await Task.sleep(for:.seconds(2));if !Task.isCancelled { await refresh() } }

  }
  private func save(updating:Bool) {
    var args:[String:AssistantValue]=["tabId":.string(selectedTab),"expectedRevision":revision,"name":.string(snapshotName)]
    if updating {
      guard !reviewChanged else { error="Review the latest saved lineup before updating.";return }
      args["snapshotId"] = .string(selectedSnapshot)
    }
    perform("mainworkspace.save",args)
  }
  private func perform(_ action:String,_ args:[String:AssistantValue]=[:]) {
    guard pending==nil else { return }
    if action=="mainworkspace.restore",!restoreReady { error="Review the latest saved setup before restoring.";return }
    pending=MainWorkspacePending(action:action,args:args,id:UUID().uuidString.lowercased())
    if let data=try? JSONEncoder().encode(pending) { UserDefaults.standard.set(data,forKey:storageKey) }
    Task { await resend() }
  }
  private func resend() async {
    guard let pending else { return }
    do { _=try await controller.settingsRequest(pending.action,args:pending.args,id:pending.id);error=nil;await refresh() }
    catch { self.error="The request is saved. Reconnect and check its receipt: \(error.localizedDescription)" }
  }
  private func refresh() async {
    guard !refreshing else { return };refreshing=true;defer{refreshing=false}
    do {
      var args=target
      if let pending { args["jobId"] = .string(pending.id) }
      let value=try await controller.settingsRequest("mainworkspace.status",args:args)
      state=value["mainWorkspace"]?.object ?? [:];loaded=true
      if selectedSnapshot.isEmpty { selectedSnapshot=state["selectedSnapshotId"]?.string ?? "" }
      if reviewedState==nil,state["selectedSnapshotId"]?.string==selectedSnapshot { reviewedState=state }
      if let raw=value["catalog"],let decoded=try? JSONDecoder().decode(RemoteTerminalTabState.self,from:JSONEncoder().encode(raw)) {
        catalog=decoded
        if selectedTab.isEmpty {
          let chosen=anchorId ?? decoded.selectedTabId
          let group=decoded.tabs.first{$0.id==chosen}?.windowGroupId
          selectedTab=windowChoices.first{$0.windowGroupId==group}?.id ?? ""
        }
      }
      if let job=value["job"]?.object,!["queued","running"].contains(job["status"]?.string ?? "") {
        if pending?.action=="mainworkspace.save",job["error"]?.string==nil,let id=job["result"]?.object?["selectedSnapshotId"]?.string { selectedSnapshot=id }
        if ["mainworkspace.save","mainworkspace.remove","mainworkspace.recover"].contains(pending?.action ?? ""),job["error"]?.string==nil { reviewedState=nil }
        error=job["error"]?.string;pending=nil;UserDefaults.standard.removeObject(forKey:storageKey)
      }
      if value["paused"]?.bool==true,pending != nil { error="Mac control is paused. Resume control to continue this saved request." }
    } catch { self.error=error.localizedDescription }
  }
}
