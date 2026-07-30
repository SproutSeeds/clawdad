import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
@preconcurrency import WebRTC

struct RemoteAssistHostStatus: Equatable {
  var enabled: Bool
  var configured: Bool
  var pairedDeviceCount: Int
  var screenRecordingGranted: Bool
  var accessibilityGranted: Bool
  var relayConnected: Bool
  var active: Bool
  var message: String

  var dictionary: [String: Any] {
    [
      "enabled": enabled,
      "configured": configured,
      "pairedDeviceCount": pairedDeviceCount,
      "screenRecordingGranted": screenRecordingGranted,
      "accessibilityGranted": accessibilityGranted,
      "relayConnected": relayConnected,
      "active": active,
      "message": message
    ]
  }
}

enum RemoteAssistHostError: LocalizedError {
  case invalidCloudConfiguration
  case hostIdentityMissing
  case noDisplayAvailable
  case peerConnectionUnavailable
  case videoTrackUnavailable
  case controlChannelUnavailable
  case invalidSessionDescription
  case relayUnavailable

  var errorDescription: String? {
    switch self {
    case .invalidCloudConfiguration:
      return "ClawDad Cloud is not configured on this Mac."
    case .hostIdentityMissing:
      return "Generate a fresh Pair iPhone code, then scan it again to enable Remote Assist."
    case .noDisplayAvailable:
      return "ClawDad could not find a display to share."
    case .peerConnectionUnavailable:
      return "ClawDad could not create the Remote Assist connection."
    case .videoTrackUnavailable:
      return "ClawDad could not create the screen video stream."
    case .controlChannelUnavailable:
      return "ClawDad could not create the Remote Assist control channel."
    case .invalidSessionDescription:
      return "Remote Assist received an invalid connection response."
    case .relayUnavailable:
      return "ClawDad is reconnecting to its secure relay."
    }
  }
}

@MainActor
final class RemoteAssistHost: NSObject {
  static let enabledDefaultsKey = "clawdad.remoteAssist.enabled"

  var onStatusChange: ((RemoteAssistHostStatus) -> Void)?

  private let factory: RTCPeerConnectionFactory
  private var socket: URLSessionWebSocketTask?
  private var receiveTask: Task<Void, Never>?
  private var heartbeatTask: Task<Void, Never>?
  private var reconnectTask: Task<Void, Never>?
  private var currentPeer: MacRemotePeer?
  private var currentSessionId = ""
  private var currentDeviceId = ""
  private var relayConnected = false
  private var sequence = 0
  private var reconnectAttempt = 0
  private var seenEnvelopeIds: Set<String> = []
  private var seenEnvelopeOrder: [String] = []

  override init() {
    RTCInitializeSSL()
    factory = RTCPeerConnectionFactory()
    super.init()
  }

  var enabled: Bool {
    UserDefaults.standard.bool(forKey: Self.enabledDefaultsKey)
  }

  var status: RemoteAssistHostStatus {
    let configuration = try? RemoteCloudConfiguration.load()
    let configured = configuration?.ready == true
    let pairedDeviceCount = configuration?.trustedDevicePublicKeys.count ?? 0
    let screenGranted = CGPreflightScreenCaptureAccess()
    let controlGranted = AXIsProcessTrusted()
    let active = currentPeer != nil
    let message: String

    if !enabled {
      message = "Remote Assist is off."
    } else if !configured {
      message = "Create a fresh Pair iPhone code to finish Remote Assist setup."
    } else if pairedDeviceCount == 0 {
      message = "Pair an iPhone before using Remote Assist."
    } else if !screenGranted || !controlGranted {
      message = "Allow Screen Recording and Accessibility for ClawDad."
    } else if active {
      message = "Your paired iPhone is controlling this Mac."
    } else if relayConnected {
      message = "Remote Assist is ready."
    } else {
      message = "Remote Assist is reconnecting."
    }

    return RemoteAssistHostStatus(
      enabled: enabled,
      configured: configured,
      pairedDeviceCount: pairedDeviceCount,
      screenRecordingGranted: screenGranted,
      accessibilityGranted: controlGranted,
      relayConnected: relayConnected,
      active: active,
      message: message
    )
  }

  func startIfEnabled() {
    publishStatus()
    guard enabled else {
      return
    }
    connectIfNeeded()
  }

  func setEnabled(_ nextEnabled: Bool, requestPermissions: Bool) {
    UserDefaults.standard.set(nextEnabled, forKey: Self.enabledDefaultsKey)
    if nextEnabled {
      if requestPermissions {
        requestSystemPermissions()
      }
      connectIfNeeded()
    } else {
      stopActiveSession(reason: "Remote Assist was turned off on the Mac.")
      disconnectRelay()
    }
    publishStatus()
  }

