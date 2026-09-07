import XCTest
@testable import ClawDadMobile

@MainActor
final class RemoteQuickChatTests: XCTestCase {
  func testEditsAdditionsAndDeletionPersistLocallyWithoutReordering() throws {
    let suite = "quick-chat-test-\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = RemoteQuickChatStore(defaults: defaults)
    XCTAssertEqual(store.presets.map(\.text), ["pwd", "ls", "cd ..", "Continue with the next implementation steps.", "Let’s discuss the next steps. Break it down."])
    var edited = store.presets[3]
    edited.text = "  My own wording.\nKeep it exactly.  "
    XCTAssertTrue(store.save(edited))
    let custom = RemoteQuickChatPreset(title: "My prompt", text: "Explain this change.")
    XCTAssertTrue(store.save(custom))
    store.delete("pwd")
    let reloaded = RemoteQuickChatStore(defaults: defaults)
    XCTAssertEqual(reloaded.presets, store.presets)
    XCTAssertEqual(reloaded.presets.first?.id, "ls")
    XCTAssertEqual(reloaded.presets[2].text, edited.text)
    XCTAssertEqual(reloaded.presets.last, custom)
  }

  func testDeletingEveryPresetStaysEmptyAndInvalidEditsDoNotReplaceValidData() throws {
    let suite = "quick-chat-test-\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = RemoteQuickChatStore(defaults: defaults)
    XCTAssertFalse(store.save(.init(title: "", text: "pwd")))
    XCTAssertFalse(store.save(.init(title: "Too big", text: String(repeating: "x", count: 16_385))))
    for preset in store.presets { store.delete(preset.id) }
    XCTAssertTrue(RemoteQuickChatStore(defaults: defaults).presets.isEmpty)
  }
}
