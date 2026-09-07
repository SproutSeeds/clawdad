import ClawDadRemoteAssistProtocol
import Foundation
import SwiftUI
import Combine

struct RemoteAssistOfferAttempt: Equatable {
  let sessionId: String
  fileprivate let generation: UInt
}

struct RemoteAssistOfferGate {
  private var activeSessionId = ""
  private var generation: UInt = 0
  private var hasClaimedOffer = false

  mutating func beginSession(_ sessionId: String) {
    generation &+= 1
    activeSessionId = sessionId
    hasClaimedOffer = false
  }

  mutating func reset() {
    generation &+= 1
    activeSessionId = ""
    hasClaimedOffer = false
  }

  mutating func claimOffer(
    for sessionId: String
  ) -> RemoteAssistOfferAttempt? {
    guard !sessionId.isEmpty,
          sessionId == activeSessionId,
          !hasClaimedOffer else {
      return nil
    }
    hasClaimedOffer = true
    return RemoteAssistOfferAttempt(
      sessionId: sessionId,
      generation: generation
    )
  }

  func isCurrent(_ attempt: RemoteAssistOfferAttempt) -> Bool {
    hasClaimedOffer &&
      attempt.sessionId == activeSessionId &&
      attempt.generation == generation
  }
}

struct RemoteDisplaySelectionAttempt: Equatable {
  let requestId: String
  let displayId: String
  let expectedTopologyRevision: Int
}

struct RemoteDisplayStateApplication: Equatable {
  let accepted: Bool
  let selectedDisplayChanged: Bool
  let pendingResolved: Bool
  let pendingInvalidated: Bool
}

struct RemoteDisplayResultApplication: Equatable {
  let stateApplication: RemoteDisplayStateApplication
  let matchedPendingRequest: Bool
}

struct RemoteDisplaySelectionState: Equatable {
  private(set) var canonicalState: RemoteDisplayState?
  private(set) var pendingAttempt: RemoteDisplaySelectionAttempt?

  var displays: [RemoteDisplayDescriptor] {
    canonicalState?.displays ?? []
  }

  var selectedDisplayId: String {
    canonicalState?.selectedDisplayId ?? ""
  }

  var selectedDisplay: RemoteDisplayDescriptor? {
    displays.first { $0.id == selectedDisplayId }
  }

  var hasMultipleDisplays: Bool {
    displays.count > 1
  }

  var inputSuppressed: Bool {
    pendingAttempt != nil
  }

  mutating func reset() {
    canonicalState = nil
    pendingAttempt = nil
  }

  mutating func beginSelection(
    displayId: String,
    requestId: String
  ) -> RemoteDisplaySelectionAttempt? {
    guard pendingAttempt == nil,
          let canonicalState,
          canonicalState.displays.count > 1,
          canonicalState.selectedDisplayId != displayId,
          canonicalState.displays.contains(where: { $0.id == displayId }),
          !requestId.isEmpty else {
      return nil
    }
    let attempt = RemoteDisplaySelectionAttempt(
      requestId: requestId,
      displayId: displayId,
      expectedTopologyRevision: canonicalState.topologyRevision
    )
    pendingAttempt = attempt
    return attempt
  }

  mutating func applyState(
    _ state: RemoteDisplayState
  ) -> RemoteDisplayStateApplication {
    if let canonicalState,
       state.topologyRevision < canonicalState.topologyRevision {
      return RemoteDisplayStateApplication(
        accepted: false,
        selectedDisplayChanged: false,
        pendingResolved: false,
        pendingInvalidated: false
      )
    }

    let previousDisplayId = canonicalState?.selectedDisplayId ?? ""
    canonicalState = state

    var pendingResolved = false
    var pendingInvalidated = false
    if let pendingAttempt {
      if state.selectedDisplayId == pendingAttempt.displayId {
        self.pendingAttempt = nil
        pendingResolved = true
      } else if !state.displays.contains(where: {
        $0.id == pendingAttempt.displayId
      }) {
        self.pendingAttempt = nil
        pendingInvalidated = true
      }
    }

    return RemoteDisplayStateApplication(
      accepted: true,
      selectedDisplayChanged: previousDisplayId != state.selectedDisplayId,
      pendingResolved: pendingResolved,
      pendingInvalidated: pendingInvalidated
    )
  }

  mutating func applyResult(
    _ message: RemoteDisplayMessage
  ) -> RemoteDisplayResultApplication? {
    guard message.type == RemoteDisplayMessage.selectResultType,
          let requestId = message.requestId,
          let state = message.state else {
      return nil
    }
    let matchedPendingRequest = pendingAttempt?.requestId == requestId
    let stateApplication = applyState(state)
    if matchedPendingRequest {
      pendingAttempt = nil
    }
    return RemoteDisplayResultApplication(
      stateApplication: stateApplication,
      matchedPendingRequest: matchedPendingRequest
    )
  }

  mutating func timeOut(requestId: String) -> Bool {
    guard pendingAttempt?.requestId == requestId else {
      return false
    }
    pendingAttempt = nil
    return true
  }
}

enum RemoteTerminalTabRequestKind: Equatable {
  case catalog
  case focus(tabId: String)
  case move(tabId: String)
}

struct RemoteTerminalTabRequestAttempt: Equatable {
  let requestId: String
  let kind: RemoteTerminalTabRequestKind
}

struct RemoteTerminalTabResultApplication: Equatable {
  let acceptedState: Bool
  let selectedTabChanged: Bool
  let matchedPendingRequest: Bool
}

struct RemoteTerminalTabSelectionState: Equatable {
  private(set) var canonicalState: RemoteTerminalTabState?
  private(set) var pendingAttempt: RemoteTerminalTabRequestAttempt?

  var tabs: [RemoteTerminalTabDescriptor] {
    canonicalState?.tabs ?? []
  }

  var selectedTabId: String {
    canonicalState?.selectedTabId ?? ""
  }

  var pendingTabId: String? {
    guard case .focus(let tabId) = pendingAttempt?.kind else {
      return nil
    }
    return tabId
  }

  var requestPending: Bool {
    pendingAttempt != nil
  }

  var catalogLoading: Bool {
    pendingAttempt?.kind == .catalog
  }

  mutating func reset() {
    canonicalState = nil
    pendingAttempt = nil
  }

  mutating func beginCatalog(
    requestId: String
  ) -> RemoteTerminalTabRequestAttempt? {
    begin(kind: .catalog, requestId: requestId)
  }

  mutating func beginFocus(
    tabId: String,
    requestId: String
  ) -> RemoteTerminalTabRequestAttempt? {
    guard let canonicalState,
          canonicalState.tabs.contains(where: { $0.id == tabId }) else {
      return nil
    }
    guard pendingTabId != tabId, !requestId.isEmpty else { return nil }
    // A foreground choice supersedes a refresh or an older choice. Late replies
    // retain their request IDs and cannot overwrite this newer intent.
    pendingAttempt = nil
    return begin(kind: .focus(tabId: tabId), requestId: requestId)
  }

  mutating func applyResult(
    _ message: RemoteTerminalTabMessage
  ) -> RemoteTerminalTabResultApplication? {
    guard message.type == RemoteTerminalTabMessage.listResultType ||
            message.type == RemoteTerminalTabMessage.focusResultType ||
            message.type == RemoteTerminalTabMessage.moveResultType else {
      return nil
    }
    let expectedResultType: String?
    switch pendingAttempt?.kind {
    case .catalog:
      expectedResultType = RemoteTerminalTabMessage.listResultType
    case .focus:
      expectedResultType = RemoteTerminalTabMessage.focusResultType
    case .move:
      expectedResultType = RemoteTerminalTabMessage.moveResultType
    case nil:
      expectedResultType = nil
    }
    let matchedPendingRequest = pendingAttempt?.requestId == message.requestId &&
      expectedResultType == message.type
    let previousSelectedTabId = canonicalState?.selectedTabId
    var acceptedState = false
    let currentRevision = canonicalState?.revision ?? 0
    if (matchedPendingRequest || canonicalState == nil), let state = message.state,
       state.revision >= currentRevision {
      canonicalState = state
      acceptedState = true
    }
    if matchedPendingRequest {
      pendingAttempt = nil
    }
    return RemoteTerminalTabResultApplication(
      acceptedState: acceptedState,
      selectedTabChanged: acceptedState &&
        previousSelectedTabId != canonicalState?.selectedTabId,
      matchedPendingRequest: matchedPendingRequest
    )
  }

  mutating func timeOut(requestId: String) -> Bool {
    guard pendingAttempt?.requestId == requestId else {
      return false
    }
    pendingAttempt = nil
    return true
  }

  mutating func beginMove(tabId: String, requestId: String) -> RemoteTerminalTabRequestAttempt? {
    guard pendingAttempt == nil || catalogLoading else { return nil }
    pendingAttempt = nil
    return begin(kind: .move(tabId: tabId), requestId: requestId)
  }

  mutating func applyCloseState(_ state: RemoteTerminalTabState) {
    guard state.revision >= (canonicalState?.revision ?? 0) else { return }
    pendingAttempt = nil
    canonicalState = state
  }

  private mutating func begin(
    kind: RemoteTerminalTabRequestKind,
    requestId: String
  ) -> RemoteTerminalTabRequestAttempt? {
    guard pendingAttempt == nil, !requestId.isEmpty else {
      return nil
    }
    let attempt = RemoteTerminalTabRequestAttempt(
      requestId: requestId,
      kind: kind
    )
    pendingAttempt = attempt
    return attempt
  }
}

struct RemoteViewportTransform: Equatable {
  static let minimumScale: CGFloat = 1
  static let maximumScale: CGFloat = 4

  private(set) var scale: CGFloat = minimumScale
  private(set) var offset: CGSize = .zero

  var isZoomed: Bool {
    scale > Self.minimumScale + 0.01
  }

  mutating func reset() {
    scale = Self.minimumScale
    offset = .zero
  }

  func contentVector(at point: CGPoint, in bounds: CGRect) -> CGPoint {
    guard scale > 0 else {
      return .zero
    }
    return CGPoint(
      x: (point.x - bounds.midX - offset.width) / scale,
      y: (point.y - bounds.midY - offset.height) / scale
    )
  }

  mutating func zoom(
    to proposedScale: CGFloat,
    keeping contentVector: CGPoint,
    at viewportPoint: CGPoint,
    in bounds: CGRect,
    aspectRatio: CGFloat
  ) {
    let nextScale = min(
      Self.maximumScale,
      max(Self.minimumScale, proposedScale)
    )
    scale = nextScale
    offset = CGSize(
      width: viewportPoint.x - bounds.midX - contentVector.x * nextScale,
      height: viewportPoint.y - bounds.midY - contentVector.y * nextScale
    )
    clamp(in: bounds, aspectRatio: aspectRatio)
  }

  mutating func pan(
    by translation: CGSize,
    in bounds: CGRect,
    aspectRatio: CGFloat
  ) {
    offset.width += translation.width
    offset.height += translation.height
    clamp(in: bounds, aspectRatio: aspectRatio)
  }

  mutating func clamp(in bounds: CGRect, aspectRatio: CGFloat) {
    scale = min(Self.maximumScale, max(Self.minimumScale, scale))
    guard isZoomed else {
      reset()
      return
    }
    let fitted = fittedRect(in: bounds, aspectRatio: aspectRatio)
    let horizontalLimit = max(0, (fitted.width * scale - bounds.width) / 2)
    let verticalLimit = max(0, (fitted.height * scale - bounds.height) / 2)
    offset.width = min(horizontalLimit, max(-horizontalLimit, offset.width))
    offset.height = min(verticalLimit, max(-verticalLimit, offset.height))
  }

  func normalizedPoint(
    _ point: CGPoint,
    in bounds: CGRect,
    aspectRatio: CGFloat
  ) -> (x: Double, y: Double) {
    guard bounds.width > 0, bounds.height > 0, aspectRatio > 0 else {
      return (0.5, 0.5)
    }
    let vector = contentVector(at: point, in: bounds)
    let untransformedPoint = CGPoint(
      x: bounds.midX + vector.x,
      y: bounds.midY + vector.y
    )
    let fitted = fittedRect(in: bounds, aspectRatio: aspectRatio)
    return (
      Double(min(1, max(0, (untransformedPoint.x - fitted.minX) / fitted.width))),
      Double(min(1, max(0, (untransformedPoint.y - fitted.minY) / fitted.height)))
    )
  }

  private func fittedRect(in bounds: CGRect, aspectRatio: CGFloat) -> CGRect {
    guard bounds.width > 0, bounds.height > 0, aspectRatio > 0 else {
      return bounds
    }
    let viewAspectRatio = bounds.width / bounds.height
    if viewAspectRatio > aspectRatio {
      let width = bounds.height * aspectRatio
      return CGRect(
        x: bounds.midX - width / 2,
        y: bounds.minY,
        width: width,
        height: bounds.height
      )
    }
    let height = bounds.width / aspectRatio
    return CGRect(
      x: bounds.minX,
      y: bounds.midY - height / 2,
      width: bounds.width,
      height: height
    )
  }
}

#if os(iOS)
import LocalAuthentication
import UIKit
import UniformTypeIdentifiers
@preconcurrency import WebRTC

enum RemoteAssistPhase: Equatable {
  case idle
  case authenticating
  case requesting
  case negotiating
  case connected
  case failed(String)

  var statusText: String {
    switch self {
    case .idle:
      return "Remote Assist"
    case .authenticating:
      return "Confirming it is you..."
    case .requesting:
      return "Opening your computer..."
    case .negotiating:
      return "Connecting securely..."
    case .connected:
      return "Remote Assist"
    case .failed(let message):
      return message
    }
  }
}

struct RemoteAssistNotice: Equatable, Identifiable {
  let id = UUID()
  let text: String
  let isError: Bool
}

@MainActor
final class RemoteAssistController: NSObject, ObservableObject {
  let imageTransfer: RemoteImageTransfer
  private var imageObservation: AnyCancellable?
  let dictation = RemoteDictationDraft()
  let terminalReader = RemoteTerminalReader()
  let remoteRecorder = VoiceRecorder()
  @Published private(set) var inlineDictationActive = false
  @Published private(set) var sessionCapabilities = RemoteSessionCapabilities()
  @Published private(set) var dictationTargetName: String?
  private var capabilityTask: Task<Void, Never>?
  private var targetCaptureTask: Task<Void, Never>?
  private var speechSelectionTask: Task<Void, Never>?
  private var speechSelectionRetries = 0
  private var recordingTask: Task<Void, Never>?
  private var recordingGeneration = UUID()
  private var automaticDeliveryTask: Task<Void, Never>?
  private var menuCaptureId: String?
  private var menuCaptureSent = false
  private var menuTargetToken: String?
  private var dictationCaptureId: String?
  private var dictationTargetToken: String?
  @Published private(set) var quickChatSending = false
  private var quickChatTask: Task<Void, Never>?
  private var pendingQuickChat: RemoteQuickChatMessage?
  private var quickChatTitle = ""
#if DEBUG
  private var speechPreviewHost: RemoteSpeechPreviewHost?
#endif
  @Published private(set) var phase: RemoteAssistPhase = .idle
  @Published private(set) var remoteVideoTrack: RTCVideoTrack?
  @Published private(set) var keyboardVisible = false
  @Published private(set) var keyboardFocusRequest = 0
  @Published private(set) var remoteAspectRatio: CGFloat = 16.0 / 9.0
  @Published private(set) var clipboardBusy = false
  @Published private(set) var clipboardNotice: RemoteAssistNotice?
  @Published private(set) var remoteScreenLocked = false
  @Published private(set) var supportsRemoteDictation = false
  @Published private(set) var supportsTerminalReadAloud = false
  @Published private(set) var remoteDisplays: [RemoteDisplayDescriptor] = []
  @Published private(set) var selectedRemoteDisplayId = ""
  @Published private(set) var pendingRemoteDisplayId: String?
  @Published private(set) var displaySelectionPending = false
  @Published private(set) var remoteDisplayChangeToken = 0
  @Published private(set) var remoteTerminalTabs: [RemoteTerminalTabDescriptor] = []
  @Published private(set) var selectedRemoteTerminalTabId = ""
  @Published private(set) var pendingRemoteTerminalTabId: String?
  @Published private(set) var terminalTabRequestPending = false
  @Published private(set) var terminalTabCatalogLoading = false
  @Published private(set) var terminalTabError: String?
  @Published private(set) var closingTerminalTabId: String?
  @Published var terminalCloseConfirmation: RemoteTerminalCloseIntent?
  private var terminalCloseIntent: RemoteTerminalCloseIntent?
  private var terminalCloseRequest: RemoteTerminalTabCloseMessage?
  private var terminalCloseTimeout: Task<Void, Never>?

