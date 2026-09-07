#if DEBUG
  import Foundation
  import ClawDadRemoteAssistProtocol

  /// UI acceptance fixtures never send keyboard events or connect to a real host.
  @MainActor
  final class AssistantPreview {
    private var state: [String: AssistantValue]
    init() {
      state = [
        "version": .number(1), "enabled": .bool(true), "paused": .bool(false),
        "nativeOnline": .bool(true), "coordinator": .object(["tabId": .string("assistant")]),
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
      if action == "message" {
        var messages = state["messages"]?.array ?? []
        messages.append(
          .object([
            "id": .string(id), "role": .string("user"), "text": args["text"] ?? .string(""),
            "createdAt": .string("2026-09-07T00:01:00Z"),
          ]))
        state["messages"] = .array(messages)
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
  }
#endif
