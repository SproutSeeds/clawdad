import AVFoundation
import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

@MainActor
final class AssistantAudioTests: XCTestCase {
  func testAudioThreadTapCopiesSamplesAndDeliversOnMainActor() async {
    let samples: [Float] = await withCheckedContinuation { finished in
      Task.detached {
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 3)!
        buffer.frameLength = 3
        buffer.floatChannelData![0][0] = 0.2
        buffer.floatChannelData![0][1] = -0.4
        buffer.floatChannelData![0][2] = 0.6
        let callback = assistantInputTap { values in
          MainActor.preconditionIsolated()
          finished.resume(returning: values)
        }
        callback(buffer, AVAudioTime(sampleTime: 0, atRate: 48000))
      }
    }
    XCTAssertEqual(samples, [0.2, -0.4, 0.6])
  }

  func testAudioThreadPlaybackCompletionReturnsToMainActor() async {
    let completed: Bool = await withCheckedContinuation { finished in
      Task.detached {
        let callback = assistantPlaybackCompletion {
          MainActor.preconditionIsolated()
          finished.resume(returning: true)
        }
        callback(.dataPlayedBack)
      }
    }
    XCTAssertTrue(completed)
  }

  func testNewCallDoesNotInheritPreviousMute() {
    var microphone = AssistantMicrophoneState()
    microphone.begin(at: 1)
    microphone.muted = true
    microphone.end()
    microphone.begin(at: 2)
    XCTAssertFalse(microphone.muted)
    XCTAssertFalse(microphone.receiving(at: 2))
    microphone.receivedBuffer(at: 2.1)
    XCTAssertTrue(microphone.receiving(at: 2.2))
  }

  func testRunningEngineWithoutAudioCannotClaimMicrophoneReadiness() {
    var microphone = AssistantMicrophoneState()
    microphone.begin(at: 10)
    XCTAssertFalse(microphone.receiving(at: 10.5))
    XCTAssertFalse(microphone.needsRecovery(at: 11, engineRunning: true))
    XCTAssertTrue(microphone.needsRecovery(at: 12.1, engineRunning: true))
    microphone.receivedBuffer(at: 12.2)
    XCTAssertTrue(microphone.receiving(at: 12.3))
    XCTAssertFalse(microphone.needsRecovery(at: 12.3, engineRunning: true))
    XCTAssertTrue(microphone.needsRecovery(at: 14.3, engineRunning: true))
  }

  func testRouteChangeStoppingEngineRequiresRecoveryEvenWithRecentAudio() {
    var microphone = AssistantMicrophoneState()
    microphone.begin(at: 0)
    microphone.receivedBuffer(at: 3)
    XCTAssertTrue(microphone.needsRecovery(at: 3.1, engineRunning: false))
    microphone.end()
    microphone.receivedBuffer(at: 4)
    XCTAssertFalse(microphone.receiving(at: 4))
    XCTAssertFalse(microphone.needsRecovery(at: 20, engineRunning: false))
  }

  func testConversationRecoveryCannotReactivateAnExpiredOwner() throws {
    var activations = 0
    let session = MobileAudioSession(activate: { _ in activations += 1 }, deactivate: {})
    let first = try session.beginConversation {}
    try session.reactivateConversation(first)
    XCTAssertEqual(activations, 2)
    session.release(first)
    let recording = try session.beginRecording()
    XCTAssertThrowsError(try session.reactivateConversation(first))
    XCTAssertEqual(activations, 3)
    session.release(recording)
  }

  func testDifferentTTSRatesConvertToStableCallFormatWithoutGraphChanges() throws {
    let target = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1))
    for rate in [16000.0, 24000.0, 48000.0] {
      let wav = try fixtureWAV(sampleRate: rate)
      let buffer = try assistantPlaybackBuffer(wav, format: target)
      XCTAssertEqual(buffer.format, target)
      XCTAssertEqual(Double(buffer.frameLength) / target.sampleRate, 1, accuracy: 0.002)
      let samples = try XCTUnwrap(buffer.floatChannelData?[0])
      let energy = (0..<Int(buffer.frameLength)).reduce(0.0) { $0 + Double(samples[$1] * samples[$1]) }
      XCTAssertGreaterThan(energy / Double(buffer.frameLength), 0.001)
    }
  }

  private func fixtureWAV(sampleRate: Double) throws -> Data {
    let samples = (0..<Int(sampleRate)).map { Float(sin(Double($0) * 2 * .pi * 440 / sampleRate) * 0.1) }
    // Encode the existing samples without resampling, then declare their rate.
    var data = assistantWAV(samples, sampleRate: 16000)
    for (offset, value) in [(24, UInt32(sampleRate)), (28, UInt32(sampleRate) * 2)] {
      var word = value.littleEndian
      withUnsafeBytes(of: &word) { data.replaceSubrange(offset..<(offset + 4), with: $0) }
    }
    return data
  }

  func testInvalidPlaybackDoesNotProduceAnEmptyScheduledClip() throws {
    let target = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1))
    XCTAssertThrowsError(try assistantPlaybackBuffer(Data(), format: target))
  }
}
