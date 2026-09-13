import AVFoundation
import Combine
import Foundation

/// PCM output only. AVAudioEngine never connects an input node here.
@MainActor
final class SpeechOutputPlayer {
  var onCompletion: ((Bool) -> Void)?
  private let bus: SpeechOutputBus
  private let state: SpeechRenderState
  private var observer: AnyCancellable?
  private var timer: Task<Void, Never>?
  var duration: TimeInterval { Double(state.count) / state.rate }
  var currentTime: TimeInterval {
    get { state.position }
    set { state.seek(newValue) }
  }
  var volume: Float = 1 { didSet { state.setVolume(Double(volume)) } }

  convenience init(data: Data, preference: SpeechOutputPreference = .shared) throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("speech-decode-\(UUID().uuidString).audio")
    try data.write(to: url, options: .atomic)
    defer { try? FileManager.default.removeItem(at: url) }
    try self.init(contentsOf: url, preference: preference)
  }
  init(contentsOf url: URL, preference: SpeechOutputPreference = .shared) throws {
    let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
    guard file.length > 0, file.length <= 32_000_000, (1...2).contains(file.processingFormat.channelCount),
      (8_000...192_000).contains(file.processingFormat.sampleRate),
      let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else { throw SpeechPlayerError.unsupported }
    try file.read(into: buffer)
    guard let samples = buffer.floatChannelData else { throw SpeechPlayerError.unsupported }
    let count = Int(buffer.frameLength)
    state = SpeechRenderState(left: Array(UnsafeBufferPointer(start: samples[0], count: count)),
      right: file.processingFormat.channelCount == 2 ? Array(UnsafeBufferPointer(start: samples[1], count: count)) : nil,
      rate: file.processingFormat.sampleRate, boostDB: preference.boostDB)
    bus = SpeechOutputBus.forRate(state.rate)
    let renderState = state
    observer = preference.$boostDB.sink { renderState.setBoost($0) }
  }
  @discardableResult func prepareToPlay() -> Bool { bus.engine.prepare(); return true }
  @discardableResult func play() -> Bool {
    do {
      try bus.play(state)
      state.setPlaying(true)
      if timer == nil {
        timer = Task { @MainActor [weak self] in
          while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(10))
            guard !Task.isCancelled, let self else { return }
            if state.interrupted {
              timer = nil; onCompletion?(false); return
            }
            if state.finished {
              // Retain position at duration; only this player's callback fires.
              let drain = max(0.01, bus.source.outputPresentationLatency)
              try? await Task.sleep(for: .seconds(drain))
              guard !Task.isCancelled else { return }
              state.setPlaying(false); bus.release(state)
              let callback = onCompletion; timer = nil; callback?(true); return
            }
            if state.playing && !bus.engine.isRunning {
              state.setPlaying(false); timer = nil; onCompletion?(false); return
            }
          }
        }
      }
      return true
    } catch { return false }
  }
  func pause() { timer?.cancel(); timer = nil; state.setPlaying(false); bus.release(state) }
  func stop() {
    timer?.cancel(); timer = nil; state.setPlaying(false); bus.release(state); onCompletion = nil
  }
  deinit { timer?.cancel() }
}

private enum SpeechPlayerError: LocalizedError {
  case unsupported
  var errorDescription: String? { "This speech recording cannot be decoded for loudness processing. Its text and original recording are preserved." }
}

