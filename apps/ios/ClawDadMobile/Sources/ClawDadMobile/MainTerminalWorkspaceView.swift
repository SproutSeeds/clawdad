import SwiftUI
import ClawDadRemoteAssistProtocol

struct MainWorkspaceButton: View {
  @ObservedObject var controller: MobileAssistantController
  var anchorId: String? = nil
  @State private var presented=false
  var body: some View {
    Button { presented=true } label: { Label("Main Workspace",systemImage:"rectangle.3.group").font(.subheadline).frame(minHeight:44) }
      .accessibilityHint("Save or restore your main Terminal window and project tabs")
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
  private var storageKey:String { "clawdad.main-workspace.pending."+controller.settingsScope }
  private var entries:[[String:AssistantValue]] { state["entries"]?.array?.compactMap(\.object) ?? [] }
  private var revision:AssistantValue { state["revision"] ?? .number(1) }
  private var status:String { (state["status"]?.string ?? "loading").replacingOccurrences(of:"_",with:" ") }
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
      List {
        Section {
          Text(status.capitalized).font(.headline).accessibilityIdentifier("main-workspace-status")
          if let message=state["message"]?.string { Text(message).font(.callout) }
          Button { perform("mainworkspace.restore") } label: {
            Label("Restore Main Workspace",systemImage:"arrow.counterclockwise").frame(minHeight:44)
          }.disabled(!loaded || entries.isEmpty || pending != nil).accessibilityIdentifier("restore-main-workspace")
          if pending != nil { ProgressView("Checking saved progress…") }
          if let error { Text(error).foregroundStyle(ClawDadTheme.gold).font(.callout) }
          if pending != nil,error != nil { Button("Check / retry this request") { Task { await resend() } }.frame(minHeight:44) }
        } footer: { Text("Restores saved conversations and recoverable unsent drafts. Running work stays in its current tab.") }
        Section("Save / Update Main Workspace") {
          Picker("Main Terminal window",selection:$selectedTab) {
            Text("Choose a window").tag("")
            ForEach(windowChoices,id:\.id) { tab in Text("\(tab.windowTitle ?? "Terminal window") · \(tab.title)").tag(tab.id) }
          }
          Button("Save / Update Main Workspace") { perform("mainworkspace.save",["tabId":.string(selectedTab),"expectedRevision":revision]) }
            .frame(minHeight:44).disabled(selectedTab.isEmpty || pending != nil || !loaded)
          Button("Refresh Terminal windows") { perform("mainworkspace.inspect") }.frame(minHeight:44).disabled(pending != nil)
        }
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
                Text((entry["status"]?.string ?? "saved").replacingOccurrences(of:"_",with:" ")).font(.caption)
              }
            }
          }
        }
        if !snapshots.isEmpty {
          Section {
            ForEach(snapshots) { item in
              Button(item.title) { perform("mainworkspace.recover",["snapshotIndex":.number(Double(item.id)),"expectedRevision":revision]) }
                .frame(minHeight:44).disabled(pending != nil)
            }
          } header: { Text("Recover a previous snapshot") }
          footer: { Text("Recovery updates the saved record. Tap Restore to reopen its projects. Closing Terminal never removes saved projects.") }
        }
      }
      .navigationTitle("Main Workspace")
      #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement:.confirmationAction) { Button("Done") { dismiss() }.frame(minHeight:44).keyboardShortcut(.cancelAction) } }
      .alert("Remove from Main Workspace?",isPresented:Binding(get:{removing != nil},set:{if !$0 {removing=nil}})) {
        Button("Remove",role:.destructive) { if let id=removing?["id"] { perform("mainworkspace.remove",["entryId":id,"expectedRevision":revision]) };removing=nil }
        Button("Cancel",role:.cancel) { removing=nil }
      } message: { Text("Its live tab, files and conversation will remain intact.") }
      .task(id:controller.settingsScope) {
        if let data=UserDefaults.standard.data(forKey:storageKey) { pending=try? JSONDecoder().decode(MainWorkspacePending.self,from:data) }
        await refresh()
        if pending==nil { perform("mainworkspace.inspect") }
        while !Task.isCancelled { try? await Task.sleep(for:.seconds(2));if !Task.isCancelled { await refresh() } }
      }
    }
    .preferredColorScheme(.dark)
    .tint(ClawDadTheme.gold)
  }
  private func perform(_ action:String,_ args:[String:AssistantValue]=[:]) {
    guard pending==nil else { return }
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
      let value=try await controller.settingsRequest("mainworkspace.status",args:pending.map{["jobId":.string($0.id)]} ?? [:])
      state=value["mainWorkspace"]?.object ?? [:];loaded=true
      if let raw=value["catalog"],let decoded=try? JSONDecoder().decode(RemoteTerminalTabState.self,from:JSONEncoder().encode(raw)) {
        catalog=decoded
        if selectedTab.isEmpty {
          let chosen=anchorId ?? decoded.selectedTabId
          let group=decoded.tabs.first{$0.id==chosen}?.windowGroupId
          selectedTab=windowChoices.first{$0.windowGroupId==group}?.id ?? ""
        }
      }
      if let job=value["job"]?.object,!["queued","running"].contains(job["status"]?.string ?? "") {
        error=job["error"]?.string;pending=nil;UserDefaults.standard.removeObject(forKey:storageKey)
      }
      if value["paused"]?.bool==true,pending != nil { error="Mac control is paused. Resume control to continue this saved request." }
    } catch { self.error=error.localizedDescription }
  }
}
