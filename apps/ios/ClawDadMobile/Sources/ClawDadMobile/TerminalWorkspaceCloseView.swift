import SwiftUI
import ClawDadRemoteAssistProtocol

/// Native inspection and explicit confirmation are separate durable requests.
/// Leaving this sheet never sends Close. An in-flight confirmed request can be
/// reconciled on reopening using the original ID, rather than sending it twice.
struct TerminalWorkspaceCloseView:View {
  @ObservedObject var controller:MobileAssistantController
  let tabId:String
  @Environment(\.dismiss) private var dismiss
  @State private var result:[String:AssistantValue]=[:]
  @State private var pending:Pending?
  @State private var error:String?
  @State private var saveName="Main Workspace"
  @State private var confirmation=false
  @State private var saveFirst=false
  @State private var revision:AssistantValue = .number(1)
  private struct Pending:Codable { var action:String;var args:[String:AssistantValue];var id:String }
  private var storage:String { "clawdad.window-close.pending."+controller.settingsScope }
  private var plan:[String:AssistantValue] { result["closePlan"]?.object ?? [:] }
  private var members:[[String:AssistantValue]] { plan["tabs"]?.array?.compactMap(\.object) ?? [] }
  private var ready:Bool { plan["status"]?.string=="confirmation_required" && pending==nil }
  private var recoverable:Bool { !members.isEmpty && members.allSatisfy{$0["draft"]?.object?["text"]?.string != nil && $0["identityIssue"]?.string==nil && ($0["pendingReceipts"]?.array ?? []).isEmpty} }
  var body:some View {
    NavigationStack {
      List {
        Section {
          Text(result["windowTitle"]?.string ?? "Inspecting Terminal window").font(.headline)
          if let count=result["tabCount"]?.number {
            Text("\(Int(count)) tabs · \(Int(result["runningAgents"]?.number ?? 0)) agents working")
            Text("\(Int(result["unsentDrafts"]?.number ?? 0)) unsent drafts · \(Int(result["unrecoverableDrafts"]?.number ?? 0)) inputs need recovery review").font(.callout)
          }
          Text(result["confirmation"]?.string ?? "ClawDad is inspecting exact owners and unsent drafts. Nothing will close until you confirm.").font(.callout)
          if let message=result["message"]?.string { Text(message).font(.callout) }
          if let error { Text(error).foregroundStyle(ClawDadTheme.gold) }
          if pending != nil { ProgressView("Checking the original request…") }
        }
        if !members.isEmpty {
          DisclosureGroup("Inspected tabs") {
            ForEach(Array(members.enumerated()),id:\.offset) { _,tab in
              VStack(alignment:.leading) {
                Text(tab["name"]?.string ?? "Tab")
                Text(tab["directory"]?.string ?? "").font(.caption)
                if let issue=tab["identityIssue"]?.string { Text(issue).font(.caption) }
                if let limitation=tab["draft"]?.object?["limitation"]?.string { Text(limitation).font(.caption) }
              }
            }
          }
        }
        if ready {
          Section {
            TextField("Snapshot name",text:$saveName).accessibilityIdentifier("window-close-snapshot-name")
            Button("Save snapshot and close…") { saveFirst=true;confirmation=true }.frame(minHeight:44)
              .disabled(!recoverable || saveName.trimmingCharacters(in:.whitespaces).isEmpty)
            if !recoverable { Text("Save and close is unavailable until every identity and draft can be recovered. You can save supported data in Main Workspace and review the flagged inputs.").font(.caption) }
            Button("Close window…",role:.destructive) { saveFirst=false;confirmation=true }.frame(minHeight:44)
              .accessibilityIdentifier("confirm-close-terminal-window")
          }
        }
        if pending != nil { Button("Check this request again") { Task { await reconcile() } }.frame(minHeight:44) }
        if pending==nil,!ready,plan["status"]?.string != "closed" { Button("Inspect current window") { startInspection() }.frame(minHeight:44) }
      }
      .navigationTitle("Close window")
      .toolbar { ToolbarItem(placement:.cancellationAction) { Button(ready ? "Cancel":"Done") { dismiss() }.frame(minHeight:44).keyboardShortcut(.cancelAction) } }
      .alert("Close this exact Terminal window?",isPresented:$confirmation) {
        Button(saveFirst ? "Save and close":"Close window",role:.destructive) { close() }
        Button("Cancel",role:.cancel) {}
      } message: { Text(result["confirmation"]?.string ?? "This stops work in the inspected window.") }
      .task {
        if let data=UserDefaults.standard.data(forKey:storage) { pending=try? JSONDecoder().decode(Pending.self,from:data) }
        if pending==nil { startInspection() }
        while !Task.isCancelled { await reconcile();try? await Task.sleep(for:.seconds(1)) }
      }
    }.preferredColorScheme(.dark).tint(ClawDadTheme.gold)
  }
  private func send(_ action:String,args:[String:AssistantValue]) {
    guard pending==nil else { return }
    pending=Pending(action:action,args:args,id:UUID().uuidString.lowercased())
    if let data=try? JSONEncoder().encode(pending) { UserDefaults.standard.set(data,forKey:storage) }
    Task { await reconcile() }
  }
  private func startInspection() { result=[:];send("mainworkspace.close.inspect",args:["tabId":.string(tabId)]) }
  private func close() {
    guard let token=plan["token"]?.string else { return }
    var args:[String:AssistantValue]=["confirmationToken":.string(token),"confirm":.bool(true)]
    if saveFirst { args["saveName"] = .string(saveName);args["expectedRevision"]=revision }
    send("mainworkspace.close",args:args)
  }
  private func reconcile() async {
    guard let pending else { return }
    do {
      _=try await controller.settingsRequest(pending.action,args:pending.args,id:pending.id)
      let value=try await controller.settingsRequest("mainworkspace.status",args:["jobId":.string(pending.id)])
      revision=value["mainWorkspace"]?.object?["revision"] ?? revision
      guard let job=value["job"]?.object,!["queued","running"].contains(job["status"]?.string ?? "") else { return }
      if let failure=job["error"]?.string { error=failure }
      else { result=job["result"]?.object ?? [:];error=nil }
      self.pending=nil;UserDefaults.standard.removeObject(forKey:storage)
    } catch { self.error="Reconnect to check the saved request: \(error.localizedDescription)" }
  }
}
