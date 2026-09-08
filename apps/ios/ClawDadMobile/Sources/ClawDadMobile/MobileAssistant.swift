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
  @Published private(set) var liveTranscript = ""
  @Published private(set) var hearingSpeech = false
  @Published private(set) var transcribingSpeech = false
  @Published private(set) var canSendVoice = false
  @Published private(set) var waitForSend: Bool
  private let defaults: UserDefaults?
  private let automaticSendDelay: UInt64
  private var automaticSend: Task<Void, Never>?
  private var assistantReady = false
  private let connection: any AssistantTransport
  private let audio: any AssistantAudioIO
  private weak var session: CloudSession?
  private var scope = ""
  private var monitor: Task<Void, Never>?
  private var speech: Task<Void, Never>?
  private var transcribing: Task<Void, Never>?
  private var transcriptionPreview: Task<Void, Never>?
  private var previewEpoch = UUID()
  private var voiceEpoch = UUID()
  private var spoken = Set<String>()
  private var silencedReplies = Set<String>()
  private var pendingMessage: (text: String, id: String)?
  private var voiceQueue: [(data: Data, turn: AssistantVoiceTurn, capturedAt: TimeInterval, speechAt: TimeInterval)] = []
  private var voiceTurns: [AssistantVoiceTurn] = []
  private var draftTurn: AssistantVoiceTurn?
  private var deliveredVoiceTurns: [String: AssistantVoiceTurn] = [:]
  private var speechQueue: [AssistantMessage] = []
  private var activeReplyRequest: String?
  private var connectionError = ""
  #if DEBUG
    private var preview: AssistantPreview?
  #endif

  init(connection: any AssistantTransport = AssistantConnection(),
    audio: any AssistantAudioIO = AssistantAudio(), defaults: UserDefaults? = .standard,
    automaticSendDelay: UInt64 = 4_000_000_000, chatDraft: AssistantChatDraftStore = AssistantChatDraftStore()) {
    self.chatDraft = chatDraft
    self.connection = connection
    self.audio = audio
    self.defaults = defaults
    self.automaticSendDelay = automaticSendDelay
    waitForSend = defaults?.bool(forKey: "assistant.thinkAloud") ?? false
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
    }
    audio.onSpeechStarted = { [weak self] in
      guard let self, voiceActive, !muted, !replyAudioActive else { return }
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
      inputLevel = replyAudioActive ? 0 : level
    }
    audio.onCaptureRecovery = { [weak self] recovering in
      guard let self, voiceActive, !replyAudioActive else { return }
      if recovering { status = "Reconnecting microphone…" }
      else if status == "Reconnecting microphone…" { status = muted ? "Microphone muted" : "Listening…" }
    }
    audio.onCaptureFailure = { [weak self] failure in
      guard let self else { return }
      endVoice()
      callVisible = true
      error = failure.localizedDescription
      status = "Microphone unavailable"
    }
    audio.onUtterance = { [weak self] in self?.transcribe($0, final: $1) }
    audio.onTranscriptPreview = { [weak self] in self?.previewTranscription($0) }
    audio.onReplaced = { [weak self] in self?.endVoice() }
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
      pendingMessage = nil
      spoken = []
      silencedReplies = []
      scope = next
      chatDraft.bind(next)
    }
    self.session = session
    connection.bind(session)
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-test") {
        if preview == nil {
          if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-reset-draft") { chatDraft.clear() }
          preview = AssistantPreview()
          snapshot = try? preview?.snapshot()
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
        snapshot = try preview.snapshot()
        return
      }
    #endif
    let requestedScope = scope
    let data = try await connection.request(.state)
    guard requestedScope == scope else { throw CancellationError() }
    let next = try JSONDecoder().decode(AssistantSnapshot.self, from: data)
    snapshot = next
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
    snapshot = try JSONDecoder().decode(AssistantSnapshot.self, from: data)
    return try JSONDecoder().decode(AssistantCommandReceipt.self, from: data).job
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
    guard !sending, !chatDraft.importing, !chatDraft.value.isEmpty else { return }
    let draft = chatDraft.value, target = scope
    do {
      let images = try draft.images.map { PreparedRemoteImage(upload: $0, data: try chatDraft.bytes($0, scope: target)) }
      if await send(draft.text, id: draft.id, images: images) {
        try chatDraft.complete(draft, scope: target)
      }
    } catch { self.error = error.localizedDescription }
  }
  @discardableResult func send(_ text: String, id: String? = nil, images: [PreparedRemoteImage] = []) async -> Bool {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !images.isEmpty else { return true }
    let target = scope
    while sending { do { try await Task.sleep(nanoseconds: 100_000_000) } catch { return false } }
    guard !Task.isCancelled else { return false }
    sending = true
    defer { sending = false }
    let pending: (text: String, id: String) =
      id.map { (text, $0) }
      ?? (pendingMessage?.text == text ? pendingMessage! : (text, UUID().uuidString.lowercased()))
    pendingMessage = pending
    let deadline = Date().addingTimeInterval(60)
    for attempt in 0..<2 {
      do {
        guard target == scope else { throw CancellationError() }
        try await awaitAssistant(until: deadline)
        try Task.checkCancellation()
        guard target == scope else { throw CancellationError() }
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
        guard target == scope else { throw CancellationError() }
        var args: [String: AssistantValue] = ["text": .string(text)]
        if !images.isEmpty { args["images"] = try .encode(images.map(\.upload)) }
        let receipt = try await command("message", args: args, id: pending.id)
        // The durable receipt remains available after a previously accepted message
        // has aged out of the recent history returned to a reconnected phone.
        guard (receipt?.id == pending.id && receipt?.action == "message")
          || snapshot?.messages.contains(where: { $0.id == pending.id && $0.role == "user" }) == true else {
          throw AssistantProtocolError.invalid
        }
        pendingMessage = nil
        error = ""
        if !replyAudioActive { status = voiceActive ? "Thinking…" : "Message sent" }
        return true
      } catch {
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
    startingVoice = true
    callVisible = true
    let attempt = UUID()
    voiceEpoch = attempt
    defer { if voiceEpoch == attempt { startingVoice = false } }
    status = "Connecting Assistant…"
    error = ""
    open()
    #if DEBUG
      if preview != nil {
        if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-delayed-start") {
          try? await Task.sleep(nanoseconds: 3_000_000_000)
          guard voiceEpoch == attempt else { return }
        }
        voiceActive = true
        status = "Listening…"
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
          _ = currentVoiceTurn()
          canSendVoice = true
          hearingSpeech = true
          liveTranscript = "Could you check"
          Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard let self, voiceEpoch == attempt, voiceActive else { return }
            liveTranscript = "Could you check which Terminal tab is working?"
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
    if !muted { audio.finishUtterance() }
    muted.toggle()
    audio.muted = muted
    audio.resetUtterance()
    if !replyAudioActive { status = muted ? "Microphone muted" : "Listening…" }
  }
  func interject() {
    guard voiceActive, replyAudioActive else { return }
    // Ignore later spoken items from this same response while retaining every
    // written message and leaving project work running in Terminal.
    if let activeReplyRequest { silencedReplies.insert(activeReplyRequest) }
    interruptSpeech()
    muted = false
    audio.muted = false
    status = "Listening…"
  }
  private func interruptSpeech() {
    speech?.cancel()
    speech = nil
    speechQueue = []
    audio.stopPlayback()
    activeReplyRequest = nil
    setReplyActive(false)
    if voiceActive { status = muted ? "Microphone muted" : "Listening…" }
  }
  private func setReplyActive(_ active: Bool) {
    replyAudioActive = active
    audio.setReplyActive(active)
    if active {
      cancelTranscriptionPreview()
      hearingSpeech = false
      if !transcribingSpeech { liveTranscript = "" }
      inputLevel = 0
    }
  }
  func endVoice() {
    voiceEpoch = UUID()
    voiceActive = false
    startingVoice = false
    callVisible = false
    muted = false
    inputLevel = 0
    interruptSpeech()
    transcribing?.cancel()
    transcribing = nil
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
    audio.stop()
    status = "Conversation saved"
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
    guard voiceActive, !replyAudioActive, draftTurn != nil else { return }
    // This callback synchronously appends the final recorded samples before the
    // turn is sealed. STT may still be running; Send never submits a preview.
    audio.finishUtterance()
    hearingSpeech = false
    if let draftTurn { sealVoiceTurn(draftTurn, manual: true) }
  }
  private func scheduleVoiceSend(_ turn: AssistantVoiceTurn) {
    guard !waitForSend, automaticSend == nil else { return }
    let epoch = voiceEpoch
    automaticSend = Task { [weak self] in
      while !Task.isCancelled {
        guard let self, voiceEpoch == epoch, draftTurn === turn, !waitForSend else { return }
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
    guard draftTurn === turn, !turn.sealed else { return }
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
    canSendVoice = voiceActive && !replyAudioActive && draftTurn != nil
    transcribingSpeech = !voiceQueue.isEmpty
    liveTranscript = (draftTurn ?? voiceTurns.last)?.text ?? ""
    guard voiceActive, !replyAudioActive else { return }
    if hearingSpeech { status = "Hearing you…" }
    else if transcribingSpeech { status = voiceTurns.first?.sealed == true ? "Finishing your words…" : "Transcribing…" }
    else if draftTurn != nil { status = waitForSend ? "Think aloud · Tap Send when ready" : "Replying after a 4-second pause" }
    else if !voiceTurns.isEmpty { status = "Sending…" }
    else if deliveredVoiceTurns.values.contains(where: { $0.responseObservedAt == nil }) { status = "Thinking…" }
    else { status = muted ? "Microphone muted" : "Listening…" }
  }
  private func transcribe(_ data: Data, final: Bool) {
    guard voiceActive, !muted, !replyAudioActive else { return }
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
      voiceQueue.append((data, turn, now, speechAt))
    }
    if final {
      turn.endpointAt = now
      if let lastSpeech = audio.lastSpeechAt {
        turn.metrics["endpointDetectionMs"] = max(0, (now - lastSpeech) * 1000)
      }
      scheduleVoiceSend(turn)
    }
    if voiceQueue.count >= 30 {
      muted = true
      audio.muted = true
      error =
        "The microphone is paused while your Mac catches up. Your recorded speech is retained."
    }
    updateVoiceDraft()
    processVoiceQueue()
  }
  private func processVoiceQueue() {
    guard transcribing == nil else { return }
    let epoch = voiceEpoch
    transcribing = Task { [weak self] in
      guard let self else { return }
      defer {
        if voiceEpoch == epoch {
          transcribing = nil
          updateVoiceDraft()
          speakNext()
        }
      }
      while voiceEpoch == epoch, !Task.isCancelled {
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
            while voiceEpoch == epoch, !Task.isCancelled {
              if await send(text, id: turn.id) { break }
              status = "Reconnecting to your Mac…"
              do { try await Task.sleep(nanoseconds: 2_000_000_000) } catch { return }
            }
          }
          guard voiceEpoch == epoch, !Task.isCancelled else { return }
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
        let started = ProcessInfo.processInfo.systemUptime
        do {
          let result = try await connection.request(.transcribe, payload: segment.data)
          guard !Task.isCancelled, voiceEpoch == epoch else { return }
          let value = try JSONDecoder().decode([String: AssistantValue].self, from: result)
          if let text = value["text"]?.string,
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            turn.parts.append(text)
          }
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
          turn.metrics["finalAudioToTranscriptMs"] = max(0, (ProcessInfo.processInfo.systemUptime - turn.lastAudioAt) * 1000)
          updateVoiceDraft()
        } catch {
          guard !Task.isCancelled, voiceEpoch == epoch else { return }
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
    guard voiceActive, !muted, !replyAudioActive, transcribing == nil,
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
          if !combined.isEmpty { liveTranscript = combined }
          turn.ending.transcript(combined, capturedAt: capturedAt,
            receivedAt: ProcessInfo.processInfo.systemUptime)
          scheduleVoiceSend(turn)
        }
      } catch { /* The authoritative final transcription retains its normal retry. */ }
    }
  }
  private func speakNext() {
    guard voiceActive, speech == nil, !speechQueue.isEmpty,
      !hearingSpeech, !transcribingSpeech, voiceTurns.isEmpty else { return }
    setReplyActive(true)
    status = "Preparing reply…"
    let message = speechQueue.removeFirst()
    let identity = message.id.split(separator: ":", maxSplits: 2)
    activeReplyRequest = identity.count == 3 && identity[0] == "assistant"
      && UUID(uuidString: String(identity[1])) != nil ? String(identity[1]) : nil
    if let id = activeReplyRequest { deliveredVoiceTurns[id]?.playbackPreparationAt = ProcessInfo.processInfo.systemUptime }
    let epoch = voiceEpoch
    speech = Task { [weak self] in
      guard let self else { return }
      defer {
        if !Task.isCancelled, voiceEpoch == epoch {
          speech = nil
          if speechQueue.isEmpty {
            activeReplyRequest = nil
            setReplyActive(false)
            status = muted ? "Microphone muted" : "Listening…"
          } else { speakNext() }
        }
      }
      var played = 0
      var poll = false
      var voiceSelection: AssistantValue?
      let deadline = Date().addingTimeInterval(180)
      do {
        while Date() < deadline {
          try Task.checkCancellation()
          guard voiceActive, voiceEpoch == epoch else { return }
          var payload: [String: AssistantValue] = [
            "text": .string(String(message.text.prefix(20_000))), "requestId": .string(message.id),
            "poll": .bool(poll),
          ]
          payload["voiceSelection"] = voiceSelection
          let result = try await connection.request(
            .synthesize, payload: JSONEncoder().encode(payload))
          try Task.checkCancellation()
          guard voiceEpoch == epoch else { return }
          let body = try JSONDecoder().decode([String: AssistantValue].self, from: result)
          let generated = body["audio"]?.object ?? [:]
          voiceSelection = body["voiceSelection"] ?? voiceSelection
          if generated["state"]?.string == "failed" {
            throw NSError(
              domain: "Assistant", code: 1,
              userInfo: [
                NSLocalizedDescriptionKey: generated["error"]?.string
                  ?? "Local speech is unavailable."
              ])
          }
          let parts = generated["parts"]?.array ?? []
          while played < parts.count {
            guard let url = parts[played].object?["url"]?.string else {
              throw AssistantProtocolError.invalid
            }
            let data = try await connection.request(.audio, payload: Data(url.utf8))
            try Task.checkCancellation()
            guard voiceEpoch == epoch else { return }
            status = "Speaking…"
            try await audio.play(data)
            played += 1
          }
          if generated["state"]?.string == "ready", played > 0 {
            return
          }
          poll = true
          try await Task.sleep(nanoseconds: 700_000_000)
        }
        throw AssistantProtocolError.timedOut
      } catch {
        if !Task.isCancelled {
          self.error = error.localizedDescription
        }
      }
    }
  }
}

