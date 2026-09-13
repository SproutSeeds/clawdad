import Foundation

/// Speech output policy v1. Paired with web/speech-output-dsp.js.
/// Fixed user gain, no normalization. A linked stereo lookahead limiter uses
/// 4x windowed-sinc peak estimates, with 3 dB detector headroom. Microphone
/// samples never enter this processor. State survives render block boundaries.
final class SpeechOutputDSP {
  let rate: Double
  let lookahead: Int
  let latencyFrames: Int
  private let size: Int
  private var left: [Double]
  private var right: [Double]
  private var peaks: [Double]
  private var minimumValues: [Double]
  private var minimumIndices: [Int]
  private var minimumHead = 0
  private var minimumCount = 0
  private let coefficients: [[Double]]
  private var frame = 0
  private var gainDB: Double
  private var envelope = 0.0
  private var limiting = 1.0
  private(set) var maximumReductionDB = 0.0
  private(set) var limitedFrames = 0
  private let smooth: Double
  private let release: Double
  private let activityAttack: Double
  private let activityRelease: Double
  struct Dynamics { let gainDB: Double; let envelope: Double; let limiting: Double }
  var dynamics: Dynamics { Dynamics(gainDB: gainDB, envelope: envelope, limiting: limiting) }
  func restoreDynamics(_ value: Dynamics) { gainDB = value.gainDB; envelope = value.envelope; limiting = value.limiting }
  static let ceiling = pow(10.0, -3.0 / 20.0)

  init(rate: Double, boostDB: Double = 0) {
    self.rate = rate
    lookahead = max(1, Int(ceil(rate * 0.005)))
    latencyFrames = lookahead + 16
    size = latencyFrames + 32
    left = .init(repeating: 0, count: size)
    right = left; peaks = left; minimumValues = left
    minimumIndices = .init(repeating: 0, count: size)
    gainDB = boostDB.isFinite ? min(20, max(0, boostDB)) : 0
    smooth = 1 - exp(-1 / (rate * 0.050))
    release = 1 - exp(-1 / (rate * 0.150))
    activityAttack = 1 - exp(-1 / (rate * 0.005))
    activityRelease = 1 - exp(-1 / (rate * 0.100))
    coefficients = (1...3).map { phase in
      let fraction = Double(phase) / 4
      let raw = (-7...8).map { tap -> Double in
        let x = fraction - Double(tap)
        let sinc = abs(x) < 1e-10 ? 1 : sin(.pi * x) / (.pi * x)
        let window = abs(x) < 8 ? 0.5 + 0.5 * cos(.pi * x / 8) : 0
        return sinc * window
      }
      let sum = raw.reduce(0, +)
      return raw.map { $0 / sum }
    }
  }

  private func index(_ value: Int) -> Int { (value % size + size) % size }

  func process(_ l: Double, _ r: Double, boostDB: Double) -> (Double, Double) {
    let target = boostDB.isFinite ? min(20, max(0, boostDB)) : 0
    gainDB += (target - gainDB) * smooth
    let a = l.isFinite ? l : 0, b = r.isFinite ? r : 0
    let power = max(a * a, b * b)
    envelope += (power - envelope) * (power > envelope ? activityAttack : activityRelease)
    // Leave very quiet noise at unity. Smoothly admit requested boost from
    // -60 to -40 dBFS activity; exact silence remains exactly zero.
    let activityDB = 10 * log10(max(envelope, 1e-20))
    let activity = min(1, max(0, (activityDB + 60) / 20))
    let admitted = activity * activity * (3 - 2 * activity)
    let gain = pow(10, gainDB * admitted / 20)
    left[index(frame)] = a * gain; right[index(frame)] = b * gain
    let center = frame - 8
    var peak = max(abs(left[index(center)]), abs(right[index(center)]))
    for taps in coefficients {
      var x = 0.0, y = 0.0
      for tap in 0..<16 {
        let at = index(center + tap - 7)
        x += left[at] * taps[tap]; y += right[at] * taps[tap]
      }
      peak = max(peak, abs(x), abs(y))
    }
    peaks[index(center)] = peak
    let output = frame - latencyFrames
    // Sliding minimum of required[j] + j/lookahead yields the same linear
    // attack envelope in amortized O(1), instead of scanning 5 ms per sample.
    let latest = frame - 16
    let p = max(peaks[index(latest)], peaks[index(latest - 1)])
    let value = min(1, Self.ceiling / max(p, 1e-20)) + Double(latest) / Double(lookahead)
    while minimumCount > 0 {
      let tail = (minimumHead + minimumCount - 1) % size
      if minimumValues[tail] < value { break }
      minimumCount -= 1
    }
    let tail = (minimumHead + minimumCount) % size
    minimumValues[tail] = value; minimumIndices[tail] = latest; minimumCount += 1
    while minimumCount > 1 && minimumIndices[minimumHead] < output {
      minimumHead = (minimumHead + 1) % size; minimumCount -= 1
    }
    let rawAllowed = minimumValues[minimumHead] - Double(output) / Double(lookahead)
    let allowed = rawAllowed >= 1 - 1e-10 ? 1 : max(0, rawAllowed)
    limiting = min(allowed, limiting + (1 - limiting) * release)
    if limiting < 0.999 {
      limitedFrames += 1
      maximumReductionDB = max(maximumReductionDB, -20 * log10(max(limiting, 1e-20)))
    }
    let result = output >= 0 ? (left[index(output)] * limiting, right[index(output)] * limiting) : (0.0, 0.0)
    frame += 1
    return result
  }
}
