import ClawDadRemoteAssistProtocol
import Foundation
import LocalAuthentication
@preconcurrency import WebRTC

enum MacRemoteAssistPhase: Equatable {
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
      return "Opening the remote Mac..."
    case .negotiating:
      return "Connecting securely..."
    case .connected:
      return "Secure session"
    case .failed(let message):
      return message
    }
  }
}

enum MacRemoteAssistClientError: LocalizedError {
  case authenticationUnavailable
  case peerConnectionUnavailable
  case invalidSessionDescription
  case connectionUnavailable

  var errorDescription: String? {
    switch self {
    case .authenticationUnavailable:
      return "Touch ID or the Mac login password is required for Remote Assist."
    case .peerConnectionUnavailable:
      return "ClawDad could not create the secure Remote Assist connection."
    case .invalidSessionDescription:
      return "The remote Mac returned an invalid connection response."
    case .connectionUnavailable:
      return "ClawDad is reconnecting to the remote Mac."
    }
  }
}

@MainActor
final class MacRemoteAssistClient: NSObject {
  var onChange: (() -> Void)?

  private(set) var phase: MacRemoteAssistPhase = .idle
  private(set) var remoteVideoTrack: RTCVideoTrack?
  private(set) var remoteAspectRatio: CGFloat = 16.0 / 9.0
  private(set) var remoteDisplays: [RemoteDisplayDescriptor] = []
  private(set) var selectedRemoteDisplayId = ""
  private(set) var remoteScreenLocked = false

