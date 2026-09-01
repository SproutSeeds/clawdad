import AppKit
import ClawDadRemoteAssistProtocol
@preconcurrency import WebRTC

@MainActor
final class MacRemoteAssistWindowController: NSWindowController, NSWindowDelegate {
  var onClose: (() -> Void)?

  private let client: MacRemoteAssistClient
  private let computer: MacPairedComputerProfile
  private let canvas: MacRemoteDesktopCanvas
  private let statusLabel = NSTextField(labelWithString: "")
  private let displayPicker = NSPopUpButton()
  private let progress = NSProgressIndicator()
  private let retryButton = NSButton(title: "Try Again", target: nil, action: nil)
  private var boundTrack: RTCVideoTrack?
  private var closing = false

  init(client: MacRemoteAssistClient, computer: MacPairedComputerProfile) {
    self.client = client
    self.computer = computer
    canvas = MacRemoteDesktopCanvas(client: client)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    super.init(window: window)
    window.title = "Remote Assist — \(computer.displayName)"
    window.minSize = NSSize(width: 720, height: 480)
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.center()
    buildContent()
    client.onChange = { [weak self] in
      self?.refresh()
    }
    refresh()
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func open() {
    showWindow(nil)
    window?.makeKeyAndOrderFront(nil)
    window?.acceptsMouseMovedEvents = true
    NSApp.activate(ignoringOtherApps: true)
    canvas.window?.makeFirstResponder(canvas)
    client.start(computerId: computer.id)
  }

  func closeSession() {
    guard !closing else {
      return
    }
    closing = true
    unbindVideoTrack()
    client.stop()
    close()
    onClose?()
  }

  func windowWillClose(_ notification: Notification) {
    guard !closing else {
      return
    }
    closing = true
    unbindVideoTrack()
    client.stop()
    onClose?()
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    true
  }

  private func buildContent() {
    guard let window else {
      return
    }
    let root = NSView()
    root.wantsLayer = true
    root.layer?.backgroundColor = NSColor.black.cgColor
    window.contentView = root

    let title = NSTextField(labelWithString: computer.displayName)
    title.font = .systemFont(ofSize: 15, weight: .semibold)
    title.textColor = .white

    statusLabel.font = .systemFont(ofSize: 12, weight: .medium)
    statusLabel.textColor = NSColor(calibratedRed: 0.39, green: 0.86, blue: 0.48, alpha: 1)
    statusLabel.lineBreakMode = .byTruncatingTail

    displayPicker.target = self
    displayPicker.action = #selector(displayChanged(_:))
    displayPicker.toolTip = "Choose which display to control"
    displayPicker.setAccessibilityLabel("Remote display")

    let copyButton = toolbarButton(
      title: "Copy",
      symbol: "doc.on.doc",
      action: #selector(copyFromRemote)
    )
    copyButton.toolTip = "Copy the remote Mac selection to this Mac"

    let pasteButton = toolbarButton(
      title: "Paste",
      symbol: "doc.on.clipboard",
      action: #selector(pasteToRemote)
    )
    pasteButton.toolTip = "Paste this Mac clipboard into the remote Mac"

    let commandsButton = toolbarButton(
      title: "Commands",
      symbol: "command",
      action: #selector(showCommands(_:))
    )
    commandsButton.toolTip = "Send a special command"

    let stopButton = toolbarButton(
      title: "Stop",
      symbol: "xmark",
      action: #selector(stopPressed)
    )
    stopButton.bezelColor = NSColor.systemRed
    stopButton.toolTip = "Close Remote Assist"

    let spacer = NSView()
    spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
    let toolbar = NSStackView(views: [
      title,
      statusLabel,
      spacer,
      displayPicker,
      copyButton,
      pasteButton,
      commandsButton,
      stopButton
    ])
    toolbar.orientation = .horizontal
    toolbar.alignment = .centerY
    toolbar.spacing = 10
    toolbar.edgeInsets = NSEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
    toolbar.wantsLayer = true
    toolbar.layer?.backgroundColor = NSColor(calibratedWhite: 0.06, alpha: 0.96).cgColor

    progress.style = .spinning
    progress.controlSize = .regular
    progress.startAnimation(nil)

    retryButton.target = self
    retryButton.action = #selector(retryPressed)
    retryButton.bezelStyle = .rounded

    let overlay = NSStackView(views: [progress, retryButton])
    overlay.orientation = .vertical
    overlay.alignment = .centerX
    overlay.spacing = 12

    for view in [toolbar, canvas, overlay] {
      view.translatesAutoresizingMaskIntoConstraints = false
      root.addSubview(view)
    }
    NSLayoutConstraint.activate([
      toolbar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
      toolbar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
      toolbar.topAnchor.constraint(equalTo: root.topAnchor),
      toolbar.heightAnchor.constraint(greaterThanOrEqualToConstant: 48),
      canvas.leadingAnchor.constraint(equalTo: root.leadingAnchor),
      canvas.trailingAnchor.constraint(equalTo: root.trailingAnchor),
      canvas.topAnchor.constraint(equalTo: toolbar.bottomAnchor),
      canvas.bottomAnchor.constraint(equalTo: root.bottomAnchor),
      overlay.centerXAnchor.constraint(equalTo: canvas.centerXAnchor),
      overlay.centerYAnchor.constraint(equalTo: canvas.centerYAnchor)
    ])
  }

  private func toolbarButton(
    title: String,
    symbol: String,
    action: Selector
  ) -> NSButton {
    let button = NSButton(title: title, target: self, action: action)
    button.bezelStyle = .rounded
    button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)
    button.imagePosition = .imageLeading
    button.setAccessibilityLabel(title)
    return button
  }

