#if DEBUG
  import Foundation
  import ClawDadRemoteAssistProtocol
  import CryptoKit
  #if os(iOS)
  import UserNotifications
  #endif

  /// UI acceptance fixtures never send keyboard events or connect to a real host.
  @MainActor
  final class AssistantPreview {
    var failedAccountCancelRequest: String?
    static let replyConversation = "11111111-1111-4111-8111-111111111111"
    static let replyRequest = "22222222-2222-4222-8222-222222222222"
    static let replyID = "assistant:\(replyRequest):final"
    static func notification(session: CloudSession) -> AssistantReplyNotification {
      AssistantReplyNotification(version: 1, kind: "assistant_reply", eventId: String(repeating: "c", count: 64),
        conversationId: replyConversation, requestId: replyRequest, replyId: replyID, completedAt: "2026-09-11T20:52:00Z",
        accountId: session.accountId, workspaceId: session.workspaceId, hostId: session.hostId)
    }
    #if targetEnvironment(simulator)
    /// Exercise the OS notification delegate, rather than injecting navigation.
    /// Restricted to a synthetic simulator launch; never requests phone consent.
    static func scheduleNotificationDelegateFixture(session: CloudSession) {
      let prefix = "--clawdad-notification-delegate-fixture="
      guard session.isAppStorePreview,
        let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix(prefix) }) else { return }
      let identifier = String(argument.dropFirst(prefix.count))
      let key = "clawdad.notification-fixture.\(identifier)"
      guard !UserDefaults.standard.bool(forKey: key) else { return }
      UserDefaults.standard.set(true, forKey: key)
      let target = notification(session: session)
      Task {
        let center = UNUserNotificationCenter.current()
        guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else {
          print("Notification delegate fixture: permission unavailable"); return
        }
        let content = UNMutableNotificationContent()
        content.title = "ClawDad notification regression"
        content.body = "Open the exact synthetic Assistant reply."
        content.userInfo = ["clawdad": (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(target))) ?? [:]]
        do {
          try await center.add(UNNotificationRequest(identifier: identifier, content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 7, repeats: false)))
          print("Notification delegate fixture: scheduled")
        } catch { print("Notification delegate fixture: scheduling failed") }
      }
    }
    #endif
    func replyPayload() throws -> Data {
      try JSONSerialization.data(withJSONObject: ["assistantReply": ["conversationId": Self.replyConversation, "requestId": Self.replyRequest,
        "message": ["id": Self.replyID, "role": "assistant", "text": "Exact completed Assistant reply.\nYour work finished while the phone was away.", "createdAt": "2026-09-06T20:52:00Z"],
        "userMessage": ["id": Self.replyRequest, "role": "user", "text": "Keep working after I hang up.", "createdAt": "2026-09-06T20:49:00Z"]]])
    }
    static var capacityFixtureText: String {
      let size = ProcessInfo.processInfo.arguments.contains("--capacity-over-limit") ? 131_073 : 131_072
      let start = "BEGIN_IPHONE_PASTE\r\nResearch 🧪 中文 e\u{0301}\n```text\nExact lines stay intact.\n```\n"
      let end = "\nMIDDLE_IPHONE_PASTE\nEND_IPHONE_PASTE\t \r\n"
      let line = "Synthetic research evidence for transport verification; no project actions.\n"
      let remaining = size - start.utf8.count - end.utf8.count
      return start + String(repeating: line, count: remaining / line.utf8.count)
        + String(repeating: "x", count: remaining % line.utf8.count) + end
    }
    private var state: [String: AssistantValue]
    private var uploads: [String: Data] = [:]
    private var failedSend = false
    private var settings: [String: AssistantValue]?
    private var streamRevision = 0
    private var mainWorkspace:[String:AssistantValue] = ["revision":.number(1),"status":.string("saved"),"selectedSnapshotId":.string("fixture-setup"),
      "snapshotRevision":.number(1),
      "namedSnapshots":.array([.object(["id":.string("fixture-setup"),"name":.string("Research setup"),"revision":.number(1),"count":.number(2)])]),"snapshots":.array([]),"entries":.array([
      .object(["id":.string("fixture-one"),"name":.string("ClawDad"),"kind":.string("codex"),"directory":.string("/fixture/clawdad"),"sessionId":.string("fixture-conversation-one"),"status":.string("saved"),"draftText":.string("A recoverable unsent fixture draft.")]),
      .object(["id":.string("fixture-two"),"name":.string("Research"),"kind":.string("codex"),"directory":.string("/fixture/research"),"sessionId":.string("fixture-conversation-two"),"status":.string("saved")])])]
    private var mainWorkspaceJobs:[String:AssistantValue]=[:]
    init() {
      state = [
        "version": .number(1), "conversationId": .string(Self.replyConversation), "conversationMode": .string("background"), "imageAttachments": .bool(true), "enabled": .bool(true), "paused": .bool(false),
        "chatCapacity": .object(["textBytes": .number(131_072), "unit": .string("utf8_bytes")]),
        "nativeOnline": .bool(true), "coordinator": .object(["mode": .string("background"), "model": .string("gpt-6-astra"), "status": .string("ready")]),
        "tasks": .array([]),
        "destination": .object(["conversationId": .string("preview-conversation"), "transport": .string("terminal"), "revision": .number(0), "targets": .object([:])]),
        "messages": .array([
          .object([
            "id": .string("greeting"), "role": .string("assistant"),
            "text": .string(
              "RoomWave is working on your playback update. Your two code tabs are separate conversations; I can inspect either one before sending work."
            ), "createdAt": .string("2026-09-07T00:00:00Z"),
          ])
        ]),
      ]
      if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-links-test") {
        state["messages"] = .array([.object([
          "id": .string("contact"), "role": .string("assistant"),
          "text": .string("Example business\nPhone: (415) 555-0100\nAddress: 123 Main Street, San Francisco, CA 94105\nTap the number to call or the address to view the map."),
          "createdAt": .string("2026-09-08T00:00:00Z")
        ])])
      }
      if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-history-test") {
        state["messages"] = .array([
          .object(["id": .string("copy-user"), "role": .string("user"),
            "text": .string("Please inspect this request.\nKeep both lines 🦞."), "createdAt": .string("2026-09-08T00:00:00Z")]),
          .object(["id": .string("copy-assistant"), "role": .string("assistant"),
            "text": .string("I’ll inspect the ClawDad tab and keep your draft."), "createdAt": .string("2026-09-08T00:00:01Z")])
        ])
        state["tasks"] = .array([.object([
          "id": .string("history-task"), "action": .string("terminal.send"), "status": .string("working"),
          "displayName": .string("ClawDad"), "requestText": .string("Repair playback and preserve my draft."),
          "args": .object(["tabId": .string("code-one")]), "createdAt": .string("2026-09-08T00:00:02Z")
        ])])
      }
      if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-selection-test") {
        let role = ProcessInfo.processInfo.arguments.contains("--selection-user") ? "user" : "assistant"
        state["messages"] = .array([.object([
          "id": .string("selection-message"), "role": .string(role),
          "text": .string("Amber birds return home.\nSelect a word or this second sentence.\n- Evidence remains visible\n- Calls stay connected\n`let result = 4`"),
          "createdAt": .string("2026-09-09T00:00:00Z")])])
      }
      let catalog = RemoteTerminalTabState(
        revision: 1, selectedTabId: "code-one",
        tabs: [
          .init(
            id: "code-one", title: "code", detail: "Window 1 · Tab 1", isSelected: true,
            isBusy: false),
          .init(
            id: "code-two", title: "code", detail: "Window 1 · Tab 2", isSelected: false,
            isBusy: false),
          .init(
            id: "roomwave", title: "RoomWave", detail: "Window 2 · Tab 1", isSelected: false,
            isBusy: true),
        ])
      state["catalog"] = try? .encode(catalog)
      if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-long-history") {
        state["messages"] = .array((0..<30).map { index in .object([
          "id": .string("history-\(index)"), "role": .string(index % 2 == 0 ? "user" : "assistant"),
          "text": .string("Message \(index).\nA multiline history entry for reading, copying and playback.\nKeep the call and draft intact."),
          "createdAt": .string(String(format: "2026-09-10T10:%02d:00Z", index))
        ]) })
      }
    }
    func snapshot() throws -> AssistantSnapshot {
      if streamRevision > 0, streamRevision < 80 {
        streamRevision += 1
        var messages = state["messages"]?.array ?? []
        if var last = messages.last?.object { last["text"] = .string("A new streaming response. " + String(repeating: "More evidence. ", count: streamRevision)); messages[messages.count - 1] = .object(last); state["messages"] = .array(messages) }
      }
      return try JSONDecoder().decode(AssistantSnapshot.self, from: JSONEncoder().encode(state))
    }
    func research(_ action: String, args: [String: AssistantValue], id: String) throws -> [String: AssistantValue] {
      if action.hasPrefix("accounts.") {
        var accounts=state["codexAccounts"]?.object ?? ["version":.number(1),"revision":.number(0),"activeAccountId":.string("first"),
          "canConnectAccounts":.bool(true),"capabilities":.object(["ready":.bool(true),"appOnly":.bool(true)]),
          "accounts":.array(["first","second","third"].enumerated().map { index,name in
            .object(["id":.string(name),"email":.string(name+"@example.test"),"authentication":.string("verified"),
              "usage":.object(["remainingPercent":.number(Double(65-index*20)),"resetsAt":.number(2000000000),"observedAt":.string("2026-09-17T10:00:00Z"),"status":.string("stale"),"message":.string("Last verified reading. Refresh to check current allowance.")])])
          })]
        if action=="accounts.activate" {
          let operation:AssistantValue = .object(["id":.string(id),"targetId":args["accountId"] ?? .null,"status":.string("completed"),"phase":.string("complete"),"fenced":.bool(false),"reason":.string("Active for ClawDad. Terminal authentication is unchanged.")])
          accounts["activeAccountId"]=args["accountId"];accounts["activeOperation"]=operation;accounts["operations"] = .array([operation])
          accounts["revision"] = .number((accounts["revision"]?.number ?? 0)+1)
        }
        if action=="accounts.add" {
          var entries=accounts["accounts"]?.array ?? []
          entries.append(.object(["id":.string(id),"email":args["email"] ?? .null,"authentication":.string("needs_sign_in")]))
          accounts["accounts"] = .array(entries);accounts["revision"] = .number((accounts["revision"]?.number ?? 0)+1)
        }
        state["codexAccounts"] = .object(accounts)
        let receiptID=args["receiptId"] ?? .string(id)
        return ["accounts":.object(accounts),"accountReceipt":.object(["requestId":receiptID,"accepted":.bool(true),"accountId":args["accountId"] ?? accounts["activeAccountId"] ?? .null])]
      }
      if action.hasPrefix("settings.") { return try modelSettings(action, args: args) }
      if action.hasPrefix("mainworkspace.") {
        if action != "mainworkspace.status",mainWorkspaceJobs[id]==nil {
          if action=="mainworkspace.restore" {
            mainWorkspace["status"] = .string("restored")
            mainWorkspace["entries"] = .array((mainWorkspace["entries"]?.array ?? []).map{value in var entry=value.object ?? [:];entry["status"] = .string("already_open");return .object(entry)})
          }
          var result=mainWorkspace
          if action=="mainworkspace.close.inspect" {
            result=["closePlan":.object(["token":.string("fixture-close"),"status":.string("confirmation_required"),"tabs":.array([
              .object(["name":.string("ClawDad"),"directory":.string("/fixture/clawdad"),"draft":.object(["text":.string("")])]),
              .object(["name":.string("Research"),"directory":.string("/fixture/research"),"draft":.object(["text":.string("Review before continuing")])])])]),
              "windowTitle":.string("Terminal Window 1"),"tabCount":.number(2),"runningAgents":.number(1),"unsentDrafts":.number(1),"unrecoverableDrafts":.number(0),
              "confirmation":.string("Closing stops running work in these 2 tabs. Reopening restores saved conversation history, not an in-memory computation. Other windows and saved snapshots remain intact.")]
          }
          if action=="mainworkspace.close" { result=["closePlan":.object(["status":.string("closed")]),"message":.string("The exact fixture window is closed. Saved snapshots and histories are preserved.")] }
          mainWorkspaceJobs[id] = .object(["id":.string(id),"status":.string("completed"),"result":.object(result)])
        }
        let tabs=RemoteTerminalTabState(revision:1,selectedTabId:"fixture-tab",tabs:[RemoteTerminalTabDescriptor(id:"fixture-tab",title:"ClawDad",detail:"Window 1",isSelected:true,isBusy:false,windowTitle:"Window 1",windowGroupId:"window-one")])
        return ["mainWorkspace":.object(mainWorkspace),"catalog":try .encode(tabs),"job":args["jobId"]?.string.flatMap{mainWorkspaceJobs[$0]} ?? .null]
      }
      if action == "research.target" { return ["researchTarget": .object(["tabId": args["tabId"] ?? .string("code-one"),
        "tabTitle": .string("Disposable research"), "sessionId": .string("fixture-session"),
        "agentInstanceId": .string("fixture-process"), "directory": .string("/tmp/research-fixture")])] }
      var research = state["research"]?.object ?? ["available": .bool(true), "defaultEnabled": .bool(false), "threads": .array([])]
      let accountKey = String(repeating: "a", count: 64)
      let now = Date().timeIntervalSince1970 * 1_000
      var budget = research["budget"]?.object ?? [:]
      var account = budget["accounts"]?.array?.first?.object ?? ["accountKey": .string(accountKey), "threshold": .null, "revision": .number(0), "policies": .object([:])]
      budget["available"] = .bool(true); budget["currentAccountKey"] = .string(accountKey)
      budget["usage"] = .object(["status": .string("current"), "remainingPercent": .number(50), "validUntil": .number(now + 60_000)])
      if action == "research.enable" || action == "research.configure" {
        var thread = args; thread["id"] = .string("fixture-research"); thread["name"] = .string("Disposable research")
        thread["status"] = .string(action == "research.enable" ? "waiting" : "off")
        thread["enabled"] = .bool(action == "research.enable"); thread["activity"] = .array([])
        thread["accountKey"] = .string(accountKey); thread["revision"] = .number(1)
        research["threads"] = .array([.object(thread)])
      } else if ["research.pause", "research.off", "research.resume", "research.steer"].contains(action) {
        research["threads"] = .array((research["threads"]?.array ?? []).map { value in
          guard var thread = value.object else { return value }
          thread["enabled"] = .bool(action != "research.off")
          thread["status"] = .string(action == "research.off" ? "off" : action == "research.pause" ? "paused" : "waiting")
          return .object(thread)
        })
      }
      if action == "research.budget" {
        guard args["expectedBudgetRevision"] == account["revision"] else { throw AssistantProtocolError.invalid }
        account["revision"] = .number((account["revision"]?.number ?? 0) + 1)
        if args["scope"]?.string == "account_default" { throw AssistantProtocolError.invalid }
        else if let threadId = args["threadId"]?.string {
          var policies = account["policies"]?.object ?? [:]
          policies[threadId] = .object(["mode": args["mode"] ?? .string("none"), "threshold": args["threshold"] ?? .null,
            "expiresAt": .number(now + 86_400_000)])
          account["policies"] = .object(policies)
        }
      }
      research["threads"] = .array((research["threads"]?.array ?? []).map { value in
        guard var thread = value.object, let id = thread["id"]?.string else { return value }
        let selected = account["policies"]?.object?[id]?.object ?? [:]
        thread["budgetPolicy"] = .object(selected["mode"]?.string == "override" ? selected : ["mode": .string("none"), "threshold": .null])
        return .object(thread)
      })
      budget["accounts"] = .array([.object(account)]); research["budget"] = .object(budget)
      if action == "research.history" { return ["researchHistory": .object(["entries": .array([]), "nextCursor": .null])] }
      state["research"] = .object(research)
      return ["research": .object(research)]
    }
    func command(_ action: String, args: [String: AssistantValue], id: String) throws
      -> AssistantSnapshot
    {
      if action == "destination" {
        var destination = state["destination"]?.object ?? [:]
        guard args["conversationId"] == destination["conversationId"], args["expectedRevision"] == destination["revision"] else { throw AssistantProtocolError.invalid }
        destination["transport"] = args["transport"]
        destination["revision"] = .number((destination["revision"]?.number ?? 0) + 1)
        state["destination"] = .object(destination)
        return try snapshot()
      }
      if action == "pause" { state["paused"] = args["paused"] }
      if action == "pause", ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-long-history") { streamRevision = 1 }
      if action == "pause", ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-history-test") {
        state["tasks"] = .array((state["tasks"]?.array ?? []).map { value in
          guard var task = value.object, task["id"]?.string == "history-task" else { return value }
          task["status"] = .string("completed")
          task["response"] = .string("Playback is repaired. Your draft is preserved.")
          return .object(task)
        })
      }
      if action == "message", !(state["messages"]?.array ?? []).contains(where: { $0.object?["id"]?.string == id }) {
        let images = args["images"]?.array ?? []
        for image in images {
          guard let id = image.object?["id"]?.string, let data = uploads[id],
            SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == image.object?["sha256"]?.string
          else { throw AssistantProtocolError.invalid }
        }
        var messages = state["messages"]?.array ?? []
        messages.append(
          .object([
            "id": .string(id), "role": .string("user"), "text": args["text"] ?? .string(""),
            "createdAt": .string("2026-09-07T00:01:00Z"), "images": .array(images),
          ]))
        state["messages"] = .array(messages)
        if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-failed-send"), !failedSend {
          failedSend = true
          throw AssistantProtocolError.disconnected
        }
      }
      var tasks = state["tasks"]?.array ?? []
      tasks.append(
        .object([
          "id": .string(id), "action": .string(action), "args": .object(args),
          "status": .string("completed"),
        ]))
      state["tasks"] = .array(tasks)
      return try snapshot()
    }
    func upload(_ body: [String: AssistantValue]) throws -> Data {
      let upload = try JSONDecoder().decode(RemoteImageUpload.self, from: JSONEncoder().encode(body["upload"]))
      try upload.validate()
      var data = uploads[upload.id] ?? Data()
      if body["action"]?.string == "uploadChunk" {
        guard body["offset"]?.number == Double(data.count), let base64 = body["bytes"]?.string,
          let chunk = Data(base64Encoded: base64), data.count + chunk.count <= upload.size else { throw AssistantProtocolError.invalid }
        data.append(chunk)
        uploads[upload.id] = data
      }
      return try JSONEncoder().encode(AssistantValue.object([
        "uploadId": .string(upload.id), "offset": .number(Double(data.count)),
        "complete": .bool(data.count == upload.size)
      ]))
    }
    private func modelSettings(_ action: String, args: [String: AssistantValue]) throws -> [String: AssistantValue] {
      if settings == nil {
        let choice: AssistantValue = .object(["model": .string("gpt-6-astra"), "reasoningEffort": .string("low"), "available": .bool(true)])
        settings = ["revision": .number(0), "main": choice, "researchDefault": choice,
          "models": .array([("gpt-6-astra", ["low", "medium", "high", "max", "ultra"]), ("gpt-5.6-sol", ["low", "medium", "high", "ultra"]), ("gpt-5.5", ["low", "medium", "high", "xhigh"])].map { model, efforts in .object([
            "id": .string(model), "model": .string(model), "displayName": .string(model), "defaultReasoningEffort": .string("low"), "supportedReasoningEfforts": .array(efforts.map(AssistantValue.string)) ]) }),
          "supervisors": .array([.object(["id": .string("fixture-reviewer"), "name": .string("Research project"), "project": .string("/tmp/research-project"), "sessionId": .string("fixture-session"), "status": .string("off"), "inherited": .bool(true), "selection": choice])])]
      }
      if action == "settings.update" {
        guard args["expectedRevision"] == settings?["revision"] else { throw AssistantProtocolError.invalid }
        let revision = (settings?["revision"]?.number ?? 0) + 1
        settings?["revision"] = .number(revision)
        let scope = args["scope"]?.string ?? ""
        var choice = args["selection"]?.object ?? [:]; choice["available"] = .bool(true)
        if scope == "supervisor" {
          var supervisor = settings?["supervisors"]?.array?.first?.object ?? [:]
          supervisor["inherited"] = args["inherit"]
          supervisor["selection"] = args["inherit"]?.bool == true ? settings?["researchDefault"] : .object(choice)
          settings?["supervisors"] = .array([.object(supervisor)])
        } else { settings?[scope] = .object(choice) }
      }
      return ["settings": .object(settings!)]
    }
  }
#endif
