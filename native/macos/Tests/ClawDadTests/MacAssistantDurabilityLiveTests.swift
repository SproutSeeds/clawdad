import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDad

final class MacAssistantDurabilityLiveTests: XCTestCase {
  func testAcceptedReplySurvivesDisconnectedNativeClientAndOpensByExactReceipt() async throws {
    guard let address = ProcessInfo.processInfo.environment["CLAWDAD_DURABLE_FIXTURE_URL"],
      let url = URL(string: address), url.host == "127.0.0.1" else { throw XCTSkip("Isolated durable Assistant fixture is not running") }
    func bridge() -> MacAssistantRuntime { MacAssistantRuntime(baseURL: url, token: "durable-fixture") }
    func wire(_ body: [String: AssistantValue]) throws -> AssistantWireRequest {
      let original = AssistantWireRequest(action: .command, payload: try JSONEncoder().encode(body))
      return try JSONDecoder().decode(AssistantWireRequest.self, from: JSONEncoder().encode(original))
    }
    let fixture = try await bridge().json("/v1/fixture/image")
    let id = "durable-native-receipt"
    let request = try wire(["action": .string("message"), "requestId": .string(id),
      "text": .string("Exact native fixture 🧪\nNo Terminal work."), "images": fixture["images"]!])
    let accepted = try JSONDecoder().decode([String: AssistantValue].self,
      from: await bridge().respond(request, deviceId: "synthetic-phone"))
    XCTAssertEqual(accepted["job"]?.object?["status"]?.string, "queued")
    // Discard the sending bridge. No phone or old URLSession callback observes
    // generation; a new native bridge reads the durable receipt later.
    try await Task.sleep(for: .milliseconds(500))
    let receiptRequest = try wire(["action": .string("receipt"), "requestId": .string("inspect-durable"), "messageRequestId": .string(id)])
    let receipt = try JSONDecoder().decode([String: AssistantValue].self, from: await bridge().respond(receiptRequest))
    XCTAssertEqual(receipt["messageReceipt"]?.object?["status"]?.string, "completed")
    let outbox = try await bridge().json("/v1/assistant/notifications/outbox")
    let events = try XCTUnwrap(outbox["events"]?.array)
    XCTAssertEqual(events.count, 1)
    let event = try XCTUnwrap(events.first?.object)
    let open = try wire(["action": .string("reply"), "requestId": .string("open-durable"), "conversationId": event["conversationId"]!,
      "messageRequestId": .string(id), "replyId": event["replyId"]!])
    let result = try JSONDecoder().decode([String: AssistantValue].self, from: await bridge().respond(open))
    XCTAssertEqual(result["assistantReply"]?.object?["message"]?.object?["text"]?.string, "DURABLE_NATIVE_REPLY_OK")
    XCTAssertEqual(result["assistantReply"]?.object?["userMessage"]?.object?["images"]?.array?.count, 1)
    let retry = try JSONDecoder().decode([String: AssistantValue].self, from: await bridge().respond(request, deviceId: "synthetic-phone"))
    XCTAssertEqual(retry["job"]?.object?["status"]?.string, "completed")
    print("DURABLE_NATIVE_EVIDENCE acceptedOnce=true exactReply=true imagePreserved=true clientRecreated=true")
  }
}
