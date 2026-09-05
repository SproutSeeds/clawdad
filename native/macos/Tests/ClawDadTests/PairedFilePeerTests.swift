import XCTest
import Foundation
import ClawDadFileTransport
@testable import ClawDad

@MainActor
final class PairedFilePeerTests: XCTestCase {
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
