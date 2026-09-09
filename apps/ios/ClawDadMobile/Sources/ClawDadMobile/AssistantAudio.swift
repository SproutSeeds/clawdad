import AVFoundation
import ClawDadRemoteAssistProtocol
import Foundation

@MainActor
protocol AssistantAudioIO: AnyObject {
  var onUtterance: ((Data, Bool) -> Void)? { get set }
  var onSpeechStarted: (() -> Void)? { get set }
  var onTranscriptPreview: ((Data) -> Void)? { get set }
  var onReplaced: (() -> Void)? { get set }
  var onInputLevel: ((Float) -> Void)? { get set }
  var onCaptureRecovery: ((Bool) -> Void)? { get set }
  var onCaptureFailure: ((Error) -> Void)? { get set }
  var onPlaybackStarted: (() -> Void)? { get set }
  var muted: Bool { get set }
  var lastSpeechAt: TimeInterval? { get }
  func start() async throws
  /// Stop hardware capture synchronously. Optionally finish only samples that
  /// were captured before this call, delivering them before returning.
  func muteCapture(finishingUtterance: Bool) throws
  func unmuteCapture() async throws
  func setReplyActive(_ active: Bool)
  func play(_ data: Data) async throws
  func stopPlayback()
  func resetUtterance()
  func finishUtterance()
  func previewUtterance()
  func stop()
}

extension AssistantAudioIO {
  var lastSpeechAt: TimeInterval? { nil }
  var onPlaybackStarted: (() -> Void)? { get { nil } set {} }
  func muteCapture() throws { try muteCapture(finishingUtterance: false) }
  func unmuteCapture() async throws { muted = false; resetUtterance() }
  func previewUtterance() {}
}

@MainActor
final class AssistantAudio: AssistantAudioIO {
  var lastSpeechAt: TimeInterval? { input.lastSpeechAt }
  var onUtterance: ((Data, Bool) -> Void)?
  var onSpeechStarted: (() -> Void)?
  var onTranscriptPreview: ((Data) -> Void)?
  var onReplaced: (() -> Void)?
  var onInputLevel: ((Float) -> Void)?
  var onCaptureRecovery: ((Bool) -> Void)?
  var onCaptureFailure: ((Error) -> Void)?
  var onPlaybackStarted: (() -> Void)?
  private var boundary = AssistantCaptureBoundary()
  private var captureChange = UUID()
  private var replyActive = false
  private var microphone = AssistantMicrophoneState()
  var muted: Bool {
    get { microphone.muted }
    set { microphone.muted = newValue; input.muted = newValue }
  }
  private var engine = AVAudioEngine()
  private let replyAudio = AssistantReplyAudio()
  private var captureMonitor: Task<Void, Never>?
  private var recovery = AssistantCaptureRecovery()
  private let diagnostics = AssistantAudioDiagnostics.deviceLog()
  private var lastMeterAt: TimeInterval = 0
  private var input = AssistantListeningInput(sampleRate: 48000)
  private var owner: UUID?
  private var generation = UUID()
  private var tapInstalled = false
  private var inputMailbox: AssistantInputMailbox?
  private var startAttempt = UUID()
  private var interruptionObserver: NSObjectProtocol?
  private var routeObserver: NSObjectProtocol?

