import CryptoKit
import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDad

final class MacAssistantSpeechRecoveryLiveTests: XCTestCase {
  /// Explicit opt-in loopback fixture: synthetic text and recorded local TTS
  /// only. No microphone, Assistant turn, native input or live project access.
  func testSpeechRecoveryThroughNativeWireAndAuthenticatedRuntime() async throws {
    let env = ProcessInfo.processInfo.environment
    guard let address = env["CLAWDAD_SPEECH_FIXTURE_URL"], let url = URL(string: address), url.host == "127.0.0.1",
      let textFile = env["CLAWDAD_SPEECH_FIXTURE_TEXT"], let output = env["CLAWDAD_SPEECH_FIXTURE_PROOF"] else {
      throw XCTSkip("Requires the isolated synthetic speech fixture")
    }
    let text = try String(contentsOfFile: textFile, encoding: .utf8)
    let runtime = MacAssistantRuntime(baseURL: url, token: "synthetic-speech-fixture")
    var selection: AssistantValue?, hashes: [String] = [], voice: [String: AssistantValue] = [:]
    var failedRequests = 0, retry = false, ready = false
    let deadline = Date().addingTimeInterval(60)
    while Date() < deadline, !ready {
      var payload: [String: AssistantValue] = ["text": .string(text), "requestId": .string("native-speech-recovery"),
        "poll": .bool(!hashes.isEmpty), "retry": .bool(retry)]
      payload["voiceSelection"] = selection
      do {
        let request = AssistantWireRequest(action: .synthesize, payload: try JSONEncoder().encode(payload))
        let wire = try JSONEncoder().encode(request)
        let response = try await runtime.respond(JSONDecoder().decode(AssistantWireRequest.self, from: wire))
        let body = try JSONDecoder().decode([String: AssistantValue].self, from: response)
        if let selection { XCTAssertEqual(body["voiceSelection"], selection) }
        selection = body["voiceSelection"]; retry = false
        let audio = try XCTUnwrap(body["audio"]?.object)
        let parts = audio["parts"]?.array ?? []
        for index in hashes.count..<parts.count {
          let part = try XCTUnwrap(parts[index].object)
          let data = try await runtime.respond(.init(action: .audio, payload: Data(try XCTUnwrap(part["url"]?.string).utf8)))
          let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
          XCTAssertEqual(hash, part["audioHash"]?.string)
          XCTAssertEqual(audio["engine"]?.string, "kokoro"); XCTAssertEqual(audio["voiceId"]?.string, "af_heart")
          hashes.append(hash)
        }
        voice = audio.filter { ["engine", "voiceId", "modelId", "speed"].contains($0.key) }
        ready = audio["state"]?.string == "ready"
      } catch {
        failedRequests += 1; retry = true
        guard failedRequests <= 3 else { throw error }
      }
      if !ready { try await Task.sleep(for: .milliseconds(200)) }
    }
    XCTAssertTrue(ready); XCTAssertGreaterThan(hashes.count, 3); XCTAssertGreaterThan(failedRequests, 0)
    let proof: [String: AssistantValue] = ["voice": .object(voice), "failedRequests": .number(Double(failedRequests)),
      "downloadedParts": .number(Double(hashes.count)), "orderedAudioHashes": .array(hashes.map(AssistantValue.string)),
      "textHash": .string(SHA256.hash(data: Data(text.trimmingCharacters(in: .whitespacesAndNewlines).utf8)).map { String(format: "%02x", $0) }.joined()),
      "ready": .bool(ready), "microphoneUsed": .bool(false), "conversationTurnsSubmitted": .number(0)]
    try JSONEncoder().encode(proof).write(to: URL(fileURLWithPath: output))
  }
}
