import ClawDadRemoteAssistProtocol
import CryptoKit
import Foundation
import SwiftUI

@MainActor
final class RemoteTerminalReader: ObservableObject {
  @Published private(set) var loading = false
  @Published private(set) var title = "Terminal response"
  @Published private(set) var text = ""
  @Published private(set) var completedAt = ""
  @Published private(set) var inProgress = false
  @Published private(set) var error = ""
  @Published private(set) var playbackKey = ""
  @Published private(set) var sourceTabId = ""
  private(set) var pendingRequest: RemoteTerminalResponseMessage?
  private(set) var selectionRequestId: String?
  private weak var session: CloudSession?
  private var scope = ""

  private var activeScope: String {
    guard let session else { return "" }
    return "\(session.accountId)/\(session.workspaceId)/\(session.hostId)"
  }

  func bind(to session: CloudSession) { self.session = session }

#if DEBUG
  func preparePreview() {
    scope = activeScope
    title = "ClawDad"
    text = "The latest response belongs to the selected Terminal tab. You can listen here and keep working in Remote Assist."
    completedAt = "2026-09-05T08:00:00Z"
    playbackKey = "remote-reader-preview"
  }
#endif

  func beginLookup() {
    invalidate(stoppingPlayback: true)
    scope = activeScope
    loading = true
  }

  func expect(_ request: RemoteTerminalResponseMessage) {
    sourceTabId = request.tabId
    pendingRequest = request
  }

  @discardableResult
  func receive(_ message: RemoteTerminalResponseMessage, selectedTabId: String) -> Bool {
    guard loading, let pendingRequest,
          message.type == RemoteTerminalResponseMessage.resultType,
          message.requestId == pendingRequest.requestId,
          message.tabId == pendingRequest.tabId, message.tabId == selectedTabId,
          message.expectedRevision == pendingRequest.expectedRevision,
          scope == activeScope else { return false }
    self.pendingRequest = nil
    loading = false
    guard message.ok == true, let response = message.response else {
      error = message.error ?? "The latest response could not be read. Try selected text instead."
      return true
    }
    title = message.tabTitle ?? "Terminal response"
    text = response.text
    completedAt = response.completedAt
    inProgress = response.inProgress
    playbackKey = "remote-terminal:\(scope):\(sourceTabId):\(response.sessionId):\(response.turnId):\(fingerprint(text))"
    // The lookup returns only a completed answer, including when a later turn is running.
    togglePlayback()
    return true
  }

  func beginSelection(requestId: String, tabId: String) {
    beginLookup()
    title = "Selected Mac text"
    sourceTabId = tabId
    selectionRequestId = requestId
  }

  @discardableResult
  func receiveSelection(requestId: String, text: String) -> Bool {
    guard loading, selectionRequestId == requestId, scope == activeScope else { return false }
    selectionRequestId = nil
    loading = false
    self.text = text
    playbackKey = "remote-selection:\(scope):\(requestId):\(fingerprint(text))"
    togglePlayback()
    return true
  }

  func togglePlayback() {
    guard !text.isEmpty, !playbackKey.isEmpty, scope == activeScope else { return }
    session?.toggleRemoteReadAloud(key: playbackKey, text: text, title: title)
  }

  func stopPlayback() {
    if !playbackKey.isEmpty, session?.readAloud.activeKey == playbackKey {
      session?.readAloud.stop()
    }
  }

  func cancelLookup() {
    pendingRequest = nil
    selectionRequestId = nil
    loading = false
  }

  func fail(_ message: String) {
    cancelLookup()
    error = message
  }

  func invalidate(_ message: String = "", stoppingPlayback: Bool = false) {
    if stoppingPlayback { stopPlayback() }
    let retainedPlayback = session?.readAloud.activeKey == playbackKey ? playbackKey : ""
    cancelLookup()
    title = "Terminal response"
    text = ""
    completedAt = ""
    inProgress = false
    playbackKey = retainedPlayback
    sourceTabId = ""
    error = message
  }

  private func fingerprint(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
  }
}
