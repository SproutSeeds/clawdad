import ClawDadRemoteAssistProtocol
import Combine
import Foundation

extension RemoteShortcut {
  func keycap(isWindows: Bool) -> String {
    switch self {
    case .controlC: "⌃C"
    case .controlJ: "⌃J"
    case .escape: "esc"
    case .tab: "tab"
    case .arrowUp: "↑"
    case .arrowDown: "↓"
    case .arrowLeft: "←"
    case .arrowRight: "→"
    case .controlL: "⌃L"
    case .commandT: isWindows ? "⌃T" : "⌘T"
    case .commandTab: isWindows ? "alt⇥" : "⌘⇥"
    }
  }

  func accessibilityName(isWindows: Bool) -> String {
    switch self {
    case .controlC: "Control C"
    case .controlJ: "Control J"
    case .escape: "Escape"
    case .tab: "Tab"
    case .arrowUp: "Up Arrow"
    case .arrowDown: "Down Arrow"
    case .arrowLeft: "Left Arrow"
    case .arrowRight: "Right Arrow"
    case .controlL: "Control L"
    case .commandT:
      isWindows
        ? "Control T, open a new tab in the active Windows app"
        : "Command T, open a new tab in the active Mac app"
    case .commandTab:
      isWindows
        ? "Alt Tab, switch Windows app"
        : "Command Tab, switch Mac app"
    }
  }
}


extension RemoteKeyModifier {
  var label: String { rawValue.capitalized }
  var symbol: String {
    switch self { case .control: "⌃"; case .option: "⌥"; case .shift: "⇧"; case .command: "⌘" }
  }
}

extension RemoteKeyChord {
  static func keyLabel(_ key: String) -> String {
    ["left": "Left Arrow", "right": "Right Arrow", "up": "Up Arrow", "down": "Down Arrow",
      "enter": "Enter", "tab": "Tab", "escape": "Escape", "backspace": "Backspace",
      "forward_delete": "Forward Delete", "space": "Space", "home": "Home", "end": "End",
      "page_up": "Page Up", "page_down": "Page Down"][key] ?? key.uppercased()
  }
  var spokenName: String { (orderedModifiers.map(\.label) + [Self.keyLabel(key)]).joined(separator: " + ") }
  var keycap: String {
    orderedModifiers.map(\.symbol).joined() + (["left": "←", "right": "→", "up": "↑", "down": "↓",
      "enter": "↩", "tab": "⇥", "escape": "esc", "backspace": "⌫", "forward_delete": "⌦",
      "space": "space", "page_up": "⇞", "page_down": "⇟"][key] ?? key.uppercased())
  }
}

struct RemoteSpecialKeyPreset: Codable, Equatable, Identifiable, Sendable {
  var id: String = UUID().uuidString.lowercased()
  var title: String
  var chord: RemoteKeyChord

  static let legacy: [(RemoteShortcut, RemoteKeyChord)] = [
    (.controlC, .init(key: "c", modifiers: [.control])), (.controlJ, .init(key: "j", modifiers: [.control])),
    (.escape, .init(key: "escape")), (.tab, .init(key: "tab")),
    (.arrowUp, .init(key: "up")), (.arrowDown, .init(key: "down")),
    (.arrowLeft, .init(key: "left")), (.arrowRight, .init(key: "right")),
    (.controlL, .init(key: "l", modifiers: [.control])),
    (.commandT, .init(key: "t", modifiers: [.command])), (.commandTab, .init(key: "tab", modifiers: [.command]))
  ]
  static let defaults: [Self] = legacy.map { .init(id: $0.0.rawValue, title: $0.1.spokenName, chord: $0.1) }
    + [.init(id: "shift_left", title: "Shift + Left Arrow", chord: .init(key: "left", modifiers: [.shift]))]
  var original: Self? { Self.defaults.first { $0.id == id } }
  var isValid: Bool {
    !id.isEmpty && id.utf8.count <= 128 && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
      title.count <= 60 && !title.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) && chord.isValid
  }
  var legacyShortcut: RemoteShortcut? {
    Self.legacy.first { $0.1.key == chord.key && $0.1.orderedModifiers == chord.orderedModifiers }?.0
  }
  func request(id: String) -> RemoteInputMessage {
    if let legacyShortcut { return .shortcutRequest(shortcut: legacyShortcut, requestId: id) }
    return .chordRequest(chord: chord, requestId: id)
  }
  func keycap(isWindows: Bool) -> String {
    if isWindows, let legacyShortcut { return legacyShortcut.keycap(isWindows: true) }
    return chord.keycap
  }
  func spokenName(isWindows: Bool) -> String {
    if isWindows, let legacyShortcut { return legacyShortcut.accessibilityName(isWindows: true) }
    return chord.spokenName
  }
}