  private weak var cloudSession: CloudSession?
  private let factory = RTCPeerConnectionFactory()
  private var peerConnection: RTCPeerConnection?
  private var controlChannel: RTCDataChannel?
  private var remoteSessionId = ""
  private var offerGate = RemoteAssistOfferGate()
  private var offerTask: Task<Void, Never>?
  private var pendingCandidates: [RTCIceCandidate] = []
  private var timeoutTask: Task<Void, Never>?
  private var peerRecoveryTask: Task<Void, Never>?
  private var clipboardTimeoutTask: Task<Void, Never>?
  private var clipboardNoticeTask: Task<Void, Never>?
  private var displaySelectionTimeoutTask: Task<Void, Never>?
  private var terminalTabTimeoutTask: Task<Void, Never>?
  private var silentTerminalTabRequestId: String?
  private var readAfterTerminalCatalog = false
  private var terminalResponseTimeoutTask: Task<Void, Never>?
  private var terminalReadCatalogAttempts = 0
  private var terminalReadTargetTabId: String?
  private var textFlushTask: Task<Void, Never>?
  private var bufferedText = ""
  private var textBufferStartedAt: Date?
  private var pendingInputRequests: [String: RemoteInputAction] = [:]
  private var inputTimeoutTasks: [String: Task<Void, Never>] = [:]
  private var lastInputErrorText = ""
  private var lastInputErrorAt = Date.distantPast
  private var pendingClipboardRequest: (
    requestId: String,
    action: RemoteClipboardAction
  )?
  private var displaySelection = RemoteDisplaySelectionState()
  private var terminalTabSelection = RemoteTerminalTabSelectionState()
  private var terminalDragRevision: Int?
  private var terminalDragExpiresAt = Date.distantPast
  private var terminalFocusRetryTabId: String?
  private var lastPointerSentAt = Date.distantPast
  private var remoteIceServers = [
    RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])
  ]

  var hasMultipleRemoteDisplays: Bool {
    remoteDisplays.count > 1
  }

  var remoteInputSuppressed: Bool {
    displaySelectionPending || closingTerminalTabId != nil
  }

  var remoteComputerName: String {
    cloudSession?.activeComputerName ?? "your paired computer"
  }

  var remoteComputerKind: String {
    isWindowsComputer ? "Windows computer" : "Mac"
  }

  var remoteTerminalName: String {
    isWindowsComputer ? "Windows Terminal" : "Terminal"
  }

  var isWindowsComputer: Bool {
    cloudSession?.activeComputer?.platform == "windows"
  }

  override init() {
#if DEBUG
    if ProcessInfo.processInfo.arguments.contains("--clawdad-image-transfer-test") {
      imageTransfer = RemoteImageTransfer(upload: { images, progress in
        if ProcessInfo.processInfo.arguments.contains("--clawdad-image-count-two"), images.count != 2 { throw RemoteFileError.invalidMessage }
        for (index, image) in images.enumerated() {
          try image.upload.validate()
          try await Task.sleep(nanoseconds: 300_000_000)
          progress(Double(index + 1) / Double(images.count))
        }
      })
    } else { imageTransfer = RemoteImageTransfer() }
#else
    imageTransfer = RemoteImageTransfer()
#endif
    RTCInitializeSSL()
    super.init()
  }

  func bind(to session: CloudSession) {
    cloudSession = session
    dictation.bind(to: session)
    terminalReader.bind(to: session)
    imageTransfer.bind(to: session, canAttach: { [weak self] in
      guard let self else { return false }
      return self.phase == .connected && !self.remoteInputSuppressed && !self.remoteScreenLocked && self.sessionCapabilities.imageAttachments == true
    }, send: { [weak self] data in self?.sendControlData(data) ?? false })
    if imageObservation == nil {
      imageObservation = imageTransfer.objectWillChange.sink { [weak self] in self?.objectWillChange.send() }
    }
    dictation.onTranscript = { [weak self] in
      guard let self, self.inlineDictationActive else { return }
      // The toolbar Paste action imports the phone clipboard. Keep it in step
      // with the Mac clipboard so it always contains this new dictation.
      UIPasteboard.general.string = self.dictation.text
      self.automaticDeliveryTask?.cancel()
      self.automaticDeliveryTask = Task { @MainActor [weak self] in
        guard let self else { return }
        let deadline = Date().addingTimeInterval(6)
        while self.inlineDictationActive, Date() < deadline,
              self.clipboardBusy || (self.dictationCaptureId != nil && self.dictationCaptureId == self.menuCaptureId && self.menuTargetToken == nil) {
          try? await Task.sleep(nanoseconds: 40_000_000)
          if Task.isCancelled { return }
        }
        guard self.inlineDictationActive, !Task.isCancelled else { return }
        self.useDictationOnComputer()
      }
    }
    dictation.onTranscriptionFailure = { [weak self] in self?.inlineDictationActive = false }
    session.setRemoteAssistEnvelopeHandler { [weak self] envelope in
      self?.handle(envelope)
    }
  }

#if DEBUG
  func prepareTerminalReaderPreview() {
    guard ClawDadAppStorePreviewScenario.current == .terminalReader else { return }
    prepareSpeechPreviewConnection()
  }

  func prepareDictationPreview() {
    guard ClawDadAppStorePreviewScenario.current == .dictation else { return }
    prepareSpeechPreviewConnection()
  }

  private func prepareSpeechPreviewConnection() {
    phase = .connected
    if ProcessInfo.processInfo.arguments.contains("--clawdad-image-transfer-test") {
      UIPasteboard.general.setData(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!, forPasteboardType: UTType.png.identifier)
    }
    speechPreviewHost = RemoteSpeechPreviewHost { [weak self] data in self?.receiveControlData(data) }
    rememberDictationTarget()
    requestSessionCapabilities()
  }