  init() {
    replyAudio.onStarted = { [weak self] in self?.onPlaybackStarted?() }
    #if os(iOS)
      interruptionObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
      ) { [weak self] notification in
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          AVAudioSession.InterruptionType(rawValue: raw) == .began
        else { return }
        Task { @MainActor [weak self] in
          guard let self, owner != nil else { return }
          diagnostics.record(.interrupted)
          try? muteCapture()
          stopPlayback()
          onCaptureFailure?(AssistantMicrophoneError.interrupted)
        }
      }
      routeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          guard let self, owner != nil else { return }
          diagnostics.record(.routeChanged)
        }
      }
    #endif
  }

  func start() async throws {
    guard owner == nil else { return }
    let attempt = UUID()
    startAttempt = attempt
    let granted = await withCheckedContinuation { continuation in
      AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
    }
    guard startAttempt == attempt else { throw CancellationError() }
    guard granted else { throw VoiceRecorderError.couldNotStart }
    owner = try MobileAudioSession.shared.beginConversation { [weak self] in
      self?.stop()
      self?.onReplaced?()
    }
    do {
      // A new call starts unmuted even if the previous call ended while muted.
      microphone.begin(at: ProcessInfo.processInfo.systemUptime)
      input = AssistantListeningInput(sampleRate: 48000)
      boundary.move(to: .off, at: ProcessInfo.processInfo.systemUptime)
      recovery = AssistantCaptureRecovery()
      for retry in 0..<2 {
        do {
          try configureCapture()
          try await waitForInput(attempt: attempt)
          break
        } catch {
          guard startAttempt == attempt, owner != nil else { throw CancellationError() }
          guard retry == 0 else { throw error }
          tearDownEngine()
          if let owner { try MobileAudioSession.shared.reactivateConversation(owner) }
        }
      }
      monitorCapture(attempt: attempt)
      boundary.move(to: .conversation, at: ProcessInfo.processInfo.systemUptime)
      diagnostics.record(.started)
    } catch {
      if startAttempt == attempt { stop() }
      throw error
    }
  }
  private func configureCapture() throws {
    engine = AVAudioEngine()
    try engine.inputNode.setVoiceProcessingEnabled(true)
    engine.inputNode.isVoiceProcessingInputMuted = false
    engine.inputNode.isVoiceProcessingAGCEnabled = true
    let format = engine.inputNode.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0
    else { throw VoiceRecorderError.couldNotStart }
    let sampleRate = format.sampleRate
    input.configure(sampleRate: sampleRate)
    let wasMuted = muted
    microphone.begin(at: ProcessInfo.processInfo.systemUptime)
    muted = wasMuted
    // VoiceProcessingIO requires matching input/output client formats. The
    // implicit mixer output can retain a stale stereo/44.1 kHz device format.
    engine.connect(engine.mainMixerNode, to: engine.outputNode, format: format)
    let generation = UUID()
    self.generation = generation
    let mailbox = AssistantInputMailbox()
    inputMailbox = mailbox
    engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format,
      block: assistantInputTap(mailbox: mailbox) { [weak self] values, capturedAt in
        guard let self, self.generation == generation, owner != nil else { return }
        receiveInput(values, capturedAt: capturedAt, sampleRate: sampleRate)
      })
    tapInstalled = true
    engine.prepare()
    try engine.start()
  }
  private func receiveInput(_ values: [Float], capturedAt: TimeInterval, sampleRate: Double) {
    let time = ProcessInfo.processInfo.systemUptime
    microphone.receivedBuffer(at: time)
    guard boundary.route(capturedAt: capturedAt) == .conversation else { return }
    if time - lastMeterAt >= 0.1 {
      lastMeterAt = time
      let rms = sqrt(values.reduce(0.0) { $0 + ($1.isFinite ? Double($1) * Double($1) : 0) } / Double(values.count))
      onInputLevel?(input.acceptsInput(capturedAt: capturedAt)
        ? Float(max(0, min(1, (20 * log10(max(rms, 0.000_001)) + 60) / 35))) : 0)
    }
    let event = input.consume(values, capturedAt: capturedAt)
    if event.started { onSpeechStarted?() }
    if let samples = event.utterance {
      onUtterance?(assistantWAV(samples, sampleRate: sampleRate), event.final)
    } else if event.final {
      onUtterance?(Data(), true)
    }
    if let preview = event.preview {
      onTranscriptPreview?(assistantWAV(preview, sampleRate: sampleRate))
    }
  }
  private func waitForInput(attempt: UUID) async throws {
    let deadline = ProcessInfo.processInfo.systemUptime + 4
    while !microphone.receiving(at: ProcessInfo.processInfo.systemUptime) {
      try Task.checkCancellation()
      guard startAttempt == attempt, owner != nil else { throw CancellationError() }
      guard ProcessInfo.processInfo.systemUptime < deadline else { throw AssistantMicrophoneError.noInput }
      try await Task.sleep(nanoseconds: 50_000_000)
    }
  }
  private func monitorCapture(attempt: UUID) {
    captureMonitor?.cancel()
    captureMonitor = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(nanoseconds: 500_000_000) } catch { return }
        guard let self, startAttempt == attempt, let owner else { return }
        guard boundary.mode != .off else { continue }
        guard microphone.needsRecovery(at: ProcessInfo.processInfo.systemUptime,
          engineRunning: engine.isRunning) else {
          recovery.healthy(at: ProcessInfo.processInfo.systemUptime)
          continue
        }
        // Hardware route changes can stop AVAudioEngine without throwing.
        // Retain recognized speech, rebuild the graph, and bound automatic retries.
        onCaptureRecovery?(true)
        diagnostics.record(.recoveryStarted)
        finishUtterance()
        tearDownEngine()
        do {
          guard recovery.begin() else { throw AssistantMicrophoneError.noInput }
          try MobileAudioSession.shared.reactivateConversation(owner)
          try configureCapture()
          try await waitForInput(attempt: attempt)
          onCaptureRecovery?(false)
          diagnostics.record(.recovered)
        } catch {
          guard startAttempt == attempt, !Task.isCancelled, boundary.mode != .off else { return }
          try? muteCapture()
          diagnostics.record(.captureFailed)
          onCaptureFailure?(error)
          return
        }
      }
    }
  }
  func play(_ data: Data) async throws {
    guard owner != nil else { throw CancellationError() }
    try await replyAudio.play(data)
  }
  func stopPlayback() { replyAudio.stop() }
  func setReplyActive(_ active: Bool) {
    replyActive = active
    input.setReplyActive(active, at: ProcessInfo.processInfo.systemUptime)
    onInputLevel?(0)
  }
  func resetUtterance() { input.reset() }
  func finishUtterance() {
    if let samples = input.finish() {
      onUtterance?(assistantWAV(samples, sampleRate: input.sampleRate), true)
    }
  }
  func previewUtterance() {
    if let samples = input.preview() {
      onTranscriptPreview?(assistantWAV(samples, sampleRate: input.sampleRate))
    }
  }
  func stop() {
    if owner != nil { diagnostics.record(.stopped) }
    captureChange = UUID()
    boundary.move(to: .off, at: ProcessInfo.processInfo.systemUptime)
    startAttempt = UUID()
    captureMonitor?.cancel()
    captureMonitor = nil
    stopPlayback()
    tearDownEngine()
    if let owner {
      self.owner = nil
      MobileAudioSession.shared.release(owner)
    }
    microphone.end()
    onInputLevel?(0)
    input = AssistantListeningInput(sampleRate: 48000)
  }
  private func tearDownEngine() {
    _ = inputMailbox?.close()
    inputMailbox = nil
    generation = UUID()
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    engine.stop()
  }

  func muteCapture(finishingUtterance: Bool) throws {
    let cutoff = ProcessInfo.processInfo.systemUptime
    captureChange = UUID()
    // Close the audio-thread mailbox first. Its bounded pre-tap samples are
    // drained synchronously; queued actor callbacks cannot deliver them twice.
    // A new graph gets a fresh mailbox on unmute, excluding all private audio.
    let pending = inputMailbox?.close(before: finishingUtterance ? cutoff : nil) ?? []
    captureMonitor?.cancel()
    captureMonitor = nil
    tearDownEngine()
    if finishingUtterance && !muted {
      for packet in pending {
        receiveInput(packet.values, capturedAt: packet.capturedAt, sampleRate: packet.sampleRate)
      }
      finishUtterance()
    }
    boundary.move(to: .off, at: cutoff)
    microphone.end()
    muted = true
    input.reset()
    onInputLevel?(0)
    if let owner { try MobileAudioSession.shared.suspendConversationMicrophone(owner) }
    diagnostics.record(.muted)
  }

  func unmuteCapture() async throws {
    guard let owner else { throw CancellationError() }
    let change = UUID()
    captureChange = change
    // Keep the previous private route until a fresh capture graph is ready.
    do {
      if !engine.isRunning {
        try MobileAudioSession.shared.reactivateConversation(owner)
        try configureCapture()
        try await waitForInput(attempt: startAttempt)
      }
      guard captureChange == change else { throw CancellationError() }
      input.reset()
      boundary.move(to: .conversation, at: ProcessInfo.processInfo.systemUptime)
      muted = false
      recovery = AssistantCaptureRecovery()
      monitorCapture(attempt: startAttempt)
      diagnostics.record(.unmuted)
    } catch {
      if captureChange == change { try? muteCapture() }
      throw error
    }
  }
}

