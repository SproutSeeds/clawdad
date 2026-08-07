import Foundation

let clawDadCloudProtocolVersion = "clawdad.cloud.v1"

struct CloudSignature: Codable, Equatable {
  var alg: String
  var keyId: String
  var value: String
}

enum JSONValue: Codable, Equatable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else {
      self = .array(try container.decode([JSONValue].self))
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let value):
      try container.encode(value)
    case .number(let value):
      try container.encode(value)
    case .bool(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .null:
      try container.encodeNil()
    }
  }

  var stringValue: String {
    if case .string(let value) = self {
      return value
    }
    return ""
  }

  var boolValue: Bool? {
    if case .bool(let value) = self {
      return value
    }
    return nil
  }

  var numberValue: Double? {
    if case .number(let value) = self {
      return value
    }
    return nil
  }
}

struct CloudEnvelope: Codable, Identifiable, Equatable {
  var id: String
  var protocolVersion: String
  var type: String
  var accountId: String
  var workspaceId: String
  var sourceDeviceId: String
  var targetHostId: String
  var seq: Int
  var createdAt: String
  var expiresAt: String
  var body: [String: JSONValue]
  var signature: CloudSignature?

  init(
    type: String,
    accountId: String,
    workspaceId: String,
    sourceDeviceId: String,
    targetHostId: String,
    seq: Int = 0,
    body: [String: JSONValue] = [:]
  ) {
    let now = Date()
    self.id = UUID().uuidString.lowercased()
    self.protocolVersion = clawDadCloudProtocolVersion
    self.type = type
    self.accountId = accountId
    self.workspaceId = workspaceId
    self.sourceDeviceId = sourceDeviceId
    self.targetHostId = targetHostId
    self.seq = seq
    self.createdAt = ISO8601DateFormatter().string(from: now)
    self.expiresAt = ISO8601DateFormatter().string(from: now.addingTimeInterval(60))
    self.body = body
    self.signature = nil
  }
}

struct ProjectSummary: Identifiable, Codable, Equatable {
  var id: String { path }
  var name: String
  var path: String
  var activeSessionId: String
  var sessions: [MobileThreadSummary] = []
  var sessionAliases: [String: String]? = nil
}

struct MobileWorkspace: Identifiable, Codable, Equatable {
  var id: String
  var title: String
  var hostId: String
  var projects: [ProjectSummary]
  var recentThreads: [MobileThreadSummary] = []
}

struct CodexModelSummary: Identifiable, Equatable {
  var id: String { model }
  var model: String
  var displayName: String
  var description: String
  var isDefault: Bool
  var defaultReasoningEffort: String
  var supportedReasoningEfforts: [String]
}

struct MobileImageAttachment: Identifiable, Equatable, Sendable {
  var id: UUID
  var fileName: String
  var mimeType: String
  var data: Data
}

struct MobileVoiceTranscription: Identifiable, Equatable, Sendable {
  var id: String
  var text: String
}

struct MobileApprovalOption: Identifiable, Equatable {
  var id: String { label }
  var label: String
  var description: String
}

struct MobileApprovalQuestion: Identifiable, Equatable {
  var id: String
  var header: String
  var question: String
  var options: [MobileApprovalOption]
}

struct MobileApprovalRequest: Identifiable, Equatable {
  var id: String { approvalId }
  var approvalId: String
  var title: String
  var prompt: String
  var method: String
  var createdAt: String
  var questions: [MobileApprovalQuestion]
}

struct MobileThreadSummary: Identifiable, Codable, Equatable {
  var id: String { "\(projectPath)::\(sessionId)" }
  var projectName: String
  var projectPath: String
  var title: String
  var provider: String
  var sessionId: String
  var active: Bool
  var status: String
  var lastDispatch: String
  var lastResponse: String
  var lastActivityAt: String
}

enum MobileThreadScope: String, CaseIterable, Identifiable {
  case all
  case project

  var id: String { rawValue }

  var title: String {
    switch self {
    case .all:
      return "All"
    case .project:
      return "Project"
    }
  }
}

enum MobileReadAloudKind: String, Equatable {
  case message
  case response

  var accessibilitySubject: String {
    switch self {
    case .message:
      return "your message"
    case .response:
      return "Codex response"
    }
  }
}

enum MobileReadAloudPhase: String, Equatable {
  case idle
  case preparing
  case playing
  case paused
  case failed
}