#endif

  func start() {
    guard let cloudSession else {
      fail("ClawDad is not ready.")
      return
    }
    guard cloudSession.activeComputerSupportsRemoteAssist else {
      fail("Remote Assist is unavailable on \(remoteComputerName). Update the ClawDad companion on that computer and try again.")
      return
    }
    guard cloudSession.remoteAssistIdentityReady else {
      fail("Re-pair this iPhone from ClawDad Settings on \(remoteComputerName) to enable Remote Assist.")
      return
    }
    guard cloudSession.connected else {
      cloudSession.connectIfPaired()
      fail("The secure connection was interrupted. ClawDad is reconnecting to \(remoteComputerName) automatically.")
      return
    }
    guard cloudSession.hostOnline else {
      fail("The secure relay is online and \(remoteComputerName) is reconnecting. Keep ClawDad open on that computer, then tap Try Again.")
      return
    }
    guard phase == .idle || isFailed else {
      return
    }

    tearDownPeer()
    phase = .authenticating
    Task {
      do {
        try await authenticate()
        let sessionId = UUID().uuidString.lowercased()
        remoteSessionId = sessionId
        offerGate.beginSession(sessionId)
        phase = .requesting
        _ = try await cloudSession.sendRemoteAssistEnvelope(
          type: "remote.assist.request",
          body: [
            "sessionId": .string(sessionId),
            "requestedAt": .string(ISO8601DateFormatter().string(from: Date())),
            "transport": .string("webrtc"),
            "control": .bool(true)
          ]
        )
        startTimeout()
      } catch {
        failAndRelease(error.localizedDescription)
      }
    }
  }

  func stop() {
    let sessionId = remoteSessionId
    if !sessionId.isEmpty, let cloudSession {
      Task {
        try? await cloudSession.sendRemoteAssistEnvelope(
          type: "remote.assist.stop",
          body: [
            "sessionId": .string(sessionId),
            "reason": .string("phone_closed")
          ]
        )
      }
    }
    tearDownPeer()
    remoteSessionId = ""
    keyboardVisible = false
    phase = .idle
  }

  func retry() {
    let staleSessionId = remoteSessionId
    let session = cloudSession
    tearDownPeer()
    remoteSessionId = ""
    phase = .idle
    guard !staleSessionId.isEmpty, let session else {
      start()
      return
    }
    Task {
      _ = try? await session.sendRemoteAssistEnvelope(
        type: "remote.assist.stop",
        body: [
          "sessionId": .string(staleSessionId),
          "reason": .string("phone_retry")
        ]
      )
      guard self.phase == .idle else {
        return
      }
      self.start()
    }
  }

  func toggleKeyboard() {
    if keyboardVisible {
      dismissKeyboard()
      return
    }
    guard !displaySelection.inputSuppressed else {
      return
    }
    keyboardVisible = true
    requestKeyboardFocus()
  }

  func dismissKeyboard() {
    flushBufferedText()
    guard keyboardVisible else {
      return
    }
    keyboardVisible = false
  }

  func requestKeyboardFocus() {
    guard keyboardVisible, !displaySelection.inputSuppressed else {
      return
    }
    keyboardFocusRequest &+= 1
  }

  func sendPointerMove(x: Double, y: Double) {
    guard !displaySelection.inputSuppressed else {
      return
    }
    let now = Date()
    guard now.timeIntervalSince(lastPointerSentAt) >= (1.0 / 30.0) else {
      return
    }
    lastPointerSentAt = now
    sendControl([
      "type": "pointer",
      "action": "move",
      "x": clampUnit(x),
      "y": clampUnit(y)
    ])
  }

  func sendPointerDown(x: Double, y: Double) {
    guard !displaySelection.inputSuppressed else {
      return
    }
    lastPointerSentAt = .distantPast
    sendControl([
      "type": "pointer",
      "action": "down",
      "button": "left",
      "x": clampUnit(x),
      "y": clampUnit(y)
    ])
  }

  func sendPointerDrag(x: Double, y: Double) {
    guard !displaySelection.inputSuppressed else {
      return
    }
    let now = Date()
    guard now.timeIntervalSince(lastPointerSentAt) >= (1.0 / 30.0) else {
      return
    }
    lastPointerSentAt = now
    sendControl([
      "type": "pointer",
      "action": "drag",
      "button": "left",
      "x": clampUnit(x),
      "y": clampUnit(y)
    ])
  }

  func sendPointerUp(x: Double, y: Double) {
    guard !displaySelection.inputSuppressed else {
      return
    }
    sendControl([
      "type": "pointer",
      "action": "up",
      "button": "left",
      "x": clampUnit(x),
      "y": clampUnit(y)
    ])
  }

  func sendClick(x: Double, y: Double, button: String = "left") {
    guard !displaySelection.inputSuppressed else {
      return
    }
    sendControl([
      "type": "pointer",
      "action": "click",
      "button": button,
      "x": clampUnit(x),
      "y": clampUnit(y)
    ])
  }

  func sendScroll(deltaX: Double, deltaY: Double) {
    guard !displaySelection.inputSuppressed else {
      return
    }
    sendControl([
      "type": "scroll",
      "deltaX": deltaX,
      "deltaY": deltaY
    ])
  }

  func sendText(_ text: String) {
    guard !text.isEmpty, !displaySelection.inputSuppressed else {
      return
    }
    if bufferedText.isEmpty {
      textBufferStartedAt = Date()
    }
    bufferedText.append(text)

    if Date().timeIntervalSince(textBufferStartedAt ?? Date()) >= 0.24 {
      flushBufferedText()
      return
    }

    textFlushTask?.cancel()
    textFlushTask = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 90_000_000)
      guard !Task.isCancelled else {
        return
      }
      self?.flushBufferedText()
    }
  }

  @discardableResult
  func sendKey(_ key: String) -> Bool {
    flushBufferedText()
    return sendInputRequest(
      .keyRequest(
        key: key,
        requestId: UUID().uuidString.lowercased()
      )
    )
  }

  func pressEnter() {
    guard sendKey("enter") else {
      showClipboardNotice(
        displaySelection.inputSuppressed
          ? "Wait for \(remoteComputerName) to finish switching displays."
          : "Remote Assist is reconnecting.",
        isError: true
      )
      return
    }
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    restoreKeyboardFocusAfterControl()
  }

  func sendShortcut(_ shortcut: RemoteShortcut) {
    guard sendInputRequest(
      .shortcutRequest(
        shortcut: shortcut,
        requestId: UUID().uuidString.lowercased()
      )
    ) else {
      showClipboardNotice(
        displaySelection.inputSuppressed
          ? "Wait for \(remoteComputerName) to finish switching displays."
          : "Remote Assist is reconnecting.",
        isError: true
      )
      return
    }
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    restoreKeyboardFocusAfterControl()
  }

  var quickChatUnavailableReason: String? {
    if phase != .connected { return "Reconnect to send a preset." }
    if remoteScreenLocked { return "Unlock the Mac to send a preset." }
    if remoteInputSuppressed || pendingRemoteTerminalTabId != nil { return "Finishing the screen or tab change…" }
    if inlineDictationActive || dictation.sending || clipboardBusy || imageTransfer.busy || imageTransfer.attaching {
      return "Finish the current input operation first."
    }
    if sessionCapabilities.received && sessionCapabilities.quickChat != true { return "Update ClawDad on your Mac to use Quick Chat." }
    return nil
  }

  func sendQuickChat(_ preset: RemoteQuickChatPreset) {
    guard preset.isValid, !quickChatSending else { return }
    if let reason = quickChatUnavailableReason { showClipboardNotice(reason, isError: true); return }
    if menuCaptureId == nil { rememberDictationTarget() }
    let captureId = menuCaptureId
    quickChatSending = true
    quickChatTitle = preset.title
    quickChatTask = Task { @MainActor [weak self] in
      guard let self else { return }
      if !self.sessionCapabilities.received { self.requestSessionCapabilities() }
      let deadline = Date().addingTimeInterval(10)
      while self.phase == .connected, self.menuCaptureId == captureId,
            (!self.sessionCapabilities.received || self.menuTargetToken == nil), Date() < deadline {
        try? await Task.sleep(for: .milliseconds(40))
        guard !Task.isCancelled else { return }
      }
      guard !Task.isCancelled else { return }
      guard self.quickChatUnavailableReason == nil, self.menuCaptureId == captureId,
            self.sessionCapabilities.quickChat == true,
            let token = self.menuTargetToken else {
        self.finishQuickChat(self.quickChatUnavailableReason ?? "Tap the intended Mac input, then reopen Quick Chat.", isError: true)
        return
      }
      let request = RemoteQuickChatMessage.request(text: preset.text, targetToken: token,
        requestId: UUID().uuidString.lowercased())
      guard let data = try? request.encode() else { self.finishQuickChat("This preset could not be sent.", isError: true); return }
      self.pendingQuickChat = request
      // Repeat the same addressed request when its receipt is delayed. The Mac
      // retains its outcome, including partial insertion, to prevent resubmission.
      for _ in 0..<4 {
        guard !Task.isCancelled, self.phase == .connected, self.pendingQuickChat == request else { return }
        _ = self.sendControlData(data)
        try? await Task.sleep(for: .seconds(5))
      }
      guard !Task.isCancelled else { return }
      self.finishQuickChat("Delivery wasn’t confirmed. Check the Mac before sending again.", isError: true)
    }
  }

  private func finishQuickChat(_ notice: String, isError: Bool) {
    quickChatTask?.cancel()
    quickChatTask = nil
    pendingQuickChat = nil
    quickChatSending = false
    menuCaptureId = nil
    menuTargetToken = nil
    showClipboardNotice(notice, isError: isError)
    if !isError { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
  }

  private func handleQuickChat(_ data: Data) -> Bool {
    guard let response = try? RemoteQuickChatMessage.decode(data), response.type == "quick.chat.result" else { return false }
    guard response.requestId == pendingQuickChat?.requestId else { return true }
    finishQuickChat(response.ok == true ? "Sent: \(quickChatTitle)" : response.error ?? "This preset could not be sent.",
                   isError: response.ok != true)
    return true
  }

  func pastePhoneClipboardToMac(_ values: [String]) {
    guard !clipboardBusy, !displaySelection.inputSuppressed else {
      return
    }
    let text = values.joined(separator: "\n")
    let requestId = UUID().uuidString.lowercased()
    sendClipboardRequest(
      .pasteRequest(text: text, requestId: requestId),
      pendingText: remoteScreenLocked
        ? "Typing securely on \(remoteComputerName)..."
        : "Pasting to \(remoteComputerName)..."
    )
  }

  func useDictationOnComputer() {
    guard phase == .connected, supportsRemoteDictation,
          !clipboardBusy, !remoteInputSuppressed,
          let delivery = dictation.beginDelivery() else {
      inlineDictationActive = false
      showClipboardNotice("Text saved. Reconnect and tap Retry to deliver it.", isError: true)
      return
    }
    sendClipboardRequest(
      .dictationRequest(text: delivery.text, requestId: delivery.requestId,
                       targetToken: dictationTargetToken, copyOnly: dictationTargetToken == nil),
      pendingText: "Using dictation on \(remoteComputerName)..."
    )
  }

  func prepareForRemoteDictation() {
    terminalReader.stopPlayback()
    cloudSession?.readAloud.stop()
  }

  var inlineSpeechUnavailableReason: String? {
    if phase != .connected { return "Reconnect to use speech controls." }
    if remoteScreenLocked { return "Unlock the Mac to use speech controls." }
    if remoteInputSuppressed { return "Finishing the display change…" }
    if sessionCapabilities.inlineSpeech == true { return nil }
    if sessionCapabilities.received { return "Update ClawDad on this Mac to use inline speech." }
    return sessionCapabilities.timedOut ? "The Mac has not answered. Tap a speech control to retry." : "Checking speech connection…"
  }

  private func requestSessionCapabilities() {
    var open = controlChannel?.readyState == .open
#if DEBUG
    open = open || speechPreviewHost != nil
#endif
    guard open else { return }
    capabilityTask?.cancel()
    let requestId = UUID().uuidString.lowercased()
    sessionCapabilities.begin(requestId: requestId)
    let request = RemoteSessionStateRequest(requestId: requestId)
    guard let data = try? request.encode() else { return }
    capabilityTask = Task { @MainActor [weak self] in
      for delay: UInt64 in [0, 250_000_000, 750_000_000, 2_000_000_000, 4_000_000_000] {
        if delay > 0 { try? await Task.sleep(nanoseconds: delay) }
        guard let self, !Task.isCancelled, self.sessionCapabilities.requestId == requestId,
              !self.sessionCapabilities.received else { return }
        _ = self.sendControlData(data)
      }
      try? await Task.sleep(nanoseconds: 2_000_000_000)
      guard let self, !Task.isCancelled else { return }
      self.sessionCapabilities.expire(requestId: requestId)
    }
  }

  private func waitForInlineSpeech() async -> Bool {
    if !sessionCapabilities.received, capabilityTask == nil || sessionCapabilities.timedOut {
      requestSessionCapabilities()
    }
    let deadline = Date().addingTimeInterval(10)
    while phase == .connected, !sessionCapabilities.received, Date() < deadline {
      try? await Task.sleep(nanoseconds: 40_000_000)
      if Task.isCancelled { return false }
    }
    guard !Task.isCancelled else { return false }
    if let reason = inlineSpeechUnavailableReason {
      showClipboardNotice(reason, isError: true)
      return false
    }
    return true
  }

  /// Capture before dismissing the phone keyboard or changing control pages.
  func rememberDictationTarget() {
    guard !inlineDictationActive, !dictation.sending, !quickChatSending else { return }
    flushBufferedText()
    targetCaptureTask?.cancel()
    menuCaptureId = UUID().uuidString.lowercased()
    menuCaptureSent = false
    menuTargetToken = nil
    dictationTargetName = nil
    sendPendingTargetCapture()
  }

  private func sendPendingTargetCapture() {
    guard sessionCapabilities.inlineSpeech == true,
          let requestId = menuCaptureId, !menuCaptureSent else { return }
    menuCaptureSent = true
    guard let data = try? RemoteSpeechContextMessage.request(.captureTarget, requestId: requestId).encode(),
          sendControlData(data) else { return }
    targetCaptureTask = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 6_000_000_000)
      guard !Task.isCancelled, let self, self.menuCaptureId == requestId, self.menuTargetToken == nil else { return }
      self.menuCaptureId = nil
      self.showClipboardNotice("Input target unavailable. Dictation will be copied for pasting.", isError: false)
    }
  }

  func toggleInlineDictation() {
    if remoteRecorder.state == .recording {
      do { dictation.transcribe(try remoteRecorder.stop()) }
      catch { remoteRecorder.present(error); inlineDictationActive = false }
      return
    }
    if inlineDictationActive || remoteRecorder.state == .requestingPermission {
      pauseInlineDictation()
      return
    }
    if phase != .connected || remoteScreenLocked || remoteInputSuppressed,
       let reason = inlineSpeechUnavailableReason {
      showClipboardNotice(reason, isError: true)
      return
    }
    guard !dictation.sending, !clipboardBusy else { return }
    if dictation.hasRecording || !dictation.error.isEmpty { retryInlineDictation(); return }
    cancelTerminalLookup()
    prepareForRemoteDictation()
    clipboardNoticeTask?.cancel()
    clipboardNotice = nil
    dictation.clear()
    dictation.beginRecording()
    if menuCaptureId == nil { rememberDictationTarget() }
    dictationCaptureId = menuCaptureId
    dictationTargetToken = menuTargetToken
    inlineDictationActive = true
    let generation = UUID()
    recordingGeneration = generation
    recordingTask = Task { @MainActor [weak self] in
      guard let self else { return }
      let available = await self.waitForInlineSpeech()
      guard self.recordingGeneration == generation else { return }
      guard available, self.inlineDictationActive else {
        self.inlineDictationActive = false
        return
      }
      await self.remoteRecorder.start()
      guard self.recordingGeneration == generation else { return }
      if self.remoteRecorder.state == .idle { self.inlineDictationActive = false }
    }
  }

  func retryInlineDictation() {
    guard inlineSpeechUnavailableReason == nil, !dictation.sending else {
      showClipboardNotice(inlineSpeechUnavailableReason ?? "Wait for delivery to finish.", isError: true)
      requestSessionCapabilities()
      return
    }
    inlineDictationActive = true
    if dictation.hasRecording { dictation.retryTranscription() }
    else { useDictationOnComputer() }
  }

  func pauseInlineDictation() {
    inlineDictationActive = false
    recordingGeneration = UUID()
    automaticDeliveryTask?.cancel()
    automaticDeliveryTask = nil
    recordingTask?.cancel()
    recordingTask = nil
    if remoteRecorder.state == .recording {
      do { dictation.retain(try remoteRecorder.stop()) }
      catch { remoteRecorder.present(error) }
    } else { remoteRecorder.cancel() }
    dictation.cancelTranscription()
  }

  func discardInlineDictation() {
    pauseInlineDictation()
    dictation.clear()
    dictationTargetToken = nil
    dictationCaptureId = nil
    menuCaptureId = nil
    menuTargetToken = nil
  }

  func toggleInlineReadAloud() {
    if terminalReader.loading || [.preparing, .playing, .paused].contains(cloudSession?.readAloud.phase(for: terminalReader.playbackKey) ?? .idle) {
      cancelTerminalLookup()
      terminalReader.stopPlayback()
      return
    }
    guard !inlineDictationActive else { return }
    if phase != .connected || remoteScreenLocked || remoteInputSuppressed,
       let reason = inlineSpeechUnavailableReason {
      showClipboardNotice(reason, isError: true)
      return
    }
    speechSelectionRetries = 0
    requestInlineSpeechSelection()
  }

  private func requestInlineSpeechSelection() {
    let requestId = UUID().uuidString.lowercased()
    terminalReader.beginSelection(requestId: requestId, tabId: "")
    speechSelectionTask = Task { @MainActor [weak self] in
      guard let self else { return }
      if self.speechSelectionRetries > 0 { try? await Task.sleep(for: .milliseconds(400)) }
      guard !Task.isCancelled else { return }
      guard await self.waitForInlineSpeech() else {
        if !Task.isCancelled { self.terminalReader.cancelLookup() }
        return
      }
      // Opening the menu captures the input on the same host worker. Finish that
      // read before requesting selection; a single speaker tap owns both waits.
      let captureDeadline = Date().addingTimeInterval(6)
      while self.menuCaptureId != nil, self.menuTargetToken == nil, Date() < captureDeadline {
        try? await Task.sleep(nanoseconds: 40_000_000)
        if Task.isCancelled { return }
      }
      guard !Task.isCancelled, self.terminalReader.selectionRequestId == requestId else { return }
      guard let data = try? RemoteSpeechContextMessage.request(.selection, requestId: requestId).encode(),
            self.sendControlData(data) else {
        self.terminalReader.fail("Remote Assist disconnected. Tap the speaker to retry.")
        return
      }
      try? await Task.sleep(nanoseconds: 6_000_000_000)
      guard !Task.isCancelled, self.terminalReader.selectionRequestId == requestId else { return }
      if self.retryInlineSpeechSelection() { return }
      self.terminalReader.fail("The Mac did not return selected text. Tap the speaker to retry.")
    }
  }

  private func retryInlineSpeechSelection() -> Bool {
    guard speechSelectionRetries < 2, phase == .connected, !remoteScreenLocked, !remoteInputSuppressed else { return false }
    speechSelectionRetries += 1
    requestInlineSpeechSelection()
    return true
  }

  private func handleSpeechContext(_ data: Data) -> Bool {
    guard let message = try? RemoteSpeechContextMessage.decode(data), message.type == "speech.context.result" else { return false }
    switch message.action {
    case .captureTarget:
      guard message.requestId == menuCaptureId else { return true }
      targetCaptureTask?.cancel()
      if message.ok == true {
        menuTargetToken = message.token
        dictationTargetName = message.targetName
        if dictationCaptureId == message.requestId { dictationTargetToken = message.token }
      } else {
        menuCaptureId = nil
        showClipboardNotice("Input target unavailable. Dictation will be copied for pasting.", isError: false)
      }
    case .selection:
      guard terminalReader.selectionRequestId == message.requestId else { return true }
      speechSelectionTask?.cancel()
      if message.ok != true {
        if message.error?.hasPrefix("Wait for ") == true, retryInlineSpeechSelection() { return true }
        terminalReader.fail(message.error ?? "Selected text could not be read. Tap the speaker to retry.")
      } else if let text = message.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        _ = terminalReader.receiveSelection(requestId: message.requestId, text: text)
      } else {
        requestLatestTerminalResponse()
      }
    }
    return true
  }

  func requestLatestTerminalResponse() {
    guard phase == .connected, supportsTerminalReadAloud, !remoteScreenLocked else {
      terminalReader.fail("Connect to an updated, unlocked Mac to read Terminal responses.")
      return
    }
    cancelTerminalLookup()
    terminalReader.beginLookup()
    readAfterTerminalCatalog = true
    terminalResponseTimeoutTask = Task { @MainActor [weak self] in
      guard let self else { return }
      let deadline = Date().addingTimeInterval(30)
      // A cold catalog can outlast the picker's eight-second poll timeout. Keep
      // the user's read intent alive and reissue that read-only request instead
      // of leaving it waiting for a reply the picker has already discarded.
      while !Task.isCancelled, self.terminalReader.loading, Date() < deadline {
        if self.readAfterTerminalCatalog, !self.terminalTabSelection.requestPending,
           Date() >= self.terminalDragExpiresAt {
          guard self.terminalReadCatalogAttempts < 3 else { break }
          self.terminalReadCatalogAttempts += 1
          self.beginRemoteTerminalTabCatalog(silently: true)
        }
        try? await Task.sleep(nanoseconds: 250_000_000)
      }
      guard !Task.isCancelled, self.terminalReader.loading else { return }
      self.readAfterTerminalCatalog = false
      self.terminalReader.fail("The Mac could not finish loading this response. Check the connection and try again.")
    }
  }

  private func readCurrentTerminalResponse() {
    guard let state = terminalTabSelection.canonicalState,
          let selectedTabId = state.selectedTabId else {
      if terminalReadCatalogAttempts < 3 { readAfterTerminalCatalog = true; return }
      terminalReader.fail("Choose a Terminal tab, then tap Read latest response.")
      return
    }
    guard terminalReadTargetTabId == nil || terminalReadTargetTabId == selectedTabId else {
      terminalReader.fail("The selected Terminal tab changed. Tap the speaker to read the new tab.")
      return
    }
    terminalReadTargetTabId = selectedTabId
    let request = RemoteTerminalResponseMessage.request(
      requestId: UUID().uuidString.lowercased(), tabId: selectedTabId,
      expectedRevision: state.revision
    )
    terminalReader.expect(request)
    guard let data = try? RemoteTerminalResponseCodec.encode(request), sendControlData(data) else {
      terminalReader.fail("Remote Assist disconnected. Reconnect and try again.")
      return
    }
  }

  func cancelTerminalLookup() {
    speechSelectionTask?.cancel()
    speechSelectionTask = nil
    readAfterTerminalCatalog = false
    terminalReadCatalogAttempts = 0
    terminalReadTargetTabId = nil
    terminalResponseTimeoutTask?.cancel()
    terminalResponseTimeoutTask = nil
    terminalReader.cancelLookup()
  }

  private func handleTerminalResponse(_ data: Data) -> Bool {
    guard let message = try? RemoteTerminalResponseCodec.decode(data),
          message.type == RemoteTerminalResponseMessage.resultType else { return false }
    if terminalReader.receive(message, selectedTabId: selectedRemoteTerminalTabId) {
      if message.ok != true, terminalReadCatalogAttempts < 3,
         phase == .connected, !remoteScreenLocked, !remoteInputSuppressed {
        // Revalidate the same tab before retrying; never follow a changed focus
        // to another response just because a read failed.
        terminalReader.beginLookup()
        readAfterTerminalCatalog = true
        return true
      }
      terminalResponseTimeoutTask?.cancel()
      terminalResponseTimeoutTask = nil
    }
    return true
  }

  func pastePhoneClipboardToMac() {
    guard !clipboardBusy, !displaySelection.inputSuppressed else {
      return
    }
    guard !imageTransfer.busy, !imageTransfer.attaching else { return }
    if imageTransfer.needsPaste, imageTransfer.clipboardChangeCount == UIPasteboard.general.changeCount {
      imageTransfer.pasteSaved(targetToken: imageSelectionTarget(forceFresh: true))
      return
    }
    if UIPasteboard.general.hasImages {
      guard sessionCapabilities.imageAttachments == true, !remoteScreenLocked else {
        imageTransfer.presentError("Reconnect to an unlocked, updated Mac to paste images.")
        return
      }
      let token = imageSelectionTarget()
      let items = UIPasteboard.general.items
      var sources: [(Data, String?)] = []
      for item in items.prefix(RemoteImageLimits.count + 1) {
        if let bytes = item.first(where: { UTType($0.key)?.conforms(to: .image) == true && $0.value is Data })?.value as? Data {
          sources.append((bytes, nil))
        }
      }
      if sources.isEmpty { sources = (UIPasteboard.general.images ?? []).prefix(RemoteImageLimits.count + 1).compactMap { $0.pngData().map { ($0, nil) } } }
      if sources.isEmpty { imageTransfer.presentError("Copy the screenshot again, then tap Paste."); return }
      imageTransfer.prepare(sources, targetToken: token, clipboardChangeCount: UIPasteboard.general.changeCount)
      return
    }
    guard let text = UIPasteboard.general.string, !text.isEmpty else {
      showClipboardNotice(
        "Nothing pasteable is available on this iPhone yet.",
        isError: true
      )
      UINotificationFeedbackGenerator().notificationOccurred(.warning)
      restoreKeyboardFocusAfterControl()
      return
    }
    pastePhoneClipboardToMac([text])
  }

  func imageSelectionTarget(forceFresh: Bool = false) -> String? {
    if !forceFresh, let menuCaptureId { return menuCaptureId }
    flushBufferedText()
    let id = UUID().uuidString.lowercased()
    guard let data = try? RemoteSpeechContextMessage.request(.captureTarget, requestId: id).encode(), sendControlData(data) else { return nil }
    return id
  }

  func copyMacSelectionToPhone() {
    guard !clipboardBusy, !displaySelection.inputSuppressed else {
      return
    }
    let requestId = UUID().uuidString.lowercased()
    sendClipboardRequest(
      .copyRequest(requestId: requestId),
      pendingText: "Copying from \(remoteComputerName)..."
    )
  }

  func selectRemoteDisplay(_ displayId: String) {
    guard phase == .connected,
          !displaySelection.inputSuppressed,
          let display = remoteDisplays.first(where: { $0.id == displayId }),
          display.id != selectedRemoteDisplayId else {
      return
    }

    dismissKeyboard()
    let requestId = UUID().uuidString.lowercased()
    guard let attempt = displaySelection.beginSelection(
      displayId: display.id,
      requestId: requestId
    ) else {
      return
    }

    let data: Data
    do {
      data = try RemoteDisplayCodec.encode(
        .selectRequest(
          displayId: attempt.displayId,
          expectedTopologyRevision: attempt.expectedTopologyRevision,
          requestId: attempt.requestId
        )
      )
    } catch {
      _ = displaySelection.timeOut(requestId: attempt.requestId)
      publishDisplaySelection()
      showClipboardNotice(error.localizedDescription, isError: true)
      UINotificationFeedbackGenerator().notificationOccurred(.error)
      return
    }

    publishDisplaySelection()
    showClipboardNotice(
      "Switching to \(display.name)...",
      isError: false,
      autoDismiss: false
    )
    guard sendControlData(data) else {
      _ = displaySelection.timeOut(requestId: attempt.requestId)
      publishDisplaySelection()
      showClipboardNotice(
        "Remote Assist is reconnecting. The current display will stay active.",
        isError: true
      )
      UINotificationFeedbackGenerator().notificationOccurred(.error)
      return
    }

    displaySelectionTimeoutTask?.cancel()
    displaySelectionTimeoutTask = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 8_000_000_000)
      guard !Task.isCancelled,
            let self,
            self.displaySelection.timeOut(requestId: attempt.requestId) else {
        return
      }
      self.displaySelectionTimeoutTask = nil
      self.publishDisplaySelection()
      self.showClipboardNotice(
        "\(self.remoteComputerName) did not confirm the display change. The current display will stay active.",
        isError: true
      )
      UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
  }

  func requestRemoteTerminalTabs() {
    beginRemoteTerminalTabCatalog(silently: false)
  }

  func pollRemoteTerminalTabs() {
    beginRemoteTerminalTabCatalog(silently: true)
  }

  private func beginRemoteTerminalTabCatalog(silently: Bool) {
    guard phase == .connected,
          closingTerminalTabId == nil,
          !remoteScreenLocked,
          Date() >= terminalDragExpiresAt,
          !terminalTabSelection.requestPending else {
      return
    }
    if !silently {
      dismissKeyboard()
      terminalTabError = nil
    }
    let requestId = UUID().uuidString.lowercased()
    guard let attempt = terminalTabSelection.beginCatalog(
      requestId: requestId
    ) else {
      return
    }
    silentTerminalTabRequestId = silently ? requestId : nil
    sendTerminalTabRequest(
      .listRequest(requestId: requestId),
      attempt: attempt
    )
  }

  func focusRemoteTerminalTab(_ tabId: String, retrying: Bool = false) {
    guard phase == .connected,
          closingTerminalTabId == nil,
          !remoteScreenLocked,
          let tab = remoteTerminalTabs.first(where: { $0.id == tabId }) else {
      return
    }
    if !retrying { terminalFocusRetryTabId = nil }
    cancelTerminalLookup()
    terminalReader.invalidate()
    dismissKeyboard()
    terminalTabError = nil
    silentTerminalTabRequestId = nil
    let requestId = UUID().uuidString.lowercased()
    guard let attempt = terminalTabSelection.beginFocus(
      tabId: tab.id,
      requestId: requestId
    ), let revision = terminalTabSelection.canonicalState?.revision else {
      return
    }
    showClipboardNotice(
      "Focusing \(tab.title)...",
      isError: false,
      autoDismiss: false
    )
    sendTerminalTabRequest(
      .focusRequest(
        tabId: tab.id,
        expectedRevision: revision,
        requestId: requestId
      ),
      attempt: attempt
    )
  }

  func beginTerminalTabDrag() {
    // Retire an in-flight poll so its late reply cannot change the rows under
    // the finger. Ending the gesture resumes polling immediately.
    if let pending = terminalTabSelection.pendingAttempt, pending.kind == .catalog {
      _ = terminalTabSelection.timeOut(requestId: pending.requestId)
      terminalTabTimeoutTask?.cancel()
      terminalTabTimeoutTask = nil
      silentTerminalTabRequestId = nil
      publishTerminalTabSelection()
    }
    terminalDragRevision = terminalTabSelection.canonicalState?.revision
    terminalDragExpiresAt = Date().addingTimeInterval(20)
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
  }

  func endTerminalTabDrag() {
    terminalDragRevision = nil
    terminalDragExpiresAt = .distantPast
  }

  func moveRemoteTerminalTab(_ tabId: String, relativeTo neighborId: String, before: Bool, dragged: Bool = false) {
    let revision = dragged ? (terminalDragRevision ?? terminalTabSelection.canonicalState?.revision) : terminalTabSelection.canonicalState?.revision
    terminalDragRevision = nil
    terminalDragExpiresAt = .distantPast
    guard phase == .connected, !remoteScreenLocked, closingTerminalTabId == nil, let revision,
          let source = remoteTerminalTabs.first(where: { $0.id == tabId }), source.canReorder,
          let neighbor = remoteTerminalTabs.first(where: { $0.id == neighborId }),
          tabId != neighborId, source.windowGroupId == neighbor.windowGroupId else { return }
    let requestId = UUID().uuidString.lowercased()
    guard let attempt = terminalTabSelection.beginMove(tabId: tabId, requestId: requestId) else {
      showClipboardNotice("Wait for the current tab change, then drag again.", isError: false)
      return
    }
    cancelTerminalLookup()
    terminalTabError = nil
    silentTerminalTabRequestId = nil
    showClipboardNotice("Moving Terminal tab…", isError: false, autoDismiss: false)
    sendTerminalTabRequest(.moveRequest(tabId: tabId, neighborTabId: neighborId, placeBefore: before,
                                       expectedRevision: revision, requestId: requestId), attempt: attempt)
  }

  var canCloseTerminalTabs: Bool {
    phase == .connected && !remoteScreenLocked && sessionCapabilities.terminalTabClose == true &&
      closingTerminalTabId == nil && (terminalTabSelection.pendingAttempt == nil || terminalTabSelection.catalogLoading)
  }

  func requestCloseTerminalTab(_ id: String) {
    guard canCloseTerminalTabs, let state = terminalTabSelection.canonicalState,
          let tab = state.tabs.first(where: { $0.id == id }) else { return }
    if let attempt = terminalTabSelection.pendingAttempt { _ = terminalTabSelection.timeOut(requestId: attempt.requestId) }
    terminalTabTimeoutTask?.cancel(); terminalTabTimeoutTask = nil
    silentTerminalTabRequestId = nil
    publishTerminalTabSelection()
    let intent = RemoteTerminalCloseIntent(tab: tab, revision: state.revision,
      isLastTab: state.tabs.filter { $0.windowGroupId == tab.windowGroupId }.count == 1)
    closingTerminalTabId = id
    terminalCloseIntent = intent
    terminalCloseConfirmation = intent
    dismissKeyboard()
  }

  func confirmTerminalClose(_ intent: RemoteTerminalCloseIntent) {
    guard terminalCloseIntent?.id == intent.id, phase == .connected, !remoteScreenLocked else { cancelTerminalClose(); return }
    terminalCloseConfirmation = nil
    let request: RemoteTerminalTabCloseMessage
    if let token = intent.token {
      request = .resolve(tabId: intent.tab.id, token: token, confirm: true, requestId: UUID().uuidString.lowercased())
    } else {
      request = .request(tabId: intent.tab.id, revision: intent.revision, requestId: UUID().uuidString.lowercased())
    }
    sendTerminalClose(request)
  }

  func cancelTerminalClose() {
    terminalCloseConfirmation = nil
    if let intent = terminalCloseIntent, let token = intent.token, phase == .connected {
      sendTerminalClose(.resolve(tabId: intent.tab.id, token: token, confirm: false, requestId: UUID().uuidString.lowercased()))
    } else { clearTerminalClose() }
  }

  private func clearTerminalClose() {
    terminalCloseTimeout?.cancel(); terminalCloseTimeout = nil
    terminalCloseRequest = nil; terminalCloseIntent = nil
    terminalCloseConfirmation = nil; closingTerminalTabId = nil
  }

  private func sendTerminalClose(_ request: RemoteTerminalTabCloseMessage) {
    terminalCloseTimeout?.cancel()
    terminalCloseRequest = request
    guard let data = try? request.encode() else { clearTerminalClose(); return }
    showClipboardNotice(request.confirm == false ? "Keeping Terminal tab open…" : "Closing Terminal tab…", isError: false, autoDismiss: false)
    _ = sendControlData(data)
    terminalCloseTimeout = Task { @MainActor [weak self] in
      for attempt in 0..<4 {
        try? await Task.sleep(for: .seconds(4))
        guard !Task.isCancelled, let self, self.terminalCloseRequest == request else { return }
        if attempt < 3 { _ = self.sendControlData(data) }
        else {
          self.clearTerminalClose()
          self.showClipboardNotice("The Mac has not confirmed the close. Checking its current tabs…", isError: false)
          self.beginRemoteTerminalTabCatalog(silently: true)
        }
      }
    }
  }

  private func handleTerminalClose(_ data: Data) -> Bool {
    guard let result = try? RemoteTerminalTabCloseMessage.decode(data), result.type == "terminal.tab.close.result" else { return false }
    guard terminalCloseRequest?.requestId == result.requestId,
          terminalCloseRequest?.tabId == result.tabId else {
      if result.outcome == .confirmationRequired, let token = result.confirmationToken,
         token != terminalCloseIntent?.token,
         let cancel = try? RemoteTerminalTabCloseMessage.resolve(tabId: result.tabId, token: token,
           confirm: false, requestId: UUID().uuidString.lowercased()).encode() { _ = sendControlData(cancel) }
      return true
    }
    terminalCloseTimeout?.cancel(); terminalCloseTimeout = nil
    terminalCloseRequest = nil
    if let state = result.state { terminalTabSelection.applyCloseState(state); publishTerminalTabSelection() }
    if result.outcome == .confirmationRequired, let previous = terminalCloseIntent {
      var next = RemoteTerminalCloseIntent(tab: result.state?.tabs.first { $0.id == result.tabId } ?? previous.tab,
        revision: result.state?.revision ?? previous.revision, isLastTab: previous.isLastTab)
      next.token = result.confirmationToken; next.nativePrompt = result.prompt; next.nativeButton = result.confirmLabel
      terminalCloseIntent = next
      terminalCloseConfirmation = next
      clipboardNotice = nil
      let intentID = next.id
      terminalCloseTimeout = Task { @MainActor [weak self] in
        try? await Task.sleep(for: .seconds(55))
        guard !Task.isCancelled, let self, self.terminalCloseIntent?.id == intentID else { return }
        self.cancelTerminalClose()
      }
    } else {
      clearTerminalClose()
      terminalTabError = result.outcome == .failed ? result.prompt : nil
      showClipboardNotice(result.outcome == .closed ? "Terminal tab closed" : result.outcome == .cancelled
        ? "Terminal tab kept open" : result.prompt ?? "Check the Mac before trying to close this tab again.", isError: result.outcome == .failed)
    }
    return true
  }

  private func sendTerminalTabRequest(
    _ message: RemoteTerminalTabMessage,
    attempt: RemoteTerminalTabRequestAttempt
  ) {
    let data: Data
    do {
      data = try RemoteTerminalTabCodec.encode(message)
    } catch {
      _ = terminalTabSelection.timeOut(requestId: attempt.requestId)
      let isSilent = silentTerminalTabRequestId == attempt.requestId
      silentTerminalTabRequestId = nil
      publishTerminalTabSelection()
      guard !isSilent else {
        return
      }
      terminalTabError = error.localizedDescription
      showClipboardNotice(error.localizedDescription, isError: true)
      return
    }
    publishTerminalTabSelection()
    guard sendControlData(data) else {
      _ = terminalTabSelection.timeOut(requestId: attempt.requestId)
      let isSilent = silentTerminalTabRequestId == attempt.requestId
      silentTerminalTabRequestId = nil
      publishTerminalTabSelection()
      guard !isSilent else {
        return
      }
      terminalTabError = "Remote Assist is reconnecting."
      showClipboardNotice("Remote Assist is reconnecting.", isError: true)
      return
    }

    terminalTabTimeoutTask?.cancel()
    terminalTabTimeoutTask = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 8_000_000_000)
      guard !Task.isCancelled,
            let self,
            self.terminalTabSelection.timeOut(
              requestId: attempt.requestId
            ) else {
        return
      }
      self.terminalTabTimeoutTask = nil
      let isSilent = self.silentTerminalTabRequestId == attempt.requestId
      self.silentTerminalTabRequestId = nil
      self.publishTerminalTabSelection()
      guard !isSilent else {
        return
      }
      let timeoutMessage = attempt.kind == .catalog
        ? "\(self.remoteComputerName) did not return \(self.remoteTerminalName) tabs. Tap refresh to try again."
        : "\(self.remoteComputerName) did not confirm the \(self.remoteTerminalName) tab change."
      self.terminalTabError = timeoutMessage
      self.showClipboardNotice(timeoutMessage, isError: true)
      self.beginRemoteTerminalTabCatalog(silently: true)
      UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
  }

  private var isFailed: Bool {
    if case .failed = phase {
      return true
    }
    return false
  }

  private func authenticate() async throws {
    let context = LAContext()
    context.localizedCancelTitle = "Cancel"
    var evaluationError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &evaluationError) else {
      throw evaluationError ?? RemoteAssistError.authenticationUnavailable
    }
    try await context.evaluatePolicy(
      .deviceOwnerAuthentication,
      localizedReason: "Open \(remoteComputerName) with Remote Assist"
    )
  }

  private func handle(_ envelope: CloudEnvelope) {
    let sessionId = envelope.body["sessionId"]?.stringValue ?? ""
    guard !sessionId.isEmpty, sessionId == remoteSessionId else {
      return
    }

    switch envelope.type {
    case "remote.assist.available":
      phase = .negotiating
    case "remote.assist.offer":
      guard let sdp = envelope.body["sdp"]?.stringValue, !sdp.isEmpty else {
        failAndRelease("\(remoteComputerName) returned an invalid Remote Assist offer.")
        return
      }
      guard let attempt = offerGate.claimOffer(for: sessionId) else {
        return
      }
      let width = envelope.body["width"]?.numberValue ?? 0
      let height = envelope.body["height"]?.numberValue ?? 0
      if width > 0, height > 0 {
        remoteAspectRatio = CGFloat(width / height)
      }
      let offeredIceServers = parseIceServers(
        envelope.body["iceServers"]
      )
      if !offeredIceServers.isEmpty {
        remoteIceServers = offeredIceServers
      }
      offerTask = Task { [weak self] in
        guard let self else {
          return
        }
        do {
          try await self.acceptOffer(sdp, attempt: attempt)
        } catch {
          guard self.offerGate.isCurrent(attempt),
                self.remoteSessionId == attempt.sessionId else {
            return
          }
          self.failAndRelease(error.localizedDescription)
        }
      }
    case "remote.assist.ice":
      guard let sdp = envelope.body["candidate"]?.stringValue, !sdp.isEmpty else {
        return
      }
      let candidate = RTCIceCandidate(
        sdp: sdp,
        sdpMLineIndex: Int32(envelope.body["sdpMLineIndex"]?.numberValue ?? 0),
        sdpMid: envelope.body["sdpMid"]?.stringValue
      )
      addRemoteCandidate(candidate)
    case "remote.assist.ice-servers":
      let refreshedIceServers = parseIceServers(
        envelope.body["iceServers"]
      )
      guard !refreshedIceServers.isEmpty else {
        return
      }
      remoteIceServers = refreshedIceServers
      updatePeerIceServers(refreshedIceServers)
    case "remote.assist.stop":
      failAndRelease(
        envelope.body["reason"]?.stringValue ?? "\(remoteComputerName) ended Remote Assist.",
        notifyMac: false
      )
    case "remote.assist.error":
      failAndRelease(
        envelope.body["error"]?.stringValue ?? "Remote Assist could not start.",
        notifyMac: false
      )
    default:
      break
    }
  }

  private func acceptOffer(
    _ sdp: String,
    attempt: RemoteAssistOfferAttempt
  ) async throws {
    guard offerGate.isCurrent(attempt),
          remoteSessionId == attempt.sessionId else {
      return
    }
    let peer = try makePeerConnection()
    phase = .negotiating
    try await setRemoteDescription(
      RTCSessionDescription(type: .offer, sdp: sdp),
      on: peer
    )
    guard offerGate.isCurrent(attempt),
          remoteSessionId == attempt.sessionId,
          peerConnection === peer else {
      return
    }
    for candidate in pendingCandidates {
      try? await peer.add(candidate)
    }
    pendingCandidates.removeAll()

    let answer = try await createAnswer(on: peer)
    guard offerGate.isCurrent(attempt),
          remoteSessionId == attempt.sessionId,
          peerConnection === peer else {
      return
    }
    try await setLocalDescription(answer, on: peer)
    guard offerGate.isCurrent(attempt),
          remoteSessionId == attempt.sessionId,
          peerConnection === peer else {
      return
    }
    guard let cloudSession else {
      throw RemoteAssistError.cloudUnavailable
    }
    _ = try await cloudSession.sendRemoteAssistEnvelope(
      type: "remote.assist.answer",
      body: [
        "sessionId": .string(attempt.sessionId),
        "sdp": .string(answer.sdp)
      ]
    )
  }

  private func makePeerConnection() throws -> RTCPeerConnection {
    if let peerConnection {
      return peerConnection
    }
    let configuration = RTCConfiguration()
    configuration.sdpSemantics = .unifiedPlan
    configuration.continualGatheringPolicy = .gatherContinually
    configuration.iceServers = remoteIceServers
    let constraints = RTCMediaConstraints(
      mandatoryConstraints: nil,
      optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
    )
    guard let peer = factory.peerConnection(
      with: configuration,
      constraints: constraints,
      delegate: self
    ) else {
      throw RemoteAssistError.peerConnectionUnavailable
    }
    peerConnection = peer
    return peer
  }

  private func addRemoteCandidate(_ candidate: RTCIceCandidate) {
    guard let peerConnection, peerConnection.remoteDescription != nil else {
      pendingCandidates.append(candidate)
      return
    }
    Task {
      try? await peerConnection.add(candidate)
    }
  }

  private func updatePeerIceServers(_ servers: [RTCIceServer]) {
    guard let peerConnection else {
      return
    }
    let configuration = peerConnection.configuration
    configuration.iceServers = servers
    _ = peerConnection.setConfiguration(configuration)
  }

  private func createAnswer(on peer: RTCPeerConnection) async throws -> RTCSessionDescription {
    try await withCheckedThrowingContinuation { continuation in
      let constraints = RTCMediaConstraints(
        mandatoryConstraints: nil,
        optionalConstraints: nil
      )
      peer.answer(for: constraints) { answer, error in
        if let error {
          continuation.resume(throwing: error)
        } else if let answer {
          continuation.resume(returning: answer)
        } else {
          continuation.resume(throwing: RemoteAssistError.invalidSessionDescription)
        }
      }
    }
  }

  private func setRemoteDescription(
    _ description: RTCSessionDescription,
    on peer: RTCPeerConnection
  ) async throws {
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, Error>) in
      peer.setRemoteDescription(description) { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: ())
        }
      }
    }
  }

  private func setLocalDescription(
    _ description: RTCSessionDescription,
    on peer: RTCPeerConnection
  ) async throws {
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, Error>) in
      peer.setLocalDescription(description) { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: ())
        }
      }
    }
  }

  @discardableResult
  private func sendControl(_ object: [String: Any]) -> Bool {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object) else {
      return false
    }
    return sendControlData(data)
  }

  private func sendControlData(_ data: Data) -> Bool {
#if DEBUG
    if let speechPreviewHost { return speechPreviewHost.send(data) }
#endif
    guard let controlChannel,
          controlChannel.readyState == .open else {
      return false
    }
    return controlChannel.sendData(
      RTCDataBuffer(data: data, isBinary: false)
    )
  }

  private func flushBufferedText() {
    textFlushTask?.cancel()
    textFlushTask = nil
    let text = bufferedText
    bufferedText = ""
    textBufferStartedAt = nil
    guard !text.isEmpty else {
      return
    }
    _ = sendInputRequest(
      .textRequest(
        text: text,
        requestId: UUID().uuidString.lowercased()
      )
    )
  }

  @discardableResult
  private func sendInputRequest(_ message: RemoteInputMessage) -> Bool {
    guard !displaySelection.inputSuppressed else {
      return false
    }
    let data: Data
    do {
      data = try RemoteInputCodec.encode(message)
    } catch {
      showInputError(error.localizedDescription)
      return false
    }

    guard sendControlData(data) else {
      showInputError("Remote Assist is reconnecting.")
      return false
    }

    pendingInputRequests[message.requestId] = message.action
    inputTimeoutTasks[message.requestId]?.cancel()
    inputTimeoutTasks[message.requestId] = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 8_000_000_000)
      guard !Task.isCancelled,
            let self,
            self.pendingInputRequests.removeValue(
              forKey: message.requestId
            ) != nil else {
        return
      }
      self.inputTimeoutTasks.removeValue(forKey: message.requestId)
      self.showInputError(
        "\(self.remoteComputerName) did not accept input. Tap a text field and try again."
      )
    }
    return true
  }

  private func handleInputResponse(_ data: Data) -> Bool {
    guard let message = try? RemoteInputCodec.decode(data),
          message.type == RemoteInputMessage.resultType,
          let pendingAction = pendingInputRequests[message.requestId],
          pendingAction == message.action else {
      return false
    }

    pendingInputRequests.removeValue(forKey: message.requestId)
    inputTimeoutTasks.removeValue(forKey: message.requestId)?.cancel()
    if message.ok != true {
      showInputError(
        message.error ?? "The focused app on \(remoteComputerName) did not accept input."
      )
    }
    return true
  }

  private func handleSessionState(_ data: Data) -> Bool {
    guard let message = try? RemoteSessionStateCodec.decode(data) else {
      return false
    }
    guard sessionCapabilities.receive(message) else { return true }
    let changed = remoteScreenLocked != message.screenLocked
    remoteScreenLocked = message.screenLocked
    supportsRemoteDictation = sessionCapabilities.dictation == true
    supportsTerminalReadAloud = sessionCapabilities.terminalReadAloud == true
    sendPendingTargetCapture()
    if message.screenLocked {
      cancelTerminalClose()
      cancelTerminalLookup()
      terminalReader.invalidate("Unlock the Mac to read Terminal text.")
    }
    if changed {
      showClipboardNotice(
        message.screenLocked
          ? "\(remoteComputerKind) locked: secure keyboard mode"
          : "\(remoteComputerKind) unlocked",
        isError: false
      )
    }
    return true
  }

  // One receive path is exercised by the native channel and encoded preview peers.
  func receiveControlData(_ data: Data) {
    if handleTerminalClose(data) { return }
    if handleQuickChat(data) { return }
    if imageTransfer.receive(data) { return }
    if handleInputResponse(data) { return }
    if handleSessionState(data) { return }
    if handleSpeechContext(data) { return }
    if handleDisplayMessage(data) { return }
    if handleTerminalTabMessage(data) { return }
    if handleTerminalResponse(data) { return }
    handleClipboardResponse(data)
  }

  private func handleDisplayMessage(_ data: Data) -> Bool {
    guard let message = try? RemoteDisplayCodec.decode(data) else {
      return false
    }

    switch message.type {
    case RemoteDisplayMessage.stateType:
      guard let state = message.state else {
        return true
      }
      let previousSelectedDisplayId = displaySelection.selectedDisplayId
      let pendingBefore = displaySelection.pendingAttempt
      let application = displaySelection.applyState(state)
      guard application.accepted else {
        return true
      }
      if application.pendingResolved || application.pendingInvalidated {
        displaySelectionTimeoutTask?.cancel()
        displaySelectionTimeoutTask = nil
      }
      publishDisplaySelection()

      if application.pendingResolved,
         let pendingBefore,
         let selectedDisplay = displaySelection.selectedDisplay,
         selectedDisplay.id == pendingBefore.displayId {
        showClipboardNotice(
          "Showing \(selectedDisplay.name)",
          isError: false
        )
        UINotificationFeedbackGenerator().notificationOccurred(.success)
      } else if application.pendingInvalidated {
        showClipboardNotice(
          "That display is no longer available. \(remoteComputerName) kept the current display active.",
          isError: true
        )
        UINotificationFeedbackGenerator().notificationOccurred(.error)
      } else if !previousSelectedDisplayId.isEmpty,
                application.selectedDisplayChanged,
                let selectedDisplay = displaySelection.selectedDisplay {
        showClipboardNotice(
          "Showing \(selectedDisplay.name)",
          isError: false
        )
      }
      return true

    case RemoteDisplayMessage.selectResultType:
      let pendingBefore = displaySelection.pendingAttempt
      guard let application = displaySelection.applyResult(message) else {
        return true
      }
      if pendingBefore != nil, displaySelection.pendingAttempt == nil {
        displaySelectionTimeoutTask?.cancel()
        displaySelectionTimeoutTask = nil
      }
      publishDisplaySelection()

      if application.matchedPendingRequest, let pendingBefore {
        if message.ok == true,
           displaySelection.selectedDisplayId == pendingBefore.displayId,
           let selectedDisplay = displaySelection.selectedDisplay {
          showClipboardNotice(
            "Showing \(selectedDisplay.name)",
            isError: false
          )
          UINotificationFeedbackGenerator().notificationOccurred(.success)
        } else {
          showClipboardNotice(
            message.error ?? "\(remoteComputerName) could not switch displays.",
            isError: true
          )
          UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
      } else if application.stateApplication.pendingResolved,
                let selectedDisplay = displaySelection.selectedDisplay {
        showClipboardNotice(
          "Showing \(selectedDisplay.name)",
          isError: false
        )
        UINotificationFeedbackGenerator().notificationOccurred(.success)
      } else if application.stateApplication.pendingInvalidated {
        showClipboardNotice(
          "That display is no longer available. \(remoteComputerName) kept the current display active.",
          isError: true
        )
        UINotificationFeedbackGenerator().notificationOccurred(.error)
      } else if application.stateApplication.accepted,
                application.stateApplication.selectedDisplayChanged,
                let selectedDisplay = displaySelection.selectedDisplay {
        showClipboardNotice(
          "Showing \(selectedDisplay.name)",
          isError: false
        )
      }
      return true

    case RemoteDisplayMessage.selectType:
      return true

    default:
      return true
    }
  }

  private func handleTerminalTabMessage(_ data: Data) -> Bool {
    guard let message = try? RemoteTerminalTabCodec.decode(data),
          message.type == RemoteTerminalTabMessage.listResultType ||
            message.type == RemoteTerminalTabMessage.focusResultType ||
            message.type == RemoteTerminalTabMessage.moveResultType else {
      return false
    }
    let pendingBefore = terminalTabSelection.pendingAttempt
    let isSilent = silentTerminalTabRequestId == message.requestId
    guard let application = terminalTabSelection.applyResult(message) else {
      return true
    }
    if application.matchedPendingRequest {
      terminalTabTimeoutTask?.cancel()
      terminalTabTimeoutTask = nil
      silentTerminalTabRequestId = nil
    }
    publishTerminalTabSelection()

    if readAfterTerminalCatalog, application.matchedPendingRequest {
      if message.ok == true {
        readAfterTerminalCatalog = false
        readCurrentTerminalResponse()
      } else if terminalReadCatalogAttempts >= 3 ||
                  ["mac_locked", "permission_required", "automation_denied"].contains(message.errorCode ?? "") {
        readAfterTerminalCatalog = false
        terminalReader.fail(message.error ?? "Terminal tabs could not be refreshed.")
      }
    }

    if message.ok == true {
      if application.matchedPendingRequest, message.type == RemoteTerminalTabMessage.moveResultType {
        showClipboardNotice("Terminal tab order updated", isError: false)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
      }
      if application.acceptedState {
        terminalTabError = nil
      }
      if application.matchedPendingRequest,
         case .focus(let targetTabId) = pendingBefore?.kind,
         selectedRemoteTerminalTabId == targetTabId,
         let tab = remoteTerminalTabs.first(where: { $0.id == targetTabId }) {
        showClipboardNotice("Focused \(tab.title)", isError: false)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
      }
    } else if application.matchedPendingRequest, !isSilent {
      if ["stale_catalog", "layout_unavailable", "focus_failed"].contains(message.errorCode ?? ""),
         message.state != nil, case .focus(let target) = pendingBefore?.kind,
         terminalFocusRetryTabId != target, remoteTerminalTabs.contains(where: { $0.id == target }) {
        terminalFocusRetryTabId = target
        focusRemoteTerminalTab(target, retrying: true)
        return true
      }
      let failureMessage = message.error ??
        "\(remoteComputerName) could not update \(remoteTerminalName) tabs."
      terminalTabError = failureMessage
      showClipboardNotice(failureMessage, isError: true)
      UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
    return true
  }

  private func publishDisplaySelection() {
    let previousSelectedDisplayId = selectedRemoteDisplayId
    remoteDisplays = displaySelection.displays
    selectedRemoteDisplayId = displaySelection.selectedDisplayId
    pendingRemoteDisplayId = displaySelection.pendingAttempt?.displayId
    displaySelectionPending = displaySelection.inputSuppressed

    if let selectedDisplay = displaySelection.selectedDisplay,
       selectedDisplay.width > 0,
       selectedDisplay.height > 0 {
      remoteAspectRatio = CGFloat(selectedDisplay.width) /
        CGFloat(selectedDisplay.height)
    }
    if previousSelectedDisplayId != selectedRemoteDisplayId,
       !selectedRemoteDisplayId.isEmpty {
      remoteDisplayChangeToken &+= 1
    }
  }

  private func publishTerminalTabSelection() {
    remoteTerminalTabs = terminalTabSelection.tabs
    selectedRemoteTerminalTabId = terminalTabSelection.selectedTabId
    pendingRemoteTerminalTabId = terminalTabSelection.pendingTabId
    terminalTabRequestPending = terminalTabSelection.requestPending
    terminalTabCatalogLoading = terminalTabSelection.catalogLoading
    if !terminalReader.sourceTabId.isEmpty,
       terminalReader.sourceTabId != selectedRemoteTerminalTabId {
      cancelTerminalLookup()
      terminalReader.invalidate("Selected tab changed. Tap Read latest response for this tab.")
    }
  }

  private func showInputError(_ text: String) {
    let now = Date()
    guard text != lastInputErrorText ||
            now.timeIntervalSince(lastInputErrorAt) >= 1.5 else {
      return
    }
    lastInputErrorText = text
    lastInputErrorAt = now
    showClipboardNotice(text, isError: true)
    UINotificationFeedbackGenerator().notificationOccurred(.error)
  }

  private func sendClipboardRequest(
    _ message: RemoteClipboardMessage,
    pendingText: String
  ) {
    guard !displaySelection.inputSuppressed else {
      return
    }
    let data: Data
    do {
      data = try RemoteClipboardCodec.encode(message)
    } catch {
      if message.action == .dictation {
        dictation.completeDelivery(requestId: message.requestId,
                                   result: .failure(.failed(error.localizedDescription)))
      }
      showClipboardNotice(error.localizedDescription, isError: true)
      UINotificationFeedbackGenerator().notificationOccurred(.error)
      return
    }

    pendingClipboardRequest = (
      requestId: message.requestId,
      action: message.action
    )
    clipboardBusy = true
    showClipboardNotice(
      pendingText,
      isError: false,
      autoDismiss: false
    )

    guard sendControlData(data) else {
      finishClipboardRequest(
        notice: "Remote Assist is reconnecting.",
        isError: true
      )
      return
    }

    clipboardTimeoutTask?.cancel()
    clipboardTimeoutTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: 3_000_000_000)
      if !Task.isCancelled, message.action == .dictation,
         self?.pendingClipboardRequest?.requestId == message.requestId {
        // The Mac retains receipts across peer reconnects. A repeated command
        // asks for that receipt without inserting the transcript twice.
        _ = self?.sendControlData(data)
      }
      try? await Task.sleep(nanoseconds: 9_000_000_000)
      guard !Task.isCancelled,
            let self,
            self.pendingClipboardRequest?.requestId == message.requestId else {
        return
      }
      self.finishClipboardRequest(
        notice: "\(self.remoteComputerName) did not answer the clipboard request.",
        isError: true
      )
    }
  }

  private func handleClipboardResponse(_ data: Data) {
    guard let message = try? RemoteClipboardCodec.decode(data),
          message.type == RemoteClipboardMessage.resultType,
          let pendingClipboardRequest,
          message.requestId == pendingClipboardRequest.requestId,
          message.action == pendingClipboardRequest.action else {
      return
    }

    guard message.ok == true else {
      finishClipboardRequest(
        notice: message.error ?? "The clipboard request failed.",
        isError: true
      )
      return
    }

    switch message.action {
    case .dictation:
      finishClipboardRequest(
        notice: message.disposition == .inserted
          ? "Inserted on \(remoteComputerName)"
          : (message.disposition == .pasteRequested
            ? "Copied and sent Paste on \(remoteComputerName)"
            : "Copied to \(remoteComputerName) clipboard"),
        isError: false, dictationDisposition: message.disposition
      )
    case .paste:
      finishClipboardRequest(
        notice: remoteScreenLocked
          ? "Keys sent securely"
          : "Pasted to \(remoteComputerName)",
        isError: false
      )
    case .copy:
      guard let text = message.text, !text.isEmpty else {
        finishClipboardRequest(
          notice: "\(remoteComputerName) did not return any copied text.",
          isError: true
        )
        return
      }
      UIPasteboard.general.string = text
      finishClipboardRequest(
        notice: "Copied to iPhone",
        isError: false
      )
    }
  }

  private func finishClipboardRequest(
    notice: String,
    isError: Bool,
    dictationDisposition: RemoteDictationDisposition? = nil
  ) {
    if let pending = pendingClipboardRequest, pending.action == .dictation {
      inlineDictationActive = false
      let result: Result<RemoteDictationDisposition, VoiceTranscriptionError>
      if !isError, let dictationDisposition {
        result = .success(dictationDisposition)
        // A second recording in the still-open menu needs a fresh caret snapshot.
        menuCaptureId = nil
        menuTargetToken = nil
      } else {
        result = .failure(.failed(notice + " Your draft is saved. Check the Mac before trying again."))
      }
      dictation.completeDelivery(
        requestId: pending.requestId,
        result: result
      )
    }
    clipboardTimeoutTask?.cancel()
    clipboardTimeoutTask = nil
    pendingClipboardRequest = nil
    clipboardBusy = false
    showClipboardNotice(notice, isError: isError)
    UINotificationFeedbackGenerator().notificationOccurred(
      isError ? .error : .success
    )
    restoreKeyboardFocusAfterControl()
  }

  private func restoreKeyboardFocusAfterControl() {
    guard keyboardVisible else {
      return
    }
    Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 150_000_000)
      guard !Task.isCancelled,
            let self,
            self.keyboardVisible else {
        return
      }
      self.requestKeyboardFocus()
    }
  }

  private func showClipboardNotice(
    _ text: String,
    isError: Bool,
    autoDismiss: Bool = true
  ) {
    clipboardNoticeTask?.cancel()
    clipboardNoticeTask = nil
    let notice = RemoteAssistNotice(text: text, isError: isError)
    clipboardNotice = notice
    guard autoDismiss else {
      return
    }
    clipboardNoticeTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: 2_200_000_000)
      guard !Task.isCancelled,
            let self,
            self.clipboardNotice?.id == notice.id else {
        return
      }
      self.clipboardNotice = nil
      self.clipboardNoticeTask = nil
    }
  }

  private func startTimeout() {
    timeoutTask?.cancel()
    timeoutTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: 25_000_000_000)
      guard !Task.isCancelled, let self else {
        return
      }
      if self.phase != .connected {
        self.failAndRelease(
          "\(self.remoteComputerName) did not answer within 25 seconds. Confirm ClawDad is open and Remote Assist is enabled, then tap Try Again."
        )
      }
    }
  }

  private func fail(_ message: String) {
    timeoutTask?.cancel()
    timeoutTask = nil
    phase = .failed(
      message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? "Remote Assist could not start."
        : message
    )
  }

  private func failAndRelease(
    _ message: String,
    notifyMac: Bool = true
  ) {
    let sessionId = remoteSessionId
    fail(message)
    tearDownPeer()
    remoteSessionId = ""
    guard notifyMac, !sessionId.isEmpty, let cloudSession else {
      return
    }
    Task {
      try? await cloudSession.sendRemoteAssistEnvelope(
        type: "remote.assist.stop",
        body: [
          "sessionId": .string(sessionId),
          "reason": .string("phone_connection_ended")
        ]
      )
    }
  }

  private func schedulePeerRecoveryTimeout(
    for peer: RTCPeerConnection
  ) {
    peerRecoveryTask?.cancel()
    peerRecoveryTask = Task { @MainActor [weak self, weak peer] in
      do {
        try await Task.sleep(nanoseconds: 15_000_000_000)
      } catch {
        return
      }
      guard !Task.isCancelled,
            let self,
            let peer,
            self.peerConnection === peer else {
        return
      }
      self.peerRecoveryTask = nil
      self.failAndRelease(
        "Remote Assist disconnected during the network change. Try again."
      )
    }
  }

  private func tearDownPeer() {
    clearTerminalClose()
    quickChatTask?.cancel()
    quickChatTask = nil
    pendingQuickChat = nil
    quickChatSending = false
    imageTransfer.disconnected()
    pauseInlineDictation()
    capabilityTask?.cancel()
    capabilityTask = nil
    targetCaptureTask?.cancel()
    targetCaptureTask = nil
    sessionCapabilities = RemoteSessionCapabilities()
    menuCaptureId = nil
    menuTargetToken = nil
    cancelTerminalLookup()
    terminalReader.invalidate()
    supportsTerminalReadAloud = false
    if pendingClipboardRequest?.action == .dictation {
      finishClipboardRequest(notice: "Remote Assist disconnected.", isError: true)
    }
    supportsRemoteDictation = false
    offerTask?.cancel()
    offerTask = nil
    offerGate.reset()
    timeoutTask?.cancel()
    timeoutTask = nil
    peerRecoveryTask?.cancel()
    peerRecoveryTask = nil
    clipboardTimeoutTask?.cancel()
    clipboardTimeoutTask = nil
    clipboardNoticeTask?.cancel()
    clipboardNoticeTask = nil
    displaySelectionTimeoutTask?.cancel()
    displaySelectionTimeoutTask = nil
    terminalTabTimeoutTask?.cancel()
    terminalTabTimeoutTask = nil
    silentTerminalTabRequestId = nil
    textFlushTask?.cancel()
    textFlushTask = nil
    bufferedText = ""
    textBufferStartedAt = nil
    for task in inputTimeoutTasks.values {
      task.cancel()
    }
    inputTimeoutTasks.removeAll()
    pendingInputRequests.removeAll()
    lastInputErrorText = ""
    lastInputErrorAt = .distantPast
    pendingClipboardRequest = nil
    clipboardBusy = false
    clipboardNotice = nil
    remoteScreenLocked = false
    displaySelection.reset()
    remoteDisplays = []
    selectedRemoteDisplayId = ""
    pendingRemoteDisplayId = nil
    displaySelectionPending = false
    terminalTabSelection.reset()
    terminalFocusRetryTabId = nil
    terminalDragRevision = nil
    terminalDragExpiresAt = .distantPast
    remoteTerminalTabs = []
    selectedRemoteTerminalTabId = ""
    pendingRemoteTerminalTabId = nil
    terminalTabRequestPending = false
    terminalTabCatalogLoading = false
    terminalTabError = nil
    remoteAspectRatio = 16.0 / 9.0
    controlChannel?.delegate = nil
    controlChannel?.close()
    controlChannel = nil
    peerConnection?.delegate = nil
    peerConnection?.close()
    peerConnection = nil
    pendingCandidates.removeAll()
    remoteVideoTrack = nil
    remoteIceServers = [
      RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])
    ]
  }

  private func clampUnit(_ value: Double) -> Double {
    min(1, max(0, value))
  }

  private func parseIceServers(_ value: JSONValue?) -> [RTCIceServer] {
    guard case .array(let values) = value else {
      return []
    }
    return values.compactMap { entry in
      guard case .object(let object) = entry,
            case .array(let urlValues) = object["urls"] else {
        return nil
      }
      let urls = urlValues
        .map(\.stringValue)
        .filter { !$0.isEmpty }
      guard !urls.isEmpty else {
        return nil
      }
      let username = object["username"]?.stringValue ?? ""
      let credential = object["credential"]?.stringValue ?? ""
      if !username.isEmpty, !credential.isEmpty {
        return RTCIceServer(
          urlStrings: urls,
          username: username,
          credential: credential
        )
      }
      return RTCIceServer(urlStrings: urls)
    }
  }
}

