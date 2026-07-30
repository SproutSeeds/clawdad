import Foundation
import SwiftUI
import CryptoKit
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class CloudSession: ObservableObject {
  @Published var cloudUrl: String {
    didSet { defaults.set(cloudUrl, forKey: "clawdad.cloudUrl") }
  }
  @Published var accountId: String {
    didSet { defaults.set(accountId, forKey: "clawdad.accountId") }
  }
  @Published var workspaceId: String {
    didSet { defaults.set(workspaceId, forKey: "clawdad.workspaceId") }
  }
  @Published var hostId: String {
    didSet { defaults.set(hostId, forKey: "clawdad.hostId") }
  }
  @Published var devToken: String {
    didSet { defaults.set(devToken, forKey: "clawdad.devToken") }
  }
  @Published var state: CloudConnectionState = .disconnected
  @Published var workspace = MobileWorkspace(
    id: "scratchpad",
    title: "Scratchpad",
    hostId: "cody-mac",
    projects: []
  )
  @Published var selectedProjectPath: String {
    didSet { defaults.set(selectedProjectPath, forKey: "clawdad.selectedProjectPath") }
  }
  @Published var selectedSessionId: String {
    didSet { defaults.set(selectedSessionId, forKey: "clawdad.selectedSessionId") }
  }
  @Published var historyItems: [MobileHistoryItem] = []
  @Published var historyStatus = ""
  @Published var events: [String] = []
  @Published var pairingStatus = ""
  @Published var modelOptions: [CodexModelSummary] = []
  @Published var selectedModel: String {
    didSet { defaults.set(selectedModel, forKey: "clawdad.selectedModel") }
  }
  @Published var selectedReasoningEffort: String {
    didSet { defaults.set(selectedReasoningEffort, forKey: "clawdad.selectedReasoningEffort") }
  }
  @Published var sessionCreatePending = false
  @Published var voiceTranscriptionPending = false
  @Published var voiceTranscriptionStatus = ""
  @Published var voiceTranscription: MobileVoiceTranscription?
  @Published var voiceTranscriptionError = ""
  @Published var pendingApprovals: [MobileApprovalRequest] = []
  @Published var hostOnline = false
  @Published var pairedHostId: String {
    didSet { defaults.set(pairedHostId, forKey: "clawdad.pairedHostId") }
  }
  @Published var pairedAt: String {
    didSet { defaults.set(pairedAt, forKey: "clawdad.pairedAt") }
  }
  @Published var pairedHostPublicKeyPem: String {
    didSet { defaults.set(pairedHostPublicKeyPem, forKey: "clawdad.pairedHostPublicKeyPem") }
  }
  @Published private(set) var startupWorkspaceReady = false

  private var task: URLSessionWebSocketTask?
  private var receiveTask: Task<Void, Never>?
  private var monitorTask: Task<Void, Never>?
  private var reconnectTask: Task<Void, Never>?
  private var voiceTranscriptionTimeoutTask: Task<Void, Never>?
  private var lastObservedTerminalRequest = ""
  private var pendingVoiceRequestId = ""
  private var pendingVoiceEnvelopeId = ""
  private var pendingCatalogHistoryLimit: Int?
  private var pendingPairingHostPublicKeyPem = ""
  private var remoteAssistEnvelopeHandler: ((CloudEnvelope) -> Void)?
  private var connectionRequested = true
  private var reconnectAttempt = 0
  private var lastRelayPongAt = Date.distantPast
  private var lastHostSeenAt = Date.distantPast
  private var seq = 0
  private let defaults = UserDefaults.standard

  init() {
    let bundledCloudUrl = String(
      describing: Bundle.main.object(forInfoDictionaryKey: "ClawDadCloudURL") ?? ""
    ).trimmingCharacters(in: .whitespacesAndNewlines)
    let defaultCloudUrl = bundledCloudUrl.isEmpty || bundledCloudUrl.contains("$(")
      ? "https://clawdad-cloud.frg.earth"
      : bundledCloudUrl
    self.cloudUrl = defaults.string(forKey: "clawdad.cloudUrl") ?? defaultCloudUrl
    self.accountId = defaults.string(forKey: "clawdad.accountId") ?? "local-account"
    self.workspaceId = defaults.string(forKey: "clawdad.workspaceId") ?? "scratchpad"
    self.hostId = defaults.string(forKey: "clawdad.hostId") ?? "cody-mac"
    self.devToken = defaults.string(forKey: "clawdad.devToken") ?? ""
    self.pairedHostId = defaults.string(forKey: "clawdad.pairedHostId") ?? ""
    self.pairedAt = defaults.string(forKey: "clawdad.pairedAt") ?? ""
    self.pairedHostPublicKeyPem =
      defaults.string(forKey: "clawdad.pairedHostPublicKeyPem") ?? ""
    self.selectedProjectPath = defaults.string(forKey: "clawdad.selectedProjectPath") ?? ""
    self.selectedSessionId = defaults.string(forKey: "clawdad.selectedSessionId") ?? ""
    self.selectedModel = defaults.string(forKey: "clawdad.selectedModel") ?? "gpt-5.6-sol"
    self.selectedReasoningEffort = defaults.string(forKey: "clawdad.selectedReasoningEffort") ?? "ultra"
    self.startupWorkspaceReady = self.pairedHostId.isEmpty || self.pairedHostId != self.hostId
  }

  var connected: Bool {
    if case .connected = state {
      return true
    }
    return false
  }

  var paired: Bool {
    !pairedHostId.isEmpty && pairedHostId == hostId
  }

  var ready: Bool {
    connected && paired && hostOnline
  }

  var remoteAssistAuthenticated: Bool {
    ready && !pairedHostPublicKeyPem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var startupLoading: Bool {
    paired && !startupWorkspaceReady
  }

  var selectedModelOption: CodexModelSummary? {
    modelOptions.first { $0.model == selectedModel }
  }

  var selectedModelDisplayName: String {
    selectedModelOption?.displayName ?? selectedModel
  }

  var supportedReasoningEfforts: [String] {
    let efforts = selectedModelOption?.supportedReasoningEfforts ?? []
    return efforts.isEmpty ? [selectedReasoningEffort] : efforts
  }

  func connectIfPaired() {
    guard paired else {
      return
    }
    connectionRequested = true
    if connected {
      let relayIsStale = lastRelayPongAt != .distantPast &&
        Date().timeIntervalSince(lastRelayPongAt) > 35
      if task?.state != .running || relayIsStale {
        handleConnectionLoss(URLError(.networkConnectionLost))
        return
      }
      pingHost()
      if hostOnline {
        requestCatalog()
      }
      return
    }
    if case .connecting = state {
      return
    }
    connect()
  }

  func connect() {
    guard paired else {
      pairingStatus = "Scan the Mac QR to pair this iPhone."
      events.insert("Pair with Mac first", at: 0)
      return
    }
    if case .connecting = state {
      return
    }
    if connected {
      requestCatalog()
      return
    }
    connectionRequested = true
    reconnectTask?.cancel()
    reconnectTask = nil
    Task {
      do {
        try await connectAsync()
      } catch {
        handleConnectionLoss(error)
      }
    }
  }

  func disconnect() {
    connectionRequested = false
    reconnectTask?.cancel()
    reconnectTask = nil
    resetSocket()
    state = .disconnected
  }

  private func resetSocket() {
    monitorTask?.cancel()
    monitorTask = nil
    receiveTask?.cancel()
    receiveTask = nil
    task?.cancel(with: .normalClosure, reason: nil)
    task = nil
    voiceTranscriptionTimeoutTask?.cancel()
    voiceTranscriptionTimeoutTask = nil
    voiceTranscriptionPending = false
    voiceTranscriptionStatus = ""
    pendingVoiceRequestId = ""
    pendingVoiceEnvelopeId = ""
    hostOnline = false
    lastRelayPongAt = .distantPast
    lastHostSeenAt = .distantPast
  }

  func forgetPairing() {
    disconnect()
    pairedHostId = ""
    pairedAt = ""
    pairedHostPublicKeyPem = ""
    pendingPairingHostPublicKeyPem = ""
    selectedProjectPath = ""
    selectedSessionId = ""
    historyItems = []
    historyStatus = ""
    pendingApprovals = []
    startupWorkspaceReady = true
    workspace = MobileWorkspace(
      id: workspaceId,
      title: "Scratchpad",
      hostId: hostId,
      projects: []
    )
    pairingStatus = "Pairing cleared. Scan the Mac QR to pair this iPhone again."
    events.insert("Pairing cleared", at: 0)
  }

  func selectProject(_ project: ProjectSummary) {
    selectedProjectPath = project.path
    selectedSessionId = project.activeSessionId
    historyItems = []
    historyStatus = "Loading threads for \(project.name)..."
    requestCatalog()
    requestModels()
  }

  func selectThread(_ thread: MobileThreadSummary, historyLimit: Int = 20) {
    selectedProjectPath = thread.projectPath
    selectedSessionId = thread.sessionId
    historyItems = []
    historyStatus = "Loading \(thread.title)..."
    events.insert("Opened \(thread.projectName) ...\(thread.sessionId.suffix(5))", at: 0)
    let project = workspace.projects.first { $0.path == thread.projectPath }
    let threadIsTracked: Bool
    if let project {
      let resolvedSessionId = resolveMobileSessionAlias(thread.sessionId, in: project)
      threadIsTracked = project.sessions.contains {
        resolveMobileSessionAlias($0.sessionId, in: project) == resolvedSessionId
      }
    } else {
      threadIsTracked = false
    }
    if threadIsTracked {
      requestHistory(limit: historyLimit)
      requestStatus()
    } else {
      pendingCatalogHistoryLimit = historyLimit
      requestCatalog()
    }
  }

  func requestCatalog() {
    guard paired else {
      pairingStatus = "Pair this iPhone before loading projects."
      return
    }
    guard connected else {
      connectIfPaired()
      return
    }
    Task {
      do {
        var body: [String: JSONValue] = [:]
        let project = selectedProjectPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if !project.isEmpty {
          body["project"] = .string(project)
        }
        try await sendEnvelope(type: "catalog.request", body: body)
      } catch {
        state = .failed(describe(error))
      }
    }
  }

  func requestModels() {
    guard ready else {
      return
    }
    Task {
      do {
        try await sendEnvelope(type: "models.request", body: [
          "project": .string(selectedProjectPath)
        ])
      } catch {
        events.insert("Model catalog failed: \(describe(error))", at: 0)
      }
    }
  }

  func chooseModel(_ model: CodexModelSummary) {
    selectedModel = model.model
    if !model.supportedReasoningEfforts.contains(selectedReasoningEffort) {
      selectedReasoningEffort = model.defaultReasoningEffort
    }
  }

  func chooseReasoningEffort(_ effort: String) {
    guard supportedReasoningEfforts.contains(effort) else {
      return
    }
    selectedReasoningEffort = effort
  }

  func createSession(title: String = "") {
    guard ready, !selectedProjectPath.isEmpty, !sessionCreatePending else {
      return
    }
    let normalizedTitle = String(
      title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)
    )
    sessionCreatePending = true
    historyStatus = "Starting a new Codex thread..."
    Task {
      do {
        try await sendEnvelope(type: "session.create.request", body: [
          "project": .string(selectedProjectPath),
          "provider": .string("codex"),
          "model": .string(selectedModel),
          "reasoningEffort": .string(selectedReasoningEffort),
          "title": .string(normalizedTitle)
        ])
      } catch {
        sessionCreatePending = false
        let message = describe(error)
        historyStatus = message
        events.insert("New thread failed: \(message)", at: 0)
      }
    }
  }

  func requestHistory(limit: Int = 8) {
    guard paired else {
      historyItems = []
      historyStatus = "Pair this iPhone to load thread history."
      return
    }
    guard connected else {
      historyStatus = "Connect to load thread history."
      return
    }
    guard !selectedProjectPath.isEmpty else {
      historyItems = []
      historyStatus = "Choose a project to load its active thread."
      return
    }
    guard !selectedSessionId.isEmpty else {
      historyItems = []
      historyStatus = "This project does not have an active thread yet."
      return
    }

    historyStatus = "Loading thread..."
    Task {
      do {
        try await sendEnvelope(type: "history.request", body: [
          "project": .string(selectedProjectPath),
          "sessionId": .string(selectedSessionId),
          "cursor": .string("0"),
          "limit": .string(String(limit))
        ])
      } catch {
        let message = describe(error)
        historyStatus = message
        events.insert("Thread history failed: \(message)", at: 0)
      }
    }
  }

  func requestStatus() {
    guard ready, !selectedProjectPath.isEmpty else {
      return
    }
    Task {
      do {
        try await sendEnvelope(type: "status.request", body: [
          "project": .string(selectedProjectPath),
          "sessionId": .string(selectedSessionId)
        ])
      } catch {
        events.insert("Status check failed: \(describe(error))", at: 0)
      }
    }
  }

  func decideApproval(_ approval: MobileApprovalRequest, approve: Bool) {
    guard ready else {
      historyStatus = "Reconnect to your Mac before responding to this approval."
      return
    }
    Task {
      do {
        try await sendEnvelope(type: "approval.decision", body: [
          "project": .string(selectedProjectPath),
          "approvalId": .string(approval.approvalId),
          "decision": .string(approve ? "approve" : "decline")
        ])
        pendingApprovals.removeAll { $0.approvalId == approval.approvalId }
        historyStatus = approve ? "Approval sent. Codex is continuing." : "Request declined."
        events.insert(approve ? "Approved Codex action" : "Declined Codex action", at: 0)
        requestStatus()
      } catch {
        let message = describe(error)
        historyStatus = message
        events.insert("Approval response failed: \(message)", at: 0)
        handleConnectionLoss(error)
      }
    }
  }

  func sendMessage(
    _ message: String,
    dispatchMode: String = "direct",
    permissionMode: String = "approve",
    imageAttachments: [MobileImageAttachment] = []
  ) {
    let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty || !imageAttachments.isEmpty else {
      return
    }
    guard paired else {
      pairingStatus = "Pair this iPhone before sending."
      events.insert("Pairing required", at: 0)
      return
    }
    guard connected else {
      pairingStatus = "Connect to your Mac before sending."
      events.insert("Connect to host first", at: 0)
      return
    }
    Task {
      do {
        var body: [String: JSONValue] = [
          "project": .string(selectedProjectPath),
          "sessionId": .string(selectedSessionId),
          "message": .string(text),
          "dispatchMode": .string(dispatchMode),
          "permissionMode": .string(permissionMode),
          "model": .string(selectedModel),
          "reasoningEffort": .string(selectedReasoningEffort)
        ]
        if !imageAttachments.isEmpty {
          body["attachments"] = .array(imageAttachments.map { attachment in
            .object([
              "fileName": .string(attachment.fileName),
              "mimeType": .string(attachment.mimeType),
              "size": .number(Double(attachment.data.count)),
              "dataBase64": .string(attachment.data.base64EncodedString())
            ])
          })
        }
        try await sendEnvelope(type: "message.send", body: body)
        let projectName = URL(fileURLWithPath: selectedProjectPath).lastPathComponent
        let threadSuffix = selectedSessionId.isEmpty ? "new thread" : "...\(selectedSessionId.suffix(5))"
        let attachmentNote = imageAttachments.isEmpty ? "" : " with \(imageAttachments.count) image\(imageAttachments.count == 1 ? "" : "s")"
        events.insert("Sent to \(projectName) \(threadSuffix)\(attachmentNote)", at: 0)
        historyStatus = "Message sent. Waiting for desktop history..."
        requestHistory()
      } catch {
        state = .failed(describe(error))
      }
    }
  }

  func transcribeVoice(
    _ data: Data,
    fileName: String = "clawdad-voice.m4a",
    mimeType: String = "audio/mp4",
    duration: TimeInterval = 0
  ) {
    guard ready else {
      voiceTranscriptionError = "ClawDad must be connected before voice transcription."
      return
    }
    guard !voiceTranscriptionPending else {
      return
    }
    guard !data.isEmpty else {
      voiceTranscriptionError = "The recording did not contain any audio."
      return
    }
    guard data.count <= 12 * 1024 * 1024 else {
      voiceTranscriptionError = "The recording is too large. Keep voice notes under 12 MB."
      return
    }

    let requestId = UUID().uuidString.lowercased()
    let envelopeId = UUID().uuidString.lowercased()
    pendingVoiceRequestId = requestId
    pendingVoiceEnvelopeId = envelopeId
    voiceTranscription = nil
    voiceTranscriptionError = ""
    voiceTranscriptionPending = true
    voiceTranscriptionStatus = "Uploading recording..."
    startVoiceTranscriptionTimeout(requestId: requestId, duration: duration)

    Task {
      do {
        try await sendEnvelope(
          type: "speech.transcribe.request",
          body: [
            "requestId": .string(requestId),
            "project": .string(selectedProjectPath),
            "fileName": .string(fileName),
            "mimeType": .string(mimeType),
            "size": .number(Double(data.count)),
            "dataBase64": .string(data.base64EncodedString())
          ],
          envelopeId: envelopeId
        )
        if voiceTranscriptionPending, pendingVoiceRequestId == requestId {
          voiceTranscriptionStatus = "Waiting for your Mac..."
        }
        events.insert("Voice note sent for transcription", at: 0)
      } catch {
        finishVoiceTranscription(error: describe(error))
      }
    }
  }

  func pairWithScannedCode(_ text: String) {
    Task {
      do {
        let payload = try parsePairingPayload(text)
        try await pair(with: payload)
      } catch {
        let message = describe(error)
        pairingStatus = message
        events.insert("Pairing failed: \(message)", at: 0)
      }
    }
  }

  func setRemoteAssistEnvelopeHandler(_ handler: ((CloudEnvelope) -> Void)?) {
    remoteAssistEnvelopeHandler = handler
  }

  @discardableResult
  func sendRemoteAssistEnvelope(
    type: String,
    body: [String: JSONValue]
  ) async throws -> String {
    guard type.hasPrefix("remote.assist.") else {
      throw URLError(.unsupportedURL)
    }
    guard remoteAssistAuthenticated else {
      throw RemoteAssistCloudError.authenticationRequired
    }
    let envelopeId = UUID().uuidString.lowercased()
    try await sendEnvelope(type: type, body: body, envelopeId: envelopeId)
    return envelopeId
  }

  private func parsePairingPayload(_ text: String) throws -> PairingPayload {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let data = trimmed.data(using: .utf8) else {
      throw PairingError.invalidCode
    }
    let payload: PairingPayload
    do {
      payload = try JSONDecoder().decode(PairingPayload.self, from: data)
    } catch {
      throw PairingError.invalidCode
    }
    guard payload.type == "clawdad.pair.v1" else {
      throw PairingError.wrongCode
    }
    guard
      !payload.cloudUrl.isEmpty,
      !payload.accountId.isEmpty,
      !payload.workspaceId.isEmpty,
      !payload.hostId.isEmpty,
      !payload.token.isEmpty,
      let expiresAt = parseCloudDate(payload.expiresAt)
    else {
      throw PairingError.invalidCode
    }
    guard expiresAt > Date() else {
      throw PairingError.expiredCode
    }
    return payload
  }

  private func pair(with payload: PairingPayload) async throws {
    cloudUrl = payload.cloudUrl
    accountId = payload.accountId
    workspaceId = payload.workspaceId
    hostId = payload.hostId
    pendingPairingHostPublicKeyPem = payload.hostPublicKeyPem ?? ""
    startupWorkspaceReady = false
    workspace = MobileWorkspace(
      id: payload.workspaceId,
      title: "Scratchpad",
      hostId: payload.hostId,
      projects: workspace.projects,
      recentThreads: workspace.recentThreads
    )
    pairingStatus = "Connecting to ClawDad..."
    try await connectAsync()
    pairingStatus = "Trusting this iPhone..."
    try await sendEnvelope(type: "pair.request", body: [
      "token": .string(payload.token),
      "publicKeyPem": .string(try DeviceIdentity.shared.publicKeyExport()),
      "keyId": .string(try DeviceIdentity.shared.publicKeyId()),
      "deviceName": .string(deviceName()),
      "platform": .string("ios")
    ])
  }

  private func deviceName() -> String {
    #if canImport(UIKit)
    return UIDevice.current.name
    #else
    return "ClawDad device"
    #endif
  }

  private func connectAsync() async throws {
    reconnectTask = nil
    resetSocket()
    state = .connecting
    let deviceId = try DeviceIdentity.shared.deviceId()
    var request = URLRequest(url: try realtimeURL(deviceId: deviceId))
    if !devToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      request.setValue("Bearer \(devToken)", forHTTPHeaderField: "Authorization")
    }
    let socket = URLSession.shared.webSocketTask(with: request)
    socket.maximumMessageSize = 32 * 1024 * 1024
    task = socket
    socket.resume()
    lastRelayPongAt = Date()
    receiveTask = Task { [weak self, weak socket] in
      guard let self, let socket else {
        return
      }
      do {
        try await self.receiveLoop(socket)
      } catch {
        if self.task === socket {
          if self.voiceTranscriptionPending {
            self.finishVoiceTranscription(
              error: "The connection dropped before your transcript returned. Reconnect and try again."
            )
          }
          self.handleConnectionLoss(error)
        }
      }
    }
    try await sendEnvelope(type: "ping", body: [
      "platform": .string("ios"),
      "sentAt": .string(ISO8601DateFormatter().string(from: Date()))
    ])
    state = .connected
    reconnectAttempt = 0
    workspace = MobileWorkspace(
      id: workspaceId,
      title: "Scratchpad",
      hostId: hostId,
      projects: workspace.projects,
      recentThreads: workspace.recentThreads
    )
    events.insert("Cloud relay connected", at: 0)
    startActivityMonitor()
  }

  private func startActivityMonitor() {
    monitorTask?.cancel()
    monitorTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 5_000_000_000)
        guard let self else {
          return
        }
        guard self.connected else {
          self.scheduleReconnect()
          return
        }
        let now = Date()
        if self.lastRelayPongAt != .distantPast,
           now.timeIntervalSince(self.lastRelayPongAt) > 35 {
          self.handleConnectionLoss(URLError(.networkConnectionLost))
          return
        }
        if self.lastHostSeenAt != .distantPast,
           now.timeIntervalSince(self.lastHostSeenAt) > 40 {
          self.hostOnline = false
        }
        self.pingHost()
        if self.ready {
          self.requestStatus()
        }
      }
    }
  }

  private func pingHost() {
    guard connected else {
      return
    }
    Task {
      do {
        try await sendEnvelope(type: "ping", body: [
          "platform": .string("ios"),
          "sentAt": .string(ISO8601DateFormatter().string(from: Date()))
        ])
      } catch {
        handleConnectionLoss(error)
      }
    }
  }

  private func handleConnectionLoss(_ error: Error) {
    guard connectionRequested, paired else {
      resetSocket()
      state = .disconnected
      return
    }
    let message = describe(error)
    resetSocket()
    state = .connecting
    historyStatus = "Reconnecting to ClawDad..."
    events.insert("Connection interrupted: \(message)", at: 0)
    scheduleReconnect()
  }

  private func scheduleReconnect() {
    guard connectionRequested, paired, reconnectTask == nil else {
      return
    }
    reconnectAttempt += 1
    let delaySeconds = min(30.0, pow(2.0, Double(min(reconnectAttempt - 1, 5))))
    reconnectTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(delaySeconds * 1_000_000_000))
      guard !Task.isCancelled, let self, self.connectionRequested, self.paired else {
        return
      }
      self.reconnectTask = nil
      do {
        try await self.connectAsync()
      } catch {
        self.handleConnectionLoss(error)
      }
    }
  }

  private func realtimeURL(deviceId: String) throws -> URL {
    guard var components = URLComponents(string: cloudUrl) else {
      throw URLError(.badURL)
    }
    components.scheme = components.scheme == "https" ? "wss" : "ws"
    components.path = "/workspaces/\(workspaceId)/realtime"
    components.queryItems = [
      URLQueryItem(name: "deviceId", value: deviceId),
      URLQueryItem(name: "accountId", value: accountId)
    ]
    guard let url = components.url else {
      throw URLError(.badURL)
    }
    return url
  }

  private func receiveLoop(_ socket: URLSessionWebSocketTask) async throws {
    while task === socket {
      let message = try await socket.receive()
      switch message {
      case .string(let text):
        try handleIncomingText(text)
      case .data(let data):
        if let text = String(data: data, encoding: .utf8) {
          try handleIncomingText(text)
        }
      @unknown default:
        break
      }
    }
  }

  private func handleIncomingText(_ text: String) throws {
    let data = Data(text.utf8)
    if let envelope = try? JSONDecoder().decode(CloudEnvelope.self, from: data) {
      apply(envelope)
      return
    }
    events.insert(text, at: 0)
  }

  private func apply(_ envelope: CloudEnvelope) {
    switch envelope.type {
    case "catalog.snapshot":
      let projects = parseProjects(envelope.body["projects"])
      let parsedRecentThreads = parseRecentThreadSummaries(
        envelope.body["recentThreads"],
        projects: projects
      )
      let recentThreads = parsedRecentThreads.isEmpty
        ? mobileRecentThreads(in: projects)
        : Array(mobileThreadsByRecentActivity(parsedRecentThreads).prefix(20))
      let nextWorkspace = MobileWorkspace(
        id: workspaceId,
        title: "Scratchpad",
        hostId: hostId,
        projects: projects,
        recentThreads: recentThreads
      )
      let catalogChanged = workspace != nextWorkspace
      if catalogChanged {
        workspace = nextWorkspace
      }
      if selectedProjectPath.isEmpty, let first = projects.first {
        selectedProjectPath = first.path
        selectedSessionId = first.activeSessionId
      } else if let selected = projects.first(where: { $0.path == selectedProjectPath }) {
        let resolvedSessionId = resolveMobileSessionAlias(selectedSessionId, in: selected)
        let sessionStillAvailable = selected.sessions.contains { $0.sessionId == resolvedSessionId }
        if sessionStillAvailable {
          selectedSessionId = resolvedSessionId
        } else {
          selectedSessionId = selected.activeSessionId
        }
      } else if let first = projects.first {
        selectedProjectPath = first.path
        selectedSessionId = first.activeSessionId
      }
      startupWorkspaceReady = true
      if catalogChanged {
        events.insert("Updated project catalog", at: 0)
      }
      let historyLimit = pendingCatalogHistoryLimit ?? 8
      pendingCatalogHistoryLimit = nil
      requestHistory(limit: historyLimit)
      requestStatus()
      requestModels()
    case "models.snapshot":
      applyModelsSnapshot(envelope)
    case "session.created":
      sessionCreatePending = false
      let sessionId = envelope.body["sessionId"]?.stringValue ?? ""
      if !sessionId.isEmpty {
        selectedSessionId = sessionId
      }
      historyItems = []
      historyStatus = "New Codex thread ready."
      events.insert("Started new thread ...\(sessionId.suffix(5))", at: 0)
      requestCatalog()
    case "history.page":
      let pageSessionId = envelope.body["sessionId"]?.stringValue ?? ""
      let requestedSessionId = envelope.body["requestedSessionId"]?.stringValue ?? ""
      let matchesSelection = selectedSessionId.isEmpty ||
        pageSessionId == selectedSessionId ||
        requestedSessionId == selectedSessionId
      guard matchesSelection else {
        events.insert("Ignored history from a previously selected thread", at: 0)
        return
      }
      if !pageSessionId.isEmpty {
        selectedSessionId = pageSessionId
      }
      historyItems = parseHistoryItems(envelope.body["items"])
      historyStatus = historyItems.isEmpty ? "No mirrored messages yet." : "Thread loaded"
    case "status.snapshot":
      applyStatusSnapshot(envelope)
    case "host.ready", "host.heartbeat":
      if envelope.sourceDeviceId == hostId {
        let firstHostSignal = !hostOnline
        hostOnline = true
        lastHostSeenAt = Date()
        if firstHostSignal || workspace.projects.isEmpty {
          requestCatalog()
        }
      }
    case "speech.transcribe.accepted":
      applyVoiceTranscriptionAccepted(envelope)
    case "speech.transcription":
      applyVoiceTranscription(envelope)
    case "message.accepted":
      let requestId = envelope.body["requestId"]?.stringValue ?? envelope.body["queueId"]?.stringValue ?? ""
      let acceptedSessionId = envelope.body["sessionId"]?.stringValue ?? ""
      let requestState = (envelope.body["requestState"]?.stringValue ?? "").lowercased()
      let queued = envelope.body["queued"]?.boolValue ?? (requestState == "queued")
      let direct = envelope.body["direct"]?.boolValue
        ?? envelope.body["interjected"]?.boolValue
        ?? (requestState == "direct")
      if !acceptedSessionId.isEmpty {
        selectedSessionId = acceptedSessionId
      }
      let suffix = requestId.isEmpty ? "" : " ...\(requestId.suffix(5))"
      if queued {
        historyStatus = "Queued for after the current response\(suffix)."
        events.insert("Queued message\(suffix)", at: 0)
      } else if direct {
        historyStatus = "Sent directly to the active turn\(suffix)."
        events.insert("Sent Direct message\(suffix)", at: 0)
      } else {
        historyStatus = "Direct message started\(suffix). Loading thread..."
        events.insert("Started Direct message\(suffix)", at: 0)
      }
      requestCatalog()
      requestHistory()
    case "pair.accepted":
      pairedHostId = hostId
      pairedAt = envelope.body["trustedAt"]?.stringValue ?? ISO8601DateFormatter().string(from: Date())
      let acceptedHostKey = envelope.body["hostPublicKeyPem"]?.stringValue ?? ""
      pairedHostPublicKeyPem = acceptedHostKey.isEmpty
        ? pendingPairingHostPublicKeyPem
        : acceptedHostKey
      pendingPairingHostPublicKeyPem = ""
      pairingStatus = "iPhone paired with \(hostId)"
      events.insert("iPhone paired", at: 0)
      requestCatalog()
    case "remote.assist.available",
         "remote.assist.offer",
         "remote.assist.ice",
         "remote.assist.stop",
         "remote.assist.error":
      guard verifyRemoteAssistHostEnvelope(envelope) else {
        events.insert("Ignored an unauthenticated Remote Assist response", at: 0)
        return
      }
      remoteAssistEnvelopeHandler?(envelope)
    case "error":
      sessionCreatePending = false
      let message = envelope.body["error"]?.stringValue ?? "Cloud error"
      let inReplyTo = envelope.body["inReplyTo"]?.stringValue ?? ""
      let code = envelope.body["code"]?.stringValue ?? ""
      if code == "host_unavailable" {
        hostOnline = false
        lastHostSeenAt = .distantPast
        historyStatus = "Your ClawDad Mac is offline. ClawDad will reconnect automatically."
        events.insert("Mac host unavailable", at: 0)
        return
      }
      if voiceTranscriptionPending,
         !pendingVoiceEnvelopeId.isEmpty,
         inReplyTo == pendingVoiceEnvelopeId {
        finishVoiceTranscription(error: message)
        return
      }
      historyStatus = message
      events.insert(message, at: 0)
    case "pong":
      if envelope.sourceDeviceId == "cloud-relay" {
        let firstRelayPong = lastRelayPongAt == .distantPast
        lastRelayPongAt = Date()
        if firstRelayPong {
          events.insert("Cloud relay online", at: 0)
        }
        if case .array(let hostValues) = envelope.body["availableHostIds"] {
          let hostAvailable = hostValues.contains(where: { $0.stringValue == hostId })
          let firstHostSignal = hostAvailable && !hostOnline
          hostOnline = hostAvailable
          if hostAvailable {
            lastHostSeenAt = Date()
            if firstHostSignal {
              requestCatalog()
            }
          } else {
            lastHostSeenAt = .distantPast
          }
        }
      } else if envelope.sourceDeviceId == hostId {
        let firstHostPong = !hostOnline
        hostOnline = true
        lastHostSeenAt = Date()
        if firstHostPong {
          events.insert("Mac host online", at: 0)
          requestCatalog()
        }
      }
    default:
      events.insert(envelope.type, at: 0)
    }
  }

  private func applyVoiceTranscription(_ envelope: CloudEnvelope) {
    let requestId = envelope.body["requestId"]?.stringValue ?? ""
    guard voiceTranscriptionPending,
          !requestId.isEmpty,
          requestId == pendingVoiceRequestId else {
      return
    }
    let text = (envelope.body["text"]?.stringValue ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else {
      finishVoiceTranscription(error: "ClawDad could not hear any speech in that recording.")
      return
    }
    voiceTranscriptionTimeoutTask?.cancel()
    voiceTranscriptionTimeoutTask = nil
    voiceTranscriptionPending = false
    voiceTranscriptionStatus = ""
    pendingVoiceRequestId = ""
    pendingVoiceEnvelopeId = ""
    voiceTranscriptionError = ""
    voiceTranscription = MobileVoiceTranscription(id: requestId, text: text)
    events.insert("Voice transcription ready", at: 0)
  }

  private func applyVoiceTranscriptionAccepted(_ envelope: CloudEnvelope) {
    let requestId = envelope.body["requestId"]?.stringValue ?? ""
    guard voiceTranscriptionPending,
          !requestId.isEmpty,
          requestId == pendingVoiceRequestId else {
      return
    }
    voiceTranscriptionStatus = "Transcribing on your Mac..."
    events.insert("Mac accepted voice transcription", at: 0)
  }

  private func finishVoiceTranscription(error: String) {
    voiceTranscriptionTimeoutTask?.cancel()
    voiceTranscriptionTimeoutTask = nil
    voiceTranscriptionPending = false
    voiceTranscriptionStatus = ""
    pendingVoiceRequestId = ""
    pendingVoiceEnvelopeId = ""
    voiceTranscriptionError = error
    events.insert("Voice transcription failed: \(error)", at: 0)
  }

  private func startVoiceTranscriptionTimeout(requestId: String, duration: TimeInterval) {
    voiceTranscriptionTimeoutTask?.cancel()
    let timeoutSeconds = min(600, max(60, duration * 3 + 30))
    voiceTranscriptionTimeoutTask = Task { [weak self] in
      try? await Task.sleep(
        nanoseconds: UInt64(timeoutSeconds * 1_000_000_000)
      )
      guard !Task.isCancelled,
            let self,
            self.voiceTranscriptionPending,
            self.pendingVoiceRequestId == requestId else {
        return
      }
      self.finishVoiceTranscription(
        error: "The transcript did not return. Confirm ClawDad is running on your Mac, then try again."
      )
    }
  }

  private func applyModelsSnapshot(_ envelope: CloudEnvelope) {
    let models = parseModels(envelope.body["models"])
    guard !models.isEmpty else {
      return
    }
    if modelOptions != models {
      modelOptions = models
    }
    let configuredModel = envelope.body["configuredModel"]?.stringValue ?? ""
    let configuredEffort = envelope.body["configuredReasoningEffort"]?.stringValue ?? ""
    if !models.contains(where: { $0.model == selectedModel }) {
      selectedModel = models.contains(where: { $0.model == configuredModel })
        ? configuredModel
        : models[0].model
    }
    guard let selected = models.first(where: { $0.model == selectedModel }) else {
      return
    }
    if !selected.supportedReasoningEfforts.contains(selectedReasoningEffort) {
      selectedReasoningEffort = selected.model == configuredModel && selected.supportedReasoningEfforts.contains(configuredEffort)
        ? configuredEffort
        : selected.defaultReasoningEffort
    }
  }

  private func applyStatusSnapshot(_ envelope: CloudEnvelope) {
    pendingApprovals = parsePendingApprovals(envelope.body["pendingApprovals"])
    guard let mailboxValue = envelope.body["mailboxStatus"],
          case .object(let mailboxStatus) = mailboxValue else {
      return
    }
    let lifecycle = mailboxStatus["state"]?.stringValue.lowercased() ?? "idle"
    let requestId = mailboxStatus["request_id"]?.stringValue ?? mailboxStatus["requestId"]?.stringValue ?? ""
    let terminalObservation = "\(requestId)::\(lifecycle)"
    if (lifecycle == "completed" || lifecycle == "failed"),
       !requestId.isEmpty,
       terminalObservation == lastObservedTerminalRequest {
      return
    }
    let nextStatus: String
    let phase = mailboxStatus["phase"]?.stringValue.lowercased() ?? ""
    if phase == "awaiting_approval", let approval = pendingApprovals.first {
      let nextStatus = "\(approval.title). Review it below so Codex can continue."
      if historyStatus != nextStatus {
        historyStatus = nextStatus
      }
      return
    }
    switch lifecycle {
    case "running", "dispatched", "starting":
      nextStatus = "Codex is working. ClawDad is monitoring the turn."
    case "queued":
      nextStatus = "Message queued for after the current response."
    case "completed":
      nextStatus = "Response complete."
      refreshTerminalRequestOnce(requestId: requestId, lifecycle: lifecycle)
    case "failed":
      nextStatus = "The last turn failed. This thread is ready for another message."
      refreshTerminalRequestOnce(requestId: requestId, lifecycle: lifecycle)
    default:
      return
    }
    if historyStatus != nextStatus {
      historyStatus = nextStatus
    }
  }

  private func parsePendingApprovals(_ value: JSONValue?) -> [MobileApprovalRequest] {
    guard case .array(let entries) = value else {
      return []
    }
    return entries.compactMap { entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let approvalId = object["approvalId"]?.stringValue ?? ""
      guard !approvalId.isEmpty else {
        return nil
      }
      let questions: [MobileApprovalQuestion]
      if case .array(let questionValues) = object["questions"] {
        questions = questionValues.compactMap { questionValue in
          guard case .object(let questionObject) = questionValue else {
            return nil
          }
          let questionId = questionObject["id"]?.stringValue ?? ""
          let options: [MobileApprovalOption]
          if case .array(let optionValues) = questionObject["options"] {
            options = optionValues.compactMap { optionValue in
              guard case .object(let optionObject) = optionValue else {
                return nil
              }
              let label = optionObject["label"]?.stringValue ?? ""
              guard !label.isEmpty else {
                return nil
              }
              return MobileApprovalOption(
                label: label,
                description: optionObject["description"]?.stringValue ?? ""
              )
            }
          } else {
            options = []
          }
          return MobileApprovalQuestion(
            id: questionId,
            header: questionObject["header"]?.stringValue ?? "",
            question: questionObject["question"]?.stringValue ?? "",
            options: options
          )
        }
      } else {
        questions = []
      }
      return MobileApprovalRequest(
        approvalId: approvalId,
        title: object["title"]?.stringValue ?? "Codex needs approval",
        prompt: object["prompt"]?.stringValue ?? "",
        method: object["method"]?.stringValue ?? "",
        createdAt: object["createdAt"]?.stringValue ?? "",
        questions: questions
      )
    }
  }

  private func refreshTerminalRequestOnce(requestId: String, lifecycle: String) {
    let key = "\(requestId)::\(lifecycle)"
    guard !requestId.isEmpty, key != lastObservedTerminalRequest else {
      return
    }
    lastObservedTerminalRequest = key
    requestCatalog()
    requestHistory(limit: 50)
  }

  private func parseProjects(_ value: JSONValue?) -> [ProjectSummary] {
    guard case .array(let entries) = value else {
      return []
    }
    return entries.compactMap { entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let path = object["path"]?.stringValue ?? ""
      guard !path.isEmpty else {
        return nil
      }
      let name = object["displayName"]?.stringValue ?? object["name"]?.stringValue ?? URL(fileURLWithPath: path).lastPathComponent
      let activeSessionId = object["activeSessionId"]?.stringValue ?? ""
      let sessions = parseThreadSummaries(
        object["sessions"],
        projectName: name,
        projectPath: path,
        activeSessionId: activeSessionId
      )
      return ProjectSummary(
        name: name,
        path: path,
        activeSessionId: activeSessionId,
        sessions: sessions,
        sessionAliases: parseStringMap(object["sessionAliases"])
      )
    }
  }

  private func parseRecentThreadSummaries(
    _ value: JSONValue?,
    projects: [ProjectSummary]
  ) -> [MobileThreadSummary] {
    guard case .array(let entries) = value else {
      return []
    }
    let projectsByPath = Dictionary(uniqueKeysWithValues: projects.map { ($0.path, $0) })

    return entries.compactMap { entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let projectPath = object["projectPath"]?.stringValue ?? ""
      let sessionId = object["sessionId"]?.stringValue ?? ""
      guard !projectPath.isEmpty, !sessionId.isEmpty else {
        return nil
      }
      let project = projectsByPath[projectPath]
      let projectName = object["projectName"]?.stringValue
        ?? project?.name
        ?? URL(fileURLWithPath: projectPath).lastPathComponent

      return MobileThreadSummary(
        projectName: projectName,
        projectPath: projectPath,
        title: object["title"]?.stringValue
          ?? object["slug"]?.stringValue
          ?? "\(projectName) Chat",
        provider: object["provider"]?.stringValue ?? "codex",
        sessionId: sessionId,
        active: object["active"]?.boolValue
          ?? (project?.activeSessionId == sessionId),
        status: object["status"]?.stringValue ?? "",
        lastDispatch: object["lastDispatch"]?.stringValue ?? "",
        lastResponse: object["lastResponse"]?.stringValue ?? "",
        lastActivityAt: object["lastActivityAt"]?.stringValue ?? ""
      )
    }
  }

  private func parseStringMap(_ value: JSONValue?) -> [String: String] {
    guard case .object(let object) = value else {
      return [:]
    }
    return object.reduce(into: [:]) { result, entry in
      let key = entry.key.trimmingCharacters(in: .whitespacesAndNewlines)
      let mapped = entry.value.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
      if !key.isEmpty && !mapped.isEmpty && key != mapped {
        result[key] = mapped
      }
    }
  }

  private func parseModels(_ value: JSONValue?) -> [CodexModelSummary] {
    guard case .array(let entries) = value else {
      return []
    }
    return entries.compactMap { entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let model = object["model"]?.stringValue ?? object["id"]?.stringValue ?? ""
      guard !model.isEmpty else {
        return nil
      }
      let efforts: [String]
      if case .array(let values) = object["supportedReasoningEfforts"] {
        efforts = values.compactMap { value in
          if case .string(let effort) = value {
            return effort
          }
          return nil
        }
      } else {
        efforts = []
      }
      return CodexModelSummary(
        model: model,
        displayName: object["displayName"]?.stringValue ?? model,
        description: object["description"]?.stringValue ?? "",
        isDefault: object["isDefault"]?.boolValue ?? false,
        defaultReasoningEffort: object["defaultReasoningEffort"]?.stringValue ?? efforts.first ?? "",
        supportedReasoningEfforts: efforts
      )
    }
  }

  private func parseThreadSummaries(
    _ value: JSONValue?,
    projectName: String,
    projectPath: String,
    activeSessionId: String
  ) -> [MobileThreadSummary] {
    guard case .array(let entries) = value else {
      if activeSessionId.isEmpty {
        return []
      }
      return [
        MobileThreadSummary(
          projectName: projectName,
          projectPath: projectPath,
          title: "\(projectName) Chat",
          provider: "codex",
          sessionId: activeSessionId,
          active: true,
          status: "",
          lastDispatch: "",
          lastResponse: "",
          lastActivityAt: ""
        )
      ]
    }

    return entries.compactMap { entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let sessionId = object["sessionId"]?.stringValue ?? ""
      guard !sessionId.isEmpty else {
        return nil
      }
      return MobileThreadSummary(
        projectName: projectName,
        projectPath: projectPath,
        title: object["slug"]?.stringValue ?? "\(projectName) Chat",
        provider: object["provider"]?.stringValue ?? "codex",
        sessionId: sessionId,
        active: sessionId == activeSessionId,
        status: object["status"]?.stringValue ?? "",
        lastDispatch: object["lastDispatch"]?.stringValue ?? "",
        lastResponse: object["lastResponse"]?.stringValue ?? "",
        lastActivityAt: object["lastActivityAt"]?.stringValue ?? ""
      )
    }
  }

  private func parseHistoryItems(_ value: JSONValue?) -> [MobileHistoryItem] {
    guard case .array(let entries) = value else {
      return []
    }
    return entries.enumerated().compactMap { index, entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let message = object["message"]?.stringValue ?? ""
      let response = object["response"]?.stringValue ?? ""
      let requestId = object["requestId"]?.stringValue ?? ""
      let sentAt = object["sentAt"]?.stringValue ?? ""
      let answeredAt = object["answeredAt"]?.stringValue ?? ""
      guard !message.isEmpty || !response.isEmpty else {
        return nil
      }
      return MobileHistoryItem(
        id: requestId.isEmpty ? "\(sentAt)-\(index)" : requestId,
        requestId: requestId,
        message: message,
        response: response,
        status: object["status"]?.stringValue ?? "",
        sentAt: sentAt,
        answeredAt: answeredAt,
        scheduleMode: object["scheduleMode"]?.stringValue ?? "",
        deliveryMechanism: object["deliveryMechanism"]?.stringValue ?? ""
      )
    }
  }

  private func sendEnvelope(
    type: String,
    body: [String: JSONValue],
    envelopeId: String = ""
  ) async throws {
    guard let socket = task else {
      throw URLError(.notConnectedToInternet)
    }
    seq += 1
    var envelope = CloudEnvelope(
      type: type,
      accountId: accountId,
      workspaceId: workspaceId,
      sourceDeviceId: try DeviceIdentity.shared.deviceId(),
      targetHostId: hostId,
      seq: seq,
      body: body
    )
    if !envelopeId.isEmpty {
      envelope.id = envelopeId
    }
    envelope.signature = try DeviceIdentity.shared.sign(canonicalEnvelopeData(envelope))
    let data = try JSONEncoder.clawDadSorted.encode(envelope)
    guard let text = String(data: data, encoding: .utf8) else {
      throw URLError(.cannotParseResponse)
    }
    try await socket.send(.string(text))
  }

  private func canonicalEnvelopeData(_ envelope: CloudEnvelope) throws -> Data {
    var unsigned = envelope
    unsigned.signature = nil
    return try JSONEncoder.clawDadSorted.encode(unsigned)
  }

  private func verifyRemoteAssistHostEnvelope(_ envelope: CloudEnvelope) -> Bool {
    guard envelope.sourceDeviceId == hostId,
          envelope.accountId == accountId,
          envelope.workspaceId == workspaceId,
          envelope.targetHostId == (try? DeviceIdentity.shared.deviceId()),
          let expiresAt = parseCloudDate(envelope.expiresAt),
          expiresAt.addingTimeInterval(5) >= Date(),
          let signature = envelope.signature,
          signature.alg == "ES256",
          !pairedHostPublicKeyPem.isEmpty,
          let signatureData = Data(base64URLEncoded: signature.value)
    else {
      return false
    }

    do {
      let publicKey = try P256.Signing.PublicKey(
        pemRepresentation: pairedHostPublicKeyPem
      )
      let ecdsaSignature = try P256.Signing.ECDSASignature(
        derRepresentation: signatureData
      )
      return publicKey.isValidSignature(
        ecdsaSignature,
        for: try canonicalEnvelopeData(envelope)
      )
    } catch {
      return false
    }
  }

  private func parseCloudDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) {
      return date
    }

    let internet = ISO8601DateFormatter()
    internet.formatOptions = [.withInternetDateTime]
    return internet.date(from: value)
  }

  private func describe(_ error: Error) -> String {
    if let pairingError = error as? PairingError {
      return pairingError.errorDescription ?? "Pairing failed."
    }
    if let urlError = error as? URLError {
      switch urlError.code {
      case .cannotFindHost, .dnsLookupFailed:
        return "ClawDad cloud could not be found. Check the cloud URL and connection."
      case .notConnectedToInternet, .networkConnectionLost:
        return "The network dropped before ClawDad could finish."
      case .badURL, .unsupportedURL:
        return "The ClawDad cloud URL is invalid."
      default:
        break
      }
    }
    let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
    return message.isEmpty ? "ClawDad could not finish that operation." : message
  }
}

enum RemoteAssistCloudError: LocalizedError {
  case authenticationRequired

  var errorDescription: String? {
    switch self {
    case .authenticationRequired:
      return "Re-pair this iPhone from ClawDad Settings on your Mac to enable Remote Assist."
    }
  }
}

enum PairingError: LocalizedError {
  case invalidCode
  case wrongCode
  case expiredCode

  var errorDescription: String? {
    switch self {
    case .invalidCode:
      return "That QR code is not a valid ClawDad pairing code."
    case .wrongCode:
      return "That QR code is for something else. Open ClawDad Settings on your Mac and scan the Pair iPhone code."
    case .expiredCode:
      return "That pairing QR expired. Generate a fresh code in ClawDad Settings on your Mac."
    }
  }
}

extension JSONEncoder {
  static var clawDadSorted: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return encoder
  }
}

extension Data {
  init?(base64URLEncoded value: String) {
    var normalized = value
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let remainder = normalized.count % 4
    if remainder != 0 {
      normalized.append(String(repeating: "=", count: 4 - remainder))
    }
    self.init(base64Encoded: normalized)
  }
}
