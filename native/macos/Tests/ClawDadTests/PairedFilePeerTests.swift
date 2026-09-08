import XCTest
import Foundation
import ClawDadFileTransport
import ClawDadRemoteAssistProtocol
@testable import ClawDad

@MainActor
final class PairedFilePeerTests: XCTestCase {
  func testConcurrentAssistantRepliesSurviveDataChannelBackpressure() {
    let finished = expectation(description: "Concurrent replies arrive")
    Task { @MainActor in
      defer { finished.fulfill() }
      let host = PairedFilePeer(), phone = PairedFilePeer()
      defer { host.stop(); phone.stop() }
      var opened = false
      var received: [Data] = []
      host.onCandidate = { sdp, mid, index in Task { await phone.addCandidate(sdp: sdp, mid: mid, index: index) } }
      phone.onCandidate = { sdp, mid, index in Task { await host.addCandidate(sdp: sdp, mid: mid, index: index) } }
      phone.onOpen = { opened = true }
      phone.onMessage = { received.append($0) }
      do {
        let answer = try await phone.acceptOffer(host.createOffer())
        try await host.acceptAnswer(answer)
        let deadline = Date().addingTimeInterval(12)
        while !opened, Date() < deadline { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertTrue(opened)
        let audio = Data(repeating: 31, count: 900_000)
        let state = Data(repeating: 47, count: 34_000)
        async let speechReply: Void = host.send(audio)
        async let stateReply: Void = host.send(state)
        _ = try await (speechReply, stateReply)
        while received.count < 2, Date() < deadline { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(received.count, 2)
        XCTAssertTrue(received.contains(audio))
        XCTAssertTrue(received.contains(state))
      } catch { XCTFail("Concurrent Assistant replies were lost: \(error.localizedDescription)") }
    }
    wait(for: [finished], timeout: 16)
  }

  func testFilesRejectMediaAndRelayUnlessExplicitlyEnabledAndEnforceByteLimit() async throws {
    let direct = PairedFilePeer()
    defer { direct.stop() }
    for sdp in ["v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n", "v=0\r\na=candidate:1 1 udp 1 127.0.0.1 9 typ relay raddr 0.0.0.0 rport 0\r\n"] {
      do { _ = try await direct.acceptOffer(sdp); XCTFail("Direct Files accepted media or relay") }
      catch { XCTAssertEqual(error as? RemoteFileError, .invalidMessage) }
    }
    let limited = PairedFilePeer()
    defer { limited.stop() }
    try limited.configure(iceServers: [], permitsRelay: true, byteLimit: 64)
    var failed = false
    limited.onFailure = { error in XCTAssertEqual(error as? RemoteFileError, .tooLarge); failed = true }
    do { try await limited.send(Data(repeating: 1, count: 100)); XCTFail("Byte limit was ignored") }
    catch { XCTAssertEqual(error as? RemoteFileError, .tooLarge) }
    XCTAssertTrue(failed)
    do { _ = try await limited.acceptOffer("v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n"); XCTFail("Relay permission allowed media") }
    catch { XCTAssertEqual(error as? RemoteFileError, .invalidMessage) }
  }

  func testRealPeersTransferFragmentedBytesWithoutNegotiatingScreenOrAudio() {
    let finished = expectation(description: "Transfer finishes")
    Task { @MainActor in
    defer { finished.fulfill() }
    do {
    let host = PairedFilePeer(), phone = PairedFilePeer()
    defer { host.stop(); phone.stop() }
    var opened = false
    var received = false
    let bytes = Data((0..<190_000).map { UInt8($0 % 251) })
    host.onCandidate = { sdp, mid, index in Task { await phone.addCandidate(sdp: sdp, mid: mid, index: index) } }
    phone.onCandidate = { sdp, mid, index in Task { await host.addCandidate(sdp: sdp, mid: mid, index: index) } }
    phone.onOpen = { opened = true }
    host.onMessage = { data in
      XCTAssertEqual(data, bytes)
      Task { do { try await host.send(data) } catch { XCTFail(error.localizedDescription) } }
    }
    phone.onMessage = { data in XCTAssertEqual(data, bytes); received = true }
    let offer = try await host.createOffer()
    XCTAssertTrue(offer.contains("m=application"))
    XCTAssertFalse(offer.contains("m=video"))
    XCTAssertFalse(offer.contains("m=audio"))
    let answer = try await phone.acceptOffer(offer)
    try await host.acceptAnswer(answer)
    let deadline = Date().addingTimeInterval(15)
    while !opened, Date() < deadline { try await Task.sleep(nanoseconds: 20_000_000) }
    XCTAssertTrue(opened)
    try await phone.send(bytes)
    while !received, Date() < deadline { try await Task.sleep(nanoseconds: 20_000_000) }
    XCTAssertTrue(received)
    } catch { XCTFail(error.localizedDescription) }
    }
    wait(for: [finished], timeout: 20)
  }
}