extension RemoteAssistController: RTCPeerConnectionDelegate {
  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didChange stateChanged: RTCSignalingState
  ) {}

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didAdd stream: RTCMediaStream
  ) {
    guard let track = stream.videoTracks.first else {
      return
    }
    Task { @MainActor [weak self] in
      guard let self, self.peerConnection === peerConnection else {
        return
      }
      self.remoteVideoTrack = track
    }
  }

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didRemove stream: RTCMediaStream
  ) {}

  nonisolated func peerConnectionShouldNegotiate(
    _ peerConnection: RTCPeerConnection
  ) {}

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didChange newState: RTCIceConnectionState
  ) {}

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didChange newState: RTCIceGatheringState
  ) {}

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didGenerate candidate: RTCIceCandidate
  ) {
    Task { @MainActor [weak self] in
      guard let self,
            self.peerConnection === peerConnection,
            !self.remoteSessionId.isEmpty,
            let cloudSession = self.cloudSession else {
        return
      }
      let sessionId = self.remoteSessionId
      _ = try? await cloudSession.sendRemoteAssistEnvelope(
        type: "remote.assist.ice",
        body: [
          "sessionId": .string(sessionId),
          "candidate": .string(candidate.sdp),
          "sdpMid": .string(candidate.sdpMid ?? ""),
          "sdpMLineIndex": .number(Double(candidate.sdpMLineIndex))
        ]
      )
    }
  }

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didRemove candidates: [RTCIceCandidate]
  ) {}

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didOpen dataChannel: RTCDataChannel
  ) {
    guard dataChannel.label == "clawdad-control" else {
      return
    }
    Task { @MainActor [weak self] in
      guard let self, self.peerConnection === peerConnection else {
        return
      }
      self.controlChannel = dataChannel
      dataChannel.delegate = self
      self.requestSessionCapabilities()
    }
  }

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didChange newState: RTCPeerConnectionState
  ) {
    Task { @MainActor [weak self] in
      guard let self, self.peerConnection === peerConnection else {
        return
      }
      switch newState {
      case .connected:
        self.peerRecoveryTask?.cancel()
        self.peerRecoveryTask = nil
        self.timeoutTask?.cancel()
        self.timeoutTask = nil
        self.phase = .connected
        if !self.sessionCapabilities.received { self.requestSessionCapabilities() }
      case .disconnected:
        self.cancelTerminalLookup()
        self.terminalReader.invalidate("Remote Assist is reconnecting. Read the response again after reconnecting.")
        self.schedulePeerRecoveryTimeout(for: peerConnection)
      case .failed:
        self.failAndRelease("The Remote Assist connection failed.")
      case .closed:
        if self.phase != .idle {
          self.failAndRelease("Remote Assist ended.")
        }
      default:
        break
      }
    }
  }

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didAdd receiver: RTCRtpReceiver,
    streams: [RTCMediaStream]
  ) {
    guard let track = receiver.track as? RTCVideoTrack else {
      return
    }
    Task { @MainActor [weak self] in
      guard let self, self.peerConnection === peerConnection else {
        return
      }
      self.remoteVideoTrack = track
    }
  }
}