func mobileReadAloudKey(
  item: MobileHistoryItem,
  kind: MobileReadAloudKind,
  text: String
) -> String {
  let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
  var hash: UInt64 = 14_695_981_039_346_656_037
  for byte in normalized.utf8 {
    hash ^= UInt64(byte)
    hash &*= 1_099_511_628_211
  }
  let requestId = item.requestId.isEmpty ? item.id : item.requestId
  return "\(requestId)::\(kind.rawValue)::\(normalized.utf8.count)::\(String(hash, radix: 36))"
}

struct MobileHistoryItem: Identifiable, Equatable {
  var id: String
  var requestId: String
  var message: String
  var response: String
  var status: String
  var sentAt: String
  var answeredAt: String
  var scheduleMode: String = ""
  var deliveryMechanism: String = ""

  var lifecycleStatus: String {
    let normalized = status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalized == "answered" || normalized == "completed" {
      return "answered"
    }
    if normalized == "failed" {
      return "failed"
    }
    if ["working", "running", "dispatched", "dispatching", "starting"].contains(normalized) {
      return "working"
    }
    let mode = scheduleMode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let mechanism = deliveryMechanism.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalized == "queued" && (mode == "direct" || mechanism == "turn_steer" || mechanism == "dispatch_worker") {
      return "working"
    }
    return "queued"
  }

  var lifecycleLabel: String {
    lifecycleStatus.uppercased()
  }

  var responsePlaceholder: String {
    switch lifecycleStatus {
    case "working":
      return "Codex is working on this turn."
    case "queued":
      return "Waiting to send after the active turn finishes."
    case "failed":
      return "ClawDad could not finish this Codex turn. Your message was saved."
    default:
      return ""
    }
  }

  var displayResponse: String {
    let cleaned = response
      .replacingOccurrences(
        of: "\u{001B}\\[[0-?]*[ -/]*[@-~]",
        with: "",
        options: .regularExpression
      )
      .replacingOccurrences(
        of: "\\[[0-9;]{1,12}m",
        with: "",
        options: .regularExpression
      )
      .trimmingCharacters(in: .whitespacesAndNewlines)

    guard lifecycleStatus == "failed" else {
      return cleaned
    }

    let diagnosticText = response.lowercased()
    if diagnosticText.contains("responsestreamdisconnected")
      || (
        diagnosticText.contains("reconnecting...")
          && diagnosticText.contains("stream disconnected")
      )
    {
      return "Codex's response connection dropped while it was reconnecting. Your message was saved, but this turn did not finish."
    }

    let internalDiagnosticMarkers = [
      "\"codexerrorinfo\"",
      "rmcp::transport::worker",
      "websocket closed by server before response.completed",
      "transport channel closed",
    ]
    if cleaned.isEmpty || internalDiagnosticMarkers.contains(where: diagnosticText.contains) {
      return responsePlaceholder
    }

    return cleaned
  }

  var isPending: Bool {
    lifecycleStatus == "queued" || lifecycleStatus == "working"
  }
}

struct MobileThreadSelection: Identifiable, Equatable {
  var id = UUID()
  var initialThread: MobileThreadSummary
}

#if DEBUG
enum ClawDadAppStorePreviewScenario: String, Equatable {
  case workspace
  case conversation

  static func parse(arguments: [String]) -> Self? {
    guard
      let flagIndex = arguments.firstIndex(of: "--clawdad-app-store-preview"),
      arguments.indices.contains(flagIndex + 1)
    else {
      return nil
    }
    return Self(rawValue: arguments[flagIndex + 1])
  }

  static var current: Self? {
    parse(arguments: ProcessInfo.processInfo.arguments)
  }
}

struct ClawDadAppStorePreviewFixture: Equatable {
  var workspace: MobileWorkspace
  var selectedProjectPath: String
  var selectedSessionId: String
  var historyItems: [MobileHistoryItem]
  var modelOptions: [CodexModelSummary]

  var selectedThread: MobileThreadSummary? {
    workspace.projects
      .first { $0.path == selectedProjectPath }?
      .sessions
      .first { $0.sessionId == selectedSessionId }
  }

