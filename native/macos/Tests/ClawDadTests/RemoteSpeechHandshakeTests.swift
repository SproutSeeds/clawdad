import XCTest
import ClawDadFileTransport
import ClawDadRemoteAssistProtocol
@testable import ClawDad

@MainActor
final class RemoteSpeechHandshakeTests: XCTestCase {
  func testRealDataChannelRecoversLostAdvertisementAndLostFirstReply() {
    let finished = expectation(description: "Speech capability negotiation")
    Task { @MainActor in
      defer { finished.fulfill() }
      let host = PairedFilePeer(), phone = PairedFilePeer()
      defer { host.stop(); phone.stop() }
      do {
        var capabilities = RemoteSessionCapabilities()
        capabilities.begin(requestId: "phone-listener-ready")
        var attempts = 0
        var opened = false
        host.onCandidate = { sdp, mid, index in Task { await phone.addCandidate(sdp: sdp, mid: mid, index: index) } }
        phone.onCandidate = { sdp, mid, index in Task { await host.addCandidate(sdp: sdp, mid: mid, index: index) } }
        phone.onOpen = { opened = true }
        // No initial advertisement is delivered. The new phone must ask for state.
        host.onMessage = { data in
          guard let request = try? RemoteSessionStateRequest.decode(data) else { XCTFail(); return }
          attempts += 1
          if attempts == 1 { return } // Simulate losing a reply as well.
          Task {
            let response = MacRemotePeer.sessionState(screenLocked: false, requestId: request.requestId)
            try await host.send(RemoteSessionStateCodec.encode(response))
          }
        }
        phone.onMessage = { data in
          guard let state = try? RemoteSessionStateCodec.decode(data) else { XCTFail(); return }
          capabilities.receive(state)
        }
        let offer = try await host.createOffer()
        let answer = try await phone.acceptOffer(offer)
        try await host.acceptAnswer(answer)
        let deadline = Date().addingTimeInterval(12)
        while !opened, Date() < deadline { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertTrue(opened)
        while !capabilities.received, Date() < deadline {
          try await phone.send(RemoteSessionStateRequest(requestId: capabilities.requestId).encode())
          try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertGreaterThanOrEqual(attempts, 2)
        XCTAssertEqual(capabilities.dictation, true)
        XCTAssertEqual(capabilities.terminalReadAloud, true)
        XCTAssertEqual(capabilities.inlineSpeech, true)
        XCTAssertEqual(capabilities.quickChat, true)
        XCTAssertEqual(capabilities.terminalTabClose, true)
      } catch { XCTFail(error.localizedDescription) }
    }
    wait(for: [finished], timeout: 18)
  }
}