extension RemoteAssistController: RTCDataChannelDelegate {
  nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
    Task { @MainActor [weak self] in
      guard let self, self.controlChannel === dataChannel else { return }
      if dataChannel.readyState == .open { self.requestSessionCapabilities() }
    }
  }

  nonisolated func dataChannel(
    _ dataChannel: RTCDataChannel,
    didReceiveMessageWith buffer: RTCDataBuffer
  ) {
    guard !buffer.isBinary else {
      return
    }
    let data = buffer.data
    Task { @MainActor [weak self] in
      guard let self, self.controlChannel === dataChannel else {
        return
      }
      self.receiveControlData(data)
    }
  }
}

enum RemoteAssistError: LocalizedError {
  case authenticationUnavailable
  case cloudUnavailable
  case peerConnectionUnavailable
  case invalidSessionDescription

  var errorDescription: String? {
    switch self {
    case .authenticationUnavailable:
      return "Face ID or the iPhone passcode is required for Remote Assist."
    case .cloudUnavailable:
      return "ClawDad lost its connection while opening Remote Assist."
    case .peerConnectionUnavailable:
      return "The secure Remote Assist connection could not be created."
    case .invalidSessionDescription:
      return "The Remote Assist connection returned an invalid response."
    }
  }
}

private enum RemoteAssistControlPage: Equatable {
  case primary
  case quickChat
  case shortcuts
  case screens
  case terminalTabs
}

