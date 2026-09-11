import Foundation

public enum RemoteKeyModifier: String, Codable, CaseIterable, Equatable, Hashable, Sendable {
  case control, option, shift, command
}

/// One key press with balanced modifiers. Never a macro, text payload or command sequence.
public struct RemoteKeyChord: Codable, Equatable, Sendable {
  public var key: String
  public var modifiers: [RemoteKeyModifier]

  public init(key: String, modifiers: [RemoteKeyModifier] = []) {
    self.key = key
    self.modifiers = modifiers
  }

  public static let namedKeys = ["left", "right", "up", "down", "enter", "tab", "escape", "backspace",
    "forward_delete", "space", "home", "end", "page_up", "page_down"] + (1...12).map { "f\($0)" }
  public static let characterKeys = Array("abcdefghijklmnopqrstuvwxyz0123456789-=[]\\;',./`").map(String.init)
  public static let supportedKeys = namedKeys + characterKeys

  public var isValid: Bool {
    Self.supportedKeys.contains(key) && modifiers.count <= 4 && Set(modifiers).count == modifiers.count
  }

  public var orderedModifiers: [RemoteKeyModifier] { RemoteKeyModifier.allCases.filter(modifiers.contains) }
}
