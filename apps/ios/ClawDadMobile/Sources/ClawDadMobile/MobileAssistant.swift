import ClawDadRemoteAssistProtocol
import Foundation
import SwiftUI

@MainActor
final class MobileAssistantController: ObservableObject {
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
  private var voiceQueue: [(Data, Bool)] = []
  private var transcriptParts: [String] = []
  private var speechQueue: [AssistantMessage] = []
  private var activeReplyRequest: String?
  private var taskError = ""
  #if DEBUG
    private var preview: AssistantPreview?
  #endif

  init(connection: any AssistantTransport = AssistantConnection(),
    audio: any AssistantAudioIO = AssistantAudio()) {
    self.connection = connection
    self.audio = audio
    connected = connection.connected
    connection.onChange = { [weak self] in
      guard let self else { return }
      connected = self.connection.connected
      if !connected { status = "Reconnecting to your Mac…" }
    }
    audio.onSpeechStarted = { [weak self] in
      guard let self, voiceActive, !muted, !replyAudioActive else { return }
      hearingSpeech = true
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
    }
    self.session = session
    connection.bind(session)
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-test") {
        if preview == nil {
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
    let data = try await connection.request(.state)
    let next = try JSONDecoder().decode(AssistantSnapshot.self, from: data)
    snapshot = next
    let nextTaskError = next.tasks.last?.status == "attention" ? next.tasks.last?.error ?? "" : ""
    if error.isEmpty || error == taskError { error = nextTaskError }
    taskError = nextTaskError
    if voiceActive {
      for message in next.messages where message.role == "assistant" && !spoken.contains(message.id) {
        spoken.insert(message.id)
        if !silencedReplies.contains(where: { message.id.hasPrefix("assistant:\($0):") }) {
          speechQueue.append(message)
        }
      }
      speakNext()
    }
  }
  func command(
    _ action: String, args: [String: AssistantValue] = [:],
    id: String = UUID().uuidString.lowercased()
  ) async throws {
    #if DEBUG
      if let preview {
        snapshot = try preview.command(action, args: args, id: id)
        return
      }
    #endif
    var body = args
    body["action"] = .string(action)
    body["requestId"] = .string(id)
    let data = try await connection.request(.command, payload: JSONEncoder().encode(body))
    snapshot = try JSONDecoder().decode(AssistantSnapshot.self, from: data)
  }
  func watch(tabId: String, onWatch: @escaping () -> Void) {
    Task {
      do {
        let id = UUID().uuidString.lowercased()
        try await command("terminal.focus", args: ["tabId": .string(tabId)], id: id)
        for _ in 0..<20 {
          if let task = snapshot?.tasks.first(where: { $0.id == id }) {
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
    // Check the current host before issuing start: an older Mac would open Terminal.
    try await refresh()
    guard snapshot?.supportsBackgroundCalls == true else {
      throw NSError(domain: "Assistant", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Update ClawDad on your Mac to use the new Assistant call."
      ])
    }
    try await command("start")
  }
  func perform(_ action: String, args: [String: AssistantValue] = [:]) {
    Task {
      do { try await command(action, args: args) } catch { self.error = error.localizedDescription }
    }
  }
  @discardableResult func send(_ text: String, id: String? = nil) async -> Bool {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return true }
    while sending { do { try await Task.sleep(nanoseconds: 100_000_000) } catch { return false } }
    guard !Task.isCancelled else { return false }
    sending = true
    defer { sending = false }
    let pending: (text: String, id: String) =
      id.map { (text, $0) }
      ?? (pendingMessage?.text == text ? pendingMessage! : (text, UUID().uuidString.lowercased()))
    pendingMessage = pending
    do {
      try await ensureAssistant()
      try await command("message", args: ["text": .string(text)], id: pending.id)
      pendingMessage = nil
      error = ""
      if !replyAudioActive { status = voiceActive ? "Thinking…" : "Message sent" }
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
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
        if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-speaking") {
          setReplyActive(true)
          status = "Speaking…"
        }
        if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-transcript-test") {
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
      while !connected {
        guard voiceEpoch == attempt else { return }
        if Date() >= deadline { throw AssistantProtocolError.timedOut }
        try await Task.sleep(nanoseconds: 250_000_000)
      }
      try await refresh()
      spoken = Set(snapshot?.messages.map(\.id) ?? [])
      try await ensureAssistant()
      status = "Connecting to your Terminal workspace…"
      while snapshot?.nativeOnline != true || snapshot?.catalog == nil {
        guard voiceEpoch == attempt else { return }
        if Date() >= deadline { throw AssistantProtocolError.timedOut }
        try await Task.sleep(nanoseconds: 350_000_000)
        try await refresh()
      }
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
    transcriptParts = []
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
  }
  private func transcribe(_ data: Data, final: Bool) {
    guard voiceActive, !muted, !replyAudioActive else { return }
    cancelTranscriptionPreview()
    if final { hearingSpeech = false }
    transcribingSpeech = true
    voiceQueue.append((data, final))
    if voiceQueue.count >= 30 {
      audio.finishUtterance()
      muted = true
      audio.muted = true
      error =
        "The microphone is paused while your Mac catches up. Your recorded speech is retained."
    }
    guard transcribing == nil else { return }
    let epoch = voiceEpoch
    transcribing = Task { [weak self] in
      guard let self else { return }
      defer {
        if voiceEpoch == epoch {
          transcribing = nil
          transcribingSpeech = false
          speakNext()
        }
      }
      status = "Transcribing…"
      while !voiceQueue.isEmpty, voiceEpoch == epoch, !Task.isCancelled {
        let (segment, final) = voiceQueue[0]
        do {
          if !segment.isEmpty {
            let result = try await connection.request(.transcribe, payload: segment)
            guard !Task.isCancelled, voiceEpoch == epoch else { return }
            let value = try JSONDecoder().decode([String: AssistantValue].self, from: result)
            if let text = value["text"]?.string,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            {
              transcriptParts.append(text)
              liveTranscript = transcriptParts.joined(separator: " ")
            }
          }
          voiceQueue.removeFirst()
          if final {
            let text = transcriptParts.joined(separator: " ")
            let id = UUID().uuidString.lowercased()
            while voiceEpoch == epoch, !Task.isCancelled {
              if await send(text, id: id) {
                transcriptParts = []
                liveTranscript = ""
                break
              }
              if !replyAudioActive { status = "Reconnecting to your Mac…" }
              try await Task.sleep(nanoseconds: 2_000_000_000)
            }
          }
        } catch {
          guard !Task.isCancelled, voiceEpoch == epoch else { return }
          if !replyAudioActive { status = "Waiting for local transcription…" }
          try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
      }
      if voiceEpoch == epoch, !replyAudioActive {
        status = muted ? "Microphone muted" : "Listening…"
      }
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
    transcriptionPreview = Task { [weak self] in
      guard let self else { return }
      defer { if previewEpoch == epoch { transcriptionPreview = nil } }
      do {
        let data = try await connection.request(.transcribe, payload: data)
        guard !Task.isCancelled, voiceEpoch == call, previewEpoch == epoch,
          voiceActive, !replyAudioActive else { return }
        let result = try JSONDecoder().decode([String: AssistantValue].self, from: data)
        if let text = result["text"]?.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
          liveTranscript = (transcriptParts + [text]).joined(separator: " ")
        }
      } catch { /* The authoritative final transcription retains its normal retry. */ }
    }
  }
  private func speakNext() {
    guard voiceActive, speech == nil, !speechQueue.isEmpty,
      !hearingSpeech, !transcribingSpeech else { return }
    setReplyActive(true)
    status = "Preparing reply…"
    let message = speechQueue.removeFirst()
    let identity = message.id.split(separator: ":", maxSplits: 2)
    activeReplyRequest = identity.count == 3 && identity[0] == "assistant"
      && UUID(uuidString: String(identity[1])) != nil ? String(identity[1]) : nil
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
  @State private var draft = ""
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
                ForEach(controller.snapshot?.messages ?? []) { message in
                  VStack(alignment: .leading, spacing: 5) {
                    Text(message.role == "user" ? "You" : "Assistant").font(.caption.bold())
                      .foregroundStyle(ClawDadTheme.gold)
                    Text(message.text).textSelection(.enabled)
                  }.frame(maxWidth: .infinity, alignment: .leading).id(message.id)
                }
                if controller.hearingSpeech || controller.transcribingSpeech || !controller.liveTranscript.isEmpty {
                  VStack(alignment: .leading, spacing: 5) {
                    Text(controller.hearingSpeech ? "You · Speaking" : "You · Transcribing…")
                      .font(.caption.bold()).foregroundStyle(ClawDadTheme.gold)
                    Text(controller.liveTranscript.isEmpty ? "Listening…" : controller.liveTranscript)
                      .textSelection(.enabled)
                  }.frame(maxWidth: .infinity, alignment: .leading)
                    .id("live-transcript")
                    .accessibilityIdentifier("clawdad.assistant.transcript")
                }
                ForEach((controller.snapshot?.tasks ?? []).filter { $0.action == "terminal.send" })
                { task in
                  VStack(alignment: .leading, spacing: 6) {
                    Text("\(task.tabTitle ?? "Terminal task") · \(task.status)").font(
                      .subheadline.bold())
                    Text(task.args["text"]?.string ?? "").font(.footnote).textSelection(.enabled)
                    if let error = task.error {
                      Text(error).foregroundStyle(ClawDadTheme.gold).font(.footnote)
                    }
                    HStack {
                      if let tab = task.args["tabId"]?.string {
                        Button("Watch in Terminal") {
                          controller.watch(tabId: tab, onWatch: onWatch)
                        }
                      }
                      if task.status == "queued" {
                        Button("Cancel") {
                          controller.perform("cancel", args: ["jobId": .string(task.id)])
                        }
                      }
                    }.font(.footnote)
                  }.padding(12).background(
                    ClawDadTheme.cream.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
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
            Button(controller.status == "Microphone unavailable" ? "Retry microphone" : "Retry connection") { Task { await controller.startVoice() } }.font(.footnote)
              .disabled(controller.startingVoice)
          }
        }
        HStack(alignment: .bottom) {
          TextField("Message Assistant", text: $draft, axis: .vertical).lineLimit(1...5)
            .textFieldStyle(.plain).padding(12).background(
              ClawDadTheme.cream.opacity(0.08), in: RoundedRectangle(cornerRadius: 12)
            ).accessibilityIdentifier("clawdad.assistant.composer")
          Button {
            let text = draft
            Task { if await controller.send(text), draft == text { draft = "" } }
          } label: {
            Image(systemName: "arrow.up.circle.fill").font(.system(size: 32))
          }.disabled(
            !controller.connected || controller.sending
              || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          ).accessibilityLabel("Send to Assistant")
        }.padding(.horizontal)
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
