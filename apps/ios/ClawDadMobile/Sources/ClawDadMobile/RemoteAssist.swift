import ClawDadRemoteAssistProtocol
import Foundation
import SwiftUI

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
      return "Opening your Mac..."
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
  @Published private(set) var phase: RemoteAssistPhase = .idle
  @Published private(set) var remoteVideoTrack: RTCVideoTrack?
  @Published private(set) var keyboardVisible = false
  @Published private(set) var keyboardFocusRequest = 0
  @Published private(set) var remoteAspectRatio: CGFloat = 16.0 / 9.0
  @Published private(set) var clipboardBusy = false
  @Published private(set) var clipboardNotice: RemoteAssistNotice?
  @Published private(set) var remoteScreenLocked = false
  @Published private(set) var remoteDisplays: [RemoteDisplayDescriptor] = []
  @Published private(set) var selectedRemoteDisplayId = ""
  @Published private(set) var pendingRemoteDisplayId: String?
  @Published private(set) var displaySelectionPending = false
  @Published private(set) var remoteDisplayChangeToken = 0

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
  private var lastPointerSentAt = Date.distantPast
  private var remoteIceServers = [
    RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])
  ]

  var hasMultipleRemoteDisplays: Bool {
    remoteDisplays.count > 1
  }

  var remoteInputSuppressed: Bool {
    displaySelectionPending
  }

  override init() {
    RTCInitializeSSL()
    super.init()
  }

  func bind(to session: CloudSession) {
    cloudSession = session
    session.setRemoteAssistEnvelopeHandler { [weak self] envelope in
      self?.handle(envelope)
    }
  }

  func start() {
    guard let cloudSession else {
      fail("ClawDad is not ready.")
      return
    }
    guard cloudSession.remoteAssistIdentityReady else {
      fail("Re-pair this iPhone from ClawDad Settings on your Mac to enable Remote Assist.")
      return
    }
    guard cloudSession.connected else {
      cloudSession.connectIfPaired()
      fail("The secure connection was interrupted. ClawDad is reconnecting to your paired Mac automatically.")
      return
    }
    guard cloudSession.hostOnline else {
      fail("The secure relay is online and your paired Mac is reconnecting. Keep ClawDad open on the Mac, then tap Try Again.")
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
          ? "Wait for the Mac to finish switching displays."
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
          ? "Wait for the Mac to finish switching displays."
          : "Remote Assist is reconnecting.",
        isError: true
      )
      return
    }
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    restoreKeyboardFocusAfterControl()
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
        ? "Typing securely on Mac..."
        : "Pasting to Mac..."
    )
  }

  func copyMacSelectionToPhone() {
    guard !clipboardBusy, !displaySelection.inputSuppressed else {
      return
    }
    let requestId = UUID().uuidString.lowercased()
    sendClipboardRequest(
      .copyRequest(requestId: requestId),
      pendingText: "Copying from Mac..."
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
        "The Mac did not confirm the display change. The current display will stay active.",
        isError: true
      )
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
      localizedReason: "Open your paired Mac with Remote Assist"
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
        failAndRelease("Your Mac returned an invalid Remote Assist offer.")
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
        envelope.body["reason"]?.stringValue ?? "Your Mac ended Remote Assist.",
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
        "The Mac did not accept input. Tap a text field and try again."
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
        message.error ?? "The focused Mac app did not accept input."
      )
    }
    return true
  }

  private func handleSessionState(_ data: Data) -> Bool {
    guard let message = try? RemoteSessionStateCodec.decode(data) else {
      return false
    }
    let changed = remoteScreenLocked != message.screenLocked
    remoteScreenLocked = message.screenLocked
    if changed {
      showClipboardNotice(
        message.screenLocked
          ? "Mac locked: secure keyboard mode"
          : "Mac unlocked",
        isError: false
      )
    }
    return true
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
          "That display is no longer available. The Mac kept the current display active.",
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
            message.error ?? "The Mac could not switch displays.",
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
          "That display is no longer available. The Mac kept the current display active.",
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
      try? await Task.sleep(nanoseconds: 5_000_000_000)
      guard !Task.isCancelled,
            let self,
            self.pendingClipboardRequest?.requestId == message.requestId else {
        return
      }
      self.finishClipboardRequest(
        notice: "The Mac did not answer the clipboard request.",
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
    case .paste:
      finishClipboardRequest(
        notice: remoteScreenLocked
          ? "Keys sent securely"
          : "Pasted to Mac",
        isError: false
      )
    case .copy:
      guard let text = message.text, !text.isEmpty else {
        finishClipboardRequest(
          notice: "The Mac did not return any copied text.",
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
    isError: Bool
  ) {
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
          "Your paired Mac did not answer within 25 seconds. Confirm ClawDad is open and Remote Assist is enabled, then tap Try Again."
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
      case .disconnected:
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
  nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {}

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
      if self.handleInputResponse(data) {
        return
      }
      if self.handleSessionState(data) {
        return
      }
      if self.handleDisplayMessage(data) {
        return
      }
      self.handleClipboardResponse(data)
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
  case shortcuts
  case screens
}

private enum RemoteAssistAccessibilityFocus: Hashable {
  case screenChooser
  case screensHeading
}

private extension RemoteShortcut {
  var keycap: String {
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
    case .commandT: "⌘T"
    case .commandTab: "⌘⇥"
    }
  }

  var accessibilityName: String {
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
    case .commandT: "Command T, open a new tab in the active Mac app"
    case .commandTab: "Command Tab, switch Mac app"
    }
  }
}

struct RemoteAssistView: View {
  @ObservedObject var controller: RemoteAssistController
  var onClose: () -> Void
  @State private var viewportZoomed = false
  @State private var viewportResetToken = 0
  @State private var controlsExpanded = false
  @State private var controlPage: RemoteAssistControlPage = .primary
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

          Button {
            if controlsExpanded {
              collapseControls()
            } else {
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
              ? "Shows Exit, Enter, clipboard, keyboard, shortcuts, display, and zoom controls"
              : "Shows Exit, Enter, clipboard, keyboard, shortcuts, and zoom controls"
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
      case .shortcuts:
        shortcutControlPanel
      case .screens:
        screenControlPanel
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
    case .shortcuts:
      Self.shortcutControlPanelWidth
    case .screens:
      Self.screenControlPanelWidth
    }
  }

  private var primaryControlPanel: some View {
    VStack(alignment: .trailing, spacing: 8) {
      Label(
        controller.remoteScreenLocked ? "Mac Locked" : "Secure session",
        systemImage: "lock.fill"
      )
      .font(.caption.weight(.bold))
      .foregroundStyle(
        controller.remoteScreenLocked
          ? ClawDadTheme.gold
          : ClawDadTheme.good
      )
      .padding(.horizontal, 4)

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
        .accessibilityLabel("Press Enter on Mac")

        PasteButton(payloadType: String.self) { values in
          collapseControls()
          controller.pastePhoneClipboardToMac(values)
        }
        .labelStyle(.iconOnly)
        .font(.system(size: 18, weight: .bold))
        .frame(width: 44, height: 44)
        .buttonStyle(RemoteAssistOverlayButtonStyle())
        .disabled(
          controller.phase != .connected ||
            controller.clipboardBusy ||
            controller.remoteInputSuppressed
        )
        .accessibilityLabel(
          controller.remoteScreenLocked
            ? "Type iPhone clipboard securely on Mac"
            : "Paste iPhone clipboard to Mac"
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
            ? "Copy unavailable while Mac is locked"
            : "Copy Mac selection to iPhone"
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
        .accessibilityHint("Shows Control, navigation, and Mac app shortcuts")

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
          .accessibilityLabel("Choose Mac display")
          .accessibilityHint("Shows the available Mac displays")
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
            Text(shortcut.keycap)
              .font(.system(size: 15, weight: .black, design: .rounded))
              .frame(width: 60, height: 46)
          }
          .buttonStyle(RemoteAssistShortcutButtonStyle())
          .disabled(
            controller.phase != .connected ||
              controller.remoteScreenLocked ||
              controller.remoteInputSuppressed
          )
          .accessibilityLabel(shortcut.accessibilityName)
          .accessibilityHint("Sends this command to the Mac")
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

  private func collapseControls() {
    controlsExpanded = false
    controlPage = .primary
    accessibilityFocus = nil
  }
}

private struct RemoteAssistOverlayButtonStyle: ButtonStyle {
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
  var onClose: () -> Void

  var body: some View {
    Color.black
      .ignoresSafeArea()
  }
}

#endif
