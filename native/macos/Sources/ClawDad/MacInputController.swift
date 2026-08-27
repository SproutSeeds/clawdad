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
    clipboardCopyTask?.cancel()
    clipboardCopyTask = nil
    inputProcessingTask?.cancel()
    inputProcessingTask = nil
    inputQueue.removeAll()
    releaseRemoteInputState()
  }

  func prepareForDisplayTransition() {
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

  private func handleClipboard(
    _ message: RemoteClipboardMessage,
    respond: @escaping (RemoteClipboardMessage) -> Void
  ) {
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
    }
  }

  private func pastePhoneClipboard(
    _ message: RemoteClipboardMessage,
    respond: @escaping (RemoteClipboardMessage) -> Void
  ) {
    guard let text = message.text else {
      respond(.failure(
        action: .paste,
        requestId: message.requestId,
        error: "The iPhone clipboard did not contain any text."
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
    guard let targetPID = activeTargetPID() else {
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
      let pending = inputQueue.removeFirst()
      let response = await executeInput(pending.message)
      pending.respond?(response)
    }
  }

  private func executeInput(
    _ message: RemoteInputMessage
  ) async -> RemoteInputMessage {
    if message.action == .shortcut {
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
    targetPID: pid_t
  ) async -> Bool {
    let pasteboard = NSPasteboard.general
    let snapshot = PasteboardSnapshot(pasteboard)
    pasteboard.clearContents()
    guard pasteboard.setString(text, forType: .string) else {
      snapshot.restore(to: pasteboard)
      return false
    }
    let injectedChangeCount = pasteboard.changeCount
    guard pressCommandShortcut(keyCode: 9, targetPID: targetPID) else {
      snapshot.restore(to: pasteboard)
      return false
    }

    try? await Task.sleep(nanoseconds: 80_000_000)
    if pasteboard.changeCount == injectedChangeCount {
      snapshot.restore(to: pasteboard)
    }
    return true
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
