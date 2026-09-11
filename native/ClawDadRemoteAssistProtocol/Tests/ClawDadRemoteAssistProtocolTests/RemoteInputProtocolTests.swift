import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteInputProtocolTests: XCTestCase {
  func testKeyChordRoundTripAndInvalidMixedPayloads() throws {
    let chord = RemoteKeyChord(key: "left", modifiers: [.shift, .option])
    let request = RemoteInputMessage.chordRequest(chord: chord, requestId: "selection-1")
    XCTAssertEqual(try RemoteInputCodec.decode(RemoteInputCodec.encode(request)), request)
    XCTAssertEqual(chord.orderedModifiers, [.option, .shift])
    for invalid in [RemoteKeyChord(key: "execute"), .init(key: "left", modifiers: [.shift, .shift])] {
      XCTAssertThrowsError(try RemoteInputCodec.encode(.chordRequest(chord: invalid, requestId: "invalid")))
    }
    var mixed = RemoteInputMessage.textRequest(text: "preserve", requestId: "mixed")
    mixed.chord = chord
    XCTAssertThrowsError(try RemoteInputCodec.encode(mixed))
    var result = RemoteInputMessage.failure(action: .chord, requestId: "failed", error: "Unsupported")
    result.chord = chord
    XCTAssertThrowsError(try RemoteInputCodec.encode(result))
  }

  func testChordCapabilityIsOptionalAndReconnectCannotRetainOldSupport() throws {
    var capabilities = RemoteSessionCapabilities()
    capabilities.begin(requestId: "first")
    capabilities.receive(.state(screenLocked: false, supportsKeyChords: true, requestId: "first"))
    XCTAssertEqual(capabilities.keyChords, true)
    capabilities.receive(.state(screenLocked: true))
    XCTAssertEqual(capabilities.keyChords, true)
    capabilities.begin(requestId: "second")
    XCTAssertNil(capabilities.keyChords)
    XCTAssertFalse(capabilities.receive(.state(screenLocked: false, supportsKeyChords: true, requestId: "first")))
    capabilities.receive(.state(screenLocked: false, supportsDictation: true, requestId: "second"))
    XCTAssertNil(capabilities.keyChords)
  }
  func testTextRequestRoundTripsMultilineUnicode() throws {
    let message = RemoteInputMessage.textRequest(
      text: "first line\nsecond line with cafe\u{301}",
      requestId: "text-123"
    )

    let decoded = try RemoteInputCodec.decode(
      RemoteInputCodec.encode(message)
    )

    XCTAssertEqual(decoded, message)
  }

  func testSuccessReturnsOnlySafeTargetMetadata() throws {
    let target = RemoteInputTarget(
      applicationName: "Terminal",
      bundleIdentifier: "com.apple.Terminal",
      role: "AXTextArea"
    )
    let message = RemoteInputMessage.success(
      action: .text,
      requestId: "text-ack",
      target: target
    )

    let encoded = try RemoteInputCodec.encode(message)
    let decoded = try RemoteInputCodec.decode(encoded)

    XCTAssertEqual(decoded, message)
    XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("secret text"))
  }

  func testTextResponseCannotEchoTypedContent() {
    let message = RemoteInputMessage(
      type: RemoteInputMessage.resultType,
      action: .text,
      requestId: "text-echo",
      text: "secret text",
      key: nil,
      shortcut: nil,
      ok: true,
      error: nil,
      target: RemoteInputTarget(
        applicationName: "TextEdit",
        bundleIdentifier: "com.apple.TextEdit",
        role: "AXTextArea"
      )
    )

    XCTAssertThrowsError(try RemoteInputCodec.encode(message)) { error in
      XCTAssertEqual(error as? RemoteInputProtocolError, .invalidResult)
    }
  }

  func testEveryApprovedShortcutRoundTrips() throws {
    for shortcut in RemoteShortcut.allCases {
      let message = RemoteInputMessage.shortcutRequest(
        shortcut: shortcut,
        requestId: "shortcut-\(shortcut.rawValue)"
      )

      let decoded = try RemoteInputCodec.decode(
        RemoteInputCodec.encode(message)
      )

      XCTAssertEqual(decoded, message)
    }
  }

  func testCommandTUsesStableWireValue() {
    XCTAssertEqual(RemoteShortcut.commandT.rawValue, "command_t")
  }

  func testShortcutResponseCannotEchoTheCommand() {
    let message = RemoteInputMessage(
      type: RemoteInputMessage.resultType,
      action: .shortcut,
      requestId: "shortcut-echo",
      text: nil,
      key: nil,
      shortcut: .controlC,
      ok: true,
      error: nil,
      target: RemoteInputTarget(
        applicationName: "Terminal",
        bundleIdentifier: "com.apple.Terminal",
        role: "AXTextArea"
      )
    )

    XCTAssertThrowsError(try RemoteInputCodec.encode(message)) { error in
      XCTAssertEqual(error as? RemoteInputProtocolError, .invalidResult)
    }
  }

  func testKeyRequestRejectsEmptyKey() {
    let message = RemoteInputMessage.keyRequest(
      key: "",
      requestId: "key-empty"
    )

    XCTAssertThrowsError(try RemoteInputCodec.encode(message)) { error in
      XCTAssertEqual(error as? RemoteInputProtocolError, .invalidCommand)
    }
  }

  func testFailureRequiresAnErrorMessage() {
    let message = RemoteInputMessage.failure(
      action: .key,
      requestId: "key-failed",
      error: ""
    )

    XCTAssertThrowsError(try RemoteInputCodec.encode(message)) { error in
      XCTAssertEqual(error as? RemoteInputProtocolError, .invalidResult)
    }
  }
}
