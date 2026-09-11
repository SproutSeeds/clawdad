import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

@MainActor
final class RemoteSpecialKeyTests: XCTestCase {
  func testBuiltInsIncludeShiftLeftAndKeepLegacyTransport() throws {
    let presets = RemoteSpecialKeyPreset.defaults
    XCTAssertEqual(presets.count, RemoteShortcut.allCases.count + 1)
    for shortcut in RemoteShortcut.allCases {
      let preset = try XCTUnwrap(presets.first { $0.id == shortcut.rawValue })
      XCTAssertEqual(preset.request(id: "one"), .shortcutRequest(shortcut: shortcut, requestId: "one"))
    }
    let shift = try XCTUnwrap(presets.first { $0.id == "shift_left" })
    XCTAssertEqual(shift.request(id: "shift").chord, .init(key: "left", modifiers: [.shift]))
    XCTAssertEqual(shift.chord.keycap, "⇧←")
    XCTAssertEqual(shift.spokenName(isWindows: false), "Shift + Left Arrow")
  }
  func testAddEditRestoreDeleteAndReloadKeepBuiltInsAndExactLabels() throws {
    let name = "special-key-test-\(UUID())"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
    defer { defaults.removePersistentDomain(forName: name) }
    let store = RemoteSpecialKeyStore(defaults: defaults)
    let custom = RemoteSpecialKeyPreset(title: "選択 — word", chord: .init(key: "left", modifiers: [.option, .shift]))
    XCTAssertTrue(store.save(custom))
    var builtin = try XCTUnwrap(store.presets.first { $0.id == "shift_left" })
    builtin.title = "Select word"; builtin.chord.modifiers.append(.option)
    XCTAssertTrue(store.save(builtin))
    let reloaded = RemoteSpecialKeyStore(defaults: defaults)
    XCTAssertEqual(reloaded.presets, store.presets)
    XCTAssertEqual(reloaded.presets.last?.title, custom.title)
    reloaded.delete("shift_left")
    XCTAssertTrue(reloaded.presets.contains { $0.id == "shift_left" })
    XCTAssertTrue(reloaded.save(try XCTUnwrap(builtin.original)))
    reloaded.delete(custom.id)
    XCTAssertEqual(RemoteSpecialKeyStore(defaults: defaults).presets, RemoteSpecialKeyPreset.defaults)
  }
  func testEditingValueDoesNotSaveOrChangeTransportUntilExplicitSave() throws {
    let name = "special-key-draft-\(UUID())", defaults = try XCTUnwrap(UserDefaults(suiteName: name))
    defer { defaults.removePersistentDomain(forName: name) }
    let store = RemoteSpecialKeyStore(defaults: defaults)
    var editor = store.presets[0]
    editor.title = "Discard me"; editor.chord = .init(key: "right", modifiers: [.shift])
    XCTAssertEqual(RemoteSpecialKeyStore(defaults: defaults).presets, store.presets)
    XCTAssertEqual(store.presets[0].request(id: "original").shortcut, .controlC)
    XCTAssertFalse(store.save(.init(title: "", chord: editor.chord)))
    XCTAssertFalse(store.save(.init(title: "Invalid", chord: .init(key: "shell command"))))
  }
  func testCustomLimitAndCorruptStorageArePreserved() throws {
    let name = "special-key-limits-\(UUID())", defaults = try XCTUnwrap(UserDefaults(suiteName: name))
    defer { defaults.removePersistentDomain(forName: name) }
    let store = RemoteSpecialKeyStore(defaults: defaults)
    for number in 0..<40 { XCTAssertTrue(store.save(.init(title: "Key \(number)", chord: .init(key: "f1")))) }
    XCTAssertFalse(store.canAdd)
    XCTAssertFalse(store.save(.init(title: "Extra", chord: .init(key: "f2"))))
    let corrupt = Data("invalid saved data".utf8)
    defaults.set(corrupt, forKey: RemoteSpecialKeyStore.storageKey)
    let reloaded = RemoteSpecialKeyStore(defaults: defaults)
    XCTAssertNotNil(reloaded.error)
    XCTAssertFalse(reloaded.save(store.presets[0]))
    XCTAssertEqual(defaults.data(forKey: RemoteSpecialKeyStore.storageKey), corrupt)
  }
}