// AVAudioNodeTapBlock is not annotated Sendable by AVFAudio. Creating it in an
// @MainActor method gives it UI-actor isolation and traps on the audio thread
// in Swift 6. Copy samples here, then explicitly deliver them to the UI actor.
nonisolated func assistantInputTap(
  mailbox: AssistantInputMailbox = AssistantInputMailbox(),
  receive: @escaping @MainActor @Sendable ([Float], TimeInterval) -> Void
) -> @Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void {
  return { buffer, when in
    guard buffer.frameLength > 0, let channel = buffer.floatChannelData?[0] else { return }
    // Fence by the first sample, not callback delivery time. A buffer spanning
    // an unmute boundary must be discarded in full, including its private tail.
    let beganAt = ProcessInfo.processInfo.systemUptime - Double(buffer.frameLength) / buffer.format.sampleRate
    let capturedAt = when.isHostTimeValid && when.hostTime > 0
      ? min(beganAt, AVAudioTime.seconds(forHostTime: when.hostTime)) : beganAt
    guard mailbox.append(capturedAt: capturedAt, sampleRate: buffer.format.sampleRate,
      samples: { (0..<Int(buffer.frameLength)).map { channel[$0 * buffer.stride] } }) else { return }
    Task { @MainActor in
      for packet in mailbox.drain() { receive(packet.values, packet.capturedAt) }
    }
  }
}

