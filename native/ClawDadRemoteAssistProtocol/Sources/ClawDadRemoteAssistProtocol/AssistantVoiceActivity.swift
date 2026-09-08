import Foundation

/// Energy-based endpoint detection runs on the device; STT remains on the Mac.
/// Keep pre-roll, require sustained speech, and bound each upload to 18 seconds.
public struct AssistantVoiceActivity: Sendable {
  public var sampleRate: Double
  public private(set) var speaking = false
  private var samples: [Float] = []
  private var preRoll: [Float] = []
  private var silence: Double = 0
  private var voiced: Double = 0
  private var onset: Double = 0
  private var onsetGap: Double = 0
  private var noiseFloor: Double = 0.0006
  private var segmented = false
  public init(sampleRate: Double) { self.sampleRate = sampleRate }
  /// A provisional transcription must leave endpoint detection and the final
  /// recording intact. Callers throttle previews and replace them with final STT.
  public var pendingSpeech: [Float]? { speaking && voiced >= 0.18 ? samples : nil }
  public mutating func reset() {
    speaking = false
    samples = []
    preRoll = []
    silence = 0
    voiced = 0
    onset = 0
    onsetGap = 0
    segmented = false
  }
  public mutating func finish() -> [Float]? {
    let result = voiced >= 0.18 || (segmented && !samples.isEmpty) ? samples : (segmented ? [] : nil)
    reset()
    return result
  }
  public mutating func consume(_ values: [Float]) -> (
    started: Bool, utterance: [Float]?, final: Bool
  ) {
    guard sampleRate.isFinite, sampleRate > 0, !values.isEmpty else { return (false, nil, false) }
    let energy = sqrt(values.reduce(0.0) {
      let value = $1.isFinite ? Double($1) : 0
      return $0 + value * value
    } / Double(values.count))
    let duration = Double(values.count) / sampleRate
    // Voice processing and normal microphone distance can put speech well below
    // the former fixed -38 dB gate. Track quiet input without learning speech
    // as room noise, and retain a floor that rejects low ambient hiss.
    let threshold = max(0.0005, min(0.012, noiseFloor * 2.5))
    let loud = energy > threshold
    var started = false
    if !speaking {
      preRoll.append(contentsOf: values)
      let limit = Int(sampleRate * 0.3)
      if preRoll.count > limit { preRoll.removeFirst(preRoll.count - limit) }
      if loud {
        onset += duration
        onsetGap = 0
      } else {
        noiseFloor += (energy - noiseFloor) * min(1, duration / 0.5)
        onsetGap += duration
        // Brief unvoiced consonants and syllable gaps are part of a sentence.
        if onsetGap >= 0.1 { onset = 0 }
      }
      if onset >= 0.12 {
        speaking = true
        started = true
        samples = preRoll
        preRoll = []
        voiced = onset
        silence = 0
      }
    } else {
      samples.append(contentsOf: values)
      if loud {
        voiced += duration
        silence = 0
      } else {
        silence += duration
      }
      if silence >= 0.8 {
        let utterance = voiced >= 0.18 || (segmented && !samples.isEmpty) ? samples : (segmented ? [] : nil)
        reset()
        return (started, utterance, true)
      }
      if Double(samples.count) / sampleRate >= 18 {
        let segment = samples
        samples = []
        voiced = 0
        segmented = true
        return (started, segment, false)
      }
    }
    return (started, nil, false)
  }
}

public func assistantWAV(_ samples: [Float], sampleRate: Double) -> Data {
  // Resample the processed microphone stream to the existing local STT input.
  guard sampleRate.isFinite, sampleRate > 0, !samples.isEmpty else { return Data() }
  let rate = 16000.0
  let count = Int(Double(samples.count) * rate / sampleRate)
  guard count > 0, count <= 320_000 else { return Data() }
  var pcm = Data(capacity: count * 2)
  for i in 0..<count {
    let position = Double(i) * sampleRate / rate
    let left = min(samples.count - 1, Int(position))
    let right = min(samples.count - 1, left + 1)
    let fraction = Float(position - Double(left))
    let interpolated = samples[left] * (1 - fraction) + samples[right] * fraction
    let value = interpolated.isFinite ? interpolated : 0
    var sample = Int16(max(-1, min(1, value)) * 32767).littleEndian
    withUnsafeBytes(of: &sample) { pcm.append(contentsOf: $0) }
  }
  var data = Data()
  func word<T: FixedWidthInteger>(_ value: T) {
    var little = value.littleEndian
    withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
  }
  data.append(Data("RIFF".utf8))
  word(UInt32(36 + pcm.count))
  data.append(Data("WAVEfmt ".utf8))
  word(UInt32(16))
  word(UInt16(1))
  word(UInt16(1))
  word(UInt32(16000))
  word(UInt32(32000))
  word(UInt16(2))
  word(UInt16(16))
  data.append(Data("data".utf8))
  word(UInt32(pcm.count))
  data.append(pcm)
  return data
}
