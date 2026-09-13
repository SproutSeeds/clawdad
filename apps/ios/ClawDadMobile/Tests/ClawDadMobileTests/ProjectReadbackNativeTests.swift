import XCTest
@testable import ClawDadMobile

@MainActor
final class ProjectReadbackNativeTests: XCTestCase {
  func testOptionalCompleteProjectReplyThroughBoostedNativePlayer() async throws {
    guard let path = ProcessInfo.processInfo.environment["CLAWDAD_PROJECT_SPEECH_FIXTURE"] else {
      throw XCTSkip("Opt in with the synthetic project reply WAV directory; output stays muted.")
    }
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: folder) }
    let preference = SpeechOutputPreference(url: folder.appendingPathComponent("boost.json"))
    try preference.set(12)
    var seconds: TimeInterval = 0
    for part in 0..<4 {
      let file = URL(fileURLWithPath: path).appendingPathComponent("probe-response-\(part).wav")
      let data = try Data(contentsOf: file), player = try SpeechOutputPlayer(data: data, preference: preference)
      player.volume = 0
      let completed = expectation(description: "Project response part \(part)")
      player.onCompletion = { success in XCTAssertTrue(success); completed.fulfill() }
      XCTAssertTrue(player.play())
      await fulfillment(of: [completed], timeout: player.duration + 10)
      XCTAssertEqual(player.currentTime, player.duration, accuracy: 0.02)
      seconds += player.duration; player.stop()
      XCTAssertEqual(try Data(contentsOf: file), data)
    }
    print("PROJECT_NATIVE_PLAYBACK completedParts=4 generatedSeconds=\(seconds) boostDB=12 outputMuted=true")
  }
}
