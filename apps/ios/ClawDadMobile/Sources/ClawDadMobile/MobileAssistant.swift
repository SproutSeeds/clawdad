import ClawDadRemoteAssistProtocol
import Foundation
import SwiftUI

private struct AssistantCommandReceipt: Decodable {
  let job: AssistantTaskRecord?
}

@MainActor
final class MobileAssistantController: ObservableObject {
  let chatDraft: AssistantChatDraftStore
  @Published private(set) var snapshot: AssistantSnapshot?
  @Published var researchRequested = false
  @Published private(set) var connected = false
  @Published private(set) var voiceActive = false
  @Published private(set) var muted = false
  @Published private(set) var status = "Connect to your Mac to start Assistant."
  @Published private(set) var error = ""
  @Published private(set) var sending = false
  @Published private(set) var startingVoice = false
  @Published private(set) var callVisible = false
  @Published private(set) var inputLevel: Float = 0
  @Published private(set) var replyAudioActive = false
  @Published private(set) var playingMessageID: String?
  @Published private(set) var messagePlaybackPreparing = false
  @Published private(set) var messagePlaybackPaused = false
  @Published private(set) var notificationNotice = ""
  @Published private(set) var notificationScrollTarget: String?
  @Published private(set) var notificationScrollRevision = 0
  @Published private(set) var notificationTarget: AssistantReplyNotification?
  private let replyNavigation: AssistantReplyNavigation
  private var notificationOpen: Task<Void, Never>?
  private var notificationMessages: [AssistantMessage] = []
  private var notificationConversationId: String?
  private var conversationVisible = false
  @Published private(set) var liveTranscript = ""
  @Published private(set) var hearingSpeech = false
  @Published private(set) var transcribingSpeech = false
  @Published private(set) var canSendVoice = false
  @Published private(set) var waitForSend: Bool
  @Published private(set) var microphoneNotice = ""
  @Published private(set) var changingMicrophone = false
  @Published private(set) var changingDestination = false
  @Published private(set) var transcriptionReview: AssistantTranscriptionReview = .listening
  @Published private(set) var transcriptionEditText = ""
  @Published private(set) var transcriptionClearPresented = false
  @Published private(set) var transcriptionCapturePaused = false
  private var clearTranscriptionTurn: AssistantVoiceTurn?
  private var reviewBeforeClear = AssistantTranscriptionReview.held
  private var transcriptionEdited = false
  private var acceptingReviewFlush = false
  private var voiceWorker = UUID()
  private var transcribingTurn: AssistantVoiceTurn?
  var canReviewTranscription: Bool { voiceActive && draftTurn != nil && !replyAudioActive && clearTranscriptionTurn == nil }
  var muteStatus: String { "Muted · microphone off" }
  var callStatus: String {
    if transcriptionReview != .listening { return transcriptionReview == .editing ? "Editing transcription · Held" : "Transcription held" }
    if transcriptionCapturePaused { return "Microphone paused" }
    return muted ? muteStatus : status
  }
  var automaticTurnInterval: TimeInterval { Double(automaticSendDelay) / 1_000_000_000 }
  var destinationTransport: String { snapshot?.destination?["transport"]?.string ?? "terminal" }
  var destinationName: String { destinationTransport == "app_server" ? "ClawDad threads" : "Terminal" }
  func toggleDestination() async {
    guard !changingDestination, connected, let destination = snapshot?.destination,
      let conversation = destination["conversationId"], let revision = destination["revision"] else { return }
    changingDestination = true
    defer { changingDestination = false }
    do {
      _ = try await command("destination", args: ["transport": .string(destinationTransport == "terminal" ? "app_server" : "terminal"),
        "conversationId": conversation, "expectedRevision": revision])
    } catch { self.error = "Could not change the work destination. Reconnect and try again." }
  }
  var chatSendFinishesVoice: Bool { chatDraft.value.isEmpty && canSendVoice }
  var canSendChatInput: Bool {
    !sending && !chatDraft.importing && (chatDraft.value.isEmpty ? canSendVoice : connected)
  }
  var chatCapacityProblem: String? {
    AssistantChatLimits.problem(chatDraft.value.text, maximum: chatTextLimit)
  }
  private var chatTextLimit: Int {
    guard let snapshot else { return AssistantChatLimits.textBytes }
    guard let capacity = snapshot.chatCapacity, capacity.unit == "utf8_bytes", capacity.textBytes > 0 else { return AssistantChatLimits.legacyTextBytes }
    return min(capacity.textBytes, AssistantChatLimits.textBytes)
  }
  private var microphoneChange = UUID()
  private var inputEpoch = UUID()
  private var foreground = true
  private let confirmMicrophoneChange: @MainActor () -> Void
  private let defaults: UserDefaults?
  private let automaticSendDelay: UInt64
  private var automaticSend: Task<Void, Never>?
  private var assistantReady = false
  private let connection: any AssistantTransport
  private let audio: any AssistantAudioIO
  private weak var session: CloudSession?
  private var scope = ""
  var settingsScope: String { scope }
  private var speechControlSync: Task<Void, Never>?
  private var speechControlLastSync = Date.distantPast
  private var speechControlAck: [String: AssistantValue]?
  private var monitor: Task<Void, Never>?
  private var speech: Task<Void, Never>?
  private var playbackEpoch = UUID()
  private var playback: AssistantSpeechPlayback?
  private var transcribing: Task<Void, Never>?
  private var transcriptionPreview: Task<Void, Never>?
  private var previewEpoch = UUID()
  private var voiceEpoch = UUID()
  private var spoken = Set<String>()
  private var silencedReplies = Set<String>()
  private var pendingMessage: (text: String, id: String)?
  private var voiceQueue: [(data: Data, turn: AssistantVoiceTurn, capturedAt: TimeInterval, speechAt: TimeInterval, final: Bool)] = []
  private var voiceTurns: [AssistantVoiceTurn] = []
  private var draftTurn: AssistantVoiceTurn?
  private var deliveredVoiceTurns: [String: AssistantVoiceTurn] = [:]
  private var speechQueue: [AssistantMessage] = []
  private var activeReplyRequest: String?
  private var connectionError = ""
  #if DEBUG
    private var preview: AssistantPreview?
    private var previewPausedMessages = Set<String>()
  #endif

