import ClawDadRemoteAssistProtocol
import Foundation
import SwiftUI

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

  private weak var cloudSession: CloudSession?
  private let factory = RTCPeerConnectionFactory()
  private var peerConnection: RTCPeerConnection?
  private var controlChannel: RTCDataChannel?
  private var remoteSessionId = ""
  private var pendingCandidates: [RTCIceCandidate] = []
  private var timeoutTask: Task<Void, Never>?
  private var clipboardTimeoutTask: Task<Void, Never>?
  private var clipboardNoticeTask: Task<Void, Never>?
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
  private var lastPointerSentAt = Date.distantPast
  private var remoteIceServers = [
    RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])
  ]

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
    guard cloudSession.remoteAssistAuthenticated else {
      fail("Re-pair this iPhone from ClawDad Settings on your Mac to enable Remote Assist.")
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
        remoteSessionId = UUID().uuidString.lowercased()
        phase = .requesting
        _ = try await cloudSession.sendRemoteAssistEnvelope(
          type: "remote.assist.request",
          body: [
            "sessionId": .string(remoteSessionId),
            "requestedAt": .string(ISO8601DateFormatter().string(from: Date())),
            "transport": .string("webrtc"),
            "control": .bool(true)
          ]
        )
        startTimeout()
      } catch {
        fail(error.localizedDescription)
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
    phase = .idle
    start()
  }

  func toggleKeyboard() {
    if keyboardVisible {
      keyboardVisible = false
      return
    }
    keyboardVisible = true
    requestKeyboardFocus()
  }

  func requestKeyboardFocus() {
    guard keyboardVisible else {
      return
    }
    keyboardFocusRequest &+= 1
  }

  func sendPointerMove(x: Double, y: Double) {
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
    sendControl([
      "type": "pointer",
      "action": "up",
      "button": "left",
      "x": clampUnit(x),
      "y": clampUnit(y)
    ])
  }

  func sendClick(x: Double, y: Double, button: String = "left") {
    sendControl([
      "type": "pointer",
      "action": "click",
      "button": button,
      "x": clampUnit(x),
      "y": clampUnit(y)
    ])
  }

  func sendScroll(deltaX: Double, deltaY: Double) {
    sendControl([
      "type": "scroll",
      "deltaX": deltaX,
      "deltaY": deltaY
    ])
  }

  func sendText(_ text: String) {
    guard !text.isEmpty else {
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
        "Remote Assist is reconnecting.",
        isError: true
      )
      return
    }
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    restoreKeyboardFocusAfterControl()
  }

  func pastePhoneClipboardToMac(_ values: [String]) {
    guard !clipboardBusy else {
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
    guard !clipboardBusy else {
      return
    }
    let requestId = UUID().uuidString.lowercased()
    sendClipboardRequest(
      .copyRequest(requestId: requestId),
      pendingText: "Copying from Mac..."
    )
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
    guard envelope.body["sessionId"]?.stringValue == remoteSessionId else {
      return
    }

    switch envelope.type {
    case "remote.assist.available":
      phase = .negotiating
    case "remote.assist.offer":
      guard let sdp = envelope.body["sdp"]?.stringValue, !sdp.isEmpty else {
        fail("Your Mac returned an invalid Remote Assist offer.")
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
      Task {
        do {
          try await acceptOffer(sdp)
        } catch {
          fail(error.localizedDescription)
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
    case "remote.assist.stop":
      fail(envelope.body["reason"]?.stringValue ?? "Your Mac ended Remote Assist.")
      tearDownPeer()
    case "remote.assist.error":
      fail(envelope.body["error"]?.stringValue ?? "Remote Assist could not start.")
      tearDownPeer()
    default:
      break
    }
  }

  private func acceptOffer(_ sdp: String) async throws {
    let peer = try makePeerConnection()
    phase = .negotiating
    try await setRemoteDescription(
      RTCSessionDescription(type: .offer, sdp: sdp),
      on: peer
    )
    for candidate in pendingCandidates {
      try? await peer.add(candidate)
    }
    pendingCandidates.removeAll()

    let answer = try await createAnswer(on: peer)
    try await setLocalDescription(answer, on: peer)
    guard let cloudSession else {
      throw RemoteAssistError.cloudUnavailable
    }
    _ = try await cloudSession.sendRemoteAssistEnvelope(
      type: "remote.assist.answer",
      body: [
        "sessionId": .string(remoteSessionId),
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
        self.fail("Your Mac did not open Remote Assist. Confirm it is awake and Remote Assist is enabled.")
        self.tearDownPeer()
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

  private func tearDownPeer() {
    timeoutTask?.cancel()
    timeoutTask = nil
    clipboardTimeoutTask?.cancel()
    clipboardTimeoutTask = nil
    clipboardNoticeTask?.cancel()
    clipboardNoticeTask = nil
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
    controlChannel?.delegate = nil
    controlChannel?.close()
    controlChannel = nil
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
      self?.remoteVideoTrack = track
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
      guard let self, let cloudSession = self.cloudSession else {
        return
      }
      _ = try? await cloudSession.sendRemoteAssistEnvelope(
        type: "remote.assist.ice",
        body: [
          "sessionId": .string(self.remoteSessionId),
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
      self?.controlChannel = dataChannel
      dataChannel.delegate = self
    }
  }

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didChange newState: RTCPeerConnectionState
  ) {
    Task { @MainActor [weak self] in
      guard let self else {
        return
      }
      switch newState {
      case .connected:
        self.timeoutTask?.cancel()
        self.timeoutTask = nil
        self.phase = .connected
      case .failed:
        self.fail("The Remote Assist connection failed.")
      case .closed:
        if self.phase != .idle {
          self.fail("Remote Assist ended.")
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
      self?.remoteVideoTrack = track
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
      guard let self else {
        return
      }
      if self.handleInputResponse(data) {
        return
      }
      if self.handleSessionState(data) {
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

struct RemoteAssistView: View {
  @ObservedObject var controller: RemoteAssistController
  var onClose: () -> Void

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()

      if let track = controller.remoteVideoTrack {
        RemoteVideoRenderer(track: track)
          .ignoresSafeArea()
        RemoteGestureSurface(
          controller: controller,
          aspectRatio: controller.remoteAspectRatio
        )
          .ignoresSafeArea()
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

      VStack {
        HStack(spacing: 12) {
          Button {
            controller.stop()
            onClose()
          } label: {
            Image(systemName: "xmark")
              .font(.system(size: 17, weight: .black))
              .frame(width: 44, height: 44)
          }
          .buttonStyle(RemoteAssistOverlayButtonStyle())
          .accessibilityLabel("Close Remote Assist")

          Text(controller.remoteScreenLocked ? "Mac Locked" : "Remote Assist")
            .font(.subheadline.weight(.heavy))
            .foregroundStyle(ClawDadTheme.cream)
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(Color.black.opacity(0.58), in: Capsule())

          Spacer()

          Image(systemName: "lock.fill")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(ClawDadTheme.good)
            .frame(width: 44, height: 44)
            .background(Color.black.opacity(0.58), in: Circle())
            .accessibilityLabel("Encrypted connection")
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)

        Spacer()

        VStack(alignment: .trailing, spacing: 10) {
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

          HStack(spacing: 12) {
            Spacer()

            Button {
              controller.pressEnter()
            } label: {
              Image(systemName: "arrow.turn.down.left")
                .font(.system(size: 19, weight: .bold))
                .frame(width: 48, height: 48)
            }
            .buttonStyle(RemoteAssistOverlayButtonStyle())
            .disabled(controller.phase != .connected)
            .accessibilityLabel("Press Enter on Mac")

            PasteButton(payloadType: String.self) { values in
              controller.pastePhoneClipboardToMac(values)
            }
            .labelStyle(.iconOnly)
            .font(.system(size: 19, weight: .bold))
            .frame(width: 48, height: 48)
            .buttonStyle(RemoteAssistOverlayButtonStyle())
            .disabled(
              controller.phase != .connected || controller.clipboardBusy
            )
            .accessibilityLabel(
              controller.remoteScreenLocked
                ? "Type iPhone clipboard securely on Mac"
                : "Paste iPhone clipboard to Mac"
            )

            Button {
              controller.copyMacSelectionToPhone()
            } label: {
              Image(systemName: "doc.on.doc")
                .font(.system(size: 19, weight: .bold))
                .frame(width: 48, height: 48)
            }
            .buttonStyle(RemoteAssistOverlayButtonStyle())
            .disabled(
              controller.phase != .connected ||
                controller.clipboardBusy ||
                controller.remoteScreenLocked
            )
            .accessibilityLabel(
              controller.remoteScreenLocked
                ? "Copy unavailable while Mac is locked"
                : "Copy Mac selection to iPhone"
            )

            Button {
              controller.toggleKeyboard()
            } label: {
              Image(systemName: controller.keyboardVisible ? "keyboard.chevron.compact.down" : "keyboard")
                .font(.system(size: 20, weight: .bold))
                .frame(width: 48, height: 48)
            }
            .buttonStyle(RemoteAssistOverlayButtonStyle())
            .accessibilityLabel(controller.keyboardVisible ? "Hide keyboard" : "Show keyboard")
          }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .animation(
          .easeOut(duration: 0.18),
          value: controller.clipboardNotice?.id
        )
      }

      RemoteKeyboardCapture(
        active: controller.keyboardVisible,
        focusRequest: controller.keyboardFocusRequest,
        onText: controller.sendText,
        onDelete: { controller.sendKey("delete") }
      )
      .frame(width: 1, height: 1)
      .opacity(0.01)
    }
    .statusBarHidden(true)
    .persistentSystemOverlays(.hidden)
    .onDisappear {
      controller.stop()
    }
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

private struct RemoteVideoRenderer: UIViewRepresentable {
  let track: RTCVideoTrack

  final class Coordinator {
    weak var track: RTCVideoTrack?
  }

  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  func makeUIView(context: Context) -> RTCMTLVideoView {
    let view = RTCMTLVideoView(frame: .zero)
    view.videoContentMode = .scaleAspectFit
    view.backgroundColor = .black
    context.coordinator.track = track
    track.add(view)
    return view
  }

  func updateUIView(_ view: RTCMTLVideoView, context: Context) {
    guard context.coordinator.track !== track else {
      return
    }
    context.coordinator.track?.remove(view)
    context.coordinator.track = track
    track.add(view)
  }

  static func dismantleUIView(_ view: RTCMTLVideoView, coordinator: Coordinator) {
    coordinator.track?.remove(view)
    coordinator.track = nil
  }
}

private struct RemoteGestureSurface: UIViewRepresentable {
  @ObservedObject var controller: RemoteAssistController
  var aspectRatio: CGFloat

  func makeCoordinator() -> Coordinator {
    Coordinator(controller: controller, aspectRatio: aspectRatio)
  }

  func makeUIView(context: Context) -> UIView {
    let view = UIView()
    view.backgroundColor = .clear
    view.isMultipleTouchEnabled = true

    let tap = UITapGestureRecognizer(
      target: context.coordinator,
      action: #selector(Coordinator.handleTap(_:))
    )
    tap.numberOfTouchesRequired = 1
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

    return view
  }

  func updateUIView(_ view: UIView, context: Context) {
    context.coordinator.controller = controller
    context.coordinator.aspectRatio = aspectRatio
  }

  @MainActor
  final class Coordinator: NSObject {
    var controller: RemoteAssistController
    var aspectRatio: CGFloat
    private var selectionActive = false

    init(controller: RemoteAssistController, aspectRatio: CGFloat) {
      self.controller = controller
      self.aspectRatio = aspectRatio
    }

    @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
      guard let view = recognizer.view else {
        return
      }
      let point = normalizedPoint(recognizer.location(in: view), in: view.bounds)
      Task { @MainActor in
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
      Task { @MainActor in
        controller.sendScroll(
          deltaX: Double(translation.x),
          deltaY: Double(translation.y)
        )
      }
    }

    private func normalizedPoint(_ point: CGPoint, in bounds: CGRect) -> (x: Double, y: Double) {
      guard bounds.width > 0, bounds.height > 0, aspectRatio > 0 else {
        return (0.5, 0.5)
      }
      let viewAspectRatio = bounds.width / bounds.height
      let fitted: CGRect
      if viewAspectRatio > aspectRatio {
        let width = bounds.height * aspectRatio
        fitted = CGRect(
          x: bounds.midX - width / 2,
          y: bounds.minY,
          width: width,
          height: bounds.height
        )
      } else {
        let height = bounds.width / aspectRatio
        fitted = CGRect(
          x: bounds.minX,
          y: bounds.midY - height / 2,
          width: bounds.width,
          height: height
        )
      }
      return (
        Double(min(1, max(0, (point.x - fitted.minX) / fitted.width))),
        Double(min(1, max(0, (point.y - fitted.minY) / fitted.height)))
      )
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
