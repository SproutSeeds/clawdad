import Foundation
import XCTest
@testable import ClawDadMobile

@MainActor
final class AssistantTranscriptionReviewTests: XCTestCase {
  func testEditNearActualDeadlineHoldsAndSendsCorrectionExactlyOnce() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.transcribe = { _ in "Call the wrong name" }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.startVoice()
    audio.onUtterance?(Data([1]), true)
    await until { !controller.liveTranscript.isEmpty }
    try await Task.sleep(for: .milliseconds(1800))
    controller.editTranscription()
    XCTAssertEqual(controller.transcriptionReview, .editing)
    XCTAssertEqual(audio.captureMode, .off)
    controller.updateTranscriptionEdit("Call Cody\nabout the project.")
    controller.saveTranscriptionEdits()
    try await Task.sleep(for: .milliseconds(450))
    XCTAssertTrue(transport.sentTexts.isEmpty)
    XCTAssertEqual(controller.transcriptionReview, .held)
    XCTAssertEqual(controller.liveTranscript, "Call Cody\nabout the project.")
    await controller.sendDraft(); await controller.sendDraft()
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Call Cody\nabout the project."])
    XCTAssertEqual(Set(transport.messageIDs).count, 1)
    XCTAssertTrue(controller.voiceActive)
    XCTAssertEqual(transport.closes, 0)
  }

  func testCorrectionDetachesDelayedFinalAndPreviewWithoutBlockingExplicitSend() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 20_000_000)
    defer { controller.stop() }
    var latePreview: CheckedContinuation<String, Never>?, lateFinal: CheckedContinuation<String, Never>?
    transport.transcribe = { data in
      if data == Data([1]) { return "Visible mistaken words" }
      return await withCheckedContinuation { if data == Data([2]) { latePreview = $0 } else { lateFinal = $0 } }
    }
    await controller.startVoice()
    audio.onTranscriptPreview?(Data([1]))
    await until { !controller.liveTranscript.isEmpty }
    audio.onTranscriptPreview?(Data([2]))
    await until { latePreview != nil }
    audio.finishData = Data([3])
    controller.editTranscription() // Drains pre-tap audio, suspends the timer immediately.
    await until { lateFinal != nil }
    controller.updateTranscriptionEdit("My exact correction")
    for _ in 0..<20 { audio.onSpeechStarted?(); audio.onUtterance?(Data([9]), true); audio.onTranscriptPreview?(Data([9])) }
    controller.saveTranscriptionEdits(); controller.sendVoiceNow()
    await until { transport.sentTexts.count == 1 }
    latePreview?.resume(returning: "OLD partial")
    lateFinal?.resume(returning: "OLD final text")
    await settle()
    XCTAssertEqual(transport.sentTexts, ["My exact correction"])
    XCTAssertTrue(controller.liveTranscript.isEmpty)
    XCTAssertEqual(transport.transcriptions, 3)
  }

  func testPreTapFinalWordsCanFinishBeforeTheFirstEditButNeverAutoSend() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 20_000_000)
    defer { controller.stop() }
    var final: CheckedContinuation<String, Never>?
    transport.transcribe = { _ in await withCheckedContinuation { final = $0 } }
    await controller.startVoice(); audio.onUtterance?(Data([1]), true)
    await until { final != nil }
    controller.editTranscription()
    final?.resume(returning: "All words captured before editing")
    await until { controller.transcriptionEditText == "All words captured before editing" }
    await settle()
    XCTAssertTrue(transport.sentTexts.isEmpty)
    controller.saveTranscriptionEdits()
    XCTAssertEqual(controller.liveTranscript, "All words captured before editing")
    XCTAssertEqual(controller.transcriptionReview, .held)
  }

  func testClearPendingFinalAndPreviewNeverRevivesDiscardedWordsAndAllowsFreshTurn() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 40_000_000)
    defer { controller.stop() }
    var final: CheckedContinuation<String, Never>?
    transport.transcribe = { data in
      if data == Data([2]) { return await withCheckedContinuation { final = $0 } }
      return data == Data([1]) ? "Discard this turn" : "Fresh turn"
    }
    await controller.startVoice(); audio.onTranscriptPreview?(Data([1]))
    await until { !controller.liveTranscript.isEmpty }
    audio.finishData = Data([2])
    controller.requestClearTranscription()
    await until { final != nil }
    controller.sendVoiceNow()
    await settle()
    XCTAssertTrue(controller.transcriptionClearPresented)
    XCTAssertTrue(transport.sentTexts.isEmpty)
    controller.hideTranscriptionClearPrompt() // Native alert binding may dismiss first.
    controller.clearTranscription()
    await until { !controller.transcriptionCapturePaused }
    XCTAssertTrue(controller.liveTranscript.isEmpty)
    XCTAssertEqual(controller.transcriptionReview, .listening)
    XCTAssertEqual(audio.captureMode, .conversation)
    audio.onUtterance?(Data([3]), true)
    final?.resume(returning: "Discarded late final")
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Fresh turn"])
    XCTAssertTrue(controller.voiceActive)
  }

  func testCancelPreservesAndHoldsUntilResumeWithFreshAutomaticDeadline() async throws {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.transcribe = { _ in "Keep these words" }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 200_000_000)
    defer { controller.stop() }
    await controller.startVoice(); audio.onUtterance?(Data([1]), true)
    await until { !controller.liveTranscript.isEmpty }
    controller.requestClearTranscription()
    try await Task.sleep(for: .milliseconds(250))
    controller.hideTranscriptionClearPrompt(); controller.cancelClearTranscription()
    XCTAssertEqual(controller.liveTranscript, "Keep these words")
    XCTAssertEqual(controller.transcriptionReview, .held)
    await settle()
    XCTAssertTrue(transport.sentTexts.isEmpty)
    await controller.resumeTranscriptionListening()
    try await Task.sleep(for: .milliseconds(80))
    XCTAssertTrue(transport.sentTexts.isEmpty, "Cancel/Resume must not inherit the expired pre-dialog deadline")
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Keep these words"])
  }

  func testMutedThinkAloudClearAndCancelPreserveTypedImagesAndHistory() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("transcript-review-\(UUID())")
    defer { try? FileManager.default.removeItem(at: root) }
    let draft = AssistantChatDraftStore(root: root); draft.bind("")
    draft.setText("Unrelated typed draft")
    let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!
    let image = try RemoteImagePreparation.prepare(png); try draft.add([image], to: "")
    let before = draft.value
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.addReply("Existing history"); transport.transcribe = { _ in "A separate voice turn" }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 20_000_000, chatDraft: draft)
    defer { controller.stop() }
    controller.setWaitForSend(true)
    await controller.startVoice(); audio.onUtterance?(Data([1]), true)
    await until { !controller.liveTranscript.isEmpty }
    controller.muteMicrophone(); controller.editTranscription()
    controller.updateTranscriptionEdit("Corrected voice")
    controller.requestClearTranscription(); controller.cancelClearTranscription()
    XCTAssertEqual(controller.transcriptionReview, .editing)
    XCTAssertEqual(controller.transcriptionEditText, "Corrected voice")
    controller.leaveTranscriptionEditor()
    XCTAssertEqual(controller.transcriptionReview, .held)
    try await controller.refresh()
    controller.applicationForegroundChanged(false); controller.applicationForegroundChanged(true)
    XCTAssertEqual(controller.liveTranscript, "Corrected voice")
    controller.requestClearTranscription(); controller.clearTranscription()
    await until { !controller.transcriptionCapturePaused }
    XCTAssertTrue(controller.waitForSend)
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(audio.captureMode, .off)
    XCTAssertEqual(draft.value, before)
    XCTAssertEqual(try draft.bytes(image.upload, scope: ""), png)
    XCTAssertEqual(transport.messages.count, 1)
    XCTAssertTrue(transport.sentTexts.isEmpty)
  }

  func testInfinityCannotReleaseEditHoldAndMutedCorrectionStillSendsOnce() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.transcribe = { _ in "Original" }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 20_000_000)
    defer { controller.stop() }
    controller.setWaitForSend(true)
    await controller.startVoice(); audio.onUtterance?(Data([1]), true)
    await until { !controller.liveTranscript.isEmpty }
    controller.muteMicrophone(); controller.editTranscription(); controller.updateTranscriptionEdit("Corrected")
    controller.setWaitForSend(false)
    await settle()
    XCTAssertTrue(transport.sentTexts.isEmpty)
    await controller.sendDraft(); await controller.sendDraft()
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Corrected"])
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(audio.captureMode, .off)
  }

  func testEmptyDraftAndErasedEditorCannotSubmitAndClearReadiesTheCall() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.startVoice()
    controller.editTranscription(); controller.requestClearTranscription(); controller.clearTranscription()
    XCTAssertFalse(controller.transcriptionClearPresented)
    XCTAssertEqual(controller.transcriptionReview, .listening)
    audio.onSpeechStarted?(); controller.editTranscription(); controller.updateTranscriptionEdit("")
    controller.saveTranscriptionEdits(); controller.sendVoiceNow()
    XCTAssertFalse(controller.canSendVoice)
    XCTAssertEqual(controller.transcriptionReview, .held)
    XCTAssertTrue(transport.sentTexts.isEmpty)
    controller.requestClearTranscription(); controller.clearTranscription()
    await until { !controller.transcriptionCapturePaused }
    XCTAssertFalse(controller.canSendVoice)
    XCTAssertEqual(controller.transcriptionReview, .listening)
  }

  func testClearNewDraftPreservesPreviouslyCommittedPendingTurn() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    var first: CheckedContinuation<String, Never>?
    transport.transcribe = { _ in await withCheckedContinuation { first = $0 } }
    controller.setWaitForSend(true)
    await controller.startVoice(); audio.onUtterance?(Data([1]), true)
    await until { first != nil }
    controller.sendVoiceNow()
    audio.onSpeechStarted?(); audio.onUtterance?(Data([2]), true)
    controller.requestClearTranscription(); controller.clearTranscription()
    first?.resume(returning: "Previously committed request")
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Previously committed request"])
    XCTAssertEqual(transport.transcriptions, 1)
  }

  func testReconnectDoesNotReleaseHeldEditsAndUncertainReceiptKeepsOneDelivery() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.transcribe = { _ in "Original" }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 20_000_000)
    defer { controller.stop() }
    await controller.startVoice(); audio.onUtterance?(Data([1]), true)
    await until { !controller.liveTranscript.isEmpty }
    controller.editTranscription(); controller.updateTranscriptionEdit("Preserved correction")
    controller.leaveTranscriptionEditor()
    transport.connected = false; transport.onChange?()
    transport.connected = true; transport.onChange?()
    await settle()
    XCTAssertEqual(controller.liveTranscript, "Preserved correction")
    XCTAssertTrue(transport.sentTexts.isEmpty)
    transport.failAfterAcceptance = true; transport.disconnectOnFailure = true
    transport.onReconnect = { transport.connected = true; transport.onChange?() }
    controller.sendVoiceNow()
    await until { transport.messageIDs.count == 2 }
    XCTAssertEqual(transport.sentTexts, ["Preserved correction"])
    XCTAssertEqual(Set(transport.messageIDs).count, 1)
  }

  func testThinkAloudResumeKeepsModeAndAppendsOnlyFreshSpeech() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.transcribe = { String(decoding: $0, as: UTF8.self) }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 20_000_000)
    defer { controller.stop() }
    controller.setWaitForSend(true)
    await controller.startVoice(); audio.onUtterance?(Data("First".utf8), true)
    await until { !controller.liveTranscript.isEmpty }
    controller.editTranscription(); controller.updateTranscriptionEdit("Corrected first.")
    await controller.resumeTranscriptionListening()
    audio.onUtterance?(Data("Fresh second.".utf8), true)
    await until { controller.liveTranscript == "Corrected first. Fresh second." }
    await settle()
    XCTAssertTrue(controller.waitForSend)
    XCTAssertTrue(transport.sentTexts.isEmpty)
    controller.sendVoiceNow()
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Corrected first. Fresh second."])
  }

  func testCaptureFailureRetainsHeldCorrectionAndManualOffWinsOverResume() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.transcribe = { _ in "Original" }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil)
    defer { controller.stop() }
    await controller.startVoice(); audio.onUtterance?(Data([1]), true)
    await until { !controller.liveTranscript.isEmpty }
    controller.editTranscription(); controller.updateTranscriptionEdit("Protected correction")
    audio.onCaptureFailure?(AssistantMicrophoneError.interrupted)
    XCTAssertEqual(controller.liveTranscript, "Protected correction")
    var waiting: CheckedContinuation<Void, Never>?
    audio.beforeUnmute = { await withCheckedContinuation { waiting = $0 } }
    let resume = Task { await controller.resumeTranscriptionListening(unmute: true) }
    await until { waiting != nil }
    controller.muteMicrophone()
    waiting?.resume(); await resume.value
    XCTAssertTrue(controller.muted)
    XCTAssertEqual(audio.captureMode, .off)
    XCTAssertEqual(controller.liveTranscript, "Protected correction")
    XCTAssertTrue(transport.sentTexts.isEmpty)
  }

  func testNewEditCancelsAnInFlightMicrophoneResumeAtTheCaptureBoundary() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.transcribe = { _ in "Original words" }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 20_000_000)
    defer { controller.stop() }
    await controller.startVoice(); audio.onUtterance?(Data([1]), true)
    await until { !controller.liveTranscript.isEmpty }
    controller.editTranscription(); controller.updateTranscriptionEdit("First correction")
    var waiting: CheckedContinuation<Void, Never>?
    audio.beforeUnmute = { await withCheckedContinuation { waiting = $0 } }
    let resume = Task { await controller.resumeTranscriptionListening() }
    await until { waiting != nil }
    controller.editTranscription(); controller.updateTranscriptionEdit("Second correction")
    waiting?.resume(); await resume.value
    await settle()
    XCTAssertEqual(controller.transcriptionReview, .editing)
    XCTAssertEqual(controller.liveTranscript, "Second correction")
    XCTAssertTrue(controller.transcriptionCapturePaused)
    XCTAssertFalse(controller.changingMicrophone)
    XCTAssertEqual(audio.captureMode, .off)
    XCTAssertTrue(transport.sentTexts.isEmpty)
  }

  func testEmptyFinalWhileEditingRetainsVisibleWordsForCorrection() async {
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.transcribe = { $0 == Data([1]) ? "Visible partial words" : "" }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, automaticSendDelay: 20_000_000)
    defer { controller.stop() }
    await controller.startVoice(); audio.onTranscriptPreview?(Data([1]))
    await until { !controller.liveTranscript.isEmpty }
    audio.finishData = Data([2])
    controller.editTranscription()
    await until { controller.microphoneNotice.contains("could not be finalized") }
    XCTAssertEqual(controller.transcriptionReview, .editing)
    XCTAssertEqual(controller.transcriptionEditText, "Visible partial words")
    XCTAssertTrue(transport.sentTexts.isEmpty)
    controller.updateTranscriptionEdit("Completed correction")
    await controller.sendDraft()
    await until { transport.sentTexts.count == 1 }
    XCTAssertEqual(transport.sentTexts, ["Completed correction"])
  }

  func testEndingCallSavesHeldCorrectionForReviewButNeverSavesClearedSpeech() async {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("review-end-call-\(UUID())")
    defer { try? FileManager.default.removeItem(at: root) }
    let store = AssistantChatDraftStore(root: root); store.bind("")
    store.setText("Typed separately")
    let audio = AssistantTestAudio(), transport = AssistantTestTransport()
    transport.transcribe = { _ in "Original speech" }
    let controller = MobileAssistantController(connection: transport, audio: audio, defaults: nil, chatDraft: store)
    defer { controller.stop() }
    await controller.startVoice(); audio.onUtterance?(Data([1]), true)
    await until { !controller.liveTranscript.isEmpty }
    controller.editTranscription(); controller.updateTranscriptionEdit("Held correction")
    controller.endVoice()
    let restored = AssistantChatDraftStore(root: root); restored.bind("")
    XCTAssertEqual(restored.value.text, "Typed separately")
    XCTAssertEqual(restored.value.recoveredVoice?.map(\.text), ["Held correction"])
    await controller.startVoice(); audio.onUtterance?(Data([2]), true)
    await until { !controller.liveTranscript.isEmpty }
    controller.requestClearTranscription(); controller.clearTranscription(); controller.endVoice()
    let reopened = AssistantChatDraftStore(root: root); reopened.bind("")
    XCTAssertEqual(reopened.value.recoveredVoice?.map(\.text), ["Held correction"])
    XCTAssertTrue(transport.sentTexts.isEmpty)
  }

  private func settle() async { try? await Task.sleep(for: .milliseconds(150)) }
  private func until(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
    for _ in 0..<500 { if condition() { return }; try? await Task.sleep(for: .milliseconds(10)) }
    XCTFail("Timed out waiting for the verified state", file: file, line: line)
  }
}