  static func make(
    scenario: ClawDadAppStorePreviewScenario = .workspace
  ) -> Self {
    let launchPath = "/Users/demo/Projects/launchpad"
    let launchSessionId = "preview-paid-beta-launch"
    let launchThread = MobileThreadSummary(
      projectName: "Launchpad",
      projectPath: launchPath,
      title: "Paid beta launch",
      provider: "codex",
      sessionId: launchSessionId,
      active: true,
      status: "answered",
      lastDispatch: "2026-07-30T14:37:00.000Z",
      lastResponse: "2026-07-30T14:41:00.000Z",
      lastActivityAt: "2026-07-30T14:41:00.000Z"
    )
    let remoteThread = MobileThreadSummary(
      projectName: "Launchpad",
      projectPath: launchPath,
      title: "Remote access polish",
      provider: "codex",
      sessionId: "preview-remote-access",
      active: false,
      status: "answered",
      lastDispatch: "2026-07-30T14:08:00.000Z",
      lastResponse: "2026-07-30T14:16:00.000Z",
      lastActivityAt: "2026-07-30T14:16:00.000Z"
    )
    let studioPath = "/Users/demo/Projects/studio-site"
    let studioThread = MobileThreadSummary(
      projectName: "Studio Site",
      projectPath: studioPath,
      title: "Homepage launch",
      provider: "codex",
      sessionId: "preview-homepage-launch",
      active: true,
      status: "answered",
      lastDispatch: "2026-07-30T13:42:00.000Z",
      lastResponse: "2026-07-30T13:55:00.000Z",
      lastActivityAt: "2026-07-30T13:55:00.000Z"
    )
    let workspace = MobileWorkspace(
      id: "preview-workspace",
      title: "My Projects",
      hostId: "preview-mac",
      projects: [
        ProjectSummary(
          name: "Launchpad",
          path: launchPath,
          activeSessionId: launchSessionId,
          sessions: [launchThread, remoteThread]
        ),
        ProjectSummary(
          name: "Studio Site",
          path: studioPath,
          activeSessionId: studioThread.sessionId,
          sessions: [studioThread]
        ),
      ],
      recentThreads: [launchThread, remoteThread, studioThread]
    )
    let historyItems = [
      MobileHistoryItem(
        id: "preview-history-audit",
        requestId: "preview-history-audit",
        message: "Please audit the paid beta and give me a clear launch plan.",
        response: """
        The paid beta is ready for its final human checks.

        ## Completed
        - Mac app signed and notarized
        - iPhone build available in TestFlight
        - Secure relay and reconnect checks passed

        ## Next
        1. Verify purchase and restore on iPhone.
        2. Invite the first founding customers.
        """,
        status: "answered",
        sentAt: "2026-07-30T14:29:00.000Z",
        answeredAt: "2026-07-30T14:32:00.000Z",
        scheduleMode: "direct",
        deliveryMechanism: "dispatch_worker"
      ),
      MobileHistoryItem(
        id: "preview-history-next",
        requestId: "preview-history-next",
        message: "Great. Keep this thread open and tell me the next best action.",
        response: """
        Start with the iPhone purchase-and-restore pass. I will preserve the results here and continue from this same project when you return.
        """,
        status: "answered",
        sentAt: "2026-07-30T14:37:00.000Z",
        answeredAt: "2026-07-30T14:41:00.000Z",
        scheduleMode: "direct",
        deliveryMechanism: "dispatch_worker"
      ),
    ]
    let conversationHistory = [
      MobileHistoryItem(
        id: "preview-history-conversation",
        requestId: "preview-history-conversation",
        message: "Can you finish the paid beta readiness pass and tell me what remains?",
        response: """
        The release pass is complete.

        ## Verified
        - Mac app signed and notarized
        - iPhone build available in TestFlight
        - Secure relay and reconnect checks passed

        ## Next
        Run the final purchase-and-restore check on iPhone, then invite the first founding customers.
        """,
        status: "answered",
        sentAt: "2026-07-30T14:37:00.000Z",
        answeredAt: "2026-07-30T14:41:00.000Z",
        scheduleMode: "direct",
        deliveryMechanism: "dispatch_worker"
      )
    ]
    let models = [
      CodexModelSummary(
        model: "gpt-5.6-sol",
        displayName: "GPT-5.6 SOL",
        description: "Best quality for agentic coding",
        isDefault: true,
        defaultReasoningEffort: "ultra",
        supportedReasoningEfforts: ["medium", "high", "ultra"]
      )
    ]
    return Self(
      workspace: workspace,
      selectedProjectPath: launchPath,
      selectedSessionId: launchSessionId,
      historyItems: scenario == .conversation ? conversationHistory : historyItems,
      modelOptions: models
    )
  }
}
#endif

func resolveMobileSessionAlias(_ selector: String, in project: ProjectSummary) -> String {
  var current = selector.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !current.isEmpty else {
    return ""
  }

  let aliases = project.sessionAliases ?? [:]
  var visited = Set<String>()
  for _ in 0..<16 {
    guard !visited.contains(current) else {
      break
    }
    visited.insert(current)
    guard
      let next = aliases[current]?.trimmingCharacters(in: .whitespacesAndNewlines),
      !next.isEmpty,
      next != current
    else {
      break
    }
    current = next
  }
  return current
}