  init(connection: any AssistantTransport = AssistantConnection(),
    audio: any AssistantAudioIO = AssistantAudio(), defaults: UserDefaults? = .standard,
    automaticSendDelay: UInt64 = 2_000_000_000, chatDraft: AssistantChatDraftStore = AssistantChatDraftStore(),
    replyNavigation: AssistantReplyNavigation? = nil,
    confirmMicrophoneChange: @escaping @MainActor () -> Void = assistantMicrophoneConfirmation) {
    self.chatDraft = chatDraft
    self.connection = connection
    self.audio = audio
    self.defaults = defaults
    self.replyNavigation = replyNavigation ?? (defaults == nil ? AssistantReplyNavigation(defaults: nil) : .shared)
    self.automaticSendDelay = automaticSendDelay
    waitForSend = defaults?.bool(forKey: "assistant.thinkAloud") ?? false
    self.confirmMicrophoneChange = confirmMicrophoneChange
    connected = connection.connected
    connection.onChange = { [weak self] in
      guard let self else { return }
      connected = self.connection.connected
      if !connected {
        assistantReady = false
        status = "Reconnecting to your Mac…"
        if let failure = self.connection.lastFailure {
          connectionError = failure
          error = failure
        }
      } else if error == connectionError {
        error = ""
        connectionError = ""
      }
      if connected, foreground, notificationTarget != nil, notificationOpen == nil { retryReplyNotification() }
    }
    audio.onSpeechStarted = { [weak self] in
      guard let self, voiceActive, !muted, !replyAudioActive, !transcriptionCapturePaused else { return }
      let turn = currentVoiceTurn()
      turn.ending.speechStarted(at: ProcessInfo.processInfo.systemUptime)
      scheduleVoiceSend(turn)
      draftTurn?.endpointAt = nil
      hearingSpeech = true
      canSendVoice = true
      status = "Hearing you…"
    }
    audio.onInputLevel = { [weak self] level in
      guard let self, abs(inputLevel - level) >= 0.03 else { return }
      inputLevel = muted || replyAudioActive || transcriptionCapturePaused ? 0 : level
    }
    audio.onCaptureRecovery = { [weak self] recovering in
      guard let self, voiceActive, !replyAudioActive, !transcriptionCapturePaused else { return }
      if recovering { status = "Reconnecting microphone…" }
      else if status == "Reconnecting microphone…" { status = muted ? muteStatus : "Listening…" }
    }
    audio.onCaptureFailure = { [weak self] failure in
      guard let self, voiceActive else { return }
      if transcriptionReview != .listening {
        muted = true
        try? audio.muteCapture(finishingUtterance: false)
        microphoneNotice = failure.localizedDescription
        return
      }
      // A hardware interruption pauses capture, not the connected conversation.
      // Preserve already displayed, unsent words for explicit review. Never
      // resend a turn whose delivery may already have been accepted.
      preserveVoiceForReview()
      muteMicrophone(confirm: false, preservingTurn: false)
      microphoneNotice = failure.localizedDescription
    }
    audio.onUtterance = { [weak self] in self?.transcribe($0, final: $1) }
    audio.onTranscriptPreview = { [weak self] in self?.previewTranscription($0) }
    audio.onReplaced = { [weak self] in
      guard let self else { return }
      if voiceActive || startingVoice { endVoice() } else { stopMessagePlayback() }
    }
    audio.onPlaybackStarted = { [weak self] in
      guard let self, let id = activeReplyRequest, let turn = deliveredVoiceTurns[id],
        turn.metrics["submitToPlaybackMs"] == nil, let submitted = turn.submittedAt else { return }
      let now = ProcessInfo.processInfo.systemUptime
      turn.metrics["submitToPlaybackMs"] = max(0, (now - submitted) * 1000)
      if let response = turn.responseObservedAt { turn.metrics["responseToPlaybackMs"] = max(0, (now - response) * 1000) }
      if let preparing = turn.playbackPreparationAt { turn.metrics["playbackPreparationMs"] = max(0, (now - preparing) * 1000) }
      recordVoiceTiming(turn)
    }
  }
  func bind(_ session: CloudSession) {
    let next = "\(session.accountId)/\(session.workspaceId)/\(session.hostId)"
    if scope != next {
      stop()
      snapshot = nil
      notificationOpen?.cancel(); notificationOpen = nil
      notificationMessages = []; notificationConversationId = nil; notificationScrollTarget = nil
      pendingMessage = nil
      spoken = []
      silencedReplies = []
      speechControlSync?.cancel(); speechControlSync = nil; speechControlAck = nil
      scope = next
      chatDraft.bind(next)
    }
    self.session = session
    connection.bind(session)
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-test") {
        if preview == nil {
          if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-reset-draft") { chatDraft.clear() }
          if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-recovery-test") {
            chatDraft.recoverVoice("A recovered voice message.", id: "dd9a74ab-a11b-4831-9c76-52c5e1a050af")
          }
          preview = AssistantPreview()
          snapshot = try? preview?.snapshot()
          #if canImport(UIKit)
          if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-large-paste") {
            UIPasteboard.general.string = AssistantPreview.capacityFixtureText
          }
          #endif
        }
        connected = true
        if !voiceActive { status = "Your Mac is connected" }
      }
    #endif
  }
  func open() {
    #if DEBUG
      if preview != nil { return }
    #endif
    guard monitor == nil else { return }
    monitor = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        if session?.activeComputer?.capabilities.contains("assistant.local") != true {
          error = "Update ClawDad on the Mac to use Assistant."
        } else if !connection.connected {
          connection.connect()
        } else {
          do {
            try await refresh()
            if !voiceActive, !startingVoice, !callVisible {
              status =
                snapshot?.nativeOnline == true
                ? "Your Mac is connected" : "Waiting for the Mac app…"
            }
          } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
        try? await Task.sleep(nanoseconds: voiceActive ? 700_000_000 : 2_000_000_000)
      }
    }
  }
  func refresh() async throws {
    #if DEBUG
      if let preview {
        var next = try preview.snapshot()
        retainNotificationMessages(in: &next)
        snapshot = next
        return
      }
    #endif
    syncSpeechOutput()
    let requestedScope = scope
    let previousRevision = snapshot?.historyRevision
    let known = previousRevision.map { ["historyRevision": $0] } ?? [:]
    let data = try await connection.request(.state, payload: JSONEncoder().encode(known))
    guard requestedScope == scope else { throw CancellationError() }
    var next = try JSONDecoder().decode(AssistantSnapshot.self, from: data)
    // A concurrent Send may have installed newer history while this health
    // request was in flight. An old unchanged acknowledgment cannot replace it.
    if next.historyUnchanged == true, snapshot?.historyRevision != previousRevision { return }
    try next.retainUnchangedHistory(from: snapshot)
    retainNotificationMessages(in: &next)
    snapshot = next
    if conversationVisible { replyNavigation.visibleConversationId = next.conversationId }
    chatDraft.reconcile(next.messageReceipts ?? [])
    assistantReady = next.supportsBackgroundCalls && next.enabled && next.nativeOnline && next.catalog != nil
    if voiceActive {
      for message in next.messages + (next.taskUpdates ?? []) where message.role == "assistant" && !spoken.contains(message.id) {
        spoken.insert(message.id)
        let parts = message.id.split(separator: ":", maxSplits: 2)
        if parts.count == 3, let turn = deliveredVoiceTurns[String(parts[1])],
          turn.responseObservedAt == nil, let submitted = turn.submittedAt {
          let now = ProcessInfo.processInfo.systemUptime
          turn.responseObservedAt = now
          turn.metrics["submitToResponseObservedMs"] = max(0, (now - submitted) * 1000)
          recordVoiceTiming(turn)
        }
        if !silencedReplies.contains(where: { message.id.hasPrefix("assistant:\($0):") }) {
          speechQueue.append(message)
        }
      }
      speakNext()
    }
  }
  private func syncSpeechOutput() {
    guard speechControlSync == nil, Date().timeIntervalSince(speechControlLastSync) >= 1 else { return }
    speechControlLastSync = Date()
    let requestedScope = scope
    speechControlSync = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { if scope == requestedScope { speechControlSync = nil } }
      do {
        var body: [String: AssistantValue] = ["action": .string("speech.sync"),
          "requestId": .string(UUID().uuidString.lowercased()), "state": .object(SpeechOutputPreference.shared.wireState)]
        if let speechControlAck { body["ack"] = .object(speechControlAck) }
        let data = try await connection.request(.command, payload: JSONEncoder().encode(body))
        guard scope == requestedScope, !Task.isCancelled else { return }
        speechControlAck = nil
        let response = try JSONDecoder().decode([String: AssistantValue].self, from: data)
        if let pending = response["speechOutput"]?.object?["pending"]?.object,
          let expiresAt = pending["expiresAt"]?.number, expiresAt > Date().timeIntervalSince1970 * 1000 {
          speechControlAck = SpeechOutputPreference.shared.applyRemote(pending)
          body["state"] = .object(SpeechOutputPreference.shared.wireState)
          body["ack"] = speechControlAck.map(AssistantValue.object)
          body["requestId"] = .string(UUID().uuidString.lowercased())
          _ = try await connection.request(.command, payload: JSONEncoder().encode(body))
          if scope == requestedScope { speechControlAck = nil }
        }
      } catch { /* Old/offline hosts cannot acknowledge control. Local Settings still work. */ }
    }
  }
  @discardableResult func command(
    _ action: String, args: [String: AssistantValue] = [:],
    id: String = UUID().uuidString.lowercased()
  ) async throws -> AssistantTaskRecord? {
    #if DEBUG
      if let preview {
        snapshot = try preview.command(action, args: args, id: id)
        return snapshot?.tasks.first { $0.id == id }
      }
    #endif
    var body = args
    body["action"] = .string(action)
    body["requestId"] = .string(id)
    let requestedScope = scope
    let data = try await connection.request(.command, payload: JSONEncoder().encode(body))
    guard requestedScope == scope else { throw CancellationError() }
    var next = try JSONDecoder().decode(AssistantSnapshot.self, from: data)
    retainNotificationMessages(in: &next)
    snapshot = next
    return try JSONDecoder().decode(AssistantCommandReceipt.self, from: data).job
  }
  func researchRequest(_ action: String, args: [String: AssistantValue] = [:],
    id: String = UUID().uuidString.lowercased()) async throws -> [String: AssistantValue] {
    #if DEBUG
    if let preview { return try preview.research(action, args: args, id: id) }
    #endif
    var body = args; body["action"] = .string(action); body["requestId"] = .string(id)
    let requestedScope = scope
    let data = try await connection.request(.command, payload: JSONEncoder().encode(body))
    guard scope == requestedScope else { throw CancellationError() }
    return try JSONDecoder().decode([String: AssistantValue].self, from: data)
  }
  func settingsRequest(_ action: String, args: [String: AssistantValue] = [:],
    id: String = UUID().uuidString.lowercased()) async throws -> [String: AssistantValue] {
    #if DEBUG
    if let preview { return try preview.research(action, args: args, id: id) }
    #endif
    let requestedScope = scope, deadline = Date().addingTimeInterval(20)
    while !connection.connected {
      try Task.checkCancellation()
      guard requestedScope == scope else { throw CancellationError() }
      guard Date() < deadline else { throw AssistantProtocolError.timedOut }
      connection.connect()
      try await Task.sleep(for: .milliseconds(150))
    }
    guard requestedScope == scope else { throw CancellationError() }
    // Settings opens only the data connection: no start, microphone, message or
    // supervisor command is needed to read/change subsequent request settings.
    return try await researchRequest(action, args: args, id: id)
  }
  func watch(tabId: String, onWatch: @escaping () -> Void) {
    Task {
      do {
        let id = UUID().uuidString.lowercased()
        try await command("terminal.focus", args: ["tabId": .string(tabId)], id: id)
        for _ in 0..<20 {
          if let task = ((snapshot?.operations ?? []) + (snapshot?.tasks ?? [])).first(where: { $0.id == id }) {
            if task.status == "completed" {
              onWatch()
              return
            }
            if task.status == "attention" {
              throw NSError(
                domain: "Assistant", code: 1,
                userInfo: [
                  NSLocalizedDescriptionKey: task.error ?? "The tab could not be selected."
                ])
            }
          }
          try await Task.sleep(nanoseconds: 500_000_000)
          try await refresh()
        }
        throw AssistantProtocolError.timedOut
      } catch { self.error = error.localizedDescription }
    }
  }
  func startCall(_ session: CloudSession) {
    bind(session)
    open()
    Task { await startVoice() }
  }
  private func ensureAssistant() async throws {
    if assistantReady, connected { return }
    // Check the current host before issuing start: an older Mac would open Terminal.
    try await refresh()
    guard snapshot?.supportsBackgroundCalls == true else {
      throw NSError(domain: "Assistant", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Update ClawDad on your Mac to use the new Assistant call."
      ])
    }
    if snapshot?.enabled != true { try await command("start") }
    assistantReady = snapshot?.enabled == true && snapshot?.nativeOnline == true && snapshot?.catalog != nil
  }
  private func awaitAssistant(until deadline: Date, voiceAttempt: UUID? = nil) async throws {
    let requestedScope = scope
    while true {
      try Task.checkCancellation()
      guard scope == requestedScope, voiceAttempt == nil || voiceEpoch == voiceAttempt else {
        throw CancellationError()
      }
      guard Date() < deadline else { throw AssistantProtocolError.timedOut }
      if !connected {
        connection.connect()
      } else {
        do {
          // A call checks liveness even when an earlier message marked the link ready.
          if voiceAttempt != nil { try await refresh() }
          try await ensureAssistant()
          if assistantReady { return }
        } catch {
          if connected { throw error }
          // Transport failures invalidate the old peer. Keep this same operation
          // pending while its replacement connects; microphone capture stays off.
        }
      }
      try await Task.sleep(nanoseconds: 150_000_000)
    }
  }
  func perform(_ action: String, args: [String: AssistantValue] = [:]) {
    Task {
      do { try await command(action, args: args) } catch { self.error = error.localizedDescription }
    }
  }
  func openChat(_ session: CloudSession) { bind(session); open() }
  func retryConnection() {
    error = ""
    connectionError = ""
    connection.close()
    assistantReady = false
    open()
    connection.connect()
  }
  func sendDraft() async {
    guard !sending, !chatDraft.importing else { return }
    if chatDraft.value.isEmpty {
      if canSendVoice { sendVoiceNow() }
      return
    }
    let draft = chatDraft.value, target = scope
    do {
      let images = try draft.images.map { PreparedRemoteImage(upload: $0, data: try chatDraft.bytes($0, scope: target)) }
      if await send(draft.text, id: draft.id, images: images) {
        if target == scope { chatDraft.reconcile(snapshot?.messageReceipts ?? []) }
      }
    } catch { self.error = error.localizedDescription }
  }
  func recoverUnprocessedMessage(_ id: String) async {
    let target = scope
    do {
      let args: [String: AssistantValue] = ["action": .string("receipt"),
        "requestId": .string(UUID().uuidString.lowercased()), "messageRequestId": .string(id)]
      let data = try await connection.request(.command, payload: JSONEncoder().encode(args))
      struct Result: Decodable { let messageReceipt: AssistantMessageReceipt? }
      let receipt = try JSONDecoder().decode(Result.self, from: data).messageReceipt
      guard target == scope else { return }
      if let receipt {
        chatDraft.reconcile([receipt])
        if ["queued", "running", "completed"].contains(receipt.status) {
          status = receipt.status == "completed" ? "The original message already finished" : "The Mac already accepted this message"
          try await refresh(); return
        }
      }
      chatDraft.recoverAccepted(id)
    } catch {
      self.error = "Reconnect to the original Mac to check this message before recovering it. Its complete saved draft and request ID are kept."
    }
  }
  @discardableResult func send(_ text: String, id: String? = nil, images: [PreparedRemoteImage] = [], voiceInputEpoch: UUID? = nil) async -> Bool {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !images.isEmpty else { return true }
    if let problem = AssistantChatLimits.problem(text) { error = problem; return false }
    let target = scope
    while sending { do { try await Task.sleep(nanoseconds: 100_000_000) } catch { return false } }
    guard !Task.isCancelled else { return false }
    sending = true
    defer { sending = false }
    let pending: (text: String, id: String) =
      id.map { (text, $0) }
      ?? (pendingMessage?.text == text ? pendingMessage! : (text, UUID().uuidString.lowercased()))
    pendingMessage = pending
    let durableDraft = AssistantChatDraft(id: pending.id, text: text, images: images.map(\.upload))
    do { try chatDraft.stageAttempt(durableDraft, scope: target) }
    catch { self.error = "Save this message on the iPhone before sending: \(error.localizedDescription)"; return false }
    let deadline = Date().addingTimeInterval(60)
    for attempt in 0..<2 {
      do {
        guard target == scope, voiceInputEpoch == nil || voiceInputEpoch == inputEpoch else { throw CancellationError() }
        try await awaitAssistant(until: deadline)
        if let problem = AssistantChatLimits.problem(text, maximum: chatTextLimit) {
          self.error = problem; return false
        }
        try Task.checkCancellation()
        guard target == scope, voiceInputEpoch == nil || voiceInputEpoch == inputEpoch else { throw CancellationError() }
        if !images.isEmpty {
          guard snapshot?.imageAttachments == true else {
            throw RemoteImagePreparation.failure("Update ClawDad on your Mac to send chat images. Your draft is saved.")
          }
          if !replyAudioActive { status = "Sending images…" }
          for image in images {
            try await AssistantImageUpload.send(image.upload, data: image.data) { body in
              guard self.scope == target else { throw CancellationError() }
              #if DEBUG
                if let preview = self.preview { return try preview.upload(body) }
              #endif
              return try await self.connection.request(.imageUpload, payload: JSONEncoder().encode(body))
            }
          }
        }
        try Task.checkCancellation()
        guard target == scope, voiceInputEpoch == nil || voiceInputEpoch == inputEpoch else { throw CancellationError() }
        var args: [String: AssistantValue] = ["text": .string(text)]
        if !images.isEmpty { args["images"] = try .encode(images.map(\.upload)) }
        let receipt = try await command("message", args: args, id: pending.id)
        if receipt?.status == "attention" || receipt?.status == "interrupted" {
          chatDraft.reconcile(snapshot?.messageReceipts ?? [])
          self.error = receipt?.error ?? "This saved message needs review before it can be retried. Your draft is kept."
          return false
        }
        // The durable receipt remains available after a previously accepted message
        // has aged out of the recent history returned to a reconnected phone.
        guard (receipt?.id == pending.id && receipt?.action == "message")
          || snapshot?.messages.contains(where: { $0.id == pending.id && $0.role == "user" }) == true else {
          throw AssistantProtocolError.invalid
        }
        pendingMessage = nil
        try chatDraft.accept(durableDraft, scope: target)
        if target == scope { chatDraft.reconcile(snapshot?.messageReceipts ?? []) }
        error = ""
        if !replyAudioActive { status = voiceActive ? "Thinking…" : "Message sent" }
        return true
      } catch {
        if Task.isCancelled || (voiceInputEpoch != nil && voiceInputEpoch != inputEpoch) { return false }
        assistantReady = false
        if attempt == 0, !connected, !Task.isCancelled, target == scope, Date() < deadline {
          // Recover an uncertain send using its original durable ID. The Mac
          // receipt prevents a second delivery if it accepted the first attempt.
          continue
        }
        self.error = error.localizedDescription
        return false
      }
    }
    return false
  }
  func startVoice() async {
    guard !voiceActive, !startingVoice else { return }
    interruptSpeech()
    startingVoice = true
    callVisible = true
    let attempt = UUID()
    voiceEpoch = attempt
    defer { if voiceEpoch == attempt { startingVoice = false } }
    status = "Connecting Assistant…"
    error = ""
    microphoneNotice = ""
    open()
    #if DEBUG
      if preview != nil {
        if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-delayed-start") {
          try? await Task.sleep(nanoseconds: 3_000_000_000)
          guard voiceEpoch == attempt else { return }
        }
        voiceActive = true
        status = "Listening…"
        if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-muted-preview") {
          muted = true
        }
        if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-send-test") {
          waitForSend = true
          let turn = currentVoiceTurn()
          turn.parts = ["Please check the second Terminal tab."]
          turn.lastAudioAt = ProcessInfo.processInfo.systemUptime
          updateVoiceDraft()
        }
        if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-speaking") {
          setReplyActive(true)
          status = "Speaking…"
        }
        if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-transcript-test") {
          let turn = currentVoiceTurn()
          turn.previewText = "Could you check"
          updateVoiceDraft()
          canSendVoice = true
          hearingSpeech = true
          Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard let self, voiceEpoch == attempt, voiceActive, !transcriptionCapturePaused, draftTurn === turn else { return }
            turn.previewText = "Could you check which Terminal tab is working?"
            updateVoiceDraft()
          }
        }
        return
      }
    #endif
    var microphoneStartup = false
    do {
      let deadline = Date().addingTimeInterval(60)
      try await awaitAssistant(until: deadline, voiceAttempt: attempt)
      spoken = Set(((snapshot?.messages ?? []) + (snapshot?.taskUpdates ?? [])).map(\.id))
      guard voiceEpoch == attempt else { return }
      status = "Starting microphone…"
      microphoneStartup = true
      try await audio.start()
      guard voiceEpoch == attempt else {
        audio.stop()
        return
      }
      voiceActive = true
      muted = false
      audio.muted = false
      status = "Listening…"
      error = ""
    } catch {
      if voiceEpoch == attempt {
        self.error = error.localizedDescription
        status = microphoneStartup ? "Microphone unavailable" : "Assistant couldn't connect. Tap to view."
      }
    }
  }
  func toggleMute() {
    guard voiceActive else { return }
    if transcriptionCapturePaused {
      guard clearTranscriptionTurn == nil else { return }
      Task { await resumeTranscriptionListening(unmute: true) }
      return
    }
    if muted { Task { await unmuteMicrophone() } }
    else { muteMicrophone() }
  }
  private func preserveVoiceForReview() {
    for turn in voiceTurns where !turn.displayText.isEmpty {
      chatDraft.recoverVoice(turn.displayText, id: turn.id, deliveryUncertain: turn.submittedAt != nil)
    }
  }
  private func discardUnsentVoice() {
    inputEpoch = UUID()
    if let id = pendingMessage?.id, voiceTurns.contains(where: { $0.id == id }) { pendingMessage = nil }
    transcribing?.cancel()
    transcribing = nil
    voiceWorker = UUID()
    transcribingTurn = nil
    automaticSend?.cancel()
    automaticSend = nil
    cancelTranscriptionPreview()
    voiceQueue = []
    voiceTurns = []
    draftTurn = nil
    canSendVoice = false
    liveTranscript = ""
    hearingSpeech = false
    transcribingSpeech = false
    inputLevel = 0
    resetTranscriptionReview()
    audio.resetUtterance()
  }
  private func resetTranscriptionReview() {
    transcriptionReview = .listening
    transcriptionEditText = ""
    transcriptionEdited = false
    transcriptionClearPresented = false
    clearTranscriptionTurn = nil
    transcriptionCapturePaused = false
  }
  /// Hold synchronously before closing capture. The native cutoff drains only
  /// pre-tap samples; later callbacks cannot extend this reviewed turn.
  private func holdTranscription() -> Bool {
    guard canReviewTranscription else { return false }
    transcriptionReview = .held
    automaticSend?.cancel(); automaticSend = nil
    let wasPaused = transcriptionCapturePaused
    let needsCutoff = !wasPaused || changingMicrophone
    transcriptionCapturePaused = true
    microphoneChange = UUID()
    changingMicrophone = false
    if needsCutoff {
      acceptingReviewFlush = !wasPaused
      defer { acceptingReviewFlush = false }
      // A new hold also cancels an unfinished Resume, at the native graph as
      // well as the controller. It must not reopen capture behind the editor.
      do { try audio.muteCapture(finishingUtterance: !wasPaused && !muted) }
      catch { muted = true; microphoneNotice = "The microphone is off. Your transcription is held for review." }
    }
    cancelTranscriptionPreview()
    hearingSpeech = false
    inputLevel = 0
    updateVoiceDraft()
    return true
  }
  func editTranscription() {
    guard holdTranscription() else { return }
    transcriptionReview = .editing
    transcriptionEdited = false
    transcriptionEditText = draftTurn?.displayText ?? ""
    updateVoiceDraft()
  }
  /// Once Cody edits (or saves), his complete text is authoritative. Cancel
  /// only this draft's STT, preserving earlier submitted turns and their IDs.
  func updateTranscriptionEdit(_ text: String) {
    guard transcriptionReview == .editing, clearTranscriptionTurn == nil, let turn = draftTurn else { return }
    transcriptionEdited = true
    transcriptionEditText = text
    cancelPendingTranscription(turn)
    turn.parts = [text]
    turn.previewText = ""
    updateVoiceDraft()
  }
  func saveTranscriptionEdits() {
    guard transcriptionReview == .editing, clearTranscriptionTurn == nil else { return }
    updateTranscriptionEdit(transcriptionEditText)
    transcriptionReview = .held
    updateVoiceDraft()
  }
  func requestClearTranscription() {
    let previous = transcriptionReview
    guard holdTranscription(), let turn = draftTurn else { return }
    reviewBeforeClear = previous == .editing ? .editing : .held
    clearTranscriptionTurn = turn
    transcriptionClearPresented = true
    updateVoiceDraft()
  }
  // SwiftUI dismisses an alert binding before or after its action. Dismissal
  // alone must never release the hold or invalidate the pending Clear target.
  func hideTranscriptionClearPrompt() { transcriptionClearPresented = false }
  func cancelClearTranscription() {
    guard clearTranscriptionTurn != nil else { return }
    clearTranscriptionTurn = nil
    transcriptionClearPresented = false
    transcriptionReview = reviewBeforeClear
    updateVoiceDraft()
  }
  func clearTranscription() {
    guard let turn = clearTranscriptionTurn, draftTurn === turn, !turn.sealed, turn.submittedAt == nil else { return }
    cancelPendingTranscription(turn)
    voiceTurns.removeAll { $0 === turn }
    draftTurn = nil
    automaticSend?.cancel(); automaticSend = nil
    audio.resetUtterance()
    clearTranscriptionTurn = nil
    transcriptionClearPresented = false
    transcriptionEditText = ""
    transcriptionEdited = false
    transcriptionReview = .listening
    liveTranscript = ""
    updateVoiceDraft()
    processVoiceQueue()
    Task { await resumeTranscriptionCapture() }
  }
  func leaveTranscriptionEditor() {
    if clearTranscriptionTurn != nil { cancelClearTranscription() }
    saveTranscriptionEdits()
  }
  private func cancelPendingTranscription(_ turn: AssistantVoiceTurn) {
    cancelTranscriptionPreview()
    voiceQueue.removeAll { $0.turn === turn }
    turn.pendingSegments = 0
    if transcribingTurn === turn {
      voiceWorker = UUID()
      transcribing?.cancel(); transcribing = nil; transcribingTurn = nil
      processVoiceQueue()
    }
  }
  func resumeTranscriptionListening(unmute: Bool = false) async {
    guard voiceActive, clearTranscriptionTurn == nil, !changingMicrophone else { return }
    saveTranscriptionEdits()
    transcriptionReview = .listening
    transcriptionEdited = false
    if unmute && muted { transcriptionCapturePaused = true }
    // A reviewed draft gets a fresh normal pause interval. It never inherits
    // an expired deadline from the editor or confirmation dialog.
    if let turn = draftTurn {
      turn.ending = AssistantTurnEnding()
      let now = ProcessInfo.processInfo.systemUptime
      turn.ending.transcript(turn.text, capturedAt: now, receivedAt: now)
    }
    await resumeTranscriptionCapture(unmute: unmute)
    if let draftTurn { scheduleVoiceSend(draftTurn) }
    updateVoiceDraft()
  }
  private func resumeTranscriptionCapture(unmute: Bool = false) async {
    guard transcriptionCapturePaused, voiceActive, !changingMicrophone, transcriptionReview == .listening,
      clearTranscriptionTurn == nil else { return }
    if muted && !unmute {
      transcriptionCapturePaused = false
      updateVoiceDraft()
      return
    }
    #if DEBUG
      if preview != nil {
        transcriptionCapturePaused = false
        muted = false
        updateVoiceDraft()
        return
      }
    #endif
    let change = UUID(), call = voiceEpoch
    microphoneChange = change
    changingMicrophone = true
    defer { if microphoneChange == change { changingMicrophone = false } }
    do {
      try await audio.unmuteCapture()
      guard microphoneChange == change, voiceEpoch == call, voiceActive else { return }
      transcriptionCapturePaused = false
      muted = false
      microphoneNotice = ""
    } catch {
      guard microphoneChange == change, voiceEpoch == call else { return }
      muted = true
      transcriptionCapturePaused = false
      if draftTurn != nil { transcriptionReview = .held }
      microphoneNotice = "The microphone could not resume. Your words are held; you can still Send or retry the microphone."
    }
    updateVoiceDraft()
  }
  func muteMicrophone(confirm: Bool = true, preservingTurn: Bool = true) {
    guard voiceActive else { return }
    microphoneChange = UUID()
    changingMicrophone = false
    let previous = muted
    // Manual mute stops capture, while the accepted turn keeps its delivery
    // identity. Hardware failures use the separate saved-for-review path.
    if !preservingTurn { muted = true; discardUnsentVoice() }
    do {
      // The native method closes capture first, drains only pre-tap audio and
      // delivers its final segment synchronously. No other actor callback can
      // enter between that capture boundary and the controller's muted state.
      try audio.muteCapture(finishingUtterance: preservingTurn && !previous)
      muted = true
      if confirm && !previous { confirmMicrophoneChange() }
    } catch {
      muted = true
      microphoneNotice = "The microphone is off. Tap the microphone button to reconnect when ready."
    }
    hearingSpeech = false
    inputLevel = 0
    if let draftTurn { scheduleVoiceSend(draftTurn) }
    updateVoiceDraft()
  }
  func unmuteMicrophone() async {
    if transcriptionReview != .listening {
      await resumeTranscriptionListening(unmute: true)
      return
    }
    guard voiceActive, muted, !changingMicrophone, foreground else { return }
    let change = UUID()
    microphoneChange = change
    changingMicrophone = true
    defer { if microphoneChange == change { changingMicrophone = false } }
    do {
      try await audio.unmuteCapture()
      guard microphoneChange == change, voiceActive else { return }
      muted = false
      microphoneNotice = ""
      updateVoiceDraft()
      confirmMicrophoneChange()
    } catch {
      guard microphoneChange == change else { return }
      muteMicrophone(confirm: false)
      microphoneNotice = "The microphone could not restart. Check microphone permission and your audio connection, then tap the microphone button again."
    }
  }
  func applicationForegroundChanged(_ active: Bool) {
    // Background audio keeps the user-started call alive. Foreground changes
    // never reactivate a manually muted microphone or consult retired settings.
    foreground = active
    replyNavigation.foreground = active
    if active, notificationTarget != nil, notificationOpen == nil { retryReplyNotification() }
  }
  func conversationVisibility(_ visible: Bool, followingLatest: Bool = true) {
    conversationVisible = visible
    replyNavigation.visibleScope = visible ? scope : nil
    replyNavigation.visibleConversationId = visible ? snapshot?.conversationId : nil
    replyNavigation.viewingLatest = visible && followingLatest
  }
  func openReplyNotification(_ target: AssistantReplyNotification) {
    guard target.valid else { return }
    replyNavigation.receive(target)
    if notificationTarget == target, notificationOpen != nil { return }
    notificationOpen?.cancel(); notificationOpen = nil
    notificationTarget = target
    retryReplyNotification()
  }
  private func retainNotificationMessages(in next: inout AssistantSnapshot) {
    guard next.conversationId == notificationConversationId else { return }
    for message in notificationMessages where !next.messages.contains(where: { $0.id == message.id }) { next.messages.append(message) }
    next.messages.sort { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
  }
  func retryReplyNotification() {
    guard let target = notificationTarget, notificationOpen == nil else { return }
    notificationNotice = "Opening Assistant reply…"
    notificationOpen = Task { [weak self] in
      guard let self else { return }
      defer { if notificationTarget == target || notificationTarget == nil { notificationOpen = nil } }
      do {
        let deadline = Date().addingTimeInterval(60)
        while !connected && Date() < deadline {
          try Task.checkCancellation()
          guard notificationTarget == target, scope == target.scope else { throw CancellationError() }
          connection.connect()
          try await Task.sleep(for: .milliseconds(250))
        }
        guard connected, scope == target.scope, notificationTarget == target else { throw AssistantProtocolError.disconnected }
        try await refresh()
        let args: [String: AssistantValue] = ["action": .string("reply"), "requestId": .string(UUID().uuidString.lowercased()),
          "conversationId": .string(target.conversationId), "messageRequestId": .string(target.requestId), "replyId": .string(target.replyId)]
        let data: Data
        #if DEBUG
        if let preview { data = try preview.replyPayload() }
        else { data = try await connection.request(.command, payload: JSONEncoder().encode(args)) }
        #else
        data = try await connection.request(.command, payload: JSONEncoder().encode(args))
        #endif
        struct Reply: Decodable {
          struct Saved: Decodable { let conversationId: String; let requestId: String; let message: AssistantMessage; let userMessage: AssistantMessage? }
          let assistantReply: Saved
        }
        let result = try JSONDecoder().decode(Reply.self, from: data).assistantReply
        try Task.checkCancellation()
        guard scope == target.scope, notificationTarget == target, result.conversationId == target.conversationId,
          result.requestId == target.requestId, result.message.id == target.replyId, result.message.role == "assistant",
          snapshot?.conversationId == target.conversationId else { throw AssistantProtocolError.invalid }
        notificationMessages = [result.userMessage, result.message].compactMap { $0 }
        notificationConversationId = target.conversationId
        for message in notificationMessages where snapshot?.messages.contains(where: { $0.id == message.id }) != true { snapshot?.messages.append(message) }
        snapshot?.messages.sort { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
        notificationScrollTarget = target.replyId
        notificationScrollRevision += 1
        notificationNotice = ""
        if foreground, replyNavigation.beginPlayback(target) {
          spoken.insert(result.message.id)
          if playingMessageID != result.message.id { playMessage(id: result.message.id, text: result.message.text) }
        }
        // If the phone backgrounded while loading, keep the tap pending so it
        // opens and plays only after returning to the foreground.
        if foreground { replyNavigation.finishOpening(target); notificationTarget = nil }
      } catch is CancellationError { }
      catch {
        if notificationTarget == target {
          notificationNotice = "Keep the original Mac awake with ClawDad running to open this saved reply. Reconnect and tap Retry; the exact reply is kept as your destination."
        }
      }
    }
  }
  func cancelReplyNotification() {
    notificationOpen?.cancel(); notificationOpen = nil
    if let target = notificationTarget { replyNavigation.finishOpening(target) }
    notificationTarget = nil; notificationNotice = ""
  }
  func interject() {
    guard voiceActive, replyAudioActive else { return }
    // Ignore later spoken items from this same response while retaining every
    // written message and leaving project work running in Terminal.
    if let activeReplyRequest { silencedReplies.insert(activeReplyRequest) }
    interruptSpeech()
    if muted { Task { await unmuteMicrophone() } }
    else { status = "Listening…" }
  }
  private func interruptSpeech() {
    playbackEpoch = UUID()
    speech?.cancel()
    speech = nil
    speechQueue = []
    audio.stopPlayback()
    activeReplyRequest = nil
    playingMessageID = nil
    messagePlaybackPreparing = false
    messagePlaybackPaused = false
    playback?.record("cancelled"); playback = nil
    setReplyActive(false)
    if voiceActive { status = muted ? muteStatus : "Listening…" }
  }
  private func setReplyActive(_ active: Bool) {
    replyAudioActive = active
    audio.setReplyActive(active)
    if active {
      cancelTranscriptionPreview()
      hearingSpeech = false
      if !transcribingSpeech && draftTurn == nil { liveTranscript = "" }
      inputLevel = 0
    }
  }
  func endVoice() {
    preserveVoiceForReview()
    microphoneChange = UUID()
    inputEpoch = UUID()
    changingMicrophone = false
    voiceEpoch = UUID()
    voiceActive = false
    startingVoice = false
    callVisible = false
    muted = false
    inputLevel = 0
    interruptSpeech()
    transcribing?.cancel()
    transcribing = nil
    voiceWorker = UUID()
    transcribingTurn = nil
    voiceQueue = []
    voiceTurns = []
    deliveredVoiceTurns = [:]
    draftTurn = nil
    automaticSend?.cancel()
    automaticSend = nil
    canSendVoice = false
    cancelTranscriptionPreview()
    liveTranscript = ""
    hearingSpeech = false
    transcribingSpeech = false
    resetTranscriptionReview()
    audio.stop()
    status = "Call ended · Accepted work continues on your Mac"
  }
  func stop() {
    endVoice()
    monitor?.cancel()
    monitor = nil
    connection.close()
    assistantReady = false
  }
  private func currentVoiceTurn() -> AssistantVoiceTurn {
    if let draftTurn { return draftTurn }
    let turn = AssistantVoiceTurn()
    voiceTurns.append(turn)
    draftTurn = turn
    return turn
  }
  func setWaitForSend(_ enabled: Bool) {
    waitForSend = enabled
    defaults?.set(enabled, forKey: "assistant.thinkAloud")
    automaticSend?.cancel()
    automaticSend = nil
    if !enabled, let draftTurn { scheduleVoiceSend(draftTurn) }
    updateVoiceDraft()
  }
  func sendVoiceNow() {
    guard canSendVoice, clearTranscriptionTurn == nil else { return }
    saveTranscriptionEdits()
    // This callback synchronously appends the final recorded samples before the
    // turn is sealed. STT may still be running; Send never submits a preview.
    audio.finishUtterance()
    hearingSpeech = false
    if let draftTurn { sealVoiceTurn(draftTurn, manual: true) }
    transcriptionReview = .listening
    transcriptionEditText = ""
    transcriptionEdited = false
    Task { await resumeTranscriptionCapture() }
  }
  private func scheduleVoiceSend(_ turn: AssistantVoiceTurn) {
    guard !replyAudioActive, !waitForSend, automaticSend == nil, !transcriptionCapturePaused, transcriptionReview == .listening,
      clearTranscriptionTurn == nil else { return }
    let epoch = voiceEpoch
    automaticSend = Task { [weak self] in
      while !Task.isCancelled {
        guard let self, !replyAudioActive, voiceEpoch == epoch, draftTurn === turn, !waitForSend,
          !transcriptionCapturePaused, transcriptionReview == .listening, clearTranscriptionTurn == nil else { return }
        let now = ProcessInfo.processInfo.systemUptime
        let active = hearingSpeech && (audio.lastSpeechAt.map { now - $0 < 0.8 } ?? true)
        if turn.ending.shouldFinish(at: now, pause: Double(automaticSendDelay) / 1_000_000_000,
          thinkAloud: waitForSend, activeSpeech: active,
          transcriptionPending: turn.pendingSegments > 0 || transcriptionPreview != nil) {
          // Flush the actual recording and wait for its final words before
          // sealing the turn. The call itself stays open.
          audio.finishUtterance()
          hearingSpeech = false
          if turn.pendingSegments == 0 {
            sealVoiceTurn(turn, manual: false)
            return
          }
        }
        if active, transcriptionPreview == nil, turn.pendingSegments == 0,
          let deadline = turn.ending.deadline(pause: Double(automaticSendDelay) / 1_000_000_000), now >= deadline {
          // Energy can remain high because of room noise. Ask for a fresh word
          // checkpoint before overriding it; never infer silence from a stalled
          // recognizer or from an old partial while someone may still be talking.
          audio.previewUtterance()
        }
        do { try await Task.sleep(nanoseconds: min(100_000_000, automaticSendDelay)) } catch { return }
      }
    }
  }
  private func sealVoiceTurn(_ turn: AssistantVoiceTurn, manual: Bool) {
    guard draftTurn === turn, !turn.sealed, clearTranscriptionTurn == nil,
      manual || transcriptionReview == .listening else { return }
    automaticSend?.cancel()
    automaticSend = nil
    cancelTranscriptionPreview()
    turn.sealed = true
    turn.metrics["manualSend"] = manual ? 1 : 0
    if let endpoint = turn.endpointAt {
      turn.metrics["commitWaitMs"] = max(0, (ProcessInfo.processInfo.systemUptime - endpoint) * 1000)
    }
    draftTurn = nil
    updateVoiceDraft()
    processVoiceQueue()
  }
  private func updateVoiceDraft() {
    if voiceActive {
      chatDraft.checkpointVoice(voiceTurns.filter { !$0.displayText.isEmpty }.map {
        AssistantRecoveredVoice(id: $0.id, text: $0.displayText, deliveryUncertain: $0.submittedAt != nil)
      })
    }
    canSendVoice = voiceActive && !replyAudioActive && draftTurn != nil && clearTranscriptionTurn == nil
      && (!transcriptionEdited || !(draftTurn?.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true))
    transcribingSpeech = !voiceQueue.isEmpty
    liveTranscript = (draftTurn ?? voiceTurns.last)?.displayText ?? ""
    if transcriptionReview == .editing, !transcriptionEdited { transcriptionEditText = liveTranscript }
    guard voiceActive, !replyAudioActive else { return }
    if transcriptionReview != .listening {
      status = transcriptionReview == .editing ? "Editing transcription · Held" : "Transcription held"
      return
    }
    if hearingSpeech { status = "Hearing you…" }
    else if transcribingSpeech { status = voiceTurns.first?.sealed == true ? "Finishing your words…" : "Transcribing…" }
    else if draftTurn != nil { status = waitForSend ? "Think aloud · Tap Send when ready" : "Replying after 2 seconds without new words" }
    else if !voiceTurns.isEmpty { status = "Sending…" }
    else if deliveredVoiceTurns.values.contains(where: { $0.responseObservedAt == nil }) { status = "Thinking…" }
    else { status = muted ? muteStatus : "Listening…" }
  }
  private func transcribe(_ data: Data, final: Bool) {
    guard voiceActive, !muted, !replyAudioActive,
      !transcriptionCapturePaused || acceptingReviewFlush else { return }
    guard !data.isEmpty || draftTurn != nil else { return }
    cancelTranscriptionPreview()
    if final { hearingSpeech = false }
    let turn = currentVoiceTurn()
    let now = ProcessInfo.processInfo.systemUptime
    let speechAt = audio.lastSpeechAt ?? now
    turn.lastSpeechAt = max(turn.lastSpeechAt ?? speechAt, speechAt)
    turn.ending.speechStarted(at: speechAt)
    if !data.isEmpty {
      turn.pendingSegments += 1
      turn.lastAudioAt = now
      voiceQueue.append((data, turn, now, speechAt, final))
    }
    if final {
      turn.endpointAt = now
      if let lastSpeech = audio.lastSpeechAt {
        turn.metrics["endpointDetectionMs"] = max(0, (now - lastSpeech) * 1000)
      }
      scheduleVoiceSend(turn)
    }
    if voiceQueue.count >= 30 {
      preserveVoiceForReview()
      muteMicrophone(confirm: false, preservingTurn: false)
      error = "Transcription fell behind, so the microphone paused. Already transcribed words are saved for review; tap the microphone button when ready."
      return
    }
    updateVoiceDraft()
    processVoiceQueue()
  }
  private func processVoiceQueue() {
    guard transcribing == nil else { return }
    let epoch = inputEpoch
    let worker = UUID()
    voiceWorker = worker
    transcribing = Task { [weak self] in
      guard let self else { return }
      defer {
        if inputEpoch == epoch, voiceWorker == worker {
          transcribing = nil
          transcribingTurn = nil
          updateVoiceDraft()
          speakNext()
        }
      }
      // Muting gates capture, not this queue of already accepted public audio.
      while inputEpoch == epoch, voiceWorker == worker, !Task.isCancelled {
        if let turn = voiceTurns.first, turn.sealed, turn.pendingSegments == 0 {
          let started = ProcessInfo.processInfo.systemUptime
          let text = turn.text
          if !text.isEmpty {
            turn.submittedAt = started
            if let lastWord = turn.ending.lastWordAt {
              turn.metrics["lastWordToSubmitMs"] = max(0, (started - lastWord) * 1000)
            }
            if let lastSpeech = turn.lastSpeechAt {
              turn.metrics["lastSpeechToSubmitMs"] = max(0, (started - lastSpeech) * 1000)
            }
            if let received = turn.ending.lastTranscriptAt {
              turn.metrics["lastNewTranscriptToSubmitMs"] = max(0, (started - received) * 1000)
            }
            if let finalized = turn.finalizedAt {
              turn.metrics["finalizationToSubmitMs"] = max(0, (started - finalized) * 1000)
            }
            turn.metrics["finalAudioToSendMs"] = max(0, (started - turn.lastAudioAt) * 1000)
            while inputEpoch == epoch, !Task.isCancelled {
              if await send(text, id: turn.id, voiceInputEpoch: epoch) { break }
              status = "Reconnecting to your Mac…"
              do { try await Task.sleep(nanoseconds: 2_000_000_000) } catch { return }
            }
          }
          guard inputEpoch == epoch, !Task.isCancelled else { return }
          turn.metrics["sendRoundTripMs"] = (ProcessInfo.processInfo.systemUptime - started) * 1000
          voiceTurns.removeFirst()
          if !text.isEmpty {
            deliveredVoiceTurns[turn.id] = turn
            if deliveredVoiceTurns.count > 20,
              let oldest = deliveredVoiceTurns.min(by: { ($0.value.submittedAt ?? 0) < ($1.value.submittedAt ?? 0) })?.key {
              deliveredVoiceTurns.removeValue(forKey: oldest)
            }
          }
          updateVoiceDraft()
          if !text.isEmpty { recordVoiceTiming(turn) }
          continue
        }
        guard let segment = voiceQueue.first else { break }
        let turn = segment.turn
        transcribingTurn = turn
        let started = ProcessInfo.processInfo.systemUptime
        do {
          let result = try await connection.request(.transcribe, payload: segment.data)
          guard !Task.isCancelled, inputEpoch == epoch, voiceWorker == worker else { return }
          let value = try JSONDecoder().decode([String: AssistantValue].self, from: result)
          guard value["error"] == nil, let text = value["text"]?.string else {
            throw AssistantProtocolError.invalid
          }
          if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !turn.previewText.isEmpty {
            turn.emptyTranscriptions += 1
            if turn.emptyTranscriptions < 2 { throw AssistantProtocolError.invalid }
            if draftTurn === turn, transcriptionReview != .listening {
              // Keep the current review surface intact when final STT fails.
              // Visible words remain correctable, with no automatic delivery.
              let visible = turn.displayText
              turn.parts = [visible]
              turn.previewText = ""
              turn.pendingSegments = 0
              voiceQueue.removeAll { $0.turn === turn }
              transcribingTurn = nil
              transcriptionEditText = visible
              transcriptionEdited = true
              microphoneNotice = "Some words could not be finalized. Check this held transcription before sending."
              updateVoiceDraft()
              continue
            }
            // An empty final result must not erase a visible partial or submit
            // an incomplete thought. Keep it separate for user review; resume
            // normal listening without disconnecting or turning off the mic.
            chatDraft.recoverVoice(turn.displayText, id: turn.id)
            voiceQueue.removeAll { $0.turn === turn }
            transcribingTurn = nil
            voiceTurns.removeAll { $0 === turn }
            if draftTurn === turn {
              draftTurn = nil
              automaticSend?.cancel(); automaticSend = nil
            }
            microphoneNotice = "Some words could not be finalized. Review the saved unsent voice draft."
            updateVoiceDraft()
            continue
          }
          if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            turn.parts.append(text)
          }
          turn.previewText = ""
          let finalized = ProcessInfo.processInfo.systemUptime
          turn.finalizedAt = finalized
          turn.ending.transcript(turn.text, capturedAt: segment.speechAt, receivedAt: finalized)
          if let lastWord = turn.ending.lastWordAt {
            turn.metrics["lastWordToFinalizationMs"] = max(0, (finalized - lastWord) * 1000)
          }
          turn.add("segments", 1)
          turn.add("transcriptionQueueMs", (started - segment.capturedAt) * 1000)
          turn.add("transcriptionRoundTripMs", (ProcessInfo.processInfo.systemUptime - started) * 1000)
          if let timing = value["assistantTiming"]?.object {
            for (key, value) in timing { if let ms = value.number { turn.add(key, ms) } }
          }
          if let seconds = value["generationSeconds"]?.number { turn.add("modelGenerationMs", seconds * 1000) }
          turn.pendingSegments -= 1
          voiceQueue.removeFirst()
          transcribingTurn = nil
          turn.metrics["finalAudioToTranscriptMs"] = max(0, (ProcessInfo.processInfo.systemUptime - turn.lastAudioAt) * 1000)
          updateVoiceDraft()
        } catch {
          guard !Task.isCancelled, inputEpoch == epoch, voiceWorker == worker else { return }
          if !replyAudioActive { status = "Waiting for local transcription…" }
          try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
      }
    }
  }
  private func recordVoiceTiming(_ turn: AssistantVoiceTurn) {
    let metrics = turn.metrics.mapValues(AssistantValue.number)
    // Numeric timing only. This optional diagnostic is independent of message
    // acceptance and never retries, sends text, or changes the current snapshot.
    Task { [connection] in
      let body: [String: AssistantValue] = ["action": .string("voice.timing"),
        "requestId": .string(turn.id), "metrics": .object(metrics)]
      _ = try? await connection.request(.command, payload: JSONEncoder().encode(body))
    }
  }
  private func cancelTranscriptionPreview() {
    previewEpoch = UUID()
    transcriptionPreview?.cancel()
    transcriptionPreview = nil
  }
  private func previewTranscription(_ data: Data) {
    // One in-flight provisional request at most. Final STT always replaces it
    // and is the only text eligible for submission to the Assistant.
    guard voiceActive, !muted, !replyAudioActive, !transcriptionCapturePaused, transcribing == nil,
      transcriptionPreview == nil, !data.isEmpty else { return }
    let epoch = previewEpoch
    let call = voiceEpoch
    let turn = currentVoiceTurn()
    let capturedAt = audio.lastSpeechAt ?? ProcessInfo.processInfo.systemUptime
    transcriptionPreview = Task { [weak self] in
      guard let self else { return }
      defer { if previewEpoch == epoch { transcriptionPreview = nil } }
      do {
        let data = try await connection.request(.transcribe, payload: data)
        guard !Task.isCancelled, voiceEpoch == call, previewEpoch == epoch,
          voiceActive, !replyAudioActive, draftTurn === turn else { return }
        let result = try JSONDecoder().decode([String: AssistantValue].self, from: data)
        if let text = result["text"]?.string?.trimmingCharacters(in: .whitespacesAndNewlines) {
          let combined = (turn.parts + [text]).joined(separator: " ").trimmingCharacters(in: .whitespaces)
          if !combined.isEmpty { turn.previewText = text; updateVoiceDraft() }
          turn.ending.transcript(combined, capturedAt: capturedAt,
            receivedAt: ProcessInfo.processInfo.systemUptime)
          scheduleVoiceSend(turn)
        }
      } catch { /* The authoritative final transcription retains its normal retry. */ }
    }
  }
  func playMessage(id: String, text: String) {
    if playingMessageID == id {
      if messagePlaybackPaused { resumeMessagePlayback() } else { stopMessagePlayback() }
      return
    }
    let spokenText = AssistantMessagePlaybackText.spoken(text)
    guard !spokenText.isEmpty else { return }
    // Drain only already captured samples, then gate the conversation input.
    // In-flight STT retains its turn and can finish while playback is active.
    if voiceActive && !replyAudioActive { audio.finishUtterance() }
    interruptSpeech()
    automaticSend?.cancel(); automaticSend = nil
    startMessagePlayback(id: id, text: spokenText, automatic: false)
  }
  func stopMessagePlayback() {
    interruptSpeech()
    if let draftTurn { scheduleVoiceSend(draftTurn) }
    updateVoiceDraft()
  }
  func pauseMessagePlayback() {
    guard let playback, speech != nil else { return }
    if playback.pendingAudio != nil { playback.position = audio.playbackPosition }
    playbackEpoch = UUID(); speech?.cancel(); speech = nil
    audio.stopPlayback(); messagePlaybackPreparing = false; messagePlaybackPaused = true
    playback.record("paused", reason: "userPaused")
    status = "Speech paused"
  }
  private func speakNext() {
    guard voiceActive, speech == nil, playback == nil, !speechQueue.isEmpty,
      !hearingSpeech, !transcribingSpeech, voiceTurns.isEmpty else { return }
    let message = speechQueue.removeFirst()
    startMessagePlayback(id: message.id, text: AssistantMessagePlaybackText.spoken(message.text), automatic: true)
  }
  private func startMessagePlayback(id: String, text: String, automatic: Bool) {
    playback = AssistantSpeechPlayback(id: id, text: text, automatic: automatic)
    resumeMessagePlayback()
  }
  func resumeMessagePlayback() {
    guard let playback, speech == nil else { return }
    automaticSend?.cancel(); automaticSend = nil
    let epoch = UUID(); playbackEpoch = epoch
    playingMessageID = playback.id; messagePlaybackPreparing = true; messagePlaybackPaused = false
    setReplyActive(true)
    status = "Preparing message…"
    let identity = playback.id.split(separator: ":", maxSplits: 2)
    activeReplyRequest = playback.automatic && identity.count == 3 && identity[0] == "assistant"
      && UUID(uuidString: String(identity[1])) != nil ? String(identity[1]) : nil
    if let request = activeReplyRequest { deliveredVoiceTurns[request]?.playbackPreparationAt = ProcessInfo.processInfo.systemUptime }
    playback.record("startedOrResumed")
    speech = Task { [weak self] in
      guard let self else { return }
      do {
        try audio.preparePlayback()
        #if DEBUG
        if preview != nil {
          messagePlaybackPreparing = false
          if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-speech-recovery"),
            previewPausedMessages.insert(playback.id).inserted {
            try await Task.sleep(for: .milliseconds(300))
            throw AssistantSpeechFailure.synthesisFailed
          }
          try await Task.sleep(for: .seconds(60))
        } else {
          try await playMessageBatches(playback, epoch: epoch)
        }
        #else
        try await playMessageBatches(playback, epoch: epoch)
        #endif
        guard !Task.isCancelled, playbackEpoch == epoch else { return }
        playback.record("completed")
        speech = nil; self.playback = nil; activeReplyRequest = nil
        playingMessageID = nil; messagePlaybackPreparing = false
        audio.stopPlayback(); setReplyActive(false)
        if let draftTurn { scheduleVoiceSend(draftTurn) }
        updateVoiceDraft()
        if !voiceActive { status = connected ? "Your Mac is connected" : "Reconnecting to your Mac…" }
        speakNext()
      } catch {
        guard !Task.isCancelled, playbackEpoch == epoch else { return }
        playback.record("paused", reason: speechFailureReason(error))
        speech = nil; messagePlaybackPreparing = false; messagePlaybackPaused = true
        // Keep the cursor, exact current clip, remaining text and input gate.
        // Resume continues this message; Stop/Interject releases the gate.
        audio.stopPlayback(); status = "Speech paused"
      }
    }
  }
  private func speechFailureReason(_ error: Error) -> String {
    if let failure = error as? AssistantSpeechFailure { return failure.reason }
    if error is CancellationError { return "audioInterrupted" }
    let value = error as NSError
    return "\(value.domain):\(value.code)"
  }
  private func playMessageBatches(_ cursor: AssistantSpeechPlayback, epoch: UUID) async throws {
    while cursor.batch < cursor.batches.count {
      try await playMessageBatch(cursor, epoch: epoch)
      cursor.nextBatch()
    }
  }
  private func playMessageBatch(_ cursor: AssistantSpeechPlayback, epoch: UUID) async throws {
    var failures = 0
    var waitingSince = ProcessInfo.processInfo.systemUptime
    while true {
      try Task.checkCancellation()
      guard playbackEpoch == epoch else { throw CancellationError() }
      do {
        if cursor.pendingAudio == nil {
          cursor.stage = "synthesis"
          var payload: [String: AssistantValue] = ["text": .string(cursor.batches[cursor.batch]),
            "requestId": .string(cursor.requestID), "poll": .bool(cursor.poll), "retry": .bool(cursor.retry)]
          payload["voiceSelection"] = cursor.selection
          let result = try await connection.request(.synthesize, payload: JSONEncoder().encode(payload))
          try Task.checkCancellation()
          guard playbackEpoch == epoch else { throw CancellationError() }
          let generated = try cursor.inspect(JSONDecoder().decode([String: AssistantValue].self, from: result))
          cursor.poll = true; cursor.retry = false
          let parts = generated["parts"]?.array?.compactMap(\.object) ?? []
          if cursor.part < parts.count {
            cursor.stage = "download"
            guard let url = parts[cursor.part]["url"]?.string else { throw AssistantSpeechFailure.invalidAudio }
            let data = try await connection.request(.audio, payload: Data(url.utf8))
            try Task.checkCancellation()
            guard playbackEpoch == epoch else { throw CancellationError() }
            try cursor.verify(data, part: parts[cursor.part])
            cursor.pendingAudio = data; cursor.position = 0
            cursor.record("downloaded")
          } else if generated["state"]?.string == "ready", cursor.part > 0 { return }
          else if generated["state"]?.string == "failed" { throw AssistantSpeechFailure.synthesisFailed }
          else {
            guard ProcessInfo.processInfo.systemUptime - waitingSince < 12 else { throw AssistantSpeechFailure.stalled }
            try await Task.sleep(for: .milliseconds(350))
            continue
          }
        }
        if let data = cursor.pendingAudio {
          cursor.stage = "playback"
          messagePlaybackPreparing = false; status = "Speaking…"
          cursor.record("playing")
          do { try await audio.play(data, from: cursor.position) }
          catch { cursor.position = audio.playbackPosition; throw error }
          try Task.checkCancellation()
          guard playbackEpoch == epoch else { throw CancellationError() }
          cursor.record("partCompleted")
          cursor.part += 1; cursor.pendingAudio = nil; cursor.position = 0
          failures = 0; waitingSince = ProcessInfo.processInfo.systemUptime
        }
      } catch {
        try Task.checkCancellation()
        guard playbackEpoch == epoch else { throw CancellationError() }
        failures += 1
        cursor.record("failed", reason: speechFailureReason(error))
        // An audio-session interruption requires deliberate Resume. Integrity
        // changes also pause immediately rather than playing mismatched audio.
        if error is CancellationError || (error as? AssistantSpeechFailure)?.retryable == false || failures > 2 { throw error }
        cursor.retry = true
        messagePlaybackPreparing = true; status = "Recovering speech…"
        try await Task.sleep(for: .milliseconds(350 * failures))
        waitingSince = ProcessInfo.processInfo.systemUptime
      }
    }
  }

}

struct AssistantView: View {
  @ObservedObject var controller: MobileAssistantController
  var onClose: () -> Void
  var onWatch: () -> Void
  @State private var showingWorkspace = false
  @StateObject private var messageSelection = AssistantMessageSelection()
  @State private var selectedHistory: AssistantSnapshot?
  @State private var researchTab: String?
  @State private var historyFollowing = AssistantHistoryFollowing()
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.dynamicTypeSize) private var historyTextSize
  @State private var keyboardVisible = false
  private var historyVersion: String {
    (controller.snapshot?.messages ?? []).map { "\($0.id):\($0.text)" }.joined(separator: "\n")
      + (controller.snapshot?.tasks ?? []).map { "\($0.id):\($0.status):\($0.response ?? "")" }.joined(separator: "\n")
      + controller.liveTranscript
  }
  var body: some View {
    NavigationStack {
      VStack(spacing: 12) {
        ResearchActivityNotice(research: controller.snapshot?.research) { showingWorkspace = true }
        if historyTextSize.isAccessibilitySize && !keyboardVisible {
          VStack(alignment: .leading, spacing: 4) { connectionStatus; workspaceButton }
            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal)
        } else if !historyTextSize.isAccessibilitySize {
          HStack { connectionStatus; Spacer(); workspaceButton }.padding(.horizontal)
        }
        if showingWorkspace, let catalog = controller.snapshot?.catalog {
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
              ForEach(catalog.tabs, id: \.id) { tab in
                VStack(alignment: .leading, spacing: 0) {
                Button {
                  controller.watch(tabId: tab.id, onWatch: onWatch)
                } label: {
                  HStack {
                    Image(systemName: "terminal")
                    VStack(alignment: .leading) {
                      Text(tab.title).font(.headline)
                      Text(tab.detail + (tab.isBusy ? " · Busy" : "")).font(.caption)
                    }
                    Spacer()
                    Image(systemName: "arrow.up.right")
                  }
                  .padding(12).background(
                    ClawDadTheme.cream.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain)
                Button { researchTab = tab.id } label: {
                  Label("Research autonomy", systemImage: "flask")
                    .font(.caption).frame(minHeight: 44)
                }.buttonStyle(.plain)
                  .accessibilityIdentifier("clawdad.assistant.research.\(tab.id)")
                }
              }
            }.padding(.horizontal)
          }
        } else {
          ScrollViewReader { proxy in
            ScrollView {
              LazyVStack(alignment: .leading, spacing: 18) {
                if controller.snapshot?.messages.isEmpty != false,
                  !controller.hearingSpeech, !controller.transcribingSpeech, controller.liveTranscript.isEmpty {
                  VStack(alignment: .leading, spacing: 12) {
                    Text("Your Mac, in the conversation.").font(.title2.bold())
                    Text(
                      "Talk through an idea, ask about a project, or send work to one of your existing Terminal tabs."
                    )
                    Text("Speech uses your current ClawDad voice and transcription settings.").font(
                      .footnote
                    ).foregroundStyle(.secondary)
                    if let model = controller.snapshot?.coordinator?["model"]?.string {
                      Text(model).font(.footnote).foregroundStyle(.secondary)
                    }
                  }.padding(.vertical, 28)
                }
                AssistantChatHistory(snapshot: selectedHistory ?? controller.snapshot, selection: messageSelection,
                  playingMessageID: controller.playingMessageID, preparingPlayback: controller.messagePlaybackPreparing,
                  pausedPlayback: controller.messagePlaybackPaused,
                  play: { controller.playMessage(id: $0, text: $1) },
                  watch: { controller.watch(tabId: $0, onWatch: onWatch) },
                  cancel: { controller.perform("cancel", args: ["jobId": .string($0)]) },
                  replyScrollTarget: historyFollowing.openingExact && messageSelection.activeID == nil ? controller.notificationScrollTarget : nil,
                  replyScrollRevision: controller.notificationScrollRevision)
                if controller.hearingSpeech || controller.transcribingSpeech || !controller.liveTranscript.isEmpty || controller.transcriptionReview != .listening {
                  AssistantVoiceTranscription(controller: controller).id("live-transcript")
                }
                Color.clear.frame(height: 1).id("assistant-history-bottom")
              }.padding()
            }.accessibilityIdentifier("clawdad.assistant.history")
            .scrollDismissesKeyboard(.interactively)
            .assistantHistoryTracking($historyFollowing)
            .safeAreaInset(edge: .bottom, spacing: 0) {
              if historyFollowing.showLatest {
                Button {
                  #if canImport(UIKit)
                  UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                  #endif
                  messageSelection.changed(messageSelection.activeID ?? "", active: false)
                  selectedHistory = nil
                  historyFollowing.latest()
                  withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
                    proxy.scrollTo("assistant-history-bottom", anchor: .bottom)
                  }
                } label: {
                  Image(systemName: "arrow.down").font(.system(size: 18, weight: .semibold)).frame(width: 44, height: 44)
                    .background(ClawDadTheme.cream.opacity(0.12), in: Circle())
                }.buttonStyle(.plain).accessibilityLabel("Jump to latest message")
                  .accessibilityHint("Resume following new messages")
                  .accessibilityIdentifier("clawdad.assistant.latest")
                  .frame(maxWidth: .infinity).background(Color.black).transition(.opacity)
              }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: historyFollowing.showLatest)
            .task(id: historyVersion) {
              await Task.yield()
              if !Task.isCancelled, historyFollowing.following, messageSelection.activeID == nil,
                controller.transcriptionReview != .editing { proxy.scrollTo("assistant-history-bottom", anchor: .bottom) }
            }
            .task(id: controller.notificationScrollRevision) {
              guard let target = controller.notificationScrollTarget else { return }
              selectedHistory = nil
              historyFollowing.openExactMessage()
              // Materialize the lazy row; its native text anchor aligns the
              // actual text once UIKit's multiline measurements have settled.
              await Task.yield()
              guard !Task.isCancelled, historyFollowing.openingExact else { return }
              proxy.scrollTo(target, anchor: .top)
            }
          }
        }
        if !controller.notificationNotice.isEmpty {
          VStack(alignment: .leading, spacing: 4) {
            Text(controller.notificationNotice).font(.footnote)
            HStack {
              Button("Retry", action: controller.retryReplyNotification)
              Button("Cancel", action: controller.cancelReplyNotification)
            }.frame(minHeight: 44)
          }.padding(.horizontal).accessibilityIdentifier("clawdad.assistant.notification-notice")
        }
        if !controller.error.isEmpty, controller.error != controller.chatCapacityProblem {
          Text(controller.error).font(.footnote).foregroundStyle(ClawDadTheme.gold).padding(
            .horizontal
          ).accessibilityIdentifier("clawdad.assistant.error")
          if !controller.voiceActive {
            Button(controller.callVisible ? "Retry microphone" : "Retry connection") {
              if controller.callVisible { Task { await controller.startVoice() } }
              else { controller.retryConnection() }
            }.font(.footnote)
              .disabled(controller.startingVoice)
          }
        }
        if !controller.callVisible, !controller.microphoneNotice.isEmpty {
          Text(controller.microphoneNotice).font(.caption).foregroundStyle(ClawDadTheme.gold).padding(.horizontal)
            .accessibilityIdentifier("clawdad.assistant.microphone-notice")
        }
        if !controller.callVisible { AssistantSpeechRecoveryNotice(controller: controller) }
        AssistantChatComposer(controller: controller, draft: controller.chatDraft).padding(.horizontal)
        if controller.callVisible {
          AssistantCallBar(controller: controller)
        } else {
          HStack(spacing: 12) {
          AssistantDestinationButton(controller: controller)
          Button {
            Task { await controller.startVoice() }
          } label: {
            Label(controller.startingVoice ? "Connecting…" : "Call Assistant", systemImage: "headphones")
              .dynamicTypeSize(...DynamicTypeSize.xxxLarge).frame(maxWidth: .infinity).padding(14)
          }.buttonStyle(.plain).background(
            ClawDadTheme.gold, in: RoundedRectangle(cornerRadius: 14)
          ).foregroundStyle(Color.black).disabled(controller.startingVoice).padding([
            .horizontal, .bottom,
          ]).accessibilityIdentifier("clawdad.assistant.start-voice")
          }.padding(.leading)
        }
      }
      .foregroundStyle(ClawDadTheme.cream).background(Color.black).tint(ClawDadTheme.gold)
      #if canImport(UIKit)
      .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
      .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardVisible = false }
      #endif
      .navigationTitle("Assistant").toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Back", systemImage: "chevron.left") {
            if controller.transcriptionReview == .editing { controller.leaveTranscriptionEditor() }
            else if showingWorkspace { showingWorkspace = false } else { onClose() }
          }.keyboardShortcut(.cancelAction).accessibilityIdentifier(
            "clawdad.assistant.back")
        }
        ToolbarItem(placement: .primaryAction) {
          Button(controller.snapshot?.paused == true ? "Resume control" : "Pause control") {
            controller.perform(
              "pause", args: ["paused": .bool(controller.snapshot?.paused != true)])
          }.disabled(!controller.connected)
        }
      }
      .onAppear {
        controller.open()
        controller.conversationVisibility(true, followingLatest: historyFollowing.following && !showingWorkspace)
        if controller.researchRequested { showingWorkspace = true; controller.researchRequested = false }
      }
      .onChange(of: controller.researchRequested) { _, requested in
        if requested { showingWorkspace = true; controller.researchRequested = false }
      }
      .onChange(of: messageSelection.activeID) { _, id in
        if id != nil {
          historyFollowing.cancelExactOpening()
          if selectedHistory == nil { selectedHistory = controller.snapshot }
        }
        if id == nil { selectedHistory = nil }
      }
      .onChange(of: historyFollowing.following) { _, following in controller.conversationVisibility(true, followingLatest: following && !showingWorkspace) }
      .onChange(of: showingWorkspace) { _, showing in controller.conversationVisibility(true, followingLatest: historyFollowing.following && !showing) }
      .onDisappear { controller.leaveTranscriptionEditor(); controller.conversationVisibility(false) }
      .sheet(isPresented: Binding(get: { researchTab != nil }, set: { if !$0 { researchTab = nil } })) {
        if let researchTab { ResearchSupervisorView(controller: controller, tabId: researchTab) }
      }
    }
  }
  private var connectionStatus: some View {
    HStack {
      Circle().fill(controller.connected ? Color.green : ClawDadTheme.gold).frame(width: 8, height: 8)
      Text(controller.callStatus).font(.subheadline)
    }.accessibilityElement(children: .combine)
  }
  private var workspaceButton: some View {
    Button("Workspace", systemImage: "terminal") { showingWorkspace.toggle() }
      .dynamicTypeSize(...DynamicTypeSize.xxxLarge).frame(minHeight: 44)
  }
}