private enum RemoteAssistAccessibilityFocus: Hashable {
  case quickChat
  case dictation
  case terminalReader
  case screenChooser
  case screensHeading
  case terminalTabChooser
  case terminalTabsHeading
}

private extension RemoteShortcut {
  func keycap(isWindows: Bool) -> String {
    switch self {
    case .controlC: "⌃C"
    case .controlJ: "⌃J"
    case .escape: "esc"
    case .tab: "tab"
    case .arrowUp: "↑"
    case .arrowDown: "↓"
    case .arrowLeft: "←"
    case .arrowRight: "→"
    case .controlL: "⌃L"
    case .commandT: isWindows ? "⌃T" : "⌘T"
    case .commandTab: isWindows ? "alt⇥" : "⌘⇥"
    }
  }

  func accessibilityName(isWindows: Bool) -> String {
    switch self {
    case .controlC: "Control C"
    case .controlJ: "Control J"
    case .escape: "Escape"
    case .tab: "Tab"
    case .arrowUp: "Up Arrow"
    case .arrowDown: "Down Arrow"
    case .arrowLeft: "Left Arrow"
    case .arrowRight: "Right Arrow"
    case .controlL: "Control L"
    case .commandT:
      isWindows
        ? "Control T, open a new tab in the active Windows app"
        : "Command T, open a new tab in the active Mac app"
    case .commandTab:
      isWindows
        ? "Alt Tab, switch Windows app"
        : "Command Tab, switch Mac app"
    }
  }
}

private struct RemoteTerminalTabRow: View {
  let tab: RemoteTerminalTabDescriptor
  let isSelected: Bool
  let isPending: Bool

  private var detailText: String {
    tab.detail +
      (tab.isBusy ? " • Busy" : "") +
      (tab.hasUnreadActivity ? " • Response ready" : "")
  }

  var body: some View {
    HStack(spacing: 8) {
      ZStack(alignment: .topTrailing) {
        Image(systemName: "terminal")
          .font(.system(size: 15, weight: .bold))
          .foregroundStyle(
            tab.isBusy
              ? ClawDadTheme.gold
              : ClawDadTheme.cream.opacity(0.72)
          )
        if tab.hasUnreadActivity {
          Circle()
            .fill(ClawDadTheme.gold)
            .frame(width: 8, height: 8)
            .offset(x: 5, y: -4)
            .accessibilityHidden(true)
        }
      }
      .frame(width: 22, height: 22)

      VStack(alignment: .leading, spacing: 2) {
        Text(tab.title)
          .font(.footnote.weight(.bold))
          .lineLimit(1)
        Text(detailText)
          .font(.caption2.monospacedDigit())
          .foregroundStyle(ClawDadTheme.cream.opacity(0.68))
          .lineLimit(1)
      }

      Spacer(minLength: 4)

      if isPending {
        ProgressView()
          .controlSize(.small)
          .tint(ClawDadTheme.gold)
      } else if isSelected {
        Image(systemName: "checkmark.circle.fill")
          .font(.system(size: 17, weight: .bold))
          .foregroundStyle(ClawDadTheme.good)
      }
    }
    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    .padding(.horizontal, 10)
  }
}

struct RemoteTerminalTabButton: View {
  let tab: RemoteTerminalTabDescriptor
  let isSelected: Bool
  let isPending: Bool
  let isEnabled: Bool
  let terminalName: String
  let computerName: String
  let onSelect: () -> Void

  private var accessibilityName: String {
    var parts = [tab.title, tab.detail]
    if tab.isBusy {
      parts.append("busy")
    }
    if tab.hasUnreadActivity {
      parts.append("response ready and unread")
    }
    if isSelected {
      parts.append("selected")
    }
    return parts.joined(separator: ", ")
  }

  private var accessibilityHint: String {
    isSelected
      ? "Currently focused \(terminalName) tab"
      : "Focuses this \(terminalName) tab on \(computerName)"
  }

  var body: some View {
    Button(action: onSelect) {
      RemoteTerminalTabRow(
        tab: tab,
        isSelected: isSelected,
        isPending: isPending
      )
    }
    .buttonStyle(
      RemoteAssistDisplayButtonStyle(isSelected: isSelected)
    )
    .disabled(!isEnabled)
    .accessibilityLabel(accessibilityName)
    .accessibilityIdentifier("clawdad.remote.tab.\(tab.id)")
    .accessibilityValue(isPending ? "Focusing" : "")
    .accessibilityHint(accessibilityHint)
  }
}

struct RemoteAssistView: View {
  @ObservedObject var controller: RemoteAssistController
  var assistant: MobileAssistantController? = nil
  @EnvironmentObject private var session: CloudSession
  @Environment(\.scenePhase) private var scenePhase
  @StateObject private var files = MobileFilesController()
  @StateObject private var quickChat = RemoteQuickChatStore()
  var onClose: () -> Void
  @State private var viewportZoomed = false
  @State private var viewportResetToken = 0
  @State private var controlsExpanded = false
  @State private var showingFiles = false
  @State private var showingAssistant = false
  @State private var controlPage: RemoteAssistControlPage = .primary
  @State private var terminalWindowExpansion = RemoteTerminalWindowExpansion()
  @AccessibilityFocusState private var accessibilityFocus:
    RemoteAssistAccessibilityFocus?

  private static let mainControlColumns = Array(
    repeating: GridItem(.fixed(44), spacing: 8),
    count: 3
  )
  private static let mainControlPanelWidth: CGFloat = 148
  private static let shortcutColumns = Array(
    repeating: GridItem(.fixed(60), spacing: 8),
    count: 3
  )
  private static let shortcutControlPanelWidth: CGFloat = 196
  private static let screenControlPanelWidth: CGFloat = 228
  private static let terminalTabControlPanelWidth: CGFloat = 260

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()