  func requestSystemPermissions() {
    if !CGPreflightScreenCaptureAccess() {
      _ = CGRequestScreenCaptureAccess()
    }
    if !AXIsProcessTrusted() {
      let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
      _ = AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary)
    }
    publishStatus()
  }

  func openPrivacySettings(_ pane: String) {
    let anchor: String
    switch pane {
    case "accessibility":
      anchor = "Privacy_Accessibility"
    default:
      anchor = "Privacy_ScreenCapture"
    }
    guard let url = URL(
      string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)"
    ) else {
      return
    }
    NSWorkspace.shared.open(url)
  }

  func stopActiveSession(
    reason: String = "Remote Assist was stopped on the Mac.",
    notifyPhone: Bool = true
  ) {
    let sessionId = currentSessionId
    let deviceId = currentDeviceId
    let peer = currentPeer
    currentPeer = nil
    currentSessionId = ""
    currentDeviceId = ""
    peer?.stop()

    if notifyPhone, !sessionId.isEmpty, !deviceId.isEmpty {
      Task {
        try? await sendRemoteEnvelope(
          type: "remote.assist.stop",
          body: [
            "sessionId": .string(sessionId),
            "reason": .string(reason)
          ],
          targetDeviceId: deviceId
        )
      }
    }
    publishStatus()
  }

  func stop() {
    stopActiveSession(
      reason: "ClawDad closed on the Mac.",
      notifyPhone: true
    )
    disconnectRelay()
  }

  private func connectIfNeeded() {
    guard enabled, socket == nil, reconnectTask == nil else {
      return
    }

    Task {
      do {
        let configuration = try RemoteCloudConfiguration.load()
        guard configuration.ready else {
          throw RemoteAssistHostError.hostIdentityMissing
        }
        var request = URLRequest(url: try configuration.realtimeURL())
        if !configuration.devToken.isEmpty {
          request.setValue(
            "Bearer \(configuration.devToken)",
            forHTTPHeaderField: "Authorization"
          )
        }
        let socket = URLSession.shared.webSocketTask(with: request)
        socket.maximumMessageSize = 2 * 1024 * 1024
        self.socket = socket
        socket.resume()
        try await sendHostReady(configuration: configuration)
        startHeartbeat(for: socket, configuration: configuration)
        receiveTask = Task { [weak self, weak socket] in
          guard let self, let socket else {
            return
          }
          await self.receiveLoop(socket)
        }
      } catch {
        relayConnected = false
        disconnectRelay()
        scheduleReconnect()
        publishStatus()
      }
    }
  }

  private func receiveLoop(_ expectedSocket: URLSessionWebSocketTask) async {
    do {
      while socket === expectedSocket {
        let message = try await expectedSocket.receive()
        let text: String
        switch message {
        case .string(let value):
          text = value
        case .data(let data):
          text = String(data: data, encoding: .utf8) ?? ""
        @unknown default:
          text = ""
        }
        if !text.isEmpty {
          handleIncomingText(text)
        }
      }
    } catch {
      guard socket === expectedSocket else {
        return
      }
      relayConnected = false
      disconnectRelay()
      scheduleReconnect()
      publishStatus()
    }
  }

  private func handleIncomingText(_ text: String) {
    guard let data = text.data(using: .utf8),
          let envelope = try? RemoteCloudCodec.decoder.decode(
            RemoteCloudEnvelope.self,
            from: data
          ) else {
      return
    }

    if envelope.type == "pong", envelope.sourceDeviceId == "cloud-relay" {
      relayConnected = true
      reconnectAttempt = 0
      publishStatus()
      return
    }

    guard envelope.type.hasPrefix("remote.assist."),
          !seenEnvelopeIds.contains(envelope.id),
          let configuration = try? RemoteCloudConfiguration.load(),
          RemoteCloudCodec.verifies(envelope, configuration: configuration) else {
      return
    }
    rememberEnvelope(envelope.id)

    switch envelope.type {
    case "remote.assist.request":
      handleRequest(envelope, configuration: configuration)
    case "remote.assist.answer":
      handleAnswer(envelope)
    case "remote.assist.ice":
      handleRemoteIce(envelope)
    case "remote.assist.stop":
      guard envelope.sourceDeviceId == currentDeviceId,
            envelope.body["sessionId"]?.stringValue == currentSessionId else {
        return
      }
      stopActiveSession(
        reason: "Remote Assist was closed on the iPhone.",
        notifyPhone: false
      )
    default:
      break
    }
  }

  private func handleRequest(
    _ envelope: RemoteCloudEnvelope,
    configuration: RemoteCloudConfiguration
  ) {
    let sessionId = envelope.body["sessionId"]?.stringValue ?? ""
    guard !sessionId.isEmpty else {
      return
    }
    guard enabled else {
      sendError(
        "Remote Assist is off on your Mac.",
        code: "remote_assist_disabled",
        sessionId: sessionId,
        targetDeviceId: envelope.sourceDeviceId
      )
      return
    }
    guard CGPreflightScreenCaptureAccess() else {
      sendError(
        "Allow Screen Recording for ClawDad in Mac System Settings.",
        code: "screen_recording_permission_required",
        sessionId: sessionId,
        targetDeviceId: envelope.sourceDeviceId
      )
      return
    }
    guard AXIsProcessTrusted() else {
      sendError(
        "Allow Accessibility control for ClawDad in Mac System Settings.",
        code: "accessibility_permission_required",
        sessionId: sessionId,
        targetDeviceId: envelope.sourceDeviceId
      )
      return
    }
    guard currentSessionId.isEmpty else {
      sendError(
        "Another Remote Assist session is already open.",
        code: "remote_assist_busy",
        sessionId: sessionId,
        targetDeviceId: envelope.sourceDeviceId
      )
      return
    }

    currentSessionId = sessionId
    currentDeviceId = envelope.sourceDeviceId
    publishStatus()

    Task {
      do {
        try await sendRemoteEnvelope(
          type: "remote.assist.available",
          body: [
            "sessionId": .string(sessionId),
            "macName": .string(Host.current().localizedName ?? "Mac")
          ],
          targetDeviceId: envelope.sourceDeviceId
        )
        let iceServers = await configuration.resolvedIceServers()
        guard currentSessionId == sessionId,
              currentDeviceId == envelope.sourceDeviceId else {
          return
        }
        let peer = MacRemotePeer(
          factory: factory,
          iceServers: iceServers
        )
        currentPeer = peer
        publishStatus()

        peer.onIceCandidate = { [weak self, weak peer] candidate in
          guard let self, self.currentPeer === peer else {
            return
          }
          Task {
            try? await self.sendRemoteEnvelope(
              type: "remote.assist.ice",
              body: [
                "sessionId": .string(sessionId),
                "candidate": .string(candidate.sdp),
                "sdpMid": .string(candidate.sdpMid ?? ""),
                "sdpMLineIndex": .number(Double(candidate.sdpMLineIndex))
              ],
              targetDeviceId: envelope.sourceDeviceId
            )
          }
        }
        peer.onConnectionState = { [weak self, weak peer] state in
          guard let self, self.currentPeer === peer else {
            return
          }
          switch state {
          case .failed, .closed:
            self.stopActiveSession(
              reason: "The Remote Assist connection ended.",
              notifyPhone: true
            )
          default:
            break
          }
        }

        let offer = try await peer.createOffer()
        guard currentPeer === peer else {
          return
        }
        try await sendRemoteEnvelope(
          type: "remote.assist.offer",
          body: [
            "sessionId": .string(sessionId),
            "sdp": .string(offer.sdp),
            "width": .number(Double(offer.width)),
            "height": .number(Double(offer.height)),
            "iceServers": .array(iceServerValues(iceServers))
          ],
          targetDeviceId: envelope.sourceDeviceId
        )
      } catch {
        guard currentSessionId == sessionId,
              currentDeviceId == envelope.sourceDeviceId else {
          return
        }
        sendError(
          error.localizedDescription,
          code: "remote_assist_start_failed",
          sessionId: sessionId,
          targetDeviceId: envelope.sourceDeviceId
        )
        stopActiveSession(reason: error.localizedDescription, notifyPhone: false)
      }
    }
  }

  private func iceServerValues(
    _ servers: [RemoteIceServerConfiguration]
  ) -> [RemoteJSONValue] {
    servers.map { server in
      var object: [String: RemoteJSONValue] = [
        "urls": .array(server.urls.map(RemoteJSONValue.string))
      ]
      if let username = server.username {
        object["username"] = .string(username)
      }
      if let credential = server.credential {
        object["credential"] = .string(credential)
      }
      return .object(object)
    }
  }

  private func handleAnswer(_ envelope: RemoteCloudEnvelope) {
    guard envelope.sourceDeviceId == currentDeviceId,
          envelope.body["sessionId"]?.stringValue == currentSessionId,
          let currentPeer,
          let sdp = envelope.body["sdp"]?.stringValue,
          !sdp.isEmpty else {
      return
    }
    Task {
      do {
        try await currentPeer.acceptAnswer(sdp)
      } catch {
        sendError(
          error.localizedDescription,
          code: "remote_assist_answer_failed",
          sessionId: currentSessionId,
          targetDeviceId: currentDeviceId
        )
        stopActiveSession(reason: error.localizedDescription, notifyPhone: false)
      }
    }
  }

  private func handleRemoteIce(_ envelope: RemoteCloudEnvelope) {
    guard envelope.sourceDeviceId == currentDeviceId,
          envelope.body["sessionId"]?.stringValue == currentSessionId,
          let currentPeer,
          let sdp = envelope.body["candidate"]?.stringValue,
          !sdp.isEmpty else {
      return
    }
    let candidate = RTCIceCandidate(
      sdp: sdp,
      sdpMLineIndex: Int32(
        envelope.body["sdpMLineIndex"]?.numberValue ?? 0
      ),
      sdpMid: envelope.body["sdpMid"]?.stringValue
    )
    currentPeer.addRemoteCandidate(candidate)
  }

  private func sendError(
    _ message: String,
    code: String,
    sessionId: String,
    targetDeviceId: String
  ) {
    Task {
      try? await sendRemoteEnvelope(
        type: "remote.assist.error",
        body: [
          "sessionId": .string(sessionId),
          "error": .string(message),
          "code": .string(code)
        ],
        targetDeviceId: targetDeviceId
      )
    }
  }

  private func sendHostReady(
    configuration: RemoteCloudConfiguration
  ) async throws {
    try await sendEnvelope(
      type: "host.ready",
      body: [
        "remoteAssist": .bool(true),
        "readyAt": .string(RemoteCloudCodec.dateString(Date()))
      ],
      targetDeviceId: "",
      configuration: configuration
    )
  }

  private func sendRemoteEnvelope(
    type: String,
    body: [String: RemoteJSONValue],
    targetDeviceId: String
  ) async throws {
    guard type.hasPrefix("remote.assist.") else {
      return
    }
    let configuration = try RemoteCloudConfiguration.load()
    try await sendEnvelope(
      type: type,
      body: body,
      targetDeviceId: targetDeviceId,
      configuration: configuration
    )
  }

  private func sendEnvelope(
    type: String,
    body: [String: RemoteJSONValue],
    targetDeviceId: String,
    configuration: RemoteCloudConfiguration
  ) async throws {
    guard let socket else {
      throw RemoteAssistHostError.relayUnavailable
    }
    sequence += 1
    let envelope = RemoteCloudEnvelope(
      type: type,
      accountId: configuration.accountId,
      workspaceId: configuration.workspaceId,
      sourceDeviceId: configuration.hostId,
      targetHostId: targetDeviceId,
      seq: sequence,
      body: body
    )
    let signed = try RemoteCloudCodec.signed(
      envelope,
      configuration: configuration
    )
    let data = try RemoteCloudCodec.encoder.encode(signed)
    guard let text = String(data: data, encoding: .utf8) else {
      throw URLError(.cannotParseResponse)
    }
    try await socket.send(.string(text))
  }

  private func startHeartbeat(
    for expectedSocket: URLSessionWebSocketTask,
    configuration: RemoteCloudConfiguration
  ) {
    heartbeatTask?.cancel()
    heartbeatTask = Task { [weak self, weak expectedSocket] in
      guard let self, let expectedSocket else {
        return
      }
      while !Task.isCancelled, self.socket === expectedSocket {
        try? await Task.sleep(nanoseconds: 20_000_000_000)
        guard !Task.isCancelled, self.socket === expectedSocket else {
          return
        }
        do {
          try await self.sendEnvelope(
            type: "ping",
            body: [
              "role": .string("remote-assist-host"),
              "sentAt": .string(RemoteCloudCodec.dateString(Date()))
            ],
            targetDeviceId: configuration.hostId,
            configuration: configuration
          )
        } catch {
          self.relayConnected = false
          self.disconnectRelay()
          self.scheduleReconnect()
          self.publishStatus()
          return
        }
      }
    }
  }

  private func scheduleReconnect() {
    guard enabled, reconnectTask == nil else {
      return
    }
    reconnectAttempt += 1
    let delay = min(
      30.0,
      1.5 * pow(2.0, Double(min(reconnectAttempt - 1, 5)))
    )
    reconnectTask = Task { [weak self] in
      try? await Task.sleep(
        nanoseconds: UInt64(delay * 1_000_000_000)
      )
      guard !Task.isCancelled, let self else {
        return
      }
      self.reconnectTask = nil
      self.connectIfNeeded()
    }
  }

  private func disconnectRelay() {
    receiveTask?.cancel()
    receiveTask = nil
    heartbeatTask?.cancel()
    heartbeatTask = nil
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    relayConnected = false
  }

  private func rememberEnvelope(_ id: String) {
    guard !id.isEmpty else {
      return
    }
    seenEnvelopeIds.insert(id)
    seenEnvelopeOrder.append(id)
    while seenEnvelopeOrder.count > 512 {
      let removed = seenEnvelopeOrder.removeFirst()
      seenEnvelopeIds.remove(removed)
    }
  }

  private func publishStatus() {
    onStatusChange?(status)
  }
}
