import ClawDadRemoteAssistProtocol
import Foundation
import XCTest
@testable import ClawDadMobile

@MainActor
final class AssistantReplyAudioTests: XCTestCase {
  func testNativePlayerDecodesAndCompletesDifferentRatesWithoutMicrophoneCapture() async throws {
    let player = AssistantReplyAudio(volume: 0)
    var started = 0
    player.onStarted = { started += 1 }
    for rate in [16000.0, 24000.0, 48000.0] { try await player.play(wav(rate: rate, seconds: 0.12)) }
    XCTAssertEqual(started, 3)
  }
  func testCancellationDoesNotCancelTheReplacementClip() async throws {
    let player = AssistantReplyAudio(volume: 0)
    var started = 0
    player.onStarted = { started += 1 }
    let first = Task { try await player.play(wav(rate: 16000, seconds: 1)) }
    while started == 0 { await Task.yield() }
    first.cancel()
    // Replacement can begin before the cancellation handler reaches the actor.
    try await player.play(wav(rate: 24000, seconds: 0.12))
    do { try await first.value; XCTFail("Cancelled playback should not finish successfully") }
    catch { XCTAssertTrue(error is CancellationError) }
    XCTAssertEqual(started, 2)
  }
  func testInvalidClipFailsWithoutClaimingPlaybackStarted() async {
    let player = AssistantReplyAudio(volume: 0)
    var started = false
    player.onStarted = { started = true }
    do { try await player.play(Data()); XCTFail("Invalid audio must fail") } catch {}
    XCTAssertFalse(started)
  }
  func testNativePositionSurvivesStopAndSameClipCanResumeWithoutRepeatingItsPrefix() async throws {
    let player = AssistantReplyAudio(volume: 0)
    let data = wav(rate: 24000, seconds: 0.7)
    let first = Task { try await player.play(data) }
    try await Task.sleep(for: .milliseconds(230))
    player.stop()
    let position = player.position
    XCTAssertGreaterThan(position, 0.1); XCTAssertLessThan(position, 0.7)
    do { try await first.value; XCTFail("Stopped clip should throw") } catch {}
    let began = ProcessInfo.processInfo.systemUptime
    try await player.play(data, from: position)
    XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - began, 0.65)
    XCTAssertGreaterThanOrEqual(player.position, 0.65)
  }
  private func wav(rate: Double, seconds: Double) -> Data {
    var data = assistantWAV(Array(repeating: Float(0), count: Int(rate * seconds)), sampleRate: 16000)
    for (offset, value) in [(24, UInt32(rate)), (28, UInt32(rate) * 2)] {
      var word = value.littleEndian
      withUnsafeBytes(of: &word) { data.replaceSubrange(offset..<(offset + 4), with: $0) }
    }
    return data
  }
}