      if let track = controller.remoteVideoTrack {
        RemoteVideoViewport(
          track: track,
          controller: controller,
          aspectRatio: controller.remoteAspectRatio,
          resetToken: viewportResetToken,
          onZoomChanged: { viewportZoomed = $0 }
        )
        .ignoresSafeArea()
        .allowsHitTesting(!controller.remoteInputSuppressed)
      } else {
        VStack(spacing: 18) {
          if case .failed = controller.phase {
            Image(systemName: "display.trianglebadge.exclamationmark")
              .font(.system(size: 42, weight: .semibold))
              .foregroundStyle(ClawDadTheme.gold)
          } else {
            ProgressView()
              .controlSize(.large)
              .tint(ClawDadTheme.gold)
          }

          Text(controller.phase.statusText)
            .font(.headline.weight(.bold))
            .foregroundStyle(ClawDadTheme.cream)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 34)

          if case .failed = controller.phase {
            Button("Try Again") {
              controller.retry()
            }
            .buttonStyle(ClawDadCompactButtonStyle())
          }
        }
      }

      if controller.displaySelectionPending,
         controller.remoteVideoTrack != nil {
        Color.black.opacity(0.001)
          .ignoresSafeArea()
          .contentShape(Rectangle())
          .accessibilityHidden(true)

        HStack(spacing: 9) {
          ProgressView()
            .controlSize(.small)
            .tint(ClawDadTheme.gold)
          Text("Switching displays...")
            .font(.footnote.weight(.bold))
            .foregroundStyle(ClawDadTheme.cream)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 40)
        .background(Color.black.opacity(0.76), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Switching displays. Remote input is paused.")
      }

      if controlsExpanded {
        Color.black.opacity(0.001)
          .ignoresSafeArea()
          .contentShape(Rectangle())
          .onTapGesture {
            collapseControls()
          }
          .accessibilityHidden(true)
      }

      VStack {
        Spacer()

        VStack(alignment: .trailing, spacing: 6) {
          if let notice = controller.clipboardNotice {
            Label(
              notice.text,
              systemImage: notice.isError
                ? "exclamationmark.triangle.fill"
                : "checkmark.circle.fill"
            )
            .font(.footnote.weight(.bold))
            .foregroundStyle(
              notice.isError ? ClawDadTheme.gold : ClawDadTheme.cream
            )
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            .background(Color.black.opacity(0.72), in: Capsule())
            .transition(.move(edge: .bottom).combined(with: .opacity))
          }

          if controlsExpanded {
            controlPanel
          }

          RemoteSpeechStatus(controller: controller, draft: controller.dictation,
                             recorder: controller.remoteRecorder, reader: controller.terminalReader,
                             controlsExpanded: controlsExpanded)
          if controller.quickChatSending {
            HStack(spacing: 6) {
              ProgressView().tint(ClawDadTheme.gold)
              Text("Sending preset…").font(.caption)
            }
            .foregroundStyle(ClawDadTheme.cream)
            .accessibilityIdentifier("clawdad.quickChat.sending")
          }
          RemoteImageStatus(transfer: controller.imageTransfer)

          Button {
            if controlsExpanded {
              collapseControls()
            } else {
              controller.rememberDictationTarget()
              controller.dismissKeyboard()
              controlPage = .primary
              controlsExpanded = true
            }
          } label: {
            Image(systemName: controlsExpanded ? "chevron.down" : "ellipsis")
              .font(.system(size: 16, weight: .black))
              .frame(width: 44, height: 44)
          }
          .buttonStyle(RemoteAssistLauncherButtonStyle())
          .accessibilityLabel(
            controlsExpanded
              ? "Close Remote Assist controls"
              : "Open Remote Assist controls"
          )
          .accessibilityHint(
            controller.hasMultipleRemoteDisplays
              ? "Shows Exit, Enter, clipboard, keyboard, dictation, Read Aloud, shortcuts, Terminal tabs, display, and zoom controls"
              : "Shows Exit, Enter, clipboard, keyboard, dictation, Read Aloud, shortcuts, Terminal tabs, and zoom controls"
          )
        }
        .animation(
          .easeOut(duration: 0.18),
          value: controller.clipboardNotice?.id
        )
        .animation(.easeOut(duration: 0.18), value: controlsExpanded)
        .animation(.easeOut(duration: 0.18), value: controlPage)
      }
      .frame(
        maxWidth: .infinity,
        maxHeight: .infinity,
        alignment: .bottomTrailing
      )
      .padding(.trailing, 4)
      .padding(.bottom, 4)
      .ignoresSafeArea(.container, edges: .all)

      RemoteKeyboardCapture(
        active: controller.keyboardVisible && !controller.remoteInputSuppressed,
        focusRequest: controller.keyboardFocusRequest,
        onText: controller.sendText,
        onDelete: { controller.sendKey("delete") }
      )
      .frame(width: 1, height: 1)
      .opacity(0.01)
    }
    .statusBarHidden(true)
    .persistentSystemOverlays(.hidden)
    .safeAreaInset(edge: .top, spacing: 0) {
      if let assistant, !showingAssistant { AssistantCallBar(controller: assistant) { showingAssistant = true } }
    }
    .sheet(isPresented: $showingAssistant) {
      if let assistant {
        AssistantView(controller: assistant, onClose: { showingAssistant = false }, onWatch: { showingAssistant = false })
      }
    }
    .alert(item: $controller.terminalCloseConfirmation) { intent in
      Alert(title: Text(intent.title), message: Text(intent.message),
        primaryButton: .destructive(Text(intent.button)) { controller.confirmTerminalClose(intent) },
        secondaryButton: .cancel { controller.cancelTerminalClose() })
    }
    .onAppear {
      #if DEBUG
      if [.dictation, .terminalReader].contains(ClawDadAppStorePreviewScenario.current) {
        controlsExpanded = true
      }
      #endif
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .background {
        controller.pauseInlineDictation()
        controller.cancelTerminalClose()
      }
    }
    .sheet(isPresented: $showingFiles, onDismiss: {
      controlsExpanded = true
      controlPage = .primary
    }) {
      FilesLibraryView(controller: files) { showingFiles = false }
        .environmentObject(session)
    }
    .onChange(of: controller.phase) { _, phase in
      guard phase != .connected else {
        return
      }
      collapseControls()
      viewportZoomed = false
      viewportResetToken += 1
    }
    .onChange(of: controller.remoteDisplayChangeToken) { _, _ in
      viewportZoomed = false
      viewportResetToken += 1
      if controlsExpanded, controlPage == .screens {
        DispatchQueue.main.async {
          accessibilityFocus = .screensHeading
        }
      }
    }
    .onChange(of: controller.remoteDisplays.count) { _, count in
      guard count < 2, controlPage == .screens else {
        return
      }
      controlPage = .primary
      accessibilityFocus = nil
    }
    .task(id: terminalTabPollingActive) {
      guard terminalTabPollingActive else {
        return
      }
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        guard !Task.isCancelled else {
          return
        }
        controller.pollRemoteTerminalTabs()
      }
    }
    .onDisappear {
      collapseControls()
      viewportZoomed = false
      viewportResetToken += 1
      controller.stop()
    }
  }

  private var controlPanel: some View {
    Group {
      switch controlPage {
      case .primary:
        primaryControlPanel
      case .quickChat:
        RemoteQuickChatPanel(store: quickChat, sending: controller.quickChatSending,
          unavailableReason: controller.quickChatUnavailableReason,
          onSend: { preset in controller.sendQuickChat(preset); collapseControls() },
          onBack: {
            controlPage = .primary
            accessibilityFocus = .quickChat
          })
      case .shortcuts:
        shortcutControlPanel
      case .screens:
        screenControlPanel
      case .terminalTabs:
        terminalTabControlPanel
      }
    }
    .frame(width: controlPanelWidth, alignment: .trailing)
    .padding(10)
    .background(
      Color.black.opacity(0.78),
      in: RoundedRectangle(cornerRadius: 16, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(ClawDadTheme.cream.opacity(0.2), lineWidth: 1)
    }
    .transition(.move(edge: .trailing).combined(with: .opacity))
    .accessibilityElement(children: .contain)
  }

  private var controlPanelWidth: CGFloat {
    switch controlPage {
    case .primary:
      Self.mainControlPanelWidth
    case .quickChat:
      Self.terminalTabControlPanelWidth
    case .shortcuts:
      Self.shortcutControlPanelWidth
    case .screens:
      Self.screenControlPanelWidth
    case .terminalTabs:
      Self.terminalTabControlPanelWidth
    }
  }

  private var terminalTabPollingActive: Bool {
    controlsExpanded &&
      controlPage == .terminalTabs &&
      controller.phase == .connected
  }

  private var unreadRemoteTerminalTabCount: Int {
    controller.remoteTerminalTabs.filter(\.hasUnreadActivity).count
  }

  private var primaryControlPanel: some View {
    VStack(alignment: .trailing, spacing: 8) {
      if controller.remoteScreenLocked {
        Label("\(controller.remoteComputerKind) Locked", systemImage: "lock.fill")
          .font(.caption.weight(.bold))
          .foregroundStyle(ClawDadTheme.gold)
          .padding(.horizontal, 4)
      }

      LazyVGrid(
        columns: Self.mainControlColumns,
        alignment: .trailing,
        spacing: 8
      ) {
        Button {
          collapseControls()
          controller.stop()
          onClose()
        } label: {
          Image(systemName: "xmark")
            .font(.system(size: 17, weight: .black))
            .frame(width: 44, height: 44)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .accessibilityLabel("Close Remote Assist")

        Button {
          collapseControls()
          controller.pressEnter()
        } label: {
          Image(systemName: "arrow.turn.down.left")
            .font(.system(size: 18, weight: .bold))
            .frame(width: 44, height: 44)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .disabled(
          controller.phase != .connected || controller.remoteInputSuppressed
        )
        .accessibilityLabel("Press Enter on \(controller.remoteComputerName)")

        Button {
          collapseControls()
          controller.pastePhoneClipboardToMac()
        } label: {
          Image(systemName: "doc.on.clipboard")
            .font(.system(size: 18, weight: .bold))
            .frame(width: 44, height: 44)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .accessibilityIdentifier("clawdad.remote.paste")
        .disabled(
          controller.phase != .connected ||
            controller.clipboardBusy ||
            controller.imageTransfer.busy || controller.imageTransfer.attaching ||
            controller.remoteInputSuppressed
        )
        .accessibilityLabel(
          controller.remoteScreenLocked
            ? "Type iPhone clipboard securely on \(controller.remoteComputerName)"
            : "Paste iPhone clipboard to \(controller.remoteComputerName)"
        )

        Button {
          collapseControls()
          controller.copyMacSelectionToPhone()
        } label: {
          Image(systemName: "doc.on.doc")
            .font(.system(size: 18, weight: .bold))
            .frame(width: 44, height: 44)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .disabled(
          controller.phase != .connected ||
            controller.clipboardBusy ||
            controller.remoteScreenLocked ||
            controller.remoteInputSuppressed
        )
        .accessibilityLabel(
          controller.remoteScreenLocked
            ? "Copy unavailable while \(controller.remoteComputerName) is locked"
            : "Copy selection from \(controller.remoteComputerName) to iPhone"
        )

        Button {
          collapseControls()
          controller.toggleKeyboard()
        } label: {
          Image(
            systemName: controller.keyboardVisible
              ? "keyboard.chevron.compact.down"
              : "keyboard"
          )
          .font(.system(size: 19, weight: .bold))
          .frame(width: 44, height: 44)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .disabled(
          controller.phase != .connected || controller.remoteInputSuppressed
        )
        .accessibilityLabel(
          controller.keyboardVisible ? "Hide keyboard" : "Show keyboard"
        )

        RemoteDictationButton(controller: controller, draft: controller.dictation, recorder: controller.remoteRecorder)
        .accessibilityFocused($accessibilityFocus, equals: .dictation)

        RemoteSpeakerButton(controller: controller, reader: controller.terminalReader)
        .accessibilityFocused($accessibilityFocus, equals: .terminalReader)

        RemoteImageButton(controller: controller, transfer: controller.imageTransfer)

        if let assistant {
          Button {
            if assistant.callVisible { showingAssistant = true }
            else { assistant.startCall(session) }
          } label: {
            Image(systemName: "headphones").font(.system(size: 18, weight: .bold)).frame(width: 44, height: 44)
          }
          .buttonStyle(RemoteAssistOverlayButtonStyle())
          .accessibilityLabel("Open Assistant")
          .accessibilityIdentifier("clawdad.remote.assistant")
        }

        Button { controlPage = .quickChat } label: {
          Image(systemName: "text.bubble.fill")
            .font(.system(size: 18, weight: .bold)).frame(width: 44, height: 44)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .accessibilityLabel("Quick Chat")
        .accessibilityIdentifier("clawdad.remote.quickChat")
        .accessibilityHint("Shows presets you can send immediately or edit")
        .accessibilityFocused($accessibilityFocus, equals: .quickChat)

        Button {
          controller.dismissKeyboard()
          collapseControls()
          showingFiles = true
        } label: {
          Image(systemName: "folder.fill")
            .font(.system(size: 18, weight: .bold))
            .frame(width: 44, height: 44)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .accessibilityLabel("Open Files")
        .accessibilityIdentifier("clawdad.remote.files")
        .disabled(controller.imageTransfer.busy || controller.imageTransfer.attaching)

        Button {
          controlPage = .shortcuts
        } label: {
          Image(systemName: "keyboard.badge.ellipsis")
            .font(.system(size: 18, weight: .bold))
            .frame(width: 44, height: 44)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .disabled(
          controller.phase != .connected ||
            controller.remoteScreenLocked ||
            controller.remoteInputSuppressed
        )
        .accessibilityLabel("Special commands")
        .accessibilityHint("Shows Control, navigation, and app shortcuts")

        Button {
          controlPage = .terminalTabs
          controller.requestRemoteTerminalTabs()
          DispatchQueue.main.async {
            accessibilityFocus = .terminalTabsHeading
          }
        } label: {
          ZStack(alignment: .topTrailing) {
            Image(systemName: "terminal")
              .font(.system(size: 18, weight: .bold))
            if unreadRemoteTerminalTabCount > 0 {
              Circle()
                .fill(ClawDadTheme.gold)
                .frame(width: 8, height: 8)
                .offset(x: 5, y: -4)
                .accessibilityHidden(true)
            }
          }
          .frame(width: 44, height: 44)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .disabled(
          controller.phase != .connected ||
            controller.remoteScreenLocked ||
            controller.remoteInputSuppressed
        )
        .accessibilityLabel("Choose Terminal tab")
        .accessibilityHint("Shows the \(controller.remoteTerminalName) tabs open on \(controller.remoteComputerName)")
        .accessibilityFocused(
          $accessibilityFocus,
          equals: .terminalTabChooser
        )

        if controller.hasMultipleRemoteDisplays {
          Button {
            controlPage = .screens
            DispatchQueue.main.async {
              accessibilityFocus = .screensHeading
            }
          } label: {
            Image(systemName: "display.2")
              .font(.system(size: 18, weight: .bold))
              .frame(width: 44, height: 44)
          }
          .buttonStyle(RemoteAssistOverlayButtonStyle())
          .disabled(
            controller.phase != .connected ||
              controller.remoteInputSuppressed
          )
          .accessibilityLabel("Choose display on \(controller.remoteComputerName)")
          .accessibilityHint("Shows the available displays")
          .accessibilityFocused(
            $accessibilityFocus,
            equals: .screenChooser
          )
        }

        if viewportZoomed {
          Button {
            collapseControls()
            viewportResetToken += 1
          } label: {
            Text("1x")
              .font(.system(size: 13, weight: .black, design: .rounded))
              .frame(width: 44, height: 44)
          }
          .buttonStyle(RemoteAssistOverlayButtonStyle())
          .disabled(controller.remoteInputSuppressed)
          .accessibilityLabel("Reset Remote Assist zoom")
        }
      }
    }
  }

  private var shortcutControlPanel: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Button {
          controlPage = .primary
        } label: {
          Image(systemName: "chevron.left")
            .font(.system(size: 14, weight: .black))
            .frame(width: 32, height: 32)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .accessibilityLabel("Back to Remote Assist controls")

        Text("Special Commands")
          .font(.caption.weight(.heavy))
          .foregroundStyle(ClawDadTheme.cream)
      }

      LazyVGrid(
        columns: Self.shortcutColumns,
        alignment: .trailing,
        spacing: 8
      ) {
        ForEach(RemoteShortcut.allCases, id: \.self) { shortcut in
          Button {
            collapseControls()
            controller.sendShortcut(shortcut)
          } label: {
            Text(shortcut.keycap(isWindows: controller.isWindowsComputer))
              .font(.system(size: 15, weight: .black, design: .rounded))
              .frame(width: 60, height: 46)
          }
          .buttonStyle(RemoteAssistShortcutButtonStyle())
          .disabled(
            controller.phase != .connected ||
              controller.remoteScreenLocked ||
              controller.remoteInputSuppressed
          )
          .accessibilityLabel(
            shortcut.accessibilityName(
              isWindows: controller.isWindowsComputer
            )
          )
          .accessibilityHint(
            "Sends this command to \(controller.remoteComputerName)"
          )
        }
      }
    }
  }

  private var screenControlPanel: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Button {
          controlPage = .primary
          DispatchQueue.main.async {
            accessibilityFocus = .screenChooser
          }
        } label: {
          Image(systemName: "chevron.left")
            .font(.system(size: 14, weight: .black))
            .frame(width: 32, height: 32)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .accessibilityLabel("Back to Remote Assist controls")

        Text("Screens")
          .font(.caption.weight(.heavy))
          .foregroundStyle(ClawDadTheme.cream)
          .accessibilityAddTraits(.isHeader)
          .accessibilityFocused(
            $accessibilityFocus,
            equals: .screensHeading
          )

        Spacer(minLength: 4)

        if controller.displaySelectionPending {
          ProgressView()
            .controlSize(.small)
            .tint(ClawDadTheme.gold)
            .accessibilityHidden(true)
        }
      }

      ScrollView {
        LazyVStack(spacing: 6) {
          ForEach(controller.remoteDisplays, id: \.id) { display in
            let isSelected = display.id == controller.selectedRemoteDisplayId
            let isPending = display.id == controller.pendingRemoteDisplayId
            Button {
              controller.selectRemoteDisplay(display.id)
            } label: {
              HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(display.name)
                    .font(.footnote.weight(.bold))
                    .lineLimit(1)
                  Text(
                    "\(display.width) × \(display.height)" +
                      (display.isPrimary ? " • Main" : "")
                  )
                  .font(.caption2.monospacedDigit())
                  .foregroundStyle(ClawDadTheme.cream.opacity(0.68))
                  .lineLimit(1)
                }

                Spacer(minLength: 4)

                if isPending {
                  ProgressView()
                    .controlSize(.small)
                    .tint(ClawDadTheme.gold)
                } else if isSelected {
                  Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(ClawDadTheme.good)
                }
              }
              .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
              .padding(.horizontal, 10)
            }
            .buttonStyle(RemoteAssistDisplayButtonStyle(isSelected: isSelected))
            .disabled(
              controller.phase != .connected ||
                controller.displaySelectionPending ||
                isSelected
            )
            .accessibilityLabel(
              "\(display.name), \(display.width) by \(display.height)" +
                (display.isPrimary ? ", main display" : "") +
                (isSelected ? ", selected" : "")
            )
            .accessibilityValue(isPending ? "Switching" : "")
            .accessibilityHint(
              isSelected
                ? "Currently shown in Remote Assist"
                : "Shows this display in Remote Assist"
            )
          }
        }
      }
      .frame(maxHeight: 238)
    }
  }

  private var terminalTabControlPanel: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Button {
          controlPage = .primary
          DispatchQueue.main.async {
            accessibilityFocus = .terminalTabChooser
          }
        } label: {
          Image(systemName: "chevron.left")
            .font(.system(size: 14, weight: .black))
            .frame(width: 32, height: 32)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .accessibilityLabel("Back to Remote Assist controls")
        .keyboardShortcut(.escape, modifiers: [])

        Text("\(controller.remoteTerminalName) Tabs")
          .font(.caption.weight(.heavy))
          .foregroundStyle(ClawDadTheme.cream)
          .accessibilityAddTraits(.isHeader)
          .accessibilityFocused(
            $accessibilityFocus,
            equals: .terminalTabsHeading
          )

        if unreadRemoteTerminalTabCount > 0 {
          Label(
            "\(unreadRemoteTerminalTabCount)",
            systemImage: "bell.fill"
          )
          .font(.caption2.weight(.heavy))
          .foregroundStyle(ClawDadTheme.gold)
          .accessibilityLabel(
            "\(unreadRemoteTerminalTabCount) unread terminal " +
              (unreadRemoteTerminalTabCount == 1 ? "response" : "responses")
          )
        }

        Spacer(minLength: 4)

        if controller.terminalTabRequestPending &&
            controller.remoteTerminalTabs.isEmpty {
          ProgressView()
            .controlSize(.small)
            .tint(ClawDadTheme.gold)
            .accessibilityHidden(true)
        }

        Button {
          controller.requestRemoteTerminalTabs()
        } label: {
          Image(systemName: "arrow.clockwise")
            .font(.system(size: 14, weight: .bold))
            .frame(width: 32, height: 32)
        }
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .disabled(
          controller.phase != .connected ||
            controller.remoteScreenLocked ||
            controller.terminalTabRequestPending
        )
        .accessibilityLabel("Refresh \(controller.remoteTerminalName) tabs")
      }

      if controller.terminalTabCatalogLoading &&
          controller.remoteTerminalTabs.isEmpty {
        HStack(spacing: 8) {
          ProgressView()
            .controlSize(.small)
            .tint(ClawDadTheme.gold)
          Text("Loading \(controller.remoteTerminalName) tabs...")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(ClawDadTheme.cream.opacity(0.78))
        }
        .frame(maxWidth: .infinity, minHeight: 54, alignment: .center)
      } else if controller.remoteTerminalTabs.isEmpty {
        Text(
          controller.terminalTabError ??
            "No \(controller.remoteTerminalName) tabs are open on \(controller.remoteComputerName)."
        )
        .font(.footnote.weight(.semibold))
        .foregroundStyle(
          controller.terminalTabError == nil
            ? ClawDadTheme.cream.opacity(0.78)
            : ClawDadTheme.gold
        )
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
        .padding(.horizontal, 4)
      } else {
        RemoteTerminalWindowPicker(controller: controller, expansion: $terminalWindowExpansion)

        if let error = controller.terminalTabError {
          Text(error)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(ClawDadTheme.gold)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 4)
        }
      }
    }
  }

  private func collapseControls() {
    controlsExpanded = false
    controlPage = .primary
    accessibilityFocus = nil
  }


}