struct AssistantView: View {
  @ObservedObject var controller: MobileAssistantController
  var onClose: () -> Void
  var onWatch: () -> Void
  @State private var showingWorkspace = false
  var body: some View {
    NavigationStack {
      VStack(spacing: 12) {
        HStack {
          Circle().fill(controller.connected ? Color.green : ClawDadTheme.gold).frame(
            width: 8, height: 8)
          Text(controller.status).font(.subheadline)
          Spacer()
          Button("Workspace", systemImage: "terminal") { showingWorkspace.toggle() }
        }.padding(.horizontal)
        if showingWorkspace, let catalog = controller.snapshot?.catalog {
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
              ForEach(catalog.tabs, id: \.id) { tab in
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
                      Text("\(model) · Quick conversation").font(.footnote).foregroundStyle(.secondary)
                    }
                  }.padding(.vertical, 28)
                }
                AssistantChatHistory(snapshot: controller.snapshot,
                  watch: { controller.watch(tabId: $0, onWatch: onWatch) },
                  cancel: { controller.perform("cancel", args: ["jobId": .string($0)]) })
                if controller.hearingSpeech || controller.transcribingSpeech || !controller.liveTranscript.isEmpty {
                  VStack(alignment: .leading, spacing: 5) {
                    Text(controller.hearingSpeech ? "You · Speaking" : controller.transcribingSpeech ? "You · Transcribing…" : "You · Draft")
                      .font(.caption.bold()).foregroundStyle(ClawDadTheme.gold)
                    Text(controller.liveTranscript.isEmpty ? "Listening…" : controller.liveTranscript)
                      .textSelection(.enabled)
                  }.frame(maxWidth: .infinity, alignment: .leading)
                    .id("live-transcript")
                    .accessibilityIdentifier("clawdad.assistant.transcript")
                }
              }.padding()
            }
            .onChange(of: controller.snapshot?.messages.last?.id) { _, id in
              if let id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
            }
            .onChange(of: controller.liveTranscript) { _, text in
              if !text.isEmpty { proxy.scrollTo("live-transcript", anchor: .bottom) }
            }
            .onAppear {
              if !controller.liveTranscript.isEmpty { proxy.scrollTo("live-transcript", anchor: .bottom) }
              else if let id = controller.snapshot?.messages.last?.id { proxy.scrollTo(id, anchor: .bottom) }
            }
          }
        }
        if !controller.error.isEmpty {
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
        if controller.callVisible {
          HStack {
            VStack(alignment: .leading, spacing: 3) {
              Text("Think aloud").font(.subheadline)
              Text(controller.waitForSend ? "Keep listening through pauses until you tap Send." : "Automatically send after 4 seconds without new words.")
                .font(.caption).foregroundStyle(ClawDadTheme.cream.opacity(0.65))
            }
            Spacer(minLength: 12)
            Toggle("Think aloud", isOn: Binding(get: { controller.waitForSend }, set: { controller.setWaitForSend($0) }))
              .labelsHidden().accessibilityIdentifier("clawdad.assistant.think-aloud")
          }.padding(.horizontal)
        }
        AssistantChatComposer(controller: controller, draft: controller.chatDraft).padding(.horizontal)
        if controller.callVisible {
          AssistantCallBar(controller: controller)
        } else {
          Button {
            Task { await controller.startVoice() }
          } label: {
            Label(controller.startingVoice ? "Connecting…" : "Call Assistant", systemImage: "headphones").frame(maxWidth: .infinity).padding(14)
          }.buttonStyle(.plain).background(
            ClawDadTheme.gold, in: RoundedRectangle(cornerRadius: 14)
          ).foregroundStyle(Color.black).disabled(controller.startingVoice).padding([
            .horizontal, .bottom,
          ]).accessibilityIdentifier("clawdad.assistant.start-voice")
        }
      }
      .foregroundStyle(ClawDadTheme.cream).background(Color.black).tint(ClawDadTheme.gold)
      .navigationTitle("Assistant").toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Back", systemImage: "chevron.left") {
            if showingWorkspace { showingWorkspace = false } else { onClose() }
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
      .onAppear { controller.open() }
    }
  }
}