func resolveMobileThreadSelection(
  _ selection: MobileThreadSelection,
  workspace: MobileWorkspace,
  selectedProjectPath: String,
  selectedSessionId: String
) -> MobileThreadSummary {
  let fallback = selection.initialThread
  guard let project = workspace.projects.first(where: { $0.path == fallback.projectPath }) else {
    return fallback
  }

  let initialCanonical = resolveMobileSessionAlias(fallback.sessionId, in: project)
  let selectedCanonical = selectedProjectPath == fallback.projectPath
    ? resolveMobileSessionAlias(selectedSessionId, in: project)
    : ""
  let targetSessionId = !selectedCanonical.isEmpty && selectedCanonical == initialCanonical
    ? selectedCanonical
    : initialCanonical
  guard var live = project.sessions.first(where: { $0.sessionId == targetSessionId }) else {
    return fallback
  }

  if live.sessionId != fallback.sessionId && !fallback.title.isEmpty {
    live.title = fallback.title
  }
  return live
}

func parseCloudTimestamp(_ value: String) -> Date? {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    return nil
  }
  let fractionalFormatter = ISO8601DateFormatter()
  fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = fractionalFormatter.date(from: trimmed) {
    return date
  }
  return ISO8601DateFormatter().date(from: trimmed)
}

func mobileThreadActivityMs(_ thread: MobileThreadSummary) -> TimeInterval {
  [
    thread.lastActivityAt,
    thread.lastResponse,
    thread.lastDispatch
  ]
  .compactMap(parseCloudTimestamp)
  .map(\.timeIntervalSince1970)
  .max() ?? 0
}

func mobileThreadsByRecentActivity(_ threads: [MobileThreadSummary]) -> [MobileThreadSummary] {
  threads.sorted { left, right in
    let leftTime = mobileThreadActivityMs(left)
    let rightTime = mobileThreadActivityMs(right)
    if leftTime != rightTime {
      return leftTime > rightTime
    }
    if left.active != right.active {
      return left.active
    }
    let projectOrder = left.projectName.localizedCaseInsensitiveCompare(right.projectName)
    if projectOrder != .orderedSame {
      return projectOrder == .orderedAscending
    }
    let titleOrder = left.title.localizedCaseInsensitiveCompare(right.title)
    if titleOrder != .orderedSame {
      return titleOrder == .orderedAscending
    }
    return left.sessionId < right.sessionId
  }
}

func mobileRecentThreads(
  in projects: [ProjectSummary],
  limit: Int = 20
) -> [MobileThreadSummary] {
  var byThread: [String: MobileThreadSummary] = [:]

  for project in projects {
    for thread in project.sessions {
      var candidate = thread
      candidate.projectName = project.name
      candidate.projectPath = project.path
      candidate.sessionId = resolveMobileSessionAlias(thread.sessionId, in: project)
      candidate.active = candidate.active || candidate.sessionId == resolveMobileSessionAlias(
        project.activeSessionId,
        in: project
      )
      guard !candidate.sessionId.isEmpty else {
        continue
      }

      let key = "\(candidate.projectPath)::\(candidate.sessionId)"
      if let existing = byThread[key] {
        let candidateIsNewer = mobileThreadActivityMs(candidate) >= mobileThreadActivityMs(existing)
        var merged = candidateIsNewer ? candidate : existing
        merged.active = existing.active || candidate.active
        if merged.title.isEmpty {
          merged.title = candidateIsNewer ? existing.title : candidate.title
        }
        byThread[key] = merged
      } else {
        byThread[key] = candidate
      }
    }
  }

  return Array(
    mobileThreadsByRecentActivity(Array(byThread.values))
      .prefix(max(0, min(limit, 100)))
  )
}

struct PairingPayload: Codable, Equatable {
  var type: String
  var protocolVersion: String?
  var cloudUrl: String
  var accountId: String
  var workspaceId: String
  var hostId: String
  var hostPublicKeyPem: String?
  var hostKeyId: String?
  var token: String
  var createdAt: String?
  var expiresAt: String
}

enum CloudConnectionState: Equatable {
  case disconnected
  case connecting
  case connected
  case failed(String)

  var label: String {
    switch self {
    case .disconnected:
      return "Disconnected"
    case .connecting:
      return "Connecting"
    case .connected:
      return "Connected"
    case .failed(let message):
      return message
    }
  }
}
