import Foundation

/// Closing is separate from focus/reorder: retries retain one operation identity,
/// and a native process warning requires a single-use, host-issued token.
public struct RemoteTerminalTabCloseMessage: Codable, Equatable, Sendable {
  public enum Outcome: String, Codable, Sendable { case closed, confirmationRequired, cancelled, failed }
  public let type: String
  public let requestId: String
  public let tabId: String
  public let expectedRevision: Int?
  public let confirmationToken: String?
  public let confirm: Bool?
  public let outcome: Outcome?
  public let prompt: String?
  public let confirmLabel: String?
  public let errorCode: String?
  public let state: RemoteTerminalTabState?

  public static func request(tabId: String, revision: Int, requestId: String) -> Self {
    Self(type: "terminal.tab.close", requestId: requestId, tabId: tabId, expectedRevision: revision,
      confirmationToken: nil, confirm: nil, outcome: nil, prompt: nil, confirmLabel: nil, errorCode: nil, state: nil)
  }
  public static func resolve(tabId: String, token: String, confirm: Bool, requestId: String) -> Self {
    Self(type: "terminal.tab.close.resolve", requestId: requestId, tabId: tabId, expectedRevision: nil,
      confirmationToken: token, confirm: confirm, outcome: nil, prompt: nil, confirmLabel: nil, errorCode: nil, state: nil)
  }
  public func result(_ outcome: Outcome, state: RemoteTerminalTabState?, token: String? = nil,
                     prompt: String? = nil, confirmLabel: String? = nil, errorCode: String? = nil) -> Self {
    Self(type: "terminal.tab.close.result", requestId: requestId, tabId: tabId, expectedRevision: nil,
      confirmationToken: token, confirm: nil, outcome: outcome, prompt: prompt,
      confirmLabel: confirmLabel, errorCode: errorCode, state: state)
  }
  public func encode() throws -> Data {
    try validate()
    let data = try JSONEncoder().encode(self)
    guard data.count <= RemoteTerminalTabMessage.maximumEnvelopeBytes else { throw RemoteTerminalTabProtocolError.envelopeTooLarge }
    return data
  }
  public static func decode(_ data: Data) throws -> Self {
    guard data.count <= RemoteTerminalTabMessage.maximumEnvelopeBytes else { throw RemoteTerminalTabProtocolError.envelopeTooLarge }
    let message = try JSONDecoder().decode(Self.self, from: data)
    try message.validate()
    return message
  }
  private func validate() throws {
    func bounded(_ text: String?, _ limit: Int) -> Bool { text.map { !$0.isEmpty && $0.utf8.count <= limit } ?? false }
    guard bounded(requestId, 128), bounded(tabId, 128) else { throw RemoteTerminalTabProtocolError.invalidMessage }
    if let prompt, !bounded(prompt, 2048) { throw RemoteTerminalTabProtocolError.invalidMessage }
    if let confirmLabel, !bounded(confirmLabel, 128) { throw RemoteTerminalTabProtocolError.invalidMessage }
    switch type {
    case "terminal.tab.close", "terminal.tab.close.resolve":
      guard outcome == nil, state == nil, prompt == nil, confirmLabel == nil, errorCode == nil else { throw RemoteTerminalTabProtocolError.invalidMessage }
      if type == "terminal.tab.close" {
        guard (expectedRevision ?? 0) > 0, confirmationToken == nil, confirm == nil else { throw RemoteTerminalTabProtocolError.invalidMessage }
      } else {
        guard expectedRevision == nil, bounded(confirmationToken, 128), confirm != nil else { throw RemoteTerminalTabProtocolError.invalidMessage }
      }
    case "terminal.tab.close.result":
      guard expectedRevision == nil, confirm == nil, let outcome else { throw RemoteTerminalTabProtocolError.invalidMessage }
      if let state { try state.validate() }
      if outcome == .confirmationRequired {
        guard bounded(confirmationToken, 128), bounded(prompt, 2048), bounded(confirmLabel, 128),
              state?.tabs.contains(where: { $0.id == tabId }) == true, errorCode == nil else { throw RemoteTerminalTabProtocolError.invalidMessage }
      } else {
        guard confirmationToken == nil, confirmLabel == nil else { throw RemoteTerminalTabProtocolError.invalidMessage }
        if outcome == .failed {
          guard bounded(errorCode, 64), bounded(prompt, 2048) else { throw RemoteTerminalTabProtocolError.invalidMessage }
        } else {
          guard state != nil, errorCode == nil, prompt == nil else { throw RemoteTerminalTabProtocolError.invalidMessage }
          if outcome == .closed, state?.tabs.contains(where: { $0.id == tabId }) != false { throw RemoteTerminalTabProtocolError.invalidState }
        }
      }
    default: throw RemoteTerminalTabProtocolError.invalidType
    }
  }
}