  private func refresh() {
    statusLabel.stringValue = client.phase.statusText
    statusLabel.textColor = statusColor(for: client.phase)
    let connecting: Bool
    let failed: Bool
    switch client.phase {
    case .authenticating, .requesting, .negotiating:
      connecting = true
      failed = false
    case .failed:
      connecting = false
      failed = true
    default:
      connecting = false
      failed = false
    }
    progress.isHidden = !connecting
    if connecting {
      progress.startAnimation(nil)
    } else {
      progress.stopAnimation(nil)
    }
    retryButton.isHidden = !failed
    canvas.aspectRatio = client.remoteAspectRatio
    bindVideoTrack(client.remoteVideoTrack)
    refreshDisplays()
  }

  private func statusColor(for phase: MacRemoteAssistPhase) -> NSColor {
    if case .failed = phase {
      return .systemRed
    }
    if phase == .connected {
      return NSColor(calibratedRed: 0.39, green: 0.86, blue: 0.48, alpha: 1)
    }
    return NSColor(calibratedWhite: 0.75, alpha: 1)
  }

  private func bindVideoTrack(_ track: RTCVideoTrack?) {
    guard boundTrack !== track else {
      return
    }
    unbindVideoTrack()
    boundTrack = track
    track?.add(canvas.videoRenderer)
  }

  private func unbindVideoTrack() {
    boundTrack?.remove(canvas.videoRenderer)
    boundTrack = nil
  }

  private func refreshDisplays() {
    let currentItems = displayPicker.itemTitles
    let nextItems = client.remoteDisplays.map(\.name)
    if currentItems != nextItems {
      displayPicker.removeAllItems()
      displayPicker.addItems(withTitles: nextItems)
      for (index, display) in client.remoteDisplays.enumerated() {
        displayPicker.item(at: index)?.representedObject = display.id
      }
    }
    if let index = client.remoteDisplays.firstIndex(where: {
      $0.id == client.selectedRemoteDisplayId
    }) {
      displayPicker.selectItem(at: index)
    }
    displayPicker.isHidden = client.remoteDisplays.count < 2
    displayPicker.isEnabled = client.phase == .connected
  }

  @objc private func stopPressed() {
    closeSession()
  }

  @objc private func retryPressed() {
    client.stop()
    client.start(computerId: computer.id)
  }

  @objc private func copyFromRemote() {
    _ = client.copyRemoteSelectionToLocal()
    canvas.window?.makeFirstResponder(canvas)
  }

  @objc private func pasteToRemote() {
    _ = client.pasteLocalClipboardToRemote()
    canvas.window?.makeFirstResponder(canvas)
  }

  @objc private func displayChanged(_ sender: NSPopUpButton) {
    guard let displayId = sender.selectedItem?.representedObject as? String else {
      return
    }
    _ = client.selectDisplay(displayId)
    canvas.window?.makeFirstResponder(canvas)
  }

  @objc private func showCommands(_ sender: NSButton) {
    let menu = NSMenu(title: "Special Commands")
    addCommand("Command-Tab", shortcut: .commandTab, to: menu)
    addCommand("Command-T", shortcut: .commandT, to: menu)
    menu.addItem(.separator())
    addCommand("Control-C", shortcut: .controlC, to: menu)
    addCommand("Control-J", shortcut: .controlJ, to: menu)
    addCommand("Control-L", shortcut: .controlL, to: menu)
    menu.addItem(.separator())
    addCommand("Escape", shortcut: .escape, to: menu)
    addCommand("Tab", shortcut: .tab, to: menu)
    addCommand("Up Arrow", shortcut: .arrowUp, to: menu)
    addCommand("Down Arrow", shortcut: .arrowDown, to: menu)
    addCommand("Left Arrow", shortcut: .arrowLeft, to: menu)
    addCommand("Right Arrow", shortcut: .arrowRight, to: menu)
    menu.popUp(
      positioning: nil,
      at: NSPoint(x: sender.bounds.minX, y: sender.bounds.maxY),
      in: sender
    )
  }

