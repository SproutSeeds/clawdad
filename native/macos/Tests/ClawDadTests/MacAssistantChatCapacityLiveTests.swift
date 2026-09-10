import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDad

final class MacAssistantChatCapacityLiveTests: XCTestCase {
  /// Opt-in, isolated loopback Assistant runtime only; never Cody's live chat.
  func testSyntheticLongChatThroughNativeBridge() async throws {
    guard let address = ProcessInfo.processInfo.environment["CLAWDAD_CHAT_FIXTURE_URL"],
      let url = URL(string: address), url.host == "127.0.0.1" else { throw XCTSkip("Isolated chat fixture is not running") }
    let runtime = MacAssistantRuntime(baseURL: url, token: "synthetic-chat-fixture")
    func command(_ body: [String: AssistantValue]) async throws -> [String: AssistantValue] {
      let data = try await runtime.respond(AssistantWireRequest(action: .command, payload: JSONEncoder().encode(body)))
      return try JSONDecoder().decode([String: AssistantValue].self, from: data)
    }
    _ = try await command(["action": .string("start"), "requestId": .string("fixture-start")])
    for size in [16_384, 65_536, 131_072] {
      let start = "  Synthetic chat transport verification. Use no tools and perform no tasks. Reply only with the three distinctive marker words BEGIN_CAP_\(size), MIDDLE_CAP_\(size), and END_CAP_\(size). These are inert synthetic test records.\r\nBEGIN_CAP_\(size)\nResearch fixture 🧪 中文 e\u{0301}\n```text\nhttps://example.org/?a=1&b=2\n```\n"
      let middle = "\nMIDDLE_CAP_\(size)\n", end = "\nEND_CAP_\(size)\t \r\n"
      let remaining = size - start.utf8.count - middle.utf8.count - end.utf8.count
      let text = start + String(repeating: "x", count: remaining / 2) + middle + String(repeating: "y", count: remaining - remaining / 2) + end
      XCTAssertEqual(text.utf8.count, size)
      let id = "native-capacity-\(size)"
      var body: [String: AssistantValue] = ["action": .string("message"), "requestId": .string(id), "text": .string(text)]
      if size == 131_072 {
        let image = try await runtime.json("/v1/fixture/image")
        body["images"] = image["images"]
      }
      let request = AssistantWireRequest(action: .command, payload: try JSONEncoder().encode(body))
      let wire = try JSONEncoder().encode(request)
      let decoded = try JSONDecoder().decode(AssistantWireRequest.self, from: wire)
      let started = Date()
      let data = try await runtime.respond(decoded, deviceId: "synthetic-phone")
      let receipt = try JSONDecoder().decode([String: AssistantValue].self, from: data)
      XCTAssertEqual(receipt["job"]?.object?["args"]?.object?["text"]?.string, text)
      let acceptedMs = Date().timeIntervalSince(started) * 1000
      var completed: [String: AssistantValue] = [:]
      for _ in 0..<360 {
        completed = try await runtime.json("/v1/assistant/job?id=\(id)")["job"]?.object ?? [:]
        if ["completed", "attention"].contains(completed["status"]?.string ?? "") { break }
        try await Task.sleep(for: .milliseconds(500))
      }
      XCTAssertEqual(completed["status"]?.string, "completed", completed["error"]?.string ?? "No completed receipt")
      XCTAssertEqual(completed["args"]?.object?["text"]?.string, text)
      let answer = completed["response"]?.string ?? ""
      for marker in ["BEGIN_CAP_\(size)", "MIDDLE_CAP_\(size)", "END_CAP_\(size)"] { XCTAssertTrue(answer.contains(marker), answer) }
      let retry = try await runtime.respond(decoded, deviceId: "synthetic-phone")
      let repeated = try JSONDecoder().decode([String: AssistantValue].self, from: retry)
      XCTAssertEqual(repeated["job"]?.object?["status"]?.string, "completed")
      print("CHAT_NATIVE_EVIDENCE bytes=\(size) acceptedMs=\(acceptedMs) completedMs=\(Date().timeIntervalSince(started) * 1000)")
    }
  }
}