struct RemoteAssistOverlayButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(ClawDadTheme.cream)
      .background(Color.black.opacity(configuration.isPressed ? 0.78 : 0.58), in: Circle())
      .scaleEffect(configuration.isPressed ? 0.9 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

private struct RemoteAssistLauncherButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(ClawDadTheme.cream)
      .background {
        Circle()
          .fill(Color.black.opacity(configuration.isPressed ? 0.78 : 0.58))
          .frame(width: 36, height: 36)
      }
      .contentShape(Rectangle())
      .scaleEffect(configuration.isPressed ? 0.92 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

private struct RemoteAssistShortcutButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(ClawDadTheme.cream)
      .background(
        Color.black.opacity(configuration.isPressed ? 0.86 : 0.58),
        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .stroke(ClawDadTheme.cream.opacity(0.18), lineWidth: 1)
      }
      .scaleEffect(configuration.isPressed ? 0.95 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

private struct RemoteAssistDisplayButtonStyle: ButtonStyle {
  let isSelected: Bool

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(ClawDadTheme.cream)
      .background(
        isSelected
          ? ClawDadTheme.gold.opacity(0.18)
          : Color.black.opacity(configuration.isPressed ? 0.86 : 0.58),
        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .stroke(
            isSelected
              ? ClawDadTheme.gold.opacity(0.62)
              : ClawDadTheme.cream.opacity(0.18),
            lineWidth: 1
          )
      }
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

private final class RemoteViewportContainerView: UIView {
  var onLayout: ((CGRect) -> Void)?

  override func layoutSubviews() {
    super.layoutSubviews()
    onLayout?(bounds)
  }
}

private struct RemoteVideoViewport: UIViewRepresentable {
  let track: RTCVideoTrack
  @ObservedObject var controller: RemoteAssistController
  var aspectRatio: CGFloat
  var resetToken: Int
  var onZoomChanged: (Bool) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(
      controller: controller,
      aspectRatio: aspectRatio,
      resetToken: resetToken,
      onZoomChanged: onZoomChanged
    )
  }

  func makeUIView(context: Context) -> RemoteViewportContainerView {
    let view = RemoteViewportContainerView()
    view.backgroundColor = .clear
    view.clipsToBounds = true
    view.isMultipleTouchEnabled = true

    let videoView = RTCMTLVideoView(frame: view.bounds)
    videoView.videoContentMode = .scaleAspectFit
    videoView.backgroundColor = .black
    videoView.isUserInteractionEnabled = false
    view.addSubview(videoView)

    context.coordinator.install(
      in: view,
      videoView: videoView,
      track: track
    )

    let doubleTap = UITapGestureRecognizer(
      target: context.coordinator,
      action: #selector(Coordinator.handleDoubleTap(_:))
    )
    doubleTap.numberOfTapsRequired = 2
    doubleTap.numberOfTouchesRequired = 1
    view.addGestureRecognizer(doubleTap)

    let tap = UITapGestureRecognizer(
      target: context.coordinator,
      action: #selector(Coordinator.handleTap(_:))
    )
    tap.numberOfTouchesRequired = 1
    tap.require(toFail: doubleTap)
    view.addGestureRecognizer(tap)

    let rightTap = UITapGestureRecognizer(
      target: context.coordinator,
      action: #selector(Coordinator.handleRightTap(_:))
    )
    rightTap.numberOfTouchesRequired = 2
    view.addGestureRecognizer(rightTap)

    let pointer = UIPanGestureRecognizer(
      target: context.coordinator,
      action: #selector(Coordinator.handlePointer(_:))
    )
    pointer.minimumNumberOfTouches = 1
    pointer.maximumNumberOfTouches = 1
    view.addGestureRecognizer(pointer)

    let selection = UILongPressGestureRecognizer(
      target: context.coordinator,
      action: #selector(Coordinator.handleSelection(_:))
    )
    selection.minimumPressDuration = 0.35
    selection.allowableMovement = 20
    selection.numberOfTouchesRequired = 1
    view.addGestureRecognizer(selection)

    let scroll = UIPanGestureRecognizer(
      target: context.coordinator,
      action: #selector(Coordinator.handleScroll(_:))
    )
    scroll.minimumNumberOfTouches = 2
    scroll.maximumNumberOfTouches = 2
    view.addGestureRecognizer(scroll)

    let pinch = UIPinchGestureRecognizer(
      target: context.coordinator,
      action: #selector(Coordinator.handlePinch(_:))
    )
    pinch.delegate = context.coordinator
    scroll.delegate = context.coordinator
    view.addGestureRecognizer(pinch)

    return view
  }

  func updateUIView(
    _ view: RemoteViewportContainerView,
    context: Context
  ) {
    context.coordinator.update(
      controller: controller,
      aspectRatio: aspectRatio,
      resetToken: resetToken,
      onZoomChanged: onZoomChanged,
      track: track
    )
    view.setNeedsLayout()
  }

  static func dismantleUIView(
    _ view: RemoteViewportContainerView,
    coordinator: Coordinator
  ) {
    coordinator.tearDown()
    view.onLayout = nil
  }

  @MainActor
  final class Coordinator: NSObject, UIGestureRecognizerDelegate {
    var controller: RemoteAssistController
    var aspectRatio: CGFloat
    var onZoomChanged: (Bool) -> Void
    private weak var containerView: RemoteViewportContainerView?
    private weak var videoView: RTCMTLVideoView?
    private weak var track: RTCVideoTrack?
    private var viewport = RemoteViewportTransform()
    private var resetToken: Int
    private var lastViewportSize: CGSize = .zero
    private var lastReportedZoomed = false
    private var pinchStartScale: CGFloat = 1
    private var pinchContentVector: CGPoint = .zero
    private var pinchActive = false
    private var selectionActive = false

    init(
      controller: RemoteAssistController,
      aspectRatio: CGFloat,
      resetToken: Int,
      onZoomChanged: @escaping (Bool) -> Void
    ) {
      self.controller = controller
      self.aspectRatio = aspectRatio
      self.resetToken = resetToken
      self.onZoomChanged = onZoomChanged
    }

    func install(
      in containerView: RemoteViewportContainerView,
      videoView: RTCMTLVideoView,
      track: RTCVideoTrack
    ) {
      self.containerView = containerView
      self.videoView = videoView
      containerView.onLayout = { [weak self] bounds in
        self?.viewportDidLayout(bounds)
      }
      setTrack(track)
    }

    func update(
      controller: RemoteAssistController,
      aspectRatio: CGFloat,
      resetToken: Int,
      onZoomChanged: @escaping (Bool) -> Void,
      track: RTCVideoTrack
    ) {
      self.controller = controller
      self.onZoomChanged = onZoomChanged
      if abs(self.aspectRatio - aspectRatio) > 0.001 {
        self.aspectRatio = aspectRatio
        resetViewport(animated: false)
      }
      setTrack(track)
      if self.resetToken != resetToken {
        self.resetToken = resetToken
        resetViewport(animated: true)
      }
    }

    func tearDown() {
      if let videoView {
        track?.remove(videoView)
      }
      track = nil
      videoView = nil
      containerView = nil
    }

    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer,
      shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
      gestureRecognizer is UIPinchGestureRecognizer ||
        otherGestureRecognizer is UIPinchGestureRecognizer
    }

    @objc func handleDoubleTap(_ recognizer: UITapGestureRecognizer) {
      guard let view = recognizer.view else {
        return
      }
      if viewport.isZoomed {
        resetViewport(animated: true)
      } else {
        let location = recognizer.location(in: view)
        let contentVector = viewport.contentVector(
          at: location,
          in: view.bounds
        )
        viewport.zoom(
          to: 2,
          keeping: contentVector,
          at: location,
          in: view.bounds,
          aspectRatio: aspectRatio
        )
        applyViewport(animated: true)
        reportZoomState()
      }
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
      guard let view = recognizer.view else {
        return
      }
      let point = normalizedPoint(recognizer.location(in: view), in: view.bounds)
      Task { @MainActor in
        controller.dismissKeyboard()
        controller.sendClick(x: point.x, y: point.y)
      }
    }

    @objc func handleRightTap(_ recognizer: UITapGestureRecognizer) {
      guard let view = recognizer.view else {
        return
      }
      let point = normalizedPoint(recognizer.location(in: view), in: view.bounds)
      Task { @MainActor in
        controller.sendClick(x: point.x, y: point.y, button: "right")
      }
    }

    @objc func handlePointer(_ recognizer: UIPanGestureRecognizer) {
      guard let view = recognizer.view else {
        return
      }
      if viewport.isZoomed {
        let translation = recognizer.translation(in: view)
        recognizer.setTranslation(.zero, in: view)
        viewport.pan(
          by: CGSize(width: translation.x, height: translation.y),
          in: view.bounds,
          aspectRatio: aspectRatio
        )
        applyViewport(animated: false)
        return
      }
      let point = normalizedPoint(recognizer.location(in: view), in: view.bounds)
      Task { @MainActor in
        controller.sendPointerMove(x: point.x, y: point.y)
      }
    }

    @objc func handleSelection(_ recognizer: UILongPressGestureRecognizer) {
      guard let view = recognizer.view else {
        return
      }
      let point = normalizedPoint(recognizer.location(in: view), in: view.bounds)
      switch recognizer.state {
      case .began:
        selectionActive = true
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        controller.sendPointerDown(x: point.x, y: point.y)
      case .changed:
        guard selectionActive else {
          return
        }
        controller.sendPointerDrag(x: point.x, y: point.y)
      case .ended:
        guard selectionActive else {
          return
        }
        selectionActive = false
        controller.sendPointerUp(x: point.x, y: point.y)
      case .cancelled, .failed:
        guard selectionActive else {
          return
        }
        selectionActive = false
        controller.sendPointerUp(x: point.x, y: point.y)
      default:
        break
      }
    }

    @objc func handleScroll(_ recognizer: UIPanGestureRecognizer) {
      guard let view = recognizer.view else {
        return
      }
      let translation = recognizer.translation(in: view)
      recognizer.setTranslation(.zero, in: view)
      guard !pinchActive else {
        return
      }
      Task { @MainActor in
        controller.sendScroll(
          deltaX: Double(translation.x),
          deltaY: Double(translation.y)
        )
      }
    }

    @objc func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
      guard let view = recognizer.view else {
        return
      }
      let location = recognizer.location(in: view)
      switch recognizer.state {
      case .began:
        pinchActive = true
        pinchStartScale = viewport.scale
        pinchContentVector = viewport.contentVector(
          at: location,
          in: view.bounds
        )
      case .changed:
        viewport.zoom(
          to: pinchStartScale * recognizer.scale,
          keeping: pinchContentVector,
          at: location,
          in: view.bounds,
          aspectRatio: aspectRatio
        )
        applyViewport(animated: false)
        reportZoomState()
      case .ended:
        pinchActive = false
        if !viewport.isZoomed {
          resetViewport(animated: true)
        } else {
          applyViewport(animated: false)
          reportZoomState()
        }
      case .cancelled, .failed:
        pinchActive = false
        applyViewport(animated: false)
        reportZoomState()
      default:
        break
      }
    }

    private func normalizedPoint(_ point: CGPoint, in bounds: CGRect) -> (x: Double, y: Double) {
      viewport.normalizedPoint(
        point,
        in: bounds,
        aspectRatio: aspectRatio
      )
    }

    private func setTrack(_ track: RTCVideoTrack) {
      guard self.track !== track, let videoView else {
        return
      }
      self.track?.remove(videoView)
      self.track = track
      track.add(videoView)
      resetViewport(animated: false)
    }

    private func viewportDidLayout(_ bounds: CGRect) {
      guard bounds.width > 0, bounds.height > 0 else {
        return
      }
      let sizeChanged = lastViewportSize != .zero && (
        abs(lastViewportSize.width - bounds.width) > 1 ||
          abs(lastViewportSize.height - bounds.height) > 1
      )
      lastViewportSize = bounds.size
      if sizeChanged {
        resetViewport(animated: false)
        return
      }
      viewport.clamp(in: bounds, aspectRatio: aspectRatio)
      applyViewport(animated: false)
    }

    private func resetViewport(animated: Bool) {
      viewport.reset()
      applyViewport(animated: animated)
      reportZoomState()
    }

    private func applyViewport(animated: Bool) {
      guard let containerView, let videoView else {
        return
      }
      let updates = {
        videoView.bounds = CGRect(origin: .zero, size: containerView.bounds.size)
        videoView.center = CGPoint(
          x: containerView.bounds.midX + self.viewport.offset.width,
          y: containerView.bounds.midY + self.viewport.offset.height
        )
        videoView.transform = CGAffineTransform(
          scaleX: self.viewport.scale,
          y: self.viewport.scale
        )
      }
      if animated {
        UIView.animate(
          withDuration: 0.2,
          delay: 0,
          options: [.beginFromCurrentState, .curveEaseOut],
          animations: updates
        )
      } else {
        updates()
      }
    }

    private func reportZoomState() {
      let isZoomed = viewport.isZoomed
      guard lastReportedZoomed != isZoomed else {
        return
      }
      lastReportedZoomed = isZoomed
      let handler = onZoomChanged
      Task { @MainActor in
        handler(isZoomed)
      }
    }
  }
}

private struct RemoteKeyboardCapture: UIViewRepresentable {
  var active: Bool
  var focusRequest: Int
  var onText: (String) -> Void
  var onDelete: () -> Void

  func makeUIView(context: Context) -> RemoteKeyboardInputView {
    let view = RemoteKeyboardInputView()
    view.onText = onText
    view.onDelete = onDelete
    return view
  }

  func updateUIView(_ view: RemoteKeyboardInputView, context: Context) {
    view.onText = onText
    view.onDelete = onDelete
    view.setKeyboardActive(active, focusRequest: focusRequest)
  }
}

private final class RemoteKeyboardInputView: UIView, UIKeyInput {
  var onText: ((String) -> Void)?
  var onDelete: (() -> Void)?
  private var wantsKeyboard = false
  private var focusRequest = 0

  override var canBecomeFirstResponder: Bool {
    true
  }

  var hasText: Bool {
    true
  }

  func setKeyboardActive(_ active: Bool, focusRequest: Int) {
    wantsKeyboard = active
    self.focusRequest = focusRequest
    applyKeyboardState()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    applyKeyboardState()
  }

  func insertText(_ text: String) {
    onText?(text)
  }

  func deleteBackward() {
    onDelete?()
  }

  private func applyKeyboardState() {
    let expectedFocusRequest = focusRequest
    DispatchQueue.main.async { [weak self] in
      guard let self,
            self.focusRequest == expectedFocusRequest else {
        return
      }
      if self.wantsKeyboard, self.window != nil {
        self.becomeFirstResponder()
      } else if self.isFirstResponder {
        self.resignFirstResponder()
      }
    }
  }
}

#else

@MainActor
final class RemoteAssistController: ObservableObject {
  func bind(to session: CloudSession) {}
  func start() {}
  func stop() {}
}

struct RemoteAssistView: View {
  @ObservedObject var controller: RemoteAssistController
  var assistant: MobileAssistantController? = nil
  var onClose: () -> Void

  var body: some View {
    Color.black
      .ignoresSafeArea()
  }
}

#endif