  private func addCommand(
    _ title: String,
    shortcut: RemoteShortcut,
    to menu: NSMenu
  ) {
    let item = NSMenuItem(
      title: title,
      action: #selector(sendSpecialCommand(_:)),
      keyEquivalent: ""
    )
    item.target = self
    item.representedObject = shortcut.rawValue
    menu.addItem(item)
  }

  @objc private func sendSpecialCommand(_ sender: NSMenuItem) {
    guard let rawValue = sender.representedObject as? String,
          let shortcut = RemoteShortcut(rawValue: rawValue) else {
      return
    }
    _ = client.sendShortcut(shortcut)
    canvas.window?.makeFirstResponder(canvas)
  }
}

@MainActor
final class MacRemoteDesktopCanvas: NSView {
  let videoRenderer = RTCMTLNSVideoView(frame: .zero)
  var aspectRatio: CGFloat = 16.0 / 9.0 {
    didSet { needsLayout = true }
  }

  private weak var client: MacRemoteAssistClient?
  private var lastMoveAt = Date.distantPast

  init(client: MacRemoteAssistClient) {
    self.client = client
    super.init(frame: .zero)
    wantsLayer = true
    layer?.backgroundColor = NSColor.black.cgColor
    videoRenderer.translatesAutoresizingMaskIntoConstraints = false
    addSubview(videoRenderer)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var acceptsFirstResponder: Bool { true }

  override func layout() {
    super.layout()
    videoRenderer.frame = videoRect
  }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    guard let point = normalizedPoint(for: event) else {
      return
    }
    client?.sendPointer(action: "down", x: point.x, y: point.y)
  }

  override func mouseDragged(with event: NSEvent) {
    guard let point = normalizedPoint(for: event) else {
      return
    }
    client?.sendPointer(action: "drag", x: point.x, y: point.y)
  }

  override func mouseUp(with event: NSEvent) {
    guard let point = normalizedPoint(for: event) else {
      return
    }
    client?.sendPointer(action: "up", x: point.x, y: point.y)
  }

  override func rightMouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    guard let point = normalizedPoint(for: event) else {
      return
    }
    client?.sendPointer(action: "click", x: point.x, y: point.y, button: "right")
  }

  override func mouseMoved(with event: NSEvent) {
    let now = Date()
    guard now.timeIntervalSince(lastMoveAt) >= (1.0 / 30.0),
          let point = normalizedPoint(for: event) else {
      return
    }
    lastMoveAt = now
    client?.sendPointer(action: "move", x: point.x, y: point.y)
  }

  override func scrollWheel(with event: NSEvent) {
    client?.sendScroll(
      deltaX: Double(event.scrollingDeltaX),
      deltaY: Double(event.scrollingDeltaY)
    )
  }

  override func keyDown(with event: NSEvent) {
    if event.modifierFlags.contains(.command), event.charactersIgnoringModifiers == "w" {
      window?.performClose(nil)
      return
    }
    let keyName: String?
    switch event.keyCode {
    case 36, 76:
      keyName = "enter"
    case 48:
      keyName = "tab"
    case 51, 117:
      keyName = "backspace"
    case 123:
      keyName = "left"
    case 124:
      keyName = "right"
    case 125:
      keyName = "down"
    case 126:
      keyName = "up"
    case 53:
      window?.performClose(nil)
      return
    default:
      keyName = nil
    }
    if let keyName {
      _ = client?.sendKey(keyName)
      return
    }
    guard event.modifierFlags.intersection([.command, .control, .function]).isEmpty,
          let text = event.characters,
          !text.isEmpty else {
      NSSound.beep()
      return
    }
    _ = client?.sendText(text)
  }

  override func cancelOperation(_ sender: Any?) {
    window?.performClose(nil)
  }

  private var videoRect: NSRect {
    guard bounds.width > 0, bounds.height > 0,
          aspectRatio.isFinite, aspectRatio > 0 else {
      return bounds
    }
    let availableRatio = bounds.width / bounds.height
    if availableRatio > aspectRatio {
      let width = bounds.height * aspectRatio
      return NSRect(
        x: (bounds.width - width) / 2,
        y: 0,
        width: width,
        height: bounds.height
      )
    }
    let height = bounds.width / aspectRatio
    return NSRect(
      x: 0,
      y: (bounds.height - height) / 2,
      width: bounds.width,
      height: height
    )
  }

  private func normalizedPoint(for event: NSEvent) -> (x: Double, y: Double)? {
    let location = convert(event.locationInWindow, from: nil)
    let rect = videoRect
    guard rect.contains(location), rect.width > 0, rect.height > 0 else {
      return nil
    }
    return (
      x: Double((location.x - rect.minX) / rect.width),
      y: Double(1 - ((location.y - rect.minY) / rect.height))
    )
  }
}