@MainActor
final class RemoteSpecialKeyStore: ObservableObject {
  static let storageKey = "clawdad.remote.specialKeys.v1"
  @Published private(set) var presets: [RemoteSpecialKeyPreset]
  @Published private(set) var error: String?
  private let defaults: UserDefaults
  init(defaults: UserDefaults? = nil) {
    self.defaults = defaults ?? Self.configuredDefaults()
    presets = RemoteSpecialKeyPreset.defaults
    if let data = self.defaults.data(forKey: Self.storageKey) {
      if let saved = try? JSONDecoder().decode([RemoteSpecialKeyPreset].self, from: data),
        saved.count <= 52, saved.filter({ $0.original == nil }).count <= 40,
        saved.allSatisfy(\.isValid), Set(saved.map(\.id)).count == saved.count {
        presets = RemoteSpecialKeyPreset.defaults.map { original in saved.first { $0.id == original.id } ?? original }
          + saved.filter { $0.original == nil }
      } else { error = "Saved special keys could not be loaded. They have been preserved on this iPhone." }
    }
  }
  private static func configuredDefaults() -> UserDefaults {
#if DEBUG && os(iOS)
    if ProcessInfo.processInfo.arguments.contains("--clawdad-special-keys-test"),
      let defaults = UserDefaults(suiteName: "clawdad.specialKeys.ui-tests") {
      if ProcessInfo.processInfo.arguments.contains("--clawdad-reset-special-keys") { defaults.removeObject(forKey: storageKey) }
      return defaults
    }
#endif
    return .standard
  }
  var canAdd: Bool { presets.filter { $0.original == nil }.count < 40 }
  @discardableResult func save(_ preset: RemoteSpecialKeyPreset) -> Bool {
    guard error == nil, preset.isValid else { return false }
    var next = presets
    if let index = next.firstIndex(where: { $0.id == preset.id }) { next[index] = preset }
    else { guard canAdd else { return false }; next.append(preset) }
    return persist(next)
  }
  func delete(_ id: String) {
    guard presets.first(where: { $0.id == id })?.original == nil else { return }
    _ = persist(presets.filter { $0.id != id })
  }
  private func persist(_ next: [RemoteSpecialKeyPreset]) -> Bool {
    guard error == nil, let data = try? JSONEncoder().encode(next) else { return false }
    defaults.set(data, forKey: Self.storageKey); presets = next; return true
  }
}

#if os(iOS)
import SwiftUI

