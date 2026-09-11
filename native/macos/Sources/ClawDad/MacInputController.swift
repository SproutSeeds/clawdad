import AppKit
import ApplicationServices
import Carbon.HIToolbox
import ClawDadRemoteAssistProtocol
import CoreGraphics
import Foundation

@MainActor
final class MacInputController {
  private struct PendingInput {
    let message: RemoteInputMessage
    let respond: ((RemoteInputMessage) -> Void)?
  }

  private struct InputTarget {
    let pid: pid_t
    let applicationName: String
    let bundleIdentifier: String?
    let role: String
    let subrole: String?
    let element: AXUIElement
    let selectedTextSettable: Bool
    let screenLocked: Bool

    var requiresPhysicalKeystrokes: Bool {
      MacEditableTargetPolicy.requiresPhysicalKeystrokes(
        screenLocked: screenLocked,
        subrole: subrole
      )
    }

    var metadata: RemoteInputTarget {
      RemoteInputTarget(
        applicationName: applicationName,
        bundleIdentifier: bundleIdentifier,
        role: role
      )
    }
  }

  private struct PasteboardSnapshot {
    let items: [[NSPasteboard.PasteboardType: Data]]

    init(_ pasteboard: NSPasteboard) {
      items = pasteboard.pasteboardItems?.map { item in
        Dictionary(
          uniqueKeysWithValues: item.types.compactMap { type in
            guard let data = item.data(forType: type) else {
              return nil
            }
            return (type, data)
          }
        )
      } ?? []
    }

    func restore(to pasteboard: NSPasteboard) {
      pasteboard.clearContents()
      guard !items.isEmpty else {
        return
      }
      let restoredItems = items.map { values in
        let item = NSPasteboardItem()
        for (type, data) in values {
          item.setData(data, forType: type)
        }
        return item
      }
      pasteboard.writeObjects(restoredItems)
    }
  }

  private enum InputTargetError: Error {
    case accessibilityPermission
    case noApplication
    case noEditableElement(RemoteInputTarget?)
  }

  private let source: CGEventSource
  private let dictationDelivery = MacDictationDelivery.shared
  private let quickChatDelivery = MacQuickChatDelivery()
  private(set) var imagePasteInProgress = false
  private struct DictationTarget {
    let input: InputTarget
    let window: CFTypeRef?
    let selection: CFTypeRef?
    let applicationLaunch: Date?
  }
  private var dictationTargets = MacDictationTargetRegistry<DictationTarget>()
  private var inputGeneration: UInt64 = 0
  private var speechSelectionInProgress = false
  private var clipboardCopyTask: Task<Void, Never>?
  private var inputProcessingTask: Task<Void, Never>?
  private var inputQueue: [PendingInput] = []
  private var lastTargetPID: pid_t?
  private var lastPointerPoint: CGPoint?
  private var leftMouseButtonDown = false
  private var rightMouseButtonDown = false
  private var activeRemoteModifierKeyCodes: Set<CGKeyCode> = []
  private var activeDisplayID = CGMainDisplayID()
  private var pointerInputEnabled = true

  init?() {
    guard let source = CGEventSource(stateID: .privateState) else {
      return nil
    }
    self.source = source
  }

  func handle(
    _ data: Data,
    respondClipboard: @escaping (RemoteClipboardMessage) -> Void,
    respondInput: @escaping (RemoteInputMessage) -> Void
  ) {
    if let message = try? RemoteClipboardCodec.decode(data),
       message.type == RemoteClipboardMessage.commandType {
      handleClipboard(message, respond: respondClipboard)
      return
    }

    if let message = try? RemoteInputCodec.decode(data),
       message.type == RemoteInputMessage.commandType {
      enqueueInput(message, respond: respondInput)
      return
    }

    guard AXIsProcessTrusted(),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = object["type"] as? String else {
      return
    }

    switch type {
    case "pointer":
      handlePointer(object)
    case "scroll":
      handleScroll(object)
    case "text":
      let text = object["text"] as? String ?? ""
      guard !text.isEmpty else {
        return
      }
      enqueueInput(
        .textRequest(
          text: text,
          requestId: "legacy-\(UUID().uuidString.lowercased())"
        ),
        respond: nil
      )
    case "key":
      let key = object["key"] as? String ?? ""
      guard !key.isEmpty else {
        return
      }
      enqueueInput(
        .keyRequest(
          key: key,
          requestId: "legacy-\(UUID().uuidString.lowercased())"
        ),
        respond: nil
      )
    default:
      break
    }
  }

  func cancelPendingOperations() {
    invalidateDictationTarget()
    clipboardCopyTask?.cancel()
    clipboardCopyTask = nil
    inputProcessingTask?.cancel()
    inputProcessingTask = nil
    inputQueue.removeAll()
    releaseRemoteInputState()
  }

  func sendAssistantKey(_ key: String, modifiers: [String], targetPID: pid_t) -> Bool {
    guard AXIsProcessTrusted(), !MacConsoleSessionState.isLocked(),
      NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID,
      let stroke = assistantKeyStroke(key, modifiers: modifiers) else { return false }
    return postKeyStroke(stroke, targetPID: targetPID)
  }

  /// Uses the same approved shortcut plans as the phone's Special Commands.
  func sendAssistantRemoteKey(_ command: MacAssistantTerminalKey, targetPID: pid_t) -> Bool {
    guard AXIsProcessTrusted(), !MacConsoleSessionState.isLocked(),
      NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID else { return false }
    if let shortcut = command.shortcut { return pressRemoteShortcut(shortcut, targetPID: targetPID) }
    return pressKey(command.key ?? "", targetPID: targetPID)
  }

  func sendAssistantShortcut(_ shortcut: RemoteShortcut, targetPID: pid_t) -> Bool {
    guard AXIsProcessTrusted(), !MacConsoleSessionState.isLocked(),
      NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID else { return false }
    return pressRemoteShortcut(shortcut, targetPID: targetPID)
  }

  func finishAssistantPointer() { releaseRemoteInputState() }

