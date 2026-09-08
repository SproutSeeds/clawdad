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
  private var microphone = AssistantMicrophoneState()
  var muted: Bool {
    get { microphone.muted }
    set { microphone.muted = newValue; input.muted = newValue }
  }
  private var engine = AVAudioEngine()
  private var player = AVAudioPlayerNode()
  private var playbackFormat: AVAudioFormat?
  private var captureMonitor: Task<Void, Never>?
  private var recoveryAttempts = 0
  private var lastMeterAt: TimeInterval = 0
  private var input = AssistantListeningInput(sampleRate: 48000)
  private var owner: UUID?
  private var generation = UUID()
  private var playing: CheckedContinuation<Void, Error>?
  private var playbackGeneration = UUID()
  private var tapInstalled = false
  private var startAttempt = UUID()
  private var interruptionObserver: NSObjectProtocol?

  init() {
    #if os(iOS)
      interruptionObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
      ) { [weak self] notification in
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          AVAudioSession.InterruptionType(rawValue: raw) == .began
        else { return }
        Task { @MainActor [weak self] in
          guard let self, owner != nil else { return }
          stop()
          onReplaced?()
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
      recoveryAttempts = 0
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
    } catch {
      stop()
      throw error
    }
  }
  private func configureCapture() throws {
    engine = AVAudioEngine()
    player = AVAudioPlayerNode()
    try engine.inputNode.setVoiceProcessingEnabled(true)
    engine.inputNode.isVoiceProcessingInputMuted = false
    engine.inputNode.isVoiceProcessingAGCEnabled = true
    let format = engine.inputNode.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0,
      let playbackFormat = AVAudioFormat(standardFormatWithSampleRate: format.sampleRate, channels: 1)
    else { throw VoiceRecorderError.couldNotStart }
    self.playbackFormat = playbackFormat
    let sampleRate = format.sampleRate
    input.configure(sampleRate: sampleRate)
    let wasMuted = muted
    microphone.begin(at: ProcessInfo.processInfo.systemUptime)
    muted = wasMuted
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: playbackFormat)
    // VoiceProcessingIO requires matching input/output client formats. The
    // implicit mixer output can retain a stale stereo/44.1 kHz device format.
    engine.connect(engine.mainMixerNode, to: engine.outputNode, format: format)
    let generation = UUID()
    self.generation = generation
    engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format,
      block: assistantInputTap { [weak self] values, capturedAt in
        guard let self, self.generation == generation, owner != nil else { return }
        let time = ProcessInfo.processInfo.systemUptime
        microphone.receivedBuffer(at: time)
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
      })
    tapInstalled = true
    engine.prepare()
    try engine.start()
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
        guard microphone.needsRecovery(at: ProcessInfo.processInfo.systemUptime,
          engineRunning: engine.isRunning) else { continue }
        // Hardware route changes can stop AVAudioEngine without throwing.
        // Retain recognized speech, rebuild the graph, and bound automatic retries.
        onCaptureRecovery?(true)
        finishUtterance()
        tearDownEngine()
        do {
          guard recoveryAttempts < 2 else { throw AssistantMicrophoneError.noInput }
          recoveryAttempts += 1
          try MobileAudioSession.shared.reactivateConversation(owner)
          try configureCapture()
          try await waitForInput(attempt: attempt)
          onCaptureRecovery?(false)
        } catch {
          guard startAttempt == attempt else { return }
          stop()
          onCaptureFailure?(error)
          return
        }
      }
    }
  }
  func play(_ data: Data) async throws {
    guard owner != nil, let playbackFormat else { throw CancellationError() }
    let buffer = try assistantPlaybackBuffer(data, format: playbackFormat)
    stopPlayback()
    let playbackGeneration = UUID()
    self.playbackGeneration = playbackGeneration
    // Convert each clip into the established call format. Reconnecting this
    // graph per TTS clip can stop microphone capture during the conversation.
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        playing = continuation
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack,
          completionHandler: assistantPlaybackCompletion { [weak self] in
            guard let self, self.playbackGeneration == playbackGeneration else { return }
            let done = playing
            playing = nil
            done?.resume()
          })
        player.play()
        onPlaybackStarted?()
      }
    } onCancel: {
      Task { @MainActor [weak self] in
        guard let self, self.playbackGeneration == playbackGeneration else { return }
        self.stopPlayback()
      }
    }
  }
  func stopPlayback() {
    playbackGeneration = UUID()
    let done = playing
    playing = nil
    player.stop()
    done?.resume(throwing: CancellationError())
  }
  func setReplyActive(_ active: Bool) {
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
    startAttempt = UUID()
    captureMonitor?.cancel()
    captureMonitor = nil
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
    generation = UUID()
    stopPlayback()
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    engine.stop()
    if engine.attachedNodes.contains(player) { engine.detach(player) }
    playbackFormat = nil
  }
}

// AVAudioNodeTapBlock is not annotated Sendable by AVFAudio. Creating it in an
// @MainActor method gives it UI-actor isolation and traps on the audio thread
// in Swift 6. Copy samples here, then explicitly deliver them to the UI actor.
nonisolated func assistantInputTap(
  receive: @escaping @MainActor @Sendable ([Float], TimeInterval) -> Void
) -> @Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void {
  { buffer, _ in
    guard buffer.frameLength > 0, let channel = buffer.floatChannelData?[0] else { return }
    let capturedAt = ProcessInfo.processInfo.systemUptime
    let values = (0..<Int(buffer.frameLength)).map { channel[$0 * buffer.stride] }
    Task { @MainActor in receive(values, capturedAt) }
  }
}

nonisolated func assistantPlaybackCompletion(
  finish: @escaping @MainActor @Sendable () -> Void
) -> @Sendable (AVAudioPlayerNodeCompletionCallbackType) -> Void {
  { _ in Task { @MainActor in finish() } }
}

enum AssistantMicrophoneError: LocalizedError {
  case noInput
  var errorDescription: String? {
    "ClawDad couldn't receive audio from the iPhone microphone. Tap Retry microphone to try again."
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