/// Bound transient audio-thread handoff even while the UI actor is stalled.
/// Own only the transient samples waiting for the UI actor. Closing atomically
/// removes them and rejects future capture before even copying the samples.
final class AssistantInputMailbox: @unchecked Sendable {
  struct Packet: Sendable {
    let values: [Float]
    let capturedAt: TimeInterval
    let sampleRate: Double
  }
  private let lock = NSLock()
  private var pending: [Packet] = []
  private var closed = false
  func append(capturedAt: TimeInterval, sampleRate: Double, samples: () -> [Float]) -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard !closed, pending.count < 4 else { return false }
    pending.append(Packet(values: samples(), capturedAt: capturedAt, sampleRate: sampleRate))
    return true
  }
  func drain() -> [Packet] {
    lock.lock(); defer { lock.unlock() }
    let packets = pending
    pending.removeAll(keepingCapacity: true)
    return packets
  }
  func close(before cutoff: TimeInterval? = nil) -> [Packet] {
    lock.lock(); defer { lock.unlock() }
    closed = true
    let packets = pending
    pending.removeAll()
    guard let cutoff else { return [] }
    return packets.compactMap { packet in
      guard packet.capturedAt < cutoff, packet.sampleRate > 0 else { return nil }
      let count = Int(min(Double(packet.values.count), ((cutoff - packet.capturedAt) * packet.sampleRate).rounded(.down)))
      guard count > 0 else { return nil }
      return Packet(values: Array(packet.values.prefix(count)), capturedAt: packet.capturedAt, sampleRate: packet.sampleRate)
    }
  }
}

nonisolated func assistantPlaybackCompletion(
  finish: @escaping @MainActor @Sendable () -> Void
) -> @Sendable (AVAudioPlayerNodeCompletionCallbackType) -> Void {
  { _ in Task { @MainActor in finish() } }
}

enum AssistantMicrophoneError: LocalizedError {
  case noInput, interrupted
  var errorDescription: String? {
    switch self {
    case .noInput: "ClawDad couldn't receive microphone audio. Check your audio connection, then tap the microphone button to retry."
    case .interrupted: "Audio was interrupted. The microphone is off; tap the microphone button when ready."
    }
  }
}

func assistantPlaybackBuffer(_ data: Data, format: AVAudioFormat) throws -> AVAudioPCMBuffer {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("assistant-\(UUID().uuidString).wav")
  try data.write(to: url, options: .atomic)
  defer { try? FileManager.default.removeItem(at: url) }
  let file = try AVAudioFile(forReading: url)
  guard file.length > 0, file.length < 10_000_000,
    let input = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))
  else { throw AssistantProtocolError.invalid }
  try file.read(into: input)
  if input.format == format { return input }
  let frames = ceil(Double(input.frameLength) * format.sampleRate / input.format.sampleRate) + 32
  guard frames > 0, frames < 10_000_000,
    let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)),
    let converter = AVAudioConverter(from: input.format, to: format)
  else { throw AssistantProtocolError.invalid }
  let source = AssistantConversionInput(input)
  var error: NSError?
  let result = converter.convert(to: output, error: &error) { _, status in
    source.take(status: status)
  }
  if let error { throw error }
  guard result != .error, output.frameLength > 0 else { throw AssistantProtocolError.invalid }
  return output
}

/// Supplies one immutable buffer. The lock protects transfer through the
/// converter's Sendable callback; no audio buffer is mutated after publication.
private final class AssistantConversionInput: @unchecked Sendable {
  private let lock = NSLock()
  private var buffer: AVAudioPCMBuffer?
  init(_ buffer: AVAudioPCMBuffer) { self.buffer = buffer }
  func take(status: UnsafeMutablePointer<AVAudioConverterInputStatus>) -> AVAudioBuffer? {
    lock.lock()
    defer { lock.unlock() }
    guard let buffer else { status.pointee = .endOfStream; return nil }
    self.buffer = nil
    status.pointee = .haveData
    return buffer
  }
}