  /// Targeted Terminal gestures use the same native mouse/scroll dispatch as
  /// Remote Assist, bounded by the inspected Terminal text area's rectangle.
  func sendAssistantTerminalPointer(action: String, point: CGPoint, end: CGPoint?,
    deltaX: Double, deltaY: Double, right: Bool, targetPID: pid_t) -> Bool {
    guard AXIsProcessTrusted(), !MacConsoleSessionState.isLocked(), pointerInputEnabled,
      NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID else { return false }
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit) == .success,
      let hit else { return false }
    var pid: pid_t = 0
    guard AXUIElementGetPid(hit, &pid) == .success, pid == targetPID else { return false }
    let button: CGMouseButton = right ? .right : .left
    establishTarget(at: point)
    postMouseEvent(type: .mouseMoved, point: point, button: button)
    switch action {
    case "move": return true
    case "scroll": handleScroll(["deltaX": deltaX, "deltaY": deltaY]); return true
    case "click", "drag":
      postMouseEvent(type: right ? .rightMouseDown : .leftMouseDown, point: point, button: button)
      let destination = end ?? point
      if action == "drag" { postMouseEvent(type: right ? .rightMouseDragged : .leftMouseDragged, point: destination, button: button) }
      postMouseEvent(type: right ? .rightMouseUp : .leftMouseUp, point: destination, button: button)
      return true
    default: return false
    }
  }

  func sendAssistantText(_ text: String, isAllowed: () -> Bool) async -> Bool {
    guard let target = eligibleDictationTarget(), isAllowed(), !MacConsoleSessionState.isLocked() else { return false }
    return await insertText(text, into: target)
  }

  func prepareForDisplayTransition() {
    invalidateDictationTarget()
    pointerInputEnabled = false
    lastTargetPID = nil
    releaseRemoteInputState()
  }

  func commitDisplayTransition(to displayID: CGDirectDisplayID) {
    activeDisplayID = displayID
    lastTargetPID = nil
    pointerInputEnabled = true
  }

  func cancelDisplayTransition() {
    lastTargetPID = nil
    pointerInputEnabled = true
  }

  func invalidateDictationTarget() { inputGeneration &+= 1 }

  func captureDictationTarget(
    _ request: RemoteSpeechContextMessage,
    terminalIdentity: @MainActor () async throws -> String?
  ) async -> RemoteSpeechContextMessage {
    // A retry returns the original capture, including a deliberate clipboard-only capture.
    if let previous = dictationTargets.capture(for: request.requestId) {
      if let failure = previous.failure { return request.failure(failure) }
      return request.success(token: request.requestId, targetName: previous.value?.input.applicationName)
    }
    if let inputProcessingTask { await inputProcessingTask.value }
    let input = eligibleDictationTarget()
    let generation = inputGeneration
    let capture = input.map { target in DictationTarget(
      input: target, window: attribute(target.element, kAXWindowAttribute as CFString),
      selection: attribute(target.element, kAXSelectedTextRangeAttribute as CFString),
      applicationLaunch: NSRunningApplication(processIdentifier: target.pid)?.launchDate
    ) }
    var selectedTerminal: String?
    var failure: String?
    if input?.bundleIdentifier == "com.apple.Terminal" {
      do {
        selectedTerminal = try await terminalIdentity()
        if selectedTerminal == nil { failure = "The Terminal input could not be identified. Your text can still be copied." }
      } catch { failure = error.localizedDescription }
    }
    if let capture, Task.isCancelled || generation != inputGeneration || !targetIsCurrent(capture) {
      failure = "The focused input changed while it was being captured. Your text can still be copied."
    }
    dictationTargets.remember(.init(value: capture, generation: generation,
      expiresAt: Date().addingTimeInterval(20 * 60), requiresTerminalIdentity: input?.bundleIdentifier == "com.apple.Terminal",
      terminalIdentity: selectedTerminal, failure: failure), token: request.requestId)
    if let failure { return request.failure(failure) }
    return request.success(token: request.requestId, targetName: input?.applicationName)
  }

  private func recoverTerminalIdentity(
    for capture: MacDictationTargetRegistry<DictationTarget>.Capture?,
    read: @MainActor () async throws -> String?
  ) async -> String? {
    guard let capture, let value = capture.value, capture.failure == nil else { return nil }
    return await macRecoverTerminalInputIdentity(expected: capture.terminalIdentity,
      isCurrent: { [self] in
        capture.generation == inputGeneration && capture.expiresAt > Date() && targetIsCurrent(value)
      }, read: read)
  }

  func deliverTargetedDictation(
    _ message: RemoteClipboardMessage,
    terminalIdentity: @MainActor () async throws -> String?
  ) async -> RemoteClipboardMessage {
    await waitForImagePaste()
    let capture = message.targetToken.flatMap { dictationTargets.capture(for: $0) }
    var selectedTerminal: String?
    if message.copyOnly != true, capture?.requiresTerminalIdentity == true {
      selectedTerminal = await recoverTerminalIdentity(for: capture, read: terminalIdentity)
    }
    guard !Task.isCancelled else {
      return .failure(action: .dictation, requestId: message.requestId, error: "Remote Assist disconnected. Your transcript is saved.")
    }
    return dictationDelivery.deliver(message, copy: copyDictation, insertWithReceipt: { [self] text in
      guard let token = message.targetToken,
            let target = dictationTargets.resolve(token: token, generation: inputGeneration,
              terminalIdentity: selectedTerminal, isCurrent: targetIsCurrent) else { return .copied }
      return insertDictation(text, into: target.input)
    })
  }

  func deliverImages(_ images: MacPreparedImages, request: RemoteImageAttachmentMessage,
                     isAllowed: @MainActor () -> Bool = { true },
                     terminalIdentity: @MainActor () async throws -> String?) async -> RemoteImageAttachmentMessage {
    if let inputProcessingTask { await inputProcessingTask.value }
    if let clipboardCopyTask { await clipboardCopyTask.value }
    guard isAllowed(), !speechSelectionInProgress, !MacConsoleSessionState.isLocked(), pointerInputEnabled else {
      return request.result(error: "Unlock the Mac and finish the current input operation, then retry your saved images.")
    }
    guard !Task.isCancelled, !MacConsoleSessionState.isLocked() else { return request.result(error: "The image is saved on the Mac. Reconnect to paste it.") }
    let previous = PasteboardSnapshot(NSPasteboard.general)
    guard images.copy(to: .general) else {
      previous.restore(to: .general)
      return request.result(error: "The Mac could not copy these images. Retry the saved attachment.")
    }
    guard request.copyOnly != true, let token = request.targetToken else { return request.result(disposition: "copied", pastedCount: 0) }
    imagePasteInProgress = true
    defer { imagePasteInProgress = false }
    var pasted = 0
    for index in images.urls.indices {
      guard !Task.isCancelled, let capture = dictationTargets.capture(for: token), capture.generation == inputGeneration else { break }
      let identity = await recoverTerminalIdentity(for: capture, read: terminalIdentity)
      guard !Task.isCancelled, isAllowed(), !MacConsoleSessionState.isLocked(), pointerInputEnabled,
            let target = dictationTargets.resolve(token: token, generation: inputGeneration,
              terminalIdentity: identity, isCurrent: targetIsCurrent),
            target.input.bundleIdentifier == "com.apple.Terminal",
            images.copy(to: .general, from: index, single: true),
            pressCommandShortcut(keyCode: 9, targetPID: target.input.pid) else { break }
      pasted += 1
      // Codex's composer recognizes one pasted image path per event. Keep the
      // clipboard stable while Terminal consumes Cmd-V, then send the next.
      try? await Task.sleep(nanoseconds: 180_000_000)
    }
    if pasted < images.urls.count { _ = images.copy(to: .general, from: pasted) }
    return request.result(disposition: pasted == images.urls.count ? "pasteRequested" : "copied", pastedCount: pasted)
  }

  func waitForImagePaste() async {
    while imagePasteInProgress, !Task.isCancelled { try? await Task.sleep(nanoseconds: 20_000_000) }
  }

  private func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
    return value
  }

  private func targetIsCurrent(_ capture: DictationTarget) -> Bool {
    targetIsCurrent(capture, checkSelection: true)
  }

  private func targetIsCurrent(_ capture: DictationTarget, checkSelection: Bool) -> Bool {
    let original = capture.input
    guard let current = eligibleDictationTarget(),
          original.pid == current.pid, CFEqual(original.element, current.element),
          capture.applicationLaunch == NSRunningApplication(processIdentifier: current.pid)?.launchDate,
          let originalWindow = capture.window,
          let window = attribute(current.element, kAXWindowAttribute as CFString),
          CFEqual(originalWindow, window) else { return false }
    if original.bundleIdentifier == "com.apple.Terminal" {
      return true // The registry also validates the exact selected native Terminal tab identity.
    }
    if checkSelection, let selection = capture.selection {
      guard let currentSelection = attribute(current.element, kAXSelectedTextRangeAttribute as CFString),
            CFEqual(selection, currentSelection) else { return false }
    }
    return true
  }

  /// Insert into the captured agent composer without sending Enter. The durable
  /// Assistant job owns replay protection; verification never repeats this paste.
  func insertAssistantDraft(_ text: String, targetToken token: String,
                            isAllowed: @MainActor () -> Bool,
                            verifyPaste: (@MainActor () async -> Bool)? = nil,
                            terminalIdentity: @MainActor () async throws -> String?) async -> Bool {
    if let inputProcessingTask { await inputProcessingTask.value }
    if let clipboardCopyTask { await clipboardCopyTask.value }
    await waitForImagePaste()
    let identity = await recoverTerminalIdentity(for: dictationTargets.capture(for: token), read: terminalIdentity)
    guard !Task.isCancelled, isAllowed(), !speechSelectionInProgress,
          let target = dictationTargets.resolve(token: token, generation: inputGeneration,
            terminalIdentity: identity, isCurrent: targetIsCurrent) else { return false }
    defer { invalidateDictationTarget() }
    if target.input.bundleIdentifier == "com.apple.Terminal", let verifyPaste {
      return await pasteTextPreservingClipboard(text, targetPID: target.input.pid, verify: verifyPaste)
    }
    return await insertText(text, into: target.input)
  }

  /// The verified Codex version handles one Ctrl-C on a nonempty composer as
  /// draft clear, before its idle/busy interrupt path. A second key is never sent.
  /// Never use Terminal's Select All (which selects scrollback), or send Enter.
  /// The caller verifies nonempty draft text and the authorized draft again synchronously
  /// in isAllowed, after the exact native tab identity has been resolved.
  func clearAssistantDraft(targetToken token: String,
                           isAllowed: @MainActor () -> Bool,
                           terminalIdentity: @MainActor () async throws -> String?) async -> Bool {
    if let inputProcessingTask { await inputProcessingTask.value }
    if let clipboardCopyTask { await clipboardCopyTask.value }
    await waitForImagePaste()
    let identity = await recoverTerminalIdentity(for: dictationTargets.capture(for: token), read: terminalIdentity)
    guard !Task.isCancelled, isAllowed(), !speechSelectionInProgress,
      let target = dictationTargets.resolve(token: token, generation: inputGeneration,
        terminalIdentity: identity, isCurrent: targetIsCurrent),
      target.input.bundleIdentifier == "com.apple.Terminal",
      let key = assistantKeyStroke("c", modifiers: ["control"]) else { return false }
    return postKeyStroke(key, targetPID: target.input.pid)
  }

  /// Queue only in the captured native Terminal input. The caller checks the
  /// active Codex turn, complete draft and live Tab hint immediately before this.
  func queueAssistantDraft(targetToken token: String,
                           isAllowed: @MainActor () -> Bool,
                           terminalIdentity: @MainActor () async throws -> String?) async -> Bool {
    if let inputProcessingTask { await inputProcessingTask.value }
    if let clipboardCopyTask { await clipboardCopyTask.value }
    await waitForImagePaste()
    let identity = await recoverTerminalIdentity(for: dictationTargets.capture(for: token), read: terminalIdentity)
    guard !Task.isCancelled, isAllowed(), !speechSelectionInProgress,
      let target = dictationTargets.resolve(token: token, generation: inputGeneration,
        terminalIdentity: identity, isCurrent: targetIsCurrent),
      target.input.bundleIdentifier == "com.apple.Terminal" else { return false }
    defer { invalidateDictationTarget() }
    return pressKey("tab", targetPID: target.input.pid)
  }

  func sendQuickChat(_ request: RemoteQuickChatMessage,
                    isAllowed: @MainActor () -> Bool = { true },
                    terminalIdentity: @MainActor () async throws -> String?) async -> RemoteQuickChatMessage {
    if let inputProcessingTask { await inputProcessingTask.value }
    if let clipboardCopyTask { await clipboardCopyTask.value }
    await waitForImagePaste()
    let token = request.targetToken ?? ""
    let needsTerminal = dictationTargets.capture(for: token)?.requiresTerminalIdentity == true
    return await quickChatDelivery.deliver(request, insertIfCurrent: { [self] in
      let identity = needsTerminal ? await recoverTerminalIdentity(for: dictationTargets.capture(for: token), read: terminalIdentity) : nil
      guard !Task.isCancelled, isAllowed(), !speechSelectionInProgress,
            let target = dictationTargets.resolve(token: token, generation: inputGeneration,
              terminalIdentity: identity, isCurrent: targetIsCurrent) else { return false }
      return await insertText(request.text ?? "", into: target.input)
    }, submitIfCurrent: { [self] in
      let identity = needsTerminal ? await recoverTerminalIdentity(for: dictationTargets.capture(for: token), read: terminalIdentity) : nil
      guard !Task.isCancelled, isAllowed(),
            let target = dictationTargets.resolve(token: token, generation: inputGeneration,
              terminalIdentity: identity, isCurrent: { targetIsCurrent($0, checkSelection: false) })
      else { return false }
      // Insertion moves the caret. Recheck the app, element, window and native
      // Terminal tab, then post Enter without another suspension point.
      let accepted = pressKey("enter", targetPID: target.input.pid)
      invalidateDictationTarget()
      return accepted
    })
  }

  /// Read AX selected text without touching either device's clipboard. Some apps
  /// expose selection only through Copy; preserve the complete pasteboard there.
  func readSpeechSelection(_ request: RemoteSpeechContextMessage) async -> RemoteSpeechContextMessage {
    await waitForImagePaste()
    guard !speechSelectionInProgress else { return request.failure("Wait for the selected text to finish loading.") }
    speechSelectionInProgress = true
    defer { speechSelectionInProgress = false }
    guard AXIsProcessTrusted(), !MacConsoleSessionState.isLocked(), pointerInputEnabled,
          let app = NSWorkspace.shared.frontmostApplication else {
      return request.failure("Unlock the Mac and allow ClawDad Accessibility access to read selected text.")
    }
    let generation = inputGeneration
    let target = focusedTarget(for: app.processIdentifier, application: app, requireEditable: false, screenLocked: false)
    if target?.subrole == (kAXSecureTextFieldSubrole as String) {
      return request.failure("Choose text outside the password field to read.")
    }
    if let target {
      var value: CFTypeRef?
      let result = AXUIElementCopyAttributeValue(target.element, kAXSelectedTextAttribute as CFString, &value)
      if result == .success, let text = value as? String {
        return speechSelectionResult(request, text: text)
      }
      if let rangeValue = attribute(target.element, kAXSelectedTextRangeAttribute as CFString),
         CFGetTypeID(rangeValue) == AXValueGetTypeID() {
        var range = CFRange()
        if AXValueGetValue(unsafeBitCast(rangeValue, to: AXValue.self), .cfRange, &range), range.length == 0 {
          return request.success(text: "")
        }
      }
      if result != .attributeUnsupported && result != .noValue && result != .success {
        return request.failure("The Mac could not read the selection. Select the text again.")
      }
    }
    guard clipboardCopyTask == nil else { return request.failure("Wait for the clipboard operation to finish.") }
    let pasteboard = NSPasteboard.general
    let previous = PasteboardSnapshot(pasteboard)
    let before = pasteboard.changeCount
    guard pressCommandShortcut(keyCode: 8, targetPID: app.processIdentifier) else {
      return request.failure("The Mac could not read the selection. Select the text again.")
    }
    for _ in 0..<20 where pasteboard.changeCount == before {
      try? await Task.sleep(nanoseconds: 50_000_000)
      if Task.isCancelled { break }
    }
    let after = pasteboard.changeCount
    let text = after == before ? nil : pasteboard.string(forType: .string)
    // Never replace a later clipboard write with our saved snapshot.
    if after != before, pasteboard.changeCount == after { previous.restore(to: pasteboard) }
    guard !Task.isCancelled, inputGeneration == generation,
          NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
          !MacConsoleSessionState.isLocked() else {
      return request.failure("The focused Mac app changed. Tap the speaker again.")
    }
    let result = Self.copiedSpeechSelection(request, clipboardChanged: after != before, text: text)
    if let text = result.text { return speechSelectionResult(request, text: text) }
    return result
  }

  static func copiedSpeechSelection(_ request: RemoteSpeechContextMessage, clipboardChanged: Bool, text: String?) -> RemoteSpeechContextMessage {
    // A Copy timeout or non-text clipboard is not evidence of an empty selection.
    // Only Accessibility's explicit empty selection may trigger Terminal fallback.
    guard clipboardChanged, let text, !text.isEmpty else {
      return request.failure("The Mac could not determine the selected text. Select text again and tap the speaker.")
    }
    return request.success(text: text)
  }

  private func speechSelectionResult(_ request: RemoteSpeechContextMessage, text: String) -> RemoteSpeechContextMessage {
    guard text.utf8.count <= RemoteClipboardMessage.maximumTextBytes else {
      return request.failure("Select a smaller portion of text to read (64 KB or less).")
    }
    return request.success(text: text)
  }

  private func copyDictation(_ text: String) -> Bool {
    let pasteboard = NSPasteboard.general
    let previous = PasteboardSnapshot(pasteboard)
    pasteboard.clearContents()
    guard pasteboard.setString(text, forType: .string), pasteboard.string(forType: .string) == text else {
      previous.restore(to: pasteboard)
      return false
    }
    return true
  }

  private func handleClipboard(
    _ message: RemoteClipboardMessage,
    respond: @escaping (RemoteClipboardMessage) -> Void
  ) {
    if imagePasteInProgress {
      Task { @MainActor [weak self] in
        await self?.waitForImagePaste()
        guard !Task.isCancelled else { return }
        self?.handleClipboard(message, respond: respond)
      }
      return
    }
    guard !speechSelectionInProgress else {
      respond(.failure(action: message.action, requestId: message.requestId, error: "Wait for selected text to finish loading, then retry."))
      return
    }
    if message.action == .dictation {
      respond(dictationDelivery.deliver(message, copy: copyDictation, insertWithReceipt: { [self] text in
        insertDictationIfFocused(text)
      }))
      return
    }
    guard AXIsProcessTrusted() else {
      respond(.failure(
        action: message.action,
        requestId: message.requestId,
        error: "Allow ClawDad to control this Mac in Privacy & Security settings."
      ))
      return
    }

    switch message.action {
    case .paste:
      pastePhoneClipboard(message, respond: respond)
    case .copy:
      copyMacSelection(message, respond: respond)
    case .dictation:
      break // Handled above, including clipboard fallback without input access.
    }
  }

  private func insertDictationIfFocused(_ text: String) -> RemoteDictationDisposition {
    guard let target = eligibleDictationTarget() else { return .copied }
    return insertDictation(text, into: target)
  }

  private func eligibleDictationTarget() -> InputTarget? {
    // A previous pointer target must never bring an old app back into focus.
    guard pointerInputEnabled, AXIsProcessTrusted(),
          !MacConsoleSessionState.isLocked(),
          let application = NSWorkspace.shared.frontmostApplication,
          let target = focusedTarget(for: application.processIdentifier,
                                     application: application, requireEditable: false,
                                     screenLocked: false),
          MacEditableTargetPolicy.acceptsDictation(
            role: stringAttribute(target.element, kAXRoleAttribute as CFString) ?? "",
            subrole: target.subrole,
            explicitlyEditable: boolAttribute(target.element, kAXIsEditableAttribute as CFString),
            selectedTextSettable: target.selectedTextSettable,
            enabled: boolAttribute(target.element, kAXEnabledAttribute as CFString),
            focused: boolAttribute(target.element, kAXFocusedAttribute as CFString),
            bundleIdentifier: target.bundleIdentifier
          ) else { return nil }
    return target
  }

  private func insertDictation(_ text: String, into target: InputTarget) -> RemoteDictationDisposition {
    if target.selectedTextSettable,
       AXUIElementSetAttributeValue(target.element, kAXSelectedTextAttribute as CFString,
                                    text as CFString) == .success {
      return .inserted
    }
    // Posting Cmd-V does not prove the target accepted the text. Keep the
    // verified clipboard receipt and report the paste request accurately.
    return pressCommandShortcut(keyCode: 9, targetPID: target.pid) ? .pasteRequested : .copied
  }

  private func pastePhoneClipboard(
    _ message: RemoteClipboardMessage,
    respond: @escaping (RemoteClipboardMessage) -> Void
  ) {
    guard let text = message.text else {
      respond(.failure(
        action: .paste,
        requestId: message.requestId,
        error: "The paired device clipboard did not contain any text."
      ))
      return
    }
    if MacConsoleSessionState.isLocked() {
      enqueueTypedClipboardPaste(
        text,
        requestId: message.requestId,
        respond: respond
      )
      return
    }
    guard let target = focusedTarget(requireEditable: true) else {
      respond(.failure(
        action: .paste,
        requestId: message.requestId,
        error: "Tap a text field on your Mac, then paste again."
      ))
      return
    }
    if target.requiresPhysicalKeystrokes {
      enqueueTypedClipboardPaste(
        text,
        requestId: message.requestId,
        respond: respond
      )
      return
    }

    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    guard pasteboard.setString(text, forType: .string),
          pressCommandShortcut(keyCode: 9, targetPID: target.pid) else {
      respond(.failure(
        action: .paste,
        requestId: message.requestId,
        error: "ClawDad could not paste into the focused Mac app."
      ))
      return
    }

    respond(.success(
      action: .paste,
      requestId: message.requestId
    ))
  }

  private func enqueueTypedClipboardPaste(
    _ text: String,
    requestId: String,
    respond: @escaping (RemoteClipboardMessage) -> Void
  ) {
    enqueueInput(
      .textRequest(text: text, requestId: requestId)
    ) { result in
      if result.ok == true {
        respond(.success(
          action: .paste,
          requestId: requestId
        ))
      } else {
        respond(.failure(
          action: .paste,
          requestId: requestId,
          error: result.error ?? "ClawDad could not type the clipboard text."
        ))
      }
    }
  }

  private func copyMacSelection(
    _ message: RemoteClipboardMessage,
    respond: @escaping (RemoteClipboardMessage) -> Void
  ) {
    guard !MacConsoleSessionState.isLocked() else {
      respond(.failure(
        action: .copy,
        requestId: message.requestId,
        error: "Copy from Mac is unavailable while the Mac is locked."
      ))
      return
    }
    guard clipboardCopyTask == nil else {
      respond(.failure(
        action: .copy,
        requestId: message.requestId,
        error: "A Mac copy request is already in progress."
      ))
      return
    }
    let copyTarget = message.foregroundOnly == true
      ? NSWorkspace.shared.frontmostApplication?.processIdentifier : activeTargetPID()
    guard let targetPID = copyTarget else {
      respond(.failure(
        action: .copy,
        requestId: message.requestId,
        error: "Select text on the Mac, then tap Copy from Mac again."
      ))
      return
    }

    let pasteboard = NSPasteboard.general
    let previousChangeCount = pasteboard.changeCount
    guard pressCommandShortcut(keyCode: 8, targetPID: targetPID) else {
      respond(.failure(
        action: .copy,
        requestId: message.requestId,
        error: "ClawDad could not copy from the focused Mac app."
      ))
      return
    }

    clipboardCopyTask = Task { @MainActor [weak self] in
      guard let self else {
        return
      }
      defer {
        self.clipboardCopyTask = nil
      }

      var didChange = pasteboard.changeCount != previousChangeCount
      for _ in 0..<20 where !didChange {
        do {
          try await Task.sleep(nanoseconds: 50_000_000)
        } catch {
          return
        }
        didChange = pasteboard.changeCount != previousChangeCount
      }

      guard message.foregroundOnly != true || NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID else {
        respond(.failure(action: .copy, requestId: message.requestId,
                         error: "The focused Mac app changed. Select the text and try again."))
        return
      }
      guard didChange,
            let text = pasteboard.string(forType: .string),
            !text.isEmpty else {
        respond(.failure(
          action: .copy,
          requestId: message.requestId,
          error: "Select text on the Mac, then tap Copy from Mac again."
        ))
        return
      }
      guard text.utf8.count <= RemoteClipboardMessage.maximumTextBytes else {
        respond(.failure(
          action: .copy,
          requestId: message.requestId,
          error: "The selected Mac text is larger than 64 KB."
        ))
        return
      }

      respond(.success(
        action: .copy,
        requestId: message.requestId,
        text: text
      ))
    }
  }

  private func handlePointer(_ object: [String: Any]) {
    guard pointerInputEnabled,
          let point = screenPoint(
      x: number(object["x"], fallback: 0.5),
      y: number(object["y"], fallback: 0.5)
    ) else {
      return
    }
    let action = String(describing: object["action"] ?? "")
    let buttonName = String(describing: object["button"] ?? "left")
    let button: CGMouseButton = buttonName == "right" ? .right : .left

    if action == "down" || action == "click" {
      invalidateDictationTarget()
      establishTarget(at: point)
    }

    switch action {
    case "move":
      postMouseEvent(
        type: .mouseMoved,
        point: point,
        button: button
      )
    case "down":
      postMouseEvent(
        type: button == .right ? .rightMouseDown : .leftMouseDown,
        point: point,
        button: button
      )
    case "drag":
      postMouseEvent(
        type: button == .right ? .rightMouseDragged : .leftMouseDragged,
        point: point,
        button: button
      )
    case "up":
      postMouseEvent(
        type: button == .right ? .rightMouseUp : .leftMouseUp,
        point: point,
        button: button
      )
    case "click":
      postMouseEvent(
        type: button == .right ? .rightMouseDown : .leftMouseDown,
        point: point,
        button: button
      )
      postMouseEvent(
        type: button == .right ? .rightMouseUp : .leftMouseUp,
        point: point,
        button: button
      )
    default:
      break
    }
  }

  private func postMouseEvent(
    type: CGEventType,
    point: CGPoint,
    button: CGMouseButton
  ) {
    guard let event = CGEvent(
      mouseEventSource: source,
      mouseType: type,
      mouseCursorPosition: point,
      mouseButton: button
    ) else {
      return
    }
    event.flags = []
    event.post(tap: .cghidEventTap)
    lastPointerPoint = point

    switch type {
    case .leftMouseDown:
      leftMouseButtonDown = true
    case .leftMouseUp:
      leftMouseButtonDown = false
    case .rightMouseDown:
      rightMouseButtonDown = true
    case .rightMouseUp:
      rightMouseButtonDown = false
    default:
      break
    }
  }

  private func establishTarget(at point: CGPoint) {
    let system = AXUIElementCreateSystemWide()
    var hitElement: AXUIElement?
    guard AXUIElementCopyElementAtPosition(
      system,
      Float(point.x),
      Float(point.y),
      &hitElement
    ) == .success,
    let hitElement else {
      return
    }

    var pid: pid_t = 0
    guard AXUIElementGetPid(hitElement, &pid) == .success,
          pid > 0 else {
      return
    }
    let screenLocked = MacConsoleSessionState.isLocked()
    if screenLocked, !isLoginWindow(pid: pid) {
      lastTargetPID = nil
      return
    }
    lastTargetPID = pid
    if !screenLocked,
       let application = NSRunningApplication(processIdentifier: pid),
       !application.isActive {
      application.activate(options: [.activateIgnoringOtherApps])
    }
  }

  private func handleScroll(_ object: [String: Any]) {
    guard pointerInputEnabled else {
      return
    }
    let deltaX = Int32(number(object["deltaX"], fallback: 0).rounded())
    let deltaY = Int32(number(object["deltaY"], fallback: 0).rounded())
    guard let event = CGEvent(
      scrollWheelEvent2Source: source,
      units: .pixel,
      wheelCount: 2,
      wheel1: -deltaY,
      wheel2: -deltaX,
      wheel3: 0
    ) else {
      return
    }
    event.flags = []
    event.post(tap: .cghidEventTap)
  }

  private func enqueueInput(
    _ message: RemoteInputMessage,
    respond: ((RemoteInputMessage) -> Void)?
  ) {
    invalidateDictationTarget()
    inputQueue.append(PendingInput(message: message, respond: respond))
    guard inputProcessingTask == nil else {
      return
    }
    inputProcessingTask = Task { @MainActor [weak self] in
      await self?.processInputQueue()
    }
  }

  private func processInputQueue() async {
    defer {
      inputProcessingTask = nil
      if !inputQueue.isEmpty {
        inputProcessingTask = Task { @MainActor [weak self] in
          await self?.processInputQueue()
        }
      }
    }

    while !Task.isCancelled, !inputQueue.isEmpty {
      await waitForImagePaste()
      guard !Task.isCancelled else { return }
      let pending = inputQueue.removeFirst()
      let response = await executeInput(pending.message)
      pending.respond?(response)
    }
  }

  private func executeInput(
    _ message: RemoteInputMessage
  ) async -> RemoteInputMessage {
    if message.action == .shortcut || message.action == .chord {
      guard !MacConsoleSessionState.isLocked() else {
        return .failure(
          action: message.action,
          requestId: message.requestId,
          error: "Special commands are unavailable while the Mac is locked."
        )
      }
      if let shortcut = message.shortcut,
         macRemoteShortcutPlan(for: shortcut).delivery == .system {
        return executeSystemShortcut(message, shortcut: shortcut)
      }
      if let chord = message.chord, let plan = macRemoteChordPlan(for: chord), plan.delivery == .system {
        guard AXIsProcessTrusted() else {
          return .failure(action: message.action, requestId: message.requestId,
            error: "Allow ClawDad to control this Mac in Privacy & Security settings.")
        }
        let target = systemShortcutTarget()
        guard postKeyEventSteps(macRemoteKeyEventSteps(keyCode: plan.keyCode, flags: plan.flags), targetPID: nil) else {
          return .failure(action: message.action, requestId: message.requestId, error: "macOS did not accept that special key.", target: target)
        }
        return .success(action: message.action, requestId: message.requestId, target: target)
      }
    }

    do {
      let target = try await resolveEditableTarget()
      let accepted: Bool
      switch message.action {
      case .text:
        let text = message.text ?? ""
        if target.requiresPhysicalKeystrokes {
          guard let strokes = MacKeyboardLayout.keyStrokes(for: text) else {
            return .failure(
              action: message.action,
              requestId: message.requestId,
              error: "One or more characters are unavailable in the current Mac keyboard layout.",
              target: target.metadata
            )
          }
          accepted = await typeKeyStrokes(strokes, targetPID: target.pid)
        } else {
          accepted = await insertText(text, into: target)
        }
      case .key:
        accepted = pressKey(message.key ?? "", targetPID: target.pid)
      case .shortcut:
        guard let shortcut = message.shortcut else {
          return .failure(
            action: message.action,
            requestId: message.requestId,
            error: "The special command was invalid.",
            target: target.metadata
          )
        }
        accepted = pressRemoteShortcut(
          shortcut,
          targetPID: target.pid
        )
      case .chord:
        guard let chord = message.chord, let plan = macRemoteChordPlan(for: chord) else {
          return .failure(action: message.action, requestId: message.requestId,
            error: "This key combination is unavailable in the current Mac keyboard layout.", target: target.metadata)
        }
        accepted = postKeyEventSteps(macRemoteKeyEventSteps(keyCode: plan.keyCode, flags: plan.flags), targetPID: target.pid)
      }

      guard accepted else {
        return .failure(
          action: message.action,
          requestId: message.requestId,
          error: "The focused Mac app did not accept that input.",
          target: target.metadata
        )
      }
      return .success(
        action: message.action,
        requestId: message.requestId,
        target: target.metadata
      )
    } catch InputTargetError.accessibilityPermission {
      return .failure(
        action: message.action,
        requestId: message.requestId,
        error: "Allow ClawDad to control this Mac in Privacy & Security settings."
      )
    } catch InputTargetError.noEditableElement(let metadata) {
      return .failure(
        action: message.action,
        requestId: message.requestId,
        error: "Tap a text field on your Mac, then type again.",
        target: metadata
      )
    } catch {
      return .failure(
        action: message.action,
        requestId: message.requestId,
        error: "ClawDad could not find the Mac app receiving input."
      )
    }
  }

  private func executeSystemShortcut(
    _ message: RemoteInputMessage,
    shortcut: RemoteShortcut
  ) -> RemoteInputMessage {
    guard AXIsProcessTrusted() else {
      return .failure(
        action: message.action,
        requestId: message.requestId,
        error: "Allow ClawDad to control this Mac in Privacy & Security settings."
      )
    }
    let target = systemShortcutTarget()
    guard pressRemoteShortcut(shortcut, targetPID: nil) else {
      return .failure(
        action: message.action,
        requestId: message.requestId,
        error: "macOS did not accept that special command.",
        target: target
      )
    }
    return .success(
      action: message.action,
      requestId: message.requestId,
      target: target
    )
  }

  private func systemShortcutTarget() -> RemoteInputTarget {
    guard let application = NSWorkspace.shared.frontmostApplication else {
      return RemoteInputTarget(
        applicationName: "macOS",
        bundleIdentifier: nil,
        role: "SystemShortcut"
      )
    }
    return RemoteInputTarget(
      applicationName: application.localizedName ?? "Mac app",
      bundleIdentifier: application.bundleIdentifier,
      role: "SystemShortcut"
    )
  }

  private func resolveEditableTarget() async throws -> InputTarget {
    guard AXIsProcessTrusted() else {
      throw InputTargetError.accessibilityPermission
    }
    if MacConsoleSessionState.isLocked() {
      guard let pid = lockedTargetPID(),
            let application = NSRunningApplication(
              processIdentifier: pid
            ),
            let target = focusedTarget(
              for: pid,
              application: application,
              requireEditable: true,
              screenLocked: true
            ) else {
        throw InputTargetError.noEditableElement(nil)
      }
      return target
    }
    guard let pid = activeTargetPID(),
          let application = NSRunningApplication(processIdentifier: pid) else {
      throw InputTargetError.noApplication
    }

    if !application.isActive {
      application.activate(options: [.activateIgnoringOtherApps])
      try? await Task.sleep(nanoseconds: 80_000_000)
    }

    guard let target = focusedTarget(
      for: pid,
      application: application,
      requireEditable: true,
      screenLocked: false
    ) else {
      let metadata = focusedTarget(
        for: pid,
        application: application,
        requireEditable: false,
        screenLocked: false
      )?.metadata
      throw InputTargetError.noEditableElement(metadata)
    }
    return target
  }

  private func focusedTarget(requireEditable: Bool) -> InputTarget? {
    guard let pid = activeTargetPID(),
          let application = NSRunningApplication(processIdentifier: pid) else {
      return nil
    }
    return focusedTarget(
      for: pid,
      application: application,
      requireEditable: requireEditable,
      screenLocked: false
    )
  }

  private func focusedTarget(
    for pid: pid_t,
    application: NSRunningApplication,
    requireEditable: Bool,
    screenLocked: Bool
  ) -> InputTarget? {
    let applicationElement = AXUIElementCreateApplication(pid)
    var focusedValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
      applicationElement,
      kAXFocusedUIElementAttribute as CFString,
      &focusedValue
    ) == .success,
    let focusedValue else {
      return nil
    }

    let element = unsafeBitCast(focusedValue, to: AXUIElement.self)
    let role = stringAttribute(
      element,
      kAXRoleAttribute as CFString
    ) ?? "AXUnknown"
    let subrole = stringAttribute(
      element,
      kAXSubroleAttribute as CFString
    )
    var selectedTextSettable = DarwinBoolean(false)
    AXUIElementIsAttributeSettable(
      element,
      kAXSelectedTextAttribute as CFString,
      &selectedTextSettable
    )
    let explicitlyEditable = boolAttribute(
      element,
      kAXIsEditableAttribute as CFString
    )
    let editable = MacEditableTargetPolicy.isEditable(
      role: role,
      subrole: subrole,
      explicitlyEditable: explicitlyEditable,
      selectedTextSettable: selectedTextSettable.boolValue
    )

    if requireEditable, !editable {
      return nil
    }
    return InputTarget(
      pid: pid,
      applicationName: application.localizedName ?? "Mac app",
      bundleIdentifier: application.bundleIdentifier,
      role: subrole ?? role,
      subrole: subrole,
      element: element,
      selectedTextSettable: selectedTextSettable.boolValue,
      screenLocked: screenLocked
    )
  }

  private func lockedTargetPID() -> pid_t? {
    if let focusedPID = systemFocusedApplicationPID(),
       isLoginWindow(pid: focusedPID) {
      return focusedPID
    }
    if let lastTargetPID, isLoginWindow(pid: lastTargetPID) {
      return lastTargetPID
    }
    return nil
  }

  private func systemFocusedApplicationPID() -> pid_t? {
    let system = AXUIElementCreateSystemWide()
    var focusedApplication: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
      system,
      kAXFocusedApplicationAttribute as CFString,
      &focusedApplication
    ) == .success,
    let focusedApplication else {
      return nil
    }

    let element = unsafeBitCast(
      focusedApplication,
      to: AXUIElement.self
    )
    var pid: pid_t = 0
    guard AXUIElementGetPid(element, &pid) == .success,
          pid > 0 else {
      return nil
    }
    return pid
  }

  private func isLoginWindow(pid: pid_t) -> Bool {
    NSRunningApplication(
      processIdentifier: pid
    )?.bundleIdentifier == "com.apple.loginwindow"
  }

  private func activeTargetPID() -> pid_t? {
    if let lastTargetPID,
       let lastApplication = NSRunningApplication(
         processIdentifier: lastTargetPID
       ),
       lastApplication.isActive {
      return lastApplication.processIdentifier
    }
    if let frontmost = NSWorkspace.shared.frontmostApplication,
       frontmost.processIdentifier != ProcessInfo.processInfo.processIdentifier,
       frontmost.bundleIdentifier != "com.apple.dock" {
      return frontmost.processIdentifier
    }
    if let lastTargetPID,
       NSRunningApplication(processIdentifier: lastTargetPID) != nil {
      return lastTargetPID
    }
    return NSWorkspace.shared.frontmostApplication?.processIdentifier
  }

  private func insertText(
    _ text: String,
    into target: InputTarget
  ) async -> Bool {
    guard !text.isEmpty else {
      return true
    }

    if target.selectedTextSettable,
       AXUIElementSetAttributeValue(
         target.element,
         kAXSelectedTextAttribute as CFString,
         text as CFString
       ) == .success {
      return true
    }

    return await pasteTextPreservingClipboard(text, targetPID: target.pid)
  }

  private func typeKeyStrokes(
    _ strokes: [MacKeyStroke],
    targetPID: pid_t
  ) async -> Bool {
    for stroke in strokes {
      guard postKeyStroke(stroke, targetPID: targetPID) else {
        return false
      }
      do {
        try await Task.sleep(nanoseconds: 4_000_000)
      } catch {
        return false
      }
    }
    return true
  }

  private func postKeyStroke(
    _ stroke: MacKeyStroke,
    targetPID: pid_t
  ) -> Bool {
    postKeyEventSteps(
      macRemoteKeyEventSteps(
        keyCode: stroke.keyCode,
        flags: stroke.flags
      ),
      targetPID: targetPID
    )
  }

  private func pasteTextPreservingClipboard(
    _ text: String,
    targetPID: pid_t,
    verify: (@MainActor () async -> Bool)? = nil
  ) async -> Bool {
    let pasteboard = NSPasteboard.general
    let snapshot = PasteboardSnapshot(pasteboard)
    pasteboard.clearContents()
    guard pasteboard.setString(text, forType: .string) else {
      snapshot.restore(to: pasteboard)
      return false
    }
    let injectedChangeCount = pasteboard.changeCount
    guard pasteboard.string(forType: .string) == text else { snapshot.restore(to: pasteboard); return false }
    guard pressCommandShortcut(keyCode: 9, targetPID: targetPID) else {
      snapshot.restore(to: pasteboard)
      return false
    }

    var verified = verify == nil
    if let verify {
      for _ in 0..<24 {
        guard !Task.isCancelled, pasteboard.changeCount == injectedChangeCount,
          pasteboard.string(forType: .string) == text else { break }
        if await verify(), pasteboard.changeCount == injectedChangeCount,
          pasteboard.string(forType: .string) == text { verified = true; break }
        try? await Task.sleep(nanoseconds: 100_000_000)
      }
    } else { try? await Task.sleep(nanoseconds: 80_000_000) }
    if pasteboard.changeCount == injectedChangeCount {
      snapshot.restore(to: pasteboard)
    }
    return verified
  }

  private func pressKey(_ key: String, targetPID: pid_t) -> Bool {
    let keyCode: CGKeyCode?
    switch key.lowercased() {
    case "delete", "backspace":
      keyCode = 51
    case "return", "enter":
      keyCode = 36
    case "tab":
      keyCode = 48
    case "escape":
      keyCode = 53
    case "left":
      keyCode = 123
    case "right":
      keyCode = 124
    case "down":
      keyCode = 125
    case "up":
      keyCode = 126
    default:
      keyCode = nil
    }
    guard let keyCode else {
      return false
    }
    return postKeyEventSteps(
      macRemoteKeyEventSteps(keyCode: keyCode, flags: []),
      targetPID: targetPID
    )
  }

  private func pressRemoteShortcut(
    _ shortcut: RemoteShortcut,
    targetPID: pid_t?
  ) -> Bool {
    let plan = macRemoteShortcutPlan(for: shortcut)
    switch plan.delivery {
    case .focusedApplication:
      guard let targetPID else {
        return false
      }
      return postKeyEventSteps(
        macRemoteShortcutEventSteps(for: shortcut),
        targetPID: targetPID
      )
    case .system:
      return postKeyEventSteps(
        macRemoteShortcutEventSteps(for: shortcut),
        targetPID: nil
      )
    }
  }

  private func pressCommandShortcut(
    keyCode: CGKeyCode,
    targetPID: pid_t
  ) -> Bool {
    postKeyEventSteps(
      macRemoteKeyEventSteps(
        keyCode: keyCode,
        flags: .maskCommand
      ),
      targetPID: targetPID
    )
  }

  private func postKeyEventSteps(
    _ steps: [MacRemoteKeyEventStep],
    targetPID: pid_t?
  ) -> Bool {
    let events = steps.compactMap { step -> CGEvent? in
      guard let event = CGEvent(
        keyboardEventSource: source,
        virtualKey: step.keyCode,
        keyDown: step.keyDown
      ) else {
        return nil
      }
      event.flags = step.flags
      return event
    }
    guard events.count == steps.count else {
      return false
    }
    for (step, event) in zip(steps, events) {
      if let targetPID {
        event.postToPid(targetPID)
      } else {
        event.post(tap: .cghidEventTap)
      }
      updateRemoteModifierState(after: step)
    }
    return true
  }

  private func releaseRemoteInputState() {
    if leftMouseButtonDown, let lastPointerPoint {
      postMouseEvent(
        type: .leftMouseUp,
        point: lastPointerPoint,
        button: .left
      )
    }
    if rightMouseButtonDown, let lastPointerPoint {
      postMouseEvent(
        type: .rightMouseUp,
        point: lastPointerPoint,
        button: .right
      )
    }
    leftMouseButtonDown = false
    rightMouseButtonDown = false
    lastPointerPoint = nil

    for keyCode in activeRemoteModifierKeyCodes.sorted() {
      guard let event = CGEvent(
        keyboardEventSource: source,
        virtualKey: keyCode,
        keyDown: false
      ) else {
        continue
      }
      event.flags = []
      event.post(tap: .cghidEventTap)
    }
    activeRemoteModifierKeyCodes.removeAll()
  }

  private func updateRemoteModifierState(
    after step: MacRemoteKeyEventStep
  ) {
    let modifierKeyCodes: Set<CGKeyCode> = [
      CGKeyCode(kVK_Shift),
      CGKeyCode(kVK_Control),
      CGKeyCode(kVK_Option),
      CGKeyCode(kVK_Command),
    ]
    guard modifierKeyCodes.contains(step.keyCode) else {
      return
    }
    if step.keyDown {
      activeRemoteModifierKeyCodes.insert(step.keyCode)
    } else {
      activeRemoteModifierKeyCodes.remove(step.keyCode)
    }
  }

  private func stringAttribute(
    _ element: AXUIElement,
    _ attribute: CFString
  ) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
      element,
      attribute,
      &value
    ) == .success else {
      return nil
    }
    return value as? String
  }

  private func boolAttribute(
    _ element: AXUIElement,
    _ attribute: CFString
  ) -> Bool? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
      element,
      attribute,
      &value
    ) == .success else {
      return nil
    }
    return (value as? NSNumber)?.boolValue
  }

  private func screenPoint(x: Double, y: Double) -> CGPoint? {
    guard CGDisplayIsActive(activeDisplayID) != 0 else {
      return nil
    }
    return macRemoteScreenPoint(
      x: x,
      y: y,
      bounds: CGDisplayBounds(activeDisplayID)
    )
  }

  private func number(_ value: Any?, fallback: Double) -> Double {
    if let value = value as? NSNumber {
      return value.doubleValue
    }
    return fallback
  }
}