struct AssistantSpeechRecoveryNotice: View {
  @ObservedObject var controller: MobileAssistantController
  @Environment(\.dynamicTypeSize) private var textSize
  @ViewBuilder private func controlLabel(_ title: String, symbol: String) -> some View {
    if textSize.isAccessibilitySize {
      Label(title, systemImage: symbol).labelStyle(.iconOnly)
        .font(.system(size: 24)).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
    } else {
      Label(title, systemImage: symbol).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
    }
  }
  var body: some View {
    if controller.messagePlaybackPaused {
      VStack(alignment: .leading, spacing: 0) {
        Text("Speech paused. Your voice and place are saved.")
          .font(.caption).fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("clawdad.assistant.speech-paused")
        HStack {
          Button(action: controller.resumeMessagePlayback) {
            controlLabel("Resume speech", symbol: "play.fill")
          }
            .accessibilityHint("Continue the same message and voice from where playback stopped")
            .accessibilityIdentifier("clawdad.assistant.resume-speech")
          Spacer(minLength: 8)
          Button(action: controller.stopMessagePlayback) {
            controlLabel("Stop", symbol: "stop.fill")
          }
            .accessibilityLabel("Stop reading this message")
        }.font(.subheadline).buttonStyle(.plain).frame(minHeight: 44)
      }.padding(.horizontal, 12).padding(.top, 6)
        .foregroundStyle(ClawDadTheme.cream).background(Color.black)
    } else if controller.playingMessageID != nil {
      HStack {
        Button(action: controller.pauseMessagePlayback) {
          controlLabel("Pause speech", symbol: "pause.fill")
        }
          .accessibilityIdentifier("clawdad.assistant.pause-speech")
        Spacer()
        Button(action: controller.stopMessagePlayback) {
          controlLabel("Stop", symbol: "stop.fill")
        }
          .accessibilityLabel("Stop reading this message")
      }.font(.subheadline).buttonStyle(.plain).frame(minHeight: 44).padding(.horizontal, 12)
        .foregroundStyle(ClawDadTheme.cream).background(Color.black)
    }
  }
}