/// Render state is protected across the audio callback and main actor. No I/O,
/// allocation, UI dispatch or preference access occurs in the callback.
private final class SpeechRenderState: @unchecked Sendable {
  let left: [Float], right: [Float]?
  let rate: Double
  var count: Int { left.count }
  private let lock = NSLock()
  private var cursor = 0
  private var startFrame = 0
  private var processed = 0
  private var active = false
  private var superseded = false
  private var playbackEnvelope = 0.0
  private var boost: Double
  private var volume = 1.0
  private var dsp: SpeechOutputDSP
  init(left: [Float], right: [Float]?, rate: Double, boostDB: Double) {
    self.left = left; self.right = right; self.rate = rate; boost = boostDB
    dsp = SpeechOutputDSP(rate: rate, boostDB: boostDB)
  }
  var position: Double { lock.withLock { min(Double(count), Double(max(startFrame, cursor - dsp.latencyFrames))) / rate } }
  var finished: Bool { lock.withLock { processed >= count - startFrame + dsp.latencyFrames } }
  var playing: Bool { lock.withLock { active } }
  var interrupted: Bool { lock.withLock { superseded } }
  var fading: Bool { lock.withLock { playbackEnvelope > 0 && processed < count - startFrame + dsp.latencyFrames } }
  func interrupt() { lock.withLock { active = false; superseded = true } }
  func setPlaying(_ value: Bool) { lock.withLock { active = value; if value { superseded = false } } }
  var dynamics: SpeechOutputDSP.Dynamics { lock.withLock { dsp.dynamics } }
  func restoreDynamics(_ value: SpeechOutputDSP.Dynamics) { lock.withLock { dsp.restoreDynamics(value) } }
  func setBoost(_ value: Double) { lock.withLock { boost = value } }
  func setVolume(_ value: Double) { lock.withLock { volume = min(1, max(0, value)) } }
  func seek(_ value: Double) {
    guard value.isFinite, value >= 0, value <= Double(count) / rate else { return }
    lock.withLock {
      cursor = min(count, Int(value * rate)); startFrame = cursor; processed = 0
      dsp = SpeechOutputDSP(rate: rate, boostDB: boost)
    }
  }
  func render(_ frames: Int, buffers: UnsafeMutablePointer<AudioBufferList>) {
    lock.withLock {
      let output = UnsafeMutableAudioBufferListPointer(buffers)
      for i in 0..<frames {
        var pair = (0.0, 0.0)
        if (active || playbackEnvelope > 0) && processed < count - startFrame + dsp.latencyFrames {
          let a = cursor < count ? Double(left[cursor]) : 0
          let b = cursor < count ? Double(right?[cursor] ?? left[cursor]) : 0
          pair = dsp.process(a, b, boostDB: boost)
          let step = 1 / max(1, rate * 0.005)
          if active && processed >= dsp.latencyFrames { playbackEnvelope = min(1, playbackEnvelope + step) }
          else { playbackEnvelope = max(0, playbackEnvelope - step) }
          let tail = min(1, Double(count - startFrame + dsp.latencyFrames - processed) / max(1, rate * 0.005))
          pair = (pair.0 * playbackEnvelope * tail, pair.1 * playbackEnvelope * tail)
          cursor += 1; processed += 1
        }
        for channel in 0..<output.count {
          output[channel].mData?.assumingMemoryBound(to: Float.self)[i] = Float((channel == 0 ? pair.0 : pair.1) * volume)
        }
      }
    }
  }
}

/// Reuse the output engine for successive clips of the same voice/rate. This
/// avoids hardware startup between chunks. Idle output is released after 2 s.
@MainActor
private final class SpeechOutputBus {
  private static var cached: SpeechOutputBus?
  private static weak var activeBus: SpeechOutputBus?
  static func forRate(_ rate: Double) -> SpeechOutputBus {
    if let cached, cached.rate == rate { return cached }
    let bus = SpeechOutputBus(rate: rate); cached = bus; return bus
  }
  let rate: Double
  let engine = AVAudioEngine()
  let source: AVAudioSourceNode
  private let slot = SpeechRenderSlot()
  private var idle: Task<Void, Never>?
  init(rate: Double) {
    self.rate = rate
    let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
    source = AVAudioSourceNode(format: format, renderBlock: speechOutputRenderBlock(slot))
    engine.attach(source); engine.connect(source, to: engine.mainMixerNode, format: format)
  }
  func play(_ state: SpeechRenderState) throws {
    if let previous = Self.activeBus, previous !== self { previous.retire() }
    Self.activeBus = self
    idle?.cancel(); idle = nil
    if !slot.matches(state), let previous = slot.dynamics { state.restoreDynamics(previous) }
    slot.install(state)
    if !engine.isRunning { try engine.start() }
  }
  private func retire() {
    slot.install(nil)
    idle?.cancel()
    idle = Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(100))
      guard !Task.isCancelled else { return }
      engine.pause(); idle = nil
    }
  }
  func release(_ state: SpeechRenderState) {
    guard slot.matches(state) else { return }
    idle?.cancel()
    idle = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(2))
      guard !Task.isCancelled, let self, slot.matches(state), !state.playing else { return }
      engine.pause(); slot.install(nil); idle = nil
    }
  }
}
private final class SpeechRenderSlot: @unchecked Sendable {
  private let lock = NSLock()
  private var state: SpeechRenderState?
  private var departing: SpeechRenderState?
  func install(_ next: SpeechRenderState?) {
    lock.withLock {
      if let previous = state, previous !== next {
        previous.interrupt()
        if previous.fading { departing = previous }
      }
      state = next
    }
  }
  func matches(_ next: SpeechRenderState) -> Bool { lock.withLock { state === next } }
  var dynamics: SpeechOutputDSP.Dynamics? { lock.withLock { state?.dynamics } }
  func render(_ frames: Int, buffers: UnsafeMutablePointer<AudioBufferList>) {
    let (current, tail) = lock.withLock { (state, departing) }
    // Finish the old 5 ms fade before consuming the replacement's samples.
    if let tail {
      tail.render(frames, buffers: buffers)
      if !tail.fading { lock.withLock { if departing === tail { departing = nil } } }
      return
    }
    if let current { current.render(frames, buffers: buffers) }
    else { for buffer in UnsafeMutableAudioBufferListPointer(buffers) { if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) } } }
  }
}
private func speechOutputRenderBlock(_ slot: SpeechRenderSlot) -> AVAudioSourceNodeRenderBlock {
  { _, _, frames, buffers in
    slot.render(Int(frames), buffers: buffers)
    return noErr
  }
}
