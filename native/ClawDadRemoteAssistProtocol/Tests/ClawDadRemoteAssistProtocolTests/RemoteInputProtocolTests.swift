import XCTest
@testable import ClawDadRemoteAssistProtocol

final class RemoteInputProtocolTests: XCTestCase {
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
