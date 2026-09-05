import ClawDadRemoteAssistProtocol
import Foundation

/// One delivery is a synchronous clipboard write followed by an optional insert.
/// Receipts prevent a retried request from inserting the same text twice.
@MainActor
final class MacDictationDelivery {
  private var receipts: [String: (text: String, response: RemoteClipboardMessage)] = [:]
  private var receiptOrder: [String] = []

  func deliver(
    _ message: RemoteClipboardMessage,
    copy: (String) -> Bool,
    insert: (String) -> Bool
  ) -> RemoteClipboardMessage {
    guard message.action == .dictation,
          message.type == RemoteClipboardMessage.commandType,
          (try? RemoteClipboardCodec.encode(message)) != nil,
          let text = message.text else {
      return .failure(action: .dictation, requestId: message.requestId,
                      error: "The dictation request is invalid.")
    }
    if let receipt = receipts[message.requestId] {
      guard receipt.text == text else {
        return .failure(action: .dictation, requestId: message.requestId,
                        error: "This dictation request was already used for different text.")
      }
      return receipt.response
    }
    guard copy(text) else {
      return .failure(action: .dictation, requestId: message.requestId,
                      error: "ClawDad could not copy the transcript to the Mac clipboard.")
    }
    let response = RemoteClipboardMessage.success(
      action: .dictation, requestId: message.requestId,
      disposition: insert(text) ? .inserted : .copied
    )
    receipts[message.requestId] = (text, response)
    receiptOrder.append(message.requestId)
    if receiptOrder.count > 32 {
      receipts.removeValue(forKey: receiptOrder.removeFirst())
    }
    return response
  }
}