struct AssistantCallBar: View {
  @ObservedObject var controller: MobileAssistantController
  var onOpen: (() -> Void)? = nil
  var body: some View {
    if controller.callVisible {
      HStack(spacing: 6) {
        if let onOpen {
          Button(action: onOpen) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
              .font(.system(size: 20)).frame(width: 44, height: 44)
          }.accessibilityLabel("Assistant messages")
            .accessibilityHint("Shows your voice transcriptions and the Assistant's replies without ending the call")
            .accessibilityIdentifier("clawdad.assistant.return")
        }
        Text(controller.status).font(.caption).lineLimit(2)
          .frame(maxWidth: .infinity, alignment: .leading)
        if controller.replyAudioActive {
          Button { controller.interject() } label: {
            Label("Interject", systemImage: "stop.circle.fill")
              .font(.caption.bold()).frame(minHeight: 44)
          }.accessibilityLabel("Interject")
            .accessibilityHint("Stops the spoken reply and resumes listening to you")
            .accessibilityIdentifier("clawdad.assistant.interject")
        } else if controller.voiceActive {
          Button { controller.sendVoiceNow() } label: {
            Image(systemName: "arrow.up.circle.fill")
              .font(.system(size: 28)).frame(width: 44, height: 44)
          }.disabled(!controller.canSendVoice)
            .accessibilityLabel("Send now")
            .accessibilityHint("Finishes this thought and sends it after transcription")
            .accessibilityIdentifier("clawdad.assistant.send-now")
        }
        Button {
          controller.toggleMute()
        } label: {
          Image(systemName: controller.muted || controller.replyAudioActive ? "mic.slash.fill" : "mic.fill").frame(
            width: 44, height: 44)
            .foregroundStyle(controller.replyAudioActive ? ClawDadTheme.cream.opacity(0.5)
              : controller.inputLevel > 0.15 && !controller.muted ? Color.green : ClawDadTheme.cream)
            .scaleEffect(controller.muted || controller.replyAudioActive ? 1 : 1 + CGFloat(controller.inputLevel) * 0.12)
        }.disabled(!controller.voiceActive).accessibilityLabel(controller.muted ? "Unmute Assistant" : "Mute Assistant")
          .accessibilityHint(controller.replyAudioActive ? "Microphone input pauses during the reply. Use Interject to speak now." : "")
        Button {
          controller.endVoice()
        } label: {
          Image(systemName: "phone.down.fill").foregroundStyle(.red).frame(width: 44, height: 44)
        }.accessibilityLabel("End voice conversation")
      }.padding(.horizontal, 10).background(Color.black.opacity(0.96)).foregroundStyle(
        ClawDadTheme.cream)
    }
  }
}
