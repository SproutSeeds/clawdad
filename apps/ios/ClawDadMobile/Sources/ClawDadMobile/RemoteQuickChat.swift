import ClawDadRemoteAssistProtocol
import Combine
import Foundation

struct RemoteQuickChatPreset: Codable, Equatable, Identifiable, Sendable {
  var id: String = UUID().uuidString.lowercased()
  var title: String
  var text: String

  var isValid: Bool {
    !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && title.count <= 60 &&
      (try? RemoteQuickChatMessage.request(text: text, targetToken: "validation", requestId: id).encode()) != nil
  }

  static let defaults: [Self] = [
    .init(id: "pwd", title: "Current directory", text: "pwd"),
    .init(id: "ls", title: "List files", text: "ls"),
    .init(id: "cd-up", title: "Parent directory", text: "cd .."),
    .init(id: "continue", title: "Continue implementation", text: "Continue with the next implementation steps."),
    .init(id: "discuss", title: "Discuss next steps", text: "Let’s discuss the next steps. Break it down.")
  ]
}

@MainActor
final class RemoteQuickChatStore: ObservableObject {
  static let storageKey = "clawdad.remote.quickChat.presets.v1"
  @Published private(set) var presets: [RemoteQuickChatPreset]
  private let defaults: UserDefaults

  init(defaults: UserDefaults? = nil) {
    let defaults = defaults ?? Self.configuredDefaults()
    self.defaults = defaults
    if let data = defaults.data(forKey: Self.storageKey),
       let saved = try? JSONDecoder().decode([RemoteQuickChatPreset].self, from: data),
       saved.count <= 40, saved.allSatisfy(\.isValid), Set(saved.map(\.id)).count == saved.count {
      presets = saved
    } else { presets = RemoteQuickChatPreset.defaults }
  }

  private static func configuredDefaults() -> UserDefaults {
#if DEBUG && os(iOS)
    if ProcessInfo.processInfo.arguments.contains("--clawdad-quick-chat-test"),
       let defaults = UserDefaults(suiteName: "clawdad.quickChat.ui-tests") {
      if ProcessInfo.processInfo.arguments.contains("--clawdad-reset-quick-chat") {
        defaults.removeObject(forKey: storageKey)
      }
      return defaults
    }
#endif
    return .standard
  }

  @discardableResult
  func save(_ preset: RemoteQuickChatPreset) -> Bool {
    guard preset.isValid else { return false }
    var next = presets
    if let index = next.firstIndex(where: { $0.id == preset.id }) { next[index] = preset }
    else {
      guard next.count < 40 else { return false }
      next.append(preset)
    }
    return persist(next)
  }

  func delete(_ id: String) { _ = persist(presets.filter { $0.id != id }) }

  private func persist(_ next: [RemoteQuickChatPreset]) -> Bool {
    guard let data = try? JSONEncoder().encode(next) else { return false }
    defaults.set(data, forKey: Self.storageKey)
    presets = next
    return true
  }
}

#if os(iOS)
import SwiftUI

struct RemoteQuickChatPanel: View {
  @ObservedObject var store: RemoteQuickChatStore
  var sending: Bool
  var unavailableReason: String?
  var onSend: (RemoteQuickChatPreset) -> Void
  var onBack: () -> Void
  @State private var managing = false
  @State private var draft: RemoteQuickChatPreset?
  @AccessibilityFocusState private var headingFocused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Button(action: back) {
          Image(systemName: "chevron.left").font(.system(size: 14, weight: .black))
            .frame(width: 36, height: 36)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .accessibilityLabel("Back")
        .accessibilityIdentifier("clawdad.quickChat.back")
        .keyboardShortcut(.escape, modifiers: [])
        Text(draft != nil ? "Edit preset" : "Quick Chat")
          .font(.subheadline.weight(.bold))
          .accessibilityAddTraits(.isHeader)
          .accessibilityFocused($headingFocused)
        Spacer(minLength: 0)
        if draft == nil {
          Button(managing ? "Done" : "Edit") { managing.toggle() }
            .frame(minWidth: 44, minHeight: 36)
            .accessibilityIdentifier("clawdad.quickChat.edit")
        }
      }
      if let value = draft {
        editor(value)
      } else {
        ScrollView {
          VStack(spacing: 6) {
            if store.presets.isEmpty {
              Text("Add your first preset with Edit.").font(.subheadline).padding(.vertical, 12)
            }
            ForEach(store.presets) { preset in
              Button {
                if managing { draft = preset } else { onSend(preset) }
              } label: {
                HStack(spacing: 8) {
                  VStack(alignment: .leading, spacing: 3) {
                    Text(preset.title).font(.subheadline.weight(.semibold))
                    Text(preset.text).font(.caption).foregroundStyle(ClawDadTheme.cream.opacity(0.7))
                      .lineLimit(2)
                  }
                  Spacer(minLength: 0)
                  Image(systemName: managing ? "pencil" : "arrow.up")
                    .font(.caption.weight(.bold))
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(8)
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .background(ClawDadTheme.cream.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
              .hoverEffect(.highlight)
              .disabled(!managing && (sending || unavailableReason != nil))
              .accessibilityIdentifier("clawdad.quickChat.preset.\(preset.id)")
              .accessibilityHint(managing ? "Edit this preset" : "Types this preset and presses Enter on your Mac")
            }
            if managing {
              Button {
                draft = .init(title: "", text: "")
              } label: {
                Label("Add preset", systemImage: "plus").frame(maxWidth: .infinity, minHeight: 44)
              }
              .disabled(store.presets.count >= 40)
              .accessibilityIdentifier("clawdad.quickChat.add")
            }
          }
        }
        .frame(maxHeight: 300)
        if !managing {
          Text(sending ? "Sending…" : unavailableReason ?? "Tap a preset to send immediately.")
            .font(.caption).foregroundStyle(ClawDadTheme.cream.opacity(0.75))
        }
      }
    }
    .foregroundStyle(ClawDadTheme.cream)
    .tint(ClawDadTheme.gold)
    .onAppear { headingFocused = true }
  }

  private func editor(_ value: RemoteQuickChatPreset) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      TextField("Button label", text: Binding(get: { draft?.title ?? "" }, set: { draft?.title = $0 }))
        .textFieldStyle(.roundedBorder).foregroundStyle(.primary)
        .accessibilityIdentifier("clawdad.quickChat.title")
      TextEditor(text: Binding(get: { draft?.text ?? "" }, set: { draft?.text = $0 }))
        .frame(height: 110).scrollContentBackground(.hidden)
        .padding(4).background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
        .autocorrectionDisabled().textInputAutocapitalization(.never)
        .accessibilityLabel("Preset text").accessibilityIdentifier("clawdad.quickChat.text")
      Text("Sends this exact text, then presses Enter.").font(.caption)
      HStack {
        if store.presets.contains(where: { $0.id == value.id }) {
          Button("Delete", role: .destructive) { store.delete(value.id); draft = nil }
            .frame(minHeight: 44).accessibilityIdentifier("clawdad.quickChat.delete")
        }
        Spacer()
        Button("Save") {
          if store.save(value) { draft = nil }
        }
        .frame(minWidth: 50, minHeight: 44).disabled(!value.isValid)
        .accessibilityIdentifier("clawdad.quickChat.save")
      }
    }
  }

  private func back() {
    if draft != nil { draft = nil }
    else if managing { managing = false }
    else { onBack() }
    headingFocused = true
  }
}
#endif
