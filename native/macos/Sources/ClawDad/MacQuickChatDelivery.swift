import ClawDadRemoteAssistProtocol
import Foundation

/// Retain the outcome even when insertion succeeds and submission is interrupted:
/// a replay must never append or submit the preset a second time.
@MainActor
final class MacQuickChatDelivery {
  private var receipts: [String: (RemoteQuickChatMessage, RemoteQuickChatMessage)] = [:]
  private var order: [String] = []
  private var inFlight = Set<String>()

  func deliver(_ request: RemoteQuickChatMessage,
               insertIfCurrent: () async -> Bool,
               submitIfCurrent: () async -> Bool) async -> RemoteQuickChatMessage {
    guard request.type == "quick.chat", (try? request.encode()) != nil else {
      return request.result(error: "This Quick Chat preset is invalid.")
    }
    if let (previous, response) = receipts[request.requestId] {
      return previous == request ? response : request.result(error: "This Quick Chat request was already used.")
    }
    guard inFlight.insert(request.requestId).inserted else {
      return request.result(error: "This preset is already being sent.")
    }
    defer { inFlight.remove(request.requestId) }
    let response: RemoteQuickChatMessage
    let inserted = Task.isCancelled ? false : await insertIfCurrent()
    if !inserted {
      response = request.result(error: "Preset not sent. Tap the intended Mac input, then reopen Quick Chat.")
    } else {
      let submitted = Task.isCancelled ? false : await submitIfCurrent()
      response = submitted ? request.result() : request.result(error: "The text was inserted, but Enter was not sent because the input changed. Check the Mac before sending again.")
    }
    receipts[request.requestId] = (request, response)
    order.append(request.requestId)
    if order.count > 64 { receipts.removeValue(forKey: order.removeFirst()) }
    return response
  }
}
