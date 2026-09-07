import AVFoundation
import ClawDadRemoteAssistProtocol
import Foundation

@MainActor
final class AssistantAudio {
  var onUtterance: ((Data, Bool) -> Void)?
  var onSpeechStarted: (() -> Void)?
  var onReplaced: (() -> Void)?
  var muted = false
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var detector = AssistantVoiceActivity(sampleRate: 48000)
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
      try engine.inputNode.setVoiceProcessingEnabled(true)
      let format = engine.inputNode.outputFormat(forBus: 0)
      guard format.sampleRate > 0, format.channelCount > 0 else {
        throw VoiceRecorderError.couldNotStart
      }
      detector = AssistantVoiceActivity(sampleRate: format.sampleRate)
      engine.attach(player)
      engine.connect(player, to: engine.mainMixerNode, format: nil)
      let generation = UUID()
      self.generation = generation
      engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) {
        [weak self] buffer, _ in
        guard let channel = buffer.floatChannelData?[0] else { return }
        let values = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
        Task { @MainActor [weak self] in
          guard let self, self.generation == generation, !muted else { return }
          let event = detector.consume(values)
          if event.started { onSpeechStarted?() }
          if let samples = event.utterance {
            onUtterance?(assistantWAV(samples, sampleRate: format.sampleRate), event.final)
          }
        }
      }
      tapInstalled = true
      engine.prepare()
      try engine.start()
    } catch {
      stop()
      throw error
    }
  }
  func play(_ data: Data) async throws {
    guard owner != nil else { throw CancellationError() }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "assistant-\(UUID().uuidString).wav")
    try data.write(to: url, options: .atomic)
    defer { try? FileManager.default.removeItem(at: url) }
    let file = try AVAudioFile(forReading: url)
    guard file.length > 0, file.length < 10_000_000,
      let buffer = AVAudioPCMBuffer(
        pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))
    else { throw AssistantProtocolError.invalid }
    try file.read(into: buffer)
    stopPlayback()
    let playbackGeneration = UUID()
    self.playbackGeneration = playbackGeneration
    engine.disconnectNodeOutput(player)
    engine.connect(player, to: engine.mainMixerNode, format: buffer.format)
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        playing = continuation
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
          Task { @MainActor [weak self] in
            guard let self, self.playbackGeneration == playbackGeneration else { return }
            let done = playing
            playing = nil
            done?.resume()
          }
        }
        player.play()
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
  func resetUtterance() { detector.reset() }
  func finishUtterance() {
    if let samples = detector.finish() {
      onUtterance?(assistantWAV(samples, sampleRate: detector.sampleRate), true)
    }
  }
  func stop() {
    startAttempt = UUID()
    generation = UUID()
    stopPlayback()
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    engine.stop()
    if engine.attachedNodes.contains(player) { engine.detach(player) }
    if let owner {
      self.owner = nil
      MobileAudioSession.shared.release(owner)
    }
    detector.reset()
  }
}
