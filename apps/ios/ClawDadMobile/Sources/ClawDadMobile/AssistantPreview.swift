#if DEBUG
  import Foundation
  import ClawDadRemoteAssistProtocol
  import CryptoKit

  /// UI acceptance fixtures never send keyboard events or connect to a real host.
  @MainActor
  final class AssistantPreview {
    private var state: [String: AssistantValue]
    private var uploads: [String: Data] = [:]
    private var failedSend = false
    init() {
      state = [
        "version": .number(1), "conversationMode": .string("background"), "imageAttachments": .bool(true), "enabled": .bool(true), "paused": .bool(false),
        "nativeOnline": .bool(true), "coordinator": .object(["mode": .string("background"), "model": .string("gpt-6-astra"), "status": .string("ready")]),
        "tasks": .array([]),
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
    }
    func snapshot() throws -> AssistantSnapshot {
      try JSONDecoder().decode(AssistantSnapshot.self, from: JSONEncoder().encode(state))
    }
    func command(_ action: String, args: [String: AssistantValue], id: String) throws
      -> AssistantSnapshot
    {
      if action == "pause" { state["paused"] = args["paused"] }
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
  }
#endif
