import Foundation
import SwiftUI

struct AssistantReplyNotification: Codable, Equatable, Sendable, Identifiable {
  var id: String { eventId }
  let version: Int
  let kind: String
  let eventId: String
  let conversationId: String
  let requestId: String
  let replyId: String
  let completedAt: String
  let accountId: String
  let workspaceId: String
  let hostId: String
  var scope: String { "\(accountId)/\(workspaceId)/\(hostId)" }

  static func parse(_ userInfo: [AnyHashable: Any]) -> Self? {
    guard let value = userInfo["clawdad"] as? [String: Any],
      let data = try? JSONSerialization.data(withJSONObject: value),
      let result = try? JSONDecoder().decode(Self.self, from: data), result.valid else { return nil }
    return result
  }
  var valid: Bool {
    let date = ISO8601DateFormatter()
    date.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let fractional = date.date(from: completedAt)
    date.formatOptions = [.withInternetDateTime]
    return version == 1 && kind == "assistant_reply"
      && eventId.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
      && UUID(uuidString: conversationId) != nil
      && !requestId.isEmpty && requestId.utf8.count <= 128
      && replyId.utf8.count <= 512 && replyId.hasPrefix("assistant:\(requestId):")
      && [requestId, replyId, accountId, workspaceId, hostId].allSatisfy {
        !$0.isEmpty && $0.rangeOfCharacter(from: .controlCharacters) == nil
      } && [accountId, workspaceId, hostId].allSatisfy { $0.utf8.count <= 160 }
      && (fractional != nil || date.date(from: completedAt) != nil)
  }
  func matches(_ computer: PairedComputerProfile) -> Bool {
    computer.accountId == accountId && computer.workspaceId == workspaceId && computer.hostId == hostId
  }
}

/// A tap survives cold launch/reconnect; repeated callbacks never toggle Stop.
@MainActor
final class AssistantReplyNavigation: ObservableObject {
  static let shared = AssistantReplyNavigation(defaults: .standard)
  private let defaults: UserDefaults?
  private let pendingKey = "clawdad.assistant.notification.pending"
  private let playbackKey = "clawdad.assistant.notification.playback"
  @Published private(set) var pending: AssistantReplyNotification?
  private var played: [String]
  var visibleScope: String?
  var visibleConversationId: String?
  var viewingLatest = false
  var foreground = true
  init(defaults: UserDefaults?) {
    self.defaults = defaults
    #if DEBUG
    if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-notification-reset") {
      defaults?.removeObject(forKey: pendingKey); defaults?.removeObject(forKey: playbackKey)
    }
    #endif
    played = defaults?.stringArray(forKey: playbackKey) ?? []
    if let data = defaults?.data(forKey: pendingKey),
      let target = try? JSONDecoder().decode(AssistantReplyNotification.self, from: data), target.valid { pending = target }
  }
  func receive(_ target: AssistantReplyNotification) {
    guard target.valid else { return }
    pending = target
    defaults?.set(try? JSONEncoder().encode(target), forKey: pendingKey)
  }
  func beginPlayback(_ target: AssistantReplyNotification) -> Bool {
    let identity = "\(target.scope)/\(target.eventId)"
    guard !played.contains(identity) else { return false }
    played.append(identity); played = Array(played.suffix(256))
    defaults?.set(played, forKey: playbackKey)
    return true
  }
  func finishOpening(_ target: AssistantReplyNotification) {
    guard pending == target else { return }
    pending = nil; defaults?.removeObject(forKey: pendingKey)
  }
  func suppressInterruption(_ target: AssistantReplyNotification) -> Bool {
    foreground && viewingLatest && visibleScope == target.scope && visibleConversationId == target.conversationId
  }
}