struct RemoteSpecialKeysPanel: View {
  @ObservedObject var store: RemoteSpecialKeyStore
  var isWindows: Bool
  var unavailableReason: String?
  var supportsChords: Bool
  var onSend: (RemoteSpecialKeyPreset) -> Void
  var onBack: () -> Void
  var maximumHeight: CGFloat = 380
  @State private var managing = false
  @State private var draft: RemoteSpecialKeyPreset?
  @State private var deleting = false
  @AccessibilityFocusState private var headingFocused: Bool
  @FocusState private var titleFocused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 4) {
        Button(action: back) {
          Image(systemName: "chevron.left").font(.system(size: 14, weight: .black)).frame(width: 44, height: 44)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .accessibilityLabel(draft != nil ? "Cancel special key editing" : managing ? "Back to special keys" : "Back to Remote Assist controls")
        .accessibilityIdentifier("clawdad.specialKeys.back").keyboardShortcut(.escape, modifiers: [])
        Text(draft != nil ? "Edit key" : "Special Keys").font(.subheadline.bold())
          .accessibilityAddTraits(.isHeader).accessibilityFocused($headingFocused)
        Spacer(minLength: 0)
        if let draft {
          Button("Save") { if store.save(draft) { self.draft = nil; titleFocused = false; headingFocused = true } }
            .disabled(!draft.isValid || store.error != nil).frame(minWidth: 44, minHeight: 44)
            .accessibilityIdentifier("clawdad.specialKeys.save")
        } else {
          Button(managing ? "Done" : "Edit") { managing.toggle() }
            .frame(minWidth: 44, minHeight: 44).accessibilityIdentifier("clawdad.specialKeys.edit")
        }
      }
      ScrollView {
        if let value = draft { editor(value) }
        else {
          VStack(spacing: 8) {
            if managing {
              Button { draft = .init(title: "", chord: .init(key: "left", modifiers: [.shift])) } label: {
                Label("Add combination", systemImage: "plus").frame(maxWidth: .infinity, minHeight: 44)
              }
              .disabled(!store.canAdd || store.error != nil).accessibilityIdentifier("clawdad.specialKeys.add")
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
              ForEach(store.presets) { preset in presetButton(preset) }
            }
          }
        }
      }
      .scrollBounceBehavior(.basedOnSize)
      .frame(maxHeight: max(120, maximumHeight - 110))
      if let error = store.error { Text(error).font(.caption).foregroundStyle(ClawDadTheme.gold) }
      else if draft == nil, !managing, let reason = unavailableReason { Text(reason).font(.caption) }
      else if draft == nil, !managing, !supportsChords {
        Text(isWindows ? "Custom combinations require a supported Mac. Built-in keys remain available." : "Update ClawDad on the Mac to send custom combinations and Shift + Left Arrow.")
          .font(.caption).accessibilityIdentifier("clawdad.specialKeys.unavailable")
      }
    }
    .foregroundStyle(ClawDadTheme.cream).tint(ClawDadTheme.gold)
    .onAppear { headingFocused = true }
    .confirmationDialog("Delete this special key?", isPresented: $deleting, titleVisibility: .visible) {
      Button("Delete", role: .destructive) { if let draft { store.delete(draft.id) }; draft = nil }
      Button("Cancel", role: .cancel) {}
    }
  }

  private func presetButton(_ preset: RemoteSpecialKeyPreset) -> some View {
    let blocked = !managing && (unavailableReason != nil || (!supportsChords && preset.legacyShortcut == nil))
    let name = preset.title + ", " + preset.spokenName(isWindows: isWindows)
    return Button {
      if managing { draft = preset } else { onSend(preset) }
    } label: {
      VStack(spacing: 5) {
        Text(preset.keycap(isWindows: isWindows)).font(.system(.title3, design: .rounded).weight(.bold))
        HStack(spacing: 3) {
          Text(preset.title).font(.caption).lineLimit(2)
          if managing { Image(systemName: "pencil").font(.caption2) }
        }
      }
      .frame(maxWidth: .infinity, minHeight: 64).padding(6).contentShape(Rectangle())
    }
    .buttonStyle(.plain).hoverEffect(.highlight)
    .background(ClawDadTheme.cream.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
    .overlay(RoundedRectangle(cornerRadius: 9).stroke(ClawDadTheme.cream.opacity(0.2)))
    .disabled(blocked)
    .accessibilityLabel(name)
    .accessibilityHint(managing ? "Edit this key combination" : "Sends this key combination once to the focused computer input")
    .accessibilityIdentifier("clawdad.specialKeys.preset.\(preset.id)")
  }

  private func editor(_ value: RemoteSpecialKeyPreset) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      TextField("Button label", text: Binding(get: { draft?.title ?? "" }, set: { draft?.title = $0 }))
        .textFieldStyle(.plain).foregroundStyle(ClawDadTheme.cream).focused($titleFocused)
        .padding(10).frame(minHeight: 44)
        .background(ClawDadTheme.cream.opacity(0.09), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(ClawDadTheme.cream.opacity(0.25)))
        .accessibilityIdentifier("clawdad.specialKeys.title").accessibilityLabel("Button label")
      Menu {
        ForEach(RemoteKeyChord.supportedKeys, id: \.self) { key in
          Button(RemoteKeyChord.keyLabel(key)) { draft?.chord.key = key; titleFocused = false }
        }
      } label: {
        HStack { Text("Key"); Spacer(); Text(RemoteKeyChord.keyLabel(value.chord.key)); Image(systemName: "chevron.up.chevron.down") }
          .frame(minHeight: 44)
      }
      .accessibilityIdentifier("clawdad.specialKeys.key").accessibilityLabel("Key: " + RemoteKeyChord.keyLabel(value.chord.key))
      LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
        ForEach(RemoteKeyModifier.allCases, id: \.self) { modifier in
          let selected = value.chord.modifiers.contains(modifier)
          Button {
            if selected { draft?.chord.modifiers.removeAll { $0 == modifier } }
            else { draft?.chord.modifiers.append(modifier) }
            titleFocused = false
          } label: {
            HStack(spacing: 4) { Image(systemName: selected ? "checkmark.square.fill" : "square"); Text(modifier.label).font(.caption) }
              .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
          }
          .buttonStyle(.plain).hoverEffect(.highlight)
          .accessibilityLabel(modifier.label).accessibilityValue(selected ? "On" : "Off")
          .accessibilityAddTraits(selected ? .isSelected : [])
          .accessibilityIdentifier("clawdad.specialKeys.modifier.\(modifier.rawValue)")
        }
      }
      Text(value.chord.keycap).font(.title2.bold()).frame(maxWidth: .infinity)
        .accessibilityLabel(value.chord.spokenName)
      Text("Sends one key combination to the focused Mac input. Save does not send it.").font(.caption)
      if let original = value.original {
        Button("Restore default") { draft = original; titleFocused = false }
          .frame(minHeight: 44).accessibilityIdentifier("clawdad.specialKeys.restore")
      } else if store.presets.contains(where: { $0.id == value.id }) {
        Button("Delete combination", role: .destructive) { deleting = true }
          .frame(minHeight: 44).accessibilityIdentifier("clawdad.specialKeys.delete")
      }
      Button("Cancel", action: back).frame(maxWidth: .infinity, minHeight: 44)
        .accessibilityIdentifier("clawdad.specialKeys.cancel")
    }
  }
  private func back() {
    if deleting { deleting = false }
    else if draft != nil { draft = nil; titleFocused = false }
    else if managing { managing = false }
    else { onBack() }
    headingFocused = true
  }
}
#endif