  private let manager: MacRemoteComputerManager
  private let factory: RTCPeerConnectionFactory
  private var peerConnection: RTCPeerConnection?
  private var controlChannel: RTCDataChannel?
  private var sessionId = ""
  private var pendingCandidates: [RTCIceCandidate] = []
  private var timeoutTask: Task<Void, Never>?
  private var disconnectTask: Task<Void, Never>?
  private var remoteIceServers = [
    RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])
  ]
  private var displayState: RemoteDisplayState?

  init(manager: MacRemoteComputerManager) {
    self.manager = manager
    RTCInitializeSSL()
    factory = RTCPeerConnectionFactory()
    super.init()
    manager.onRemoteAssistEnvelope = { [weak self] envelope in
      self?.handle(envelope)
    }
  }

  func start(computerId: String) {
    guard phase == .idle || isFailed else {
      return
    }
    tearDownPeer()
    phase = .authenticating
    publishChange()
    Task { @MainActor [weak self] in
      guard let self else {
        return
      }
      do {
        try await self.authenticate()
        try await self.manager.connect(computerId: computerId)
        let sessionId = UUID().uuidString.lowercased()
        self.sessionId = sessionId
        self.phase = .requesting
        self.publishChange()
        try await self.manager.sendRemoteAssistEnvelope(
          type: "remote.assist.request",
          body: [
            "sessionId": .string(sessionId),
            "requestedAt": .string(RemoteCloudCodec.dateString(Date())),
            "transport": .string("webrtc"),
            "control": .bool(true),
            "controllerPlatform": .string("macos")
          ]
        )
        self.startTimeout()
      } catch is CancellationError {
        self.phase = .idle
        self.publishChange()
      } catch {
        self.failAndRelease(error.localizedDescription)
      }
    }
  }

  func stop(notifyRemote: Bool = true) {
    let closingSessionId = sessionId
    if notifyRemote, !closingSessionId.isEmpty {
      Task { [weak manager] in
        try? await manager?.sendRemoteAssistEnvelope(
          type: "remote.assist.stop",
          body: [
            "sessionId": .string(closingSessionId),
            "reason": .string("mac_controller_closed")
          ]
        )
      }
    }
    sessionId = ""
    tearDownPeer()
    phase = .idle
    publishChange()
  }

  func sendPointer(action: String, x: Double, y: Double, button: String = "left") {
    _ = sendControl([
      "type": "pointer",
      "action": action,
      "button": button,
      "x": min(1, max(0, x)),
      "y": min(1, max(0, y))
    ])
  }

  func sendScroll(deltaX: Double, deltaY: Double) {
    _ = sendControl([
      "type": "scroll",
      "deltaX": deltaX,
      "deltaY": deltaY
    ])
  }

  @discardableResult
  func sendText(_ text: String) -> Bool {
    guard !text.isEmpty else {
      return false
    }
    return sendProtocolMessage(
      try? RemoteInputCodec.encode(
        .textRequest(text: text, requestId: UUID().uuidString.lowercased())
      )
    )
  }

  @discardableResult
  func sendKey(_ key: String) -> Bool {
    sendProtocolMessage(
      try? RemoteInputCodec.encode(
        .keyRequest(key: key, requestId: UUID().uuidString.lowercased())
      )
    )
  }

  @discardableResult
  func sendShortcut(_ shortcut: RemoteShortcut) -> Bool {
    sendProtocolMessage(
      try? RemoteInputCodec.encode(
        .shortcutRequest(
          shortcut: shortcut,
          requestId: UUID().uuidString.lowercased()
        )
      )
    )
  }

  @discardableResult
  func pasteLocalClipboardToRemote() -> Bool {
    guard let text = NSPasteboard.general.string(forType: .string), !text.isEmpty else {
      return false
    }
    return sendProtocolMessage(
      try? RemoteClipboardCodec.encode(
        .pasteRequest(text: text, requestId: UUID().uuidString.lowercased())
      )
    )
  }

  @discardableResult
  func copyRemoteSelectionToLocal() -> Bool {
    sendProtocolMessage(
      try? RemoteClipboardCodec.encode(
        .copyRequest(requestId: UUID().uuidString.lowercased())
      )
    )
  }

  @discardableResult
  func selectDisplay(_ displayId: String) -> Bool {
    guard let displayState,
          displayState.displays.contains(where: { $0.id == displayId }),
          displayState.selectedDisplayId != displayId else {
      return false
    }
    return sendProtocolMessage(
      try? RemoteDisplayCodec.encode(
        .selectRequest(
          displayId: displayId,
          expectedTopologyRevision: displayState.topologyRevision,
          requestId: UUID().uuidString.lowercased()
        )
      )
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
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
      throw error ?? MacRemoteAssistClientError.authenticationUnavailable
    }
    try await context.evaluatePolicy(
      .deviceOwnerAuthentication,
      localizedReason: "Open a paired computer with ClawDad Remote Assist"
    )
  }

  private func handle(_ envelope: RemoteCloudEnvelope) {
    let envelopeSessionId = envelope.body["sessionId"]?.stringValue ?? ""
    guard !sessionId.isEmpty, envelopeSessionId == sessionId else {
      return
    }

    switch envelope.type {
    case "remote.assist.available":
      phase = .negotiating
      publishChange()
    case "remote.assist.offer":
      guard let sdp = envelope.body["sdp"]?.stringValue, !sdp.isEmpty else {
        failAndRelease("The remote Mac returned an invalid Remote Assist offer.")
        return
      }
      if let width = envelope.body["width"]?.numberValue,
         let height = envelope.body["height"]?.numberValue,
         width > 0, height > 0 {
        remoteAspectRatio = CGFloat(width / height)
      }
      let servers = parseIceServers(envelope.body["iceServers"])
      if !servers.isEmpty {
        remoteIceServers = servers
      }
      phase = .negotiating
      publishChange()
      Task { @MainActor [weak self] in
        do {
          try await self?.acceptOffer(sdp)
        } catch {
          self?.failAndRelease(error.localizedDescription)
        }
      }
    case "remote.assist.ice":
      let candidate = envelope.body["candidate"]?.stringValue ?? ""
      guard !candidate.isEmpty else {
        return
      }
      addRemoteCandidate(
        RTCIceCandidate(
          sdp: candidate,
          sdpMLineIndex: Int32(envelope.body["sdpMLineIndex"]?.numberValue ?? 0),
          sdpMid: envelope.body["sdpMid"]?.stringValue
        )
      )
    case "remote.assist.ice-servers":
      let servers = parseIceServers(envelope.body["iceServers"])
      guard !servers.isEmpty else {
        return
      }
      remoteIceServers = servers
      if let peerConnection {
        let configuration = peerConnection.configuration
        configuration.iceServers = servers
        _ = peerConnection.setConfiguration(configuration)
      }
    case "remote.assist.stop":
      failAndRelease(
        envelope.body["reason"]?.stringValue ?? "The remote Mac ended Remote Assist.",
        notifyRemote: false
      )
    case "remote.assist.error":
      failAndRelease(
        envelope.body["error"]?.stringValue ?? "Remote Assist could not start.",
        notifyRemote: false
      )
    default:
      break
    }
  }

  private func acceptOffer(_ sdp: String) async throws {
    let peer = try makePeerConnection()
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
    try await manager.sendRemoteAssistEnvelope(
      type: "remote.assist.answer",
      body: [
        "sessionId": .string(sessionId),
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
      throw MacRemoteAssistClientError.peerConnectionUnavailable
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
      peer.answer(
        for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
      ) { answer, error in
        if let error {
          continuation.resume(throwing: error)
        } else if let answer {
          continuation.resume(returning: answer)
        } else {
          continuation.resume(throwing: MacRemoteAssistClientError.invalidSessionDescription)
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
    return sendProtocolMessage(data)
  }

  @discardableResult
  private func sendProtocolMessage(_ data: Data?) -> Bool {
    guard let data,
          let controlChannel,
          controlChannel.readyState == .open else {
      return false
    }
    return controlChannel.sendData(RTCDataBuffer(data: data, isBinary: false))
  }

  private func handleControlMessage(_ data: Data) {
    if let state = try? RemoteSessionStateCodec.decode(data) {
      remoteScreenLocked = state.screenLocked
      publishChange()
      return
    }
    if let message = try? RemoteDisplayCodec.decode(data),
       let state = message.state {
      displayState = state
      remoteDisplays = state.displays
      selectedRemoteDisplayId = state.selectedDisplayId
      if let selected = state.displays.first(where: { $0.id == state.selectedDisplayId }),
         selected.width > 0, selected.height > 0 {
        remoteAspectRatio = CGFloat(selected.width) / CGFloat(selected.height)
      }
      publishChange()
      return
    }
    if let message = try? RemoteClipboardCodec.decode(data),
       message.type == RemoteClipboardMessage.resultType,
       message.action == .copy,
       message.ok == true,
       let text = message.text {
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
      publishChange()
    }
  }

  private func parseIceServers(_ value: RemoteJSONValue?) -> [RTCIceServer] {
    guard case .array(let values) = value else {
      return []
    }
    return values.compactMap { entry in
      guard case .object(let object) = entry,
            case .array(let urlValues) = object["urls"] else {
        return nil
      }
      let urls = urlValues.map(\.stringValue).filter { !$0.isEmpty }
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

  private func startTimeout() {
    timeoutTask?.cancel()
    timeoutTask = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 25_000_000_000)
      guard !Task.isCancelled, let self, self.phase != .connected else {
        return
      }
      self.failAndRelease(
        "The remote Mac did not answer within 25 seconds. Confirm it is awake and Remote Assist is enabled."
      )
    }
  }

  private func failAndRelease(_ message: String, notifyRemote: Bool = true) {
    let failedSessionId = sessionId
    tearDownPeer()
    sessionId = ""
    phase = .failed(message)
    publishChange()
    guard notifyRemote, !failedSessionId.isEmpty else {
      return
    }
    Task { [weak manager] in
      try? await manager?.sendRemoteAssistEnvelope(
        type: "remote.assist.stop",
        body: [
          "sessionId": .string(failedSessionId),
          "reason": .string("mac_controller_connection_ended")
        ]
      )
    }
  }

  private func scheduleDisconnectTimeout(for peer: RTCPeerConnection) {
    disconnectTask?.cancel()
    disconnectTask = Task { @MainActor [weak self, weak peer] in
      try? await Task.sleep(nanoseconds: 15_000_000_000)
      guard !Task.isCancelled, let self, let peer,
            self.peerConnection === peer else {
        return
      }
      self.failAndRelease("Remote Assist disconnected during a network change.")
    }
  }

  private func tearDownPeer() {
    timeoutTask?.cancel()
    timeoutTask = nil
    disconnectTask?.cancel()
    disconnectTask = nil
    controlChannel?.delegate = nil
    controlChannel?.close()
    controlChannel = nil
    peerConnection?.delegate = nil
    peerConnection?.close()
    peerConnection = nil
    pendingCandidates.removeAll()
    remoteVideoTrack = nil
    remoteAspectRatio = 16.0 / 9.0
    remoteDisplays = []
    selectedRemoteDisplayId = ""
    remoteScreenLocked = false
    displayState = nil
    remoteIceServers = [
      RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])
    ]
  }

  private func publishChange() {
    onChange?()
  }
}

extension MacRemoteAssistClient: RTCPeerConnectionDelegate {
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
      self.publishChange()
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
      guard let self, self.peerConnection === peerConnection,
            !self.sessionId.isEmpty else {
        return
      }
      try? await self.manager.sendRemoteAssistEnvelope(
        type: "remote.assist.ice",
        body: [
          "sessionId": .string(self.sessionId),
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
        self.timeoutTask?.cancel()
        self.timeoutTask = nil
        self.disconnectTask?.cancel()
        self.disconnectTask = nil
        self.phase = .connected
        self.publishChange()
      case .disconnected:
        self.scheduleDisconnectTimeout(for: peerConnection)
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
      self.publishChange()
    }
  }
}

extension MacRemoteAssistClient: RTCDataChannelDelegate {
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
      self.handleControlMessage(data)
    }
  }
}