struct AssistantCallBar: View {
  @ObservedObject var controller: MobileAssistantController
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  var onOpen: (() -> Void)? = nil
  var body: some View {
    if controller.callVisible {
      VStack(spacing: 0) {
      AssistantSpeechRecoveryNotice(controller: controller)
      if !controller.microphoneNotice.isEmpty {
        Text(controller.microphoneNotice).font(.caption2).padding(.horizontal, 10).padding(.top, 4)
          .accessibilityIdentifier("clawdad.assistant.microphone-notice")
      }
      if !controller.connected {
        Text("Assistant is reconnecting. Open messages for connection details.").font(.caption).frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 10).padding(.top, 4)
      }
      HStack(spacing: 6) {
        if let onOpen {
          Button(action: onOpen) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
              .font(.system(size: 20)).frame(width: 44, height: 44)
          }.accessibilityLabel("Assistant messages")
            .accessibilityHint("Shows your voice transcriptions and the Assistant's replies without ending the call")
            .accessibilityIdentifier("clawdad.assistant.return")
        }
        AssistantDestinationButton(controller: controller)
        Spacer(minLength: 0)
        if controller.replyAudioActive {
          Button { controller.interject() } label: {
            Image(systemName: "stop.circle.fill").font(.system(size: 24)).frame(width: 44, height: 44)
          }.accessibilityLabel("Interject")
            .accessibilityHint("Stops the spoken reply and resumes listening to you")
            .accessibilityIdentifier("clawdad.assistant.interject")
        }
        AssistantThinkAloudButton(controller: controller)
        Button {
          controller.toggleMute()
        } label: {
          Image(systemName: controller.muted || controller.replyAudioActive || controller.transcriptionCapturePaused ? "mic.slash.fill" : "mic.fill")
            .font(.system(size: 22)).frame(
            width: 44, height: 44)
            .foregroundStyle(controller.replyAudioActive ? ClawDadTheme.cream.opacity(0.5)
              : controller.inputLevel > 0.15 && !controller.muted ? Color.green : ClawDadTheme.cream)
            .scaleEffect(controller.muted || controller.replyAudioActive ? 1 : 1 + CGFloat(controller.inputLevel) * 0.12)
        }.disabled(!controller.voiceActive || controller.changingMicrophone || controller.transcriptionClearPresented)
          .accessibilityLabel(controller.transcriptionCapturePaused ? "Resume listening" : controller.muted ? "Unmute Assistant" : "Mute Assistant")
          .accessibilityIdentifier("clawdad.assistant.mute")
          .accessibilityHint(controller.replyAudioActive ? "Microphone input pauses during the reply. Use Interject to speak now." : "")
        Button {
          controller.endVoice()
        } label: {
          Image(systemName: "phone.down.fill").font(.system(size: 22)).foregroundStyle(.red).frame(width: 44, height: 44)
        }.accessibilityLabel("End voice conversation")
      }.padding(.horizontal, 10).background(Color.black.opacity(0.96)).foregroundStyle(
        ClawDadTheme.cream)
      }.background(Color.black.opacity(0.96)).foregroundStyle(ClawDadTheme.cream)
    }
  }
}

