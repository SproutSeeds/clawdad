import Foundation
import XCTest
import ClawDadRemoteAssistProtocol
@testable import ClawDad

private final class SpeechWireFixture: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    var body = request.httpBody ?? Data()
    if let stream = request.httpBodyStream {
      stream.open(); defer { stream.close() }
      var buffer = [UInt8](repeating: 0, count: 4096)
      while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; body.append(contentsOf: buffer.prefix(n)) }
    }
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: body)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
final class MacSpeechOutputWireTests: XCTestCase {
  func testSpeechSyncAndMessageOriginsUseAuthenticatedPhoneIdentity() async throws {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [SpeechWireFixture.self]
    let session = URLSession(configuration: config)
    defer { session.invalidateAndCancel() }
    let runtime = MacAssistantRuntime(baseURL: URL(string: "http://127.0.0.1:1234")!, token: "disposable-fixture", session: session)
    for action in ["speech.sync", "message"] {
      let body: [String: AssistantValue] = ["action": .string(action), "deviceId": .string("spoofed"), "speechDeviceId": .string("spoofed"), "text": .string("Set speech boost to 6 dB")]
      let request = AssistantWireRequest(action: .command, payload: try JSONEncoder().encode(body))
      let wire = try JSONDecoder().decode(AssistantWireRequest.self, from: JSONEncoder().encode(request))
      let data = try await runtime.respond(wire, deviceId: "verified-phone")
      let received = try JSONDecoder().decode([String: AssistantValue].self, from: data)
      XCTAssertEqual(received[action == "speech.sync" ? "deviceId" : "speechDeviceId"], .string("verified-phone"))
    }
    let request = AssistantWireRequest(action: .command, payload: try JSONEncoder().encode(["action": "speech.sync"]))
    do { _ = try await runtime.respond(request); XCTFail("An anonymous phone cannot register a speech-control target") } catch {}
  }
}
