import ClawDadRemoteAssistProtocol
import Foundation
import SwiftUI

@MainActor
final class RemoteDictationDraft: ObservableObject {
  @Published var text = ""
  @Published private(set) var transcribing = false
  @Published private(set) var sending = false
  @Published private(set) var error = ""
  @Published private(set) var notice = ""
  @Published private(set) var hasRecording = false
  @Published private(set) var computerName = "your computer"

  private weak var session: CloudSession?
  private var computerScope = ""
  private var recording: VoiceRecording?
  private var recordingBase = ""
  private var generation = UUID()
  private var transcriptionRequestId: String?
  private var deliveryRequestId = ""
  private var deliveryText = ""

  var belongsToActiveComputer: Bool {
    !computerScope.isEmpty && computerScope == activeScope
  }

  private var activeScope: String {
    guard let session else { return "" }
    return "\(session.accountId)/\(session.workspaceId)/\(session.hostId)"
  }

  func bind(to session: CloudSession) { self.session = session }

  func beginRecording() {
    cancelTranscription()
    if !belongsToActiveComputer { text = "" }
    computerScope = activeScope
    computerName = session?.activeComputerName ?? "your computer"
    recordingBase = text
    recording = nil
    hasRecording = false
    error = ""
    notice = ""
  }

  func retain(_ recording: VoiceRecording) {
    self.recording = recording
    hasRecording = true
    notice = "Recording saved. Tap Transcribe when you are ready."
  }

  func transcribe(_ recording: VoiceRecording) {
    retain(recording)
    retryTranscription()
  }

  func retryTranscription() {
    guard !transcribing, let recording, let session else { return }
    guard belongsToActiveComputer else {
      error = "Return to \(computerName) to transcribe this recording."
      return
    }
    let generation = UUID()
    self.generation = generation
    recordingBase = text
    transcribing = true
    error = ""
    notice = ""
    transcriptionRequestId = session.transcribeVoice(
      recording.data, fileName: recording.fileName, mimeType: recording.mimeType,
      duration: recording.duration, projectPath: ""
    ) { [weak self] result in
      guard let self, self.generation == generation else { return }
      self.transcriptionRequestId = nil
      self.transcribing = false
      switch result {
      case .success(let transcript):
        guard self.belongsToActiveComputer else {
          self.error = "Return to \(self.computerName) to finish this draft."
          return
        }
        self.text = self.recordingBase.isEmpty
          ? transcript : self.recordingBase + "\n\n" + transcript
        self.recording = nil
        self.hasRecording = false
      case .failure(let error):
        self.error = error.localizedDescription
      }
    }
  }

  func cancelTranscription() {
    generation = UUID()
    if let transcriptionRequestId {
      session?.cancelVoiceTranscription(requestId: transcriptionRequestId)
    }
    transcriptionRequestId = nil
    transcribing = false
  }

  func beginDelivery() -> (requestId: String, text: String)? {
    guard !sending, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    guard belongsToActiveComputer else {
      error = "Return to \(computerName) to use this draft, or copy it to your iPhone."
      return nil
    }
    if deliveryRequestId.isEmpty || deliveryText != text {
      deliveryRequestId = UUID().uuidString.lowercased()
      deliveryText = text
    }
    sending = true
    error = ""
    notice = ""
    return (deliveryRequestId, text)
  }

  func completeDelivery(requestId: String, result: Result<RemoteDictationDisposition, VoiceTranscriptionError>) {
    guard sending, requestId == deliveryRequestId else { return }
    sending = false
    switch result {
    case .success(let disposition):
      switch disposition {
      case .inserted: notice = "Inserted on \(computerName). Also copied to its clipboard."
      case .copied: notice = "Copied to \(computerName) clipboard. Paste whenever you are ready."
      case .pasteRequested: notice = "Copied to \(computerName) and sent Paste to the focused app. If it did not appear, paste from the clipboard."
      }
      deliveryRequestId = ""
    case .failure(let error):
      self.error = error.localizedDescription
    }
  }

  func copiedToPhone() {
    error = ""
    notice = "Copied to iPhone clipboard."
  }

  func clear() {
    guard !sending else { return }
    cancelTranscription()
    text = ""
    recording = nil
    recordingBase = ""
    hasRecording = false
    error = ""
    notice = ""
    deliveryRequestId = ""
    deliveryText = ""
  }
}