struct AssistantDestinationButton: View {
  @ObservedObject var controller: MobileAssistantController
  var body: some View {
    Button { Task { await controller.toggleDestination() } } label: {
      Group {
        if controller.changingDestination { ProgressView() }
        else if controller.destinationTransport == "app_server" {
          Image("ClawGlyph").resizable().scaledToFit().frame(width: 28, height: 28)
        } else { Image(systemName: "terminal").font(.system(size: 23, weight: .semibold)) }
      }.frame(width: 44, height: 44)
        .background(ClawDadTheme.gold.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(ClawDadTheme.cream.opacity(0.7), lineWidth: 1) }
    }.buttonStyle(.plain)
      .disabled(!controller.connected || controller.changingDestination || controller.snapshot?.destination == nil)
      .accessibilityLabel("Work destination")
      .accessibilityValue(controller.destinationName + " selected")
      .accessibilityAddTraits(.isSelected)
      .accessibilityHint("Tap to switch between Terminal and ClawDad threads for future requested work. Switching does not send or move work. Explicit instructions can choose another destination.")
      .help("Work destination: \(controller.destinationName). Tap to switch; existing tasks stay where they are.")
      .accessibilityIdentifier("clawdad.assistant.destination")
  }
}

struct AssistantThinkAloudButton: View {
  @ObservedObject var controller: MobileAssistantController
  var body: some View {
    Button { controller.setWaitForSend(!controller.waitForSend) } label: {
      Image(systemName: "infinity").font(.system(size: 18, weight: .semibold))
        .frame(width: 36, height: 36)
        .background(controller.waitForSend ? ClawDadTheme.gold.opacity(0.24) : Color.clear, in: Circle())
        .overlay { Circle().stroke(controller.waitForSend ? ClawDadTheme.gold : ClawDadTheme.cream.opacity(0.45), lineWidth: controller.waitForSend ? 2 : 1) }
        .overlay(alignment: .topTrailing) {
          if controller.waitForSend {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 12, weight: .bold))
              .symbolRenderingMode(.palette).foregroundStyle(.black, ClawDadTheme.gold)
              .accessibilityHidden(true)
          }
        }
        .foregroundStyle(controller.waitForSend ? ClawDadTheme.gold : ClawDadTheme.cream.opacity(0.7))
        .frame(width: 44, height: 44)
        .contentShape(Circle())
    }.buttonStyle(.plain).disabled(!controller.voiceActive)
      .accessibilityLabel("Think aloud")
      .accessibilityValue(controller.waitForSend ? "On" : "Off")
      .accessibilityAddTraits(controller.waitForSend ? .isSelected : [])
      .accessibilityHint("Holds your speaking turn until you send it from Assistant messages. Tap again for automatic turn ending.")
      .accessibilityIdentifier("clawdad.assistant.think-aloud")
      #if os(iOS)
      .hoverEffect(.highlight)
      #endif
  }
}
