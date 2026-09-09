import AVFoundation
import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

@MainActor
final class AssistantAudioTests: XCTestCase {
  func testMuteAtomicallyDrainsCapturedTailAndExcludesPostMuteAndQueuedCallbacks() async {
    let mailbox = AssistantInputMailbox()
    var delivered = 0
    let callback = assistantInputTap(mailbox: mailbox) { _, _ in delivered += 1 }
    let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800)!
    buffer.frameLength = 4800
    for i in 0..<4800 { buffer.floatChannelData![0][i] = 0.25 }
    let now = ProcessInfo.processInfo.systemUptime
    callback(buffer, AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: now - 0.3)))
    callback(buffer, AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: now - 0.2)))
    // Mute before the UI actor can receive either of these final speech frames.
    let tail = mailbox.close(before: now)
    XCTAssertEqual(tail.count, 2)
    var input = AssistantListeningInput(sampleRate: 48000)
    _ = input.consume(Array(repeating: 0.1, count: 9600), capturedAt: now - 0.5)
    for packet in tail { _ = input.consume(packet.values, capturedAt: packet.capturedAt) }
    let final = input.finish()
    input.muted = true
    XCTAssertEqual(final?.count, 19200)
    XCTAssertEqual(final?.suffix(9600), Array(repeating: Float(0.25), count: 9600)[...])
    for _ in 0..<100 { callback(buffer, AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: now + 0.1))) }
    for _ in 0..<10 { await Task.yield() }
    XCTAssertEqual(delivered, 0, "Drained frames and private callbacks cannot be delivered later")
    XCTAssertTrue(mailbox.drain().isEmpty)
    var copiedPrivateAudio = false
    XCTAssertFalse(mailbox.append(capturedAt: now + 1, sampleRate: 48000, samples: {
      copiedPrivateAudio = true; return [1]
    }))
    XCTAssertFalse(copiedPrivateAudio)
    // Unmute creates a different graph/mailbox. The retired mailbox stays shut.
    let next = AssistantInputMailbox()
    XCTAssertTrue(next.append(capturedAt: now + 2, sampleRate: 48000, samples: { [0.5] }))
    XCTAssertEqual(next.drain().first?.values, [0.5])
    XCTAssertTrue(mailbox.close(before: now + 3).isEmpty)
  }

  func testMuteCutoffTrimsAStraddlingPacketAndFailureCloseDiscardsSamples() {
    let mailbox = AssistantInputMailbox()
    XCTAssertTrue(mailbox.append(capturedAt: 10, sampleRate: 10, samples: { [1, 2, 3, 4] }))
    XCTAssertTrue(mailbox.append(capturedAt: 11, sampleRate: 10, samples: { [9] }))
    let packets = mailbox.close(before: 10.25)
    XCTAssertEqual(packets.map(\.values), [[1, 2]])
    let failure = AssistantInputMailbox()
    XCTAssertTrue(failure.append(capturedAt: 10, sampleRate: 10, samples: { [1, 2] }))
    XCTAssertTrue(failure.close().isEmpty)
    XCTAssertTrue(failure.drain().isEmpty)
  }

  func testTapFencesByFirstSampleAndBoundsAudioWaitingForUIActor() async {
    let now = ProcessInfo.processInfo.systemUptime
    var starts: [TimeInterval] = []
    let callback = assistantInputTap { _, capturedAt in starts.append(capturedAt) }
    let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800)!
    buffer.frameLength = 4800
    let firstSampleAt = now - 1
    let when = AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: firstSampleAt))
    // No actor yield: model a burst while delivery is blocked. Only four
    // transient handoffs may be queued, irrespective of the burst length.
    for _ in 0..<100 { callback(buffer, when) }
    for _ in 0..<20 where starts.count < 4 { await Task.yield() }
    XCTAssertEqual(starts.count, 4)
    XCTAssertTrue(starts.allSatisfy { abs($0 - firstSampleAt) < 0.001 })
  }

  func testFullMuteUsesAnOutputOnlySessionWithoutReleasingConversationOwnership() throws {
    var uses: [MobileAudioSession.Use] = []
    let session = MobileAudioSession(activate: { uses.append($0) }, deactivate: {})
    let owner = try session.beginConversation {}
    try session.suspendConversationMicrophone(owner)
    XCTAssertEqual(uses.count, 2)
    XCTAssertTrue(uses.last == .playback)
    XCTAssertThrowsError(try session.beginRecording(), "The call still owns its reservation")
    try session.reactivateConversation(owner)
    XCTAssertTrue(uses.last == .conversation)
    session.release(owner)
    XCTAssertThrowsError(try session.suspendConversationMicrophone(owner))
  }
  func testAudioThreadTapCopiesSamplesAndDeliversOnMainActor() async {
    let samples: [Float] = await withCheckedContinuation { finished in
      Task.detached {
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 3)!
        buffer.frameLength = 3
        buffer.floatChannelData![0][0] = 0.2
        buffer.floatChannelData![0][1] = -0.4
        buffer.floatChannelData![0][2] = 0.6
        let callback = assistantInputTap { values, capturedAt in
          MainActor.preconditionIsolated()
          XCTAssertGreaterThan(capturedAt, 0)
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
