import AppKit
import CryptoKit
import Foundation

enum MacRemoteComputerConnectionState: Equatable {
  case disconnected
  case connecting
  case connected(hostOnline: Bool)
  case failed(String)

  var label: String {
    switch self {
    case .disconnected:
      return "Disconnected"
    case .connecting:
      return "Connecting..."
    case .connected(let hostOnline):
      return hostOnline ? "Ready" : "Computer offline"
    case .failed(let message):
      return message
    }
  }
}

enum MacRemoteComputerError: LocalizedError {
  case profileNotFound
  case relayCredentialMissing
  case relayUnavailable
  case remoteAssistUnavailable
  case unauthenticatedResponse

  var errorDescription: String? {
    switch self {
    case .profileNotFound:
      return "That paired computer is no longer saved on this Mac."
    case .relayCredentialMissing:
      return "The secure credential for this computer is missing. Pair it again."
    case .relayUnavailable:
      return "ClawDad could not connect to its secure relay."
    case .remoteAssistUnavailable:
      return "Remote Assist is unavailable on that computer. Update ClawDad there and pair it again."
    case .unauthenticatedResponse:
      return "ClawDad ignored a response whose computer identity could not be verified."
    }
  }
}

@MainActor
final class MacRemoteComputerManager {
  var onChange: (() -> Void)?
  var onRemoteAssistEnvelope: ((RemoteCloudEnvelope) -> Void)?

  private(set) var profiles: [MacPairedComputerProfile]
  private(set) var activeProfile: MacPairedComputerProfile?
  private(set) var connectionState: MacRemoteComputerConnectionState = .disconnected

  private let identity: MacControllerIdentity
  private var socket: URLSessionWebSocketTask?
  private var receiveTask: Task<Void, Never>?
  private var heartbeatTask: Task<Void, Never>?
  private var reconnectTask: Task<Void, Never>?
  private var pairingTimeoutTask: Task<Void, Never>?
  private var sequence = 0
  private var reconnectAttempt = 0
  private var shouldReconnect = false
  private var pendingPairing: MacPairingPayload?
  private var pendingPairingEnvelopeId = ""
  private var pairingContinuation: CheckedContinuation<MacPairedComputerProfile, Error>?
  private var seenEnvelopeIds: Set<String> = []
  private var seenEnvelopeOrder: [String] = []

  init(identity: MacControllerIdentity = .shared) {
    self.identity = identity
    profiles = MacPairedComputerRegistry.load()
  }

  var statusDictionary: [String: Any] {
    [
      "state": connectionState.label,
      "connected": isConnected,
      "hostOnline": hostOnline,
      "activeComputerId": activeProfile?.id ?? "",
      "computers": profiles.map(\.dictionary)
    ]
  }

  var isConnected: Bool {
    if case .connected = connectionState {
      return true
    }
    return false
  }

  var hostOnline: Bool {
    if case .connected(let hostOnline) = connectionState {
      return hostOnline
    }
    return false
  }

  func pair(code: String) async throws -> MacPairedComputerProfile {
    let payload = try parseMacPairingPayload(code)
    cancelPairing(with: CancellationError())
    disconnect(keepReconnectIntent: false)

    pendingPairing = payload
    let profile = MacPairedComputerProfile(
      displayName: payload.hostName ?? payload.hostId,
      platform: payload.hostPlatform ?? "unknown",
      cloudUrl: payload.cloudUrl,
      accountId: payload.accountId,
      workspaceId: payload.workspaceId,
      hostId: payload.hostId,
      hostPublicKeyPem: payload.hostPublicKeyPem ?? "",
      pairedAt: RemoteCloudCodec.dateString(Date()),
      capabilities: payload.capabilities ?? []
    )
    activeProfile = profile
    connectionState = .connecting
    publishChange()

    return try await withCheckedThrowingContinuation { continuation in
      pairingContinuation = continuation
      pairingTimeoutTask?.cancel()
      pairingTimeoutTask = Task { @MainActor [weak self] in
        try? await Task.sleep(nanoseconds: 25_000_000_000)
        guard !Task.isCancelled, let self, self.pairingContinuation != nil else {
          return
        }
        self.cancelPairing(with: MacPairingError.responseTimedOut)
        self.disconnect(keepReconnectIntent: false)
      }
      Task { @MainActor [weak self] in
        guard let self else {
          return
        }
        do {
          try await self.openSocket(profile: profile, accessToken: payload.token)
          let envelopeId = UUID().uuidString.lowercased()
          self.pendingPairingEnvelopeId = envelopeId
          try await self.sendEnvelope(
            type: "pair.request",
            body: [
              "token": .string(payload.token),
              "publicKeyPem": .string(try self.identity.publicKeyExport()),
              "keyId": .string(try self.identity.publicKeyId()),
              "deviceName": .string(Host.current().localizedName ?? "Mac"),
              "platform": .string("macos")
            ],
            envelopeId: envelopeId,
            profile: profile
          )
        } catch {
          self.cancelPairing(with: error)
          self.disconnect(keepReconnectIntent: false)
        }
      }
    }
  }

  func connect(computerId: String) async throws {
    guard let profile = profiles.first(where: { $0.id == computerId }) else {
      throw MacRemoteComputerError.profileNotFound
    }
    guard profile.supportsRemoteAssist else {
      throw MacRemoteComputerError.remoteAssistUnavailable
    }
    if activeProfile?.id == profile.id, socket != nil {
      return
    }
    disconnect(keepReconnectIntent: false)
    activeProfile = profile
    connectionState = .connecting
    shouldReconnect = true
    publishChange()
    let token = try identity.relayAccessToken(for: profile)
    guard !token.isEmpty else {
      connectionState = .failed(
        MacRemoteComputerError.relayCredentialMissing.localizedDescription
      )
      publishChange()
      throw MacRemoteComputerError.relayCredentialMissing
    }
    do {
      try await openSocket(profile: profile, accessToken: token)
      try await sendEnvelope(
        type: "ping",
        body: [
          "platform": .string("macos"),
          "role": .string("remote-assist-controller"),
          "sentAt": .string(RemoteCloudCodec.dateString(Date()))
        ],
        profile: profile
      )
      connectionState = .connected(hostOnline: false)
      reconnectAttempt = 0
      publishChange()
      startHeartbeat(for: profile)
    } catch {
      handleConnectionLoss(error)
      throw error
    }
  }

  func forget(computerId: String) throws {
    guard let profile = profiles.first(where: { $0.id == computerId }) else {
      throw MacRemoteComputerError.profileNotFound
    }
    if activeProfile?.id == profile.id {
      disconnect(keepReconnectIntent: false)
      activeProfile = nil
    }
    try identity.deleteRelayAccessToken(for: profile)
    profiles.removeAll { $0.id == profile.id }
    MacPairedComputerRegistry.save(profiles)
    publishChange()
  }

  func sendRemoteAssistEnvelope(
    type: String,
    body: [String: RemoteJSONValue]
  ) async throws {
    guard type.hasPrefix("remote.assist."), let activeProfile else {
      throw MacRemoteComputerError.relayUnavailable
    }
    try await sendEnvelope(type: type, body: body, profile: activeProfile)
  }

  func stop() {
    cancelPairing(with: CancellationError())
    disconnect(keepReconnectIntent: false)
  }

  private func openSocket(
    profile: MacPairedComputerProfile,
    accessToken: String
  ) async throws {
    var request = URLRequest(url: try realtimeURL(for: profile))
    if !accessToken.isEmpty {
      request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    }
    let nextSocket = URLSession.shared.webSocketTask(with: request)
    nextSocket.maximumMessageSize = 4 * 1024 * 1024
    socket = nextSocket
    nextSocket.resume()
    receiveTask = Task { @MainActor [weak self, weak nextSocket] in
      guard let self, let nextSocket else {
        return
      }
      await self.receiveLoop(nextSocket)
    }
  }

  private func realtimeURL(for profile: MacPairedComputerProfile) throws -> URL {
    guard var components = URLComponents(string: profile.cloudUrl) else {
      throw URLError(.badURL)
    }
    components.scheme = components.scheme == "https" ? "wss" : "ws"
    components.path = "/workspaces/\(profile.workspaceId)/realtime"
    components.queryItems = [
      URLQueryItem(name: "deviceId", value: try identity.deviceId()),
      URLQueryItem(name: "accountId", value: profile.accountId)
    ]
    guard let url = components.url else {
      throw URLError(.badURL)
    }
    return url
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
      handleConnectionLoss(error)
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
      guard let profile = activeProfile else {
        return
      }
      let hostIds: [String]
      if case .array(let values) = envelope.body["availableHostIds"] {
        hostIds = values.map(\.stringValue)
      } else {
        hostIds = []
      }
      connectionState = .connected(hostOnline: hostIds.contains(profile.hostId))
      publishChange()
      return
    }

    guard !seenEnvelopeIds.contains(envelope.id) else {
      return
    }

    if envelope.type == "pair.accepted" {
      handlePairAccepted(envelope)
      return
    }

    guard let profile = activeProfile,
          verifyHostEnvelope(envelope, profile: profile) else {
      return
    }
    rememberEnvelope(envelope.id)

    if envelope.type == "pong" {
      connectionState = .connected(hostOnline: true)
      publishChange()
      return
    }
    if envelope.type.hasPrefix("remote.assist.") {
      onRemoteAssistEnvelope?(envelope)
    }
  }

  private func handlePairAccepted(_ envelope: RemoteCloudEnvelope) {
    let inReplyTo = envelope.body["inReplyTo"]?.stringValue ?? ""
    guard let payload = pendingPairing,
          let profile = activeProfile,
          pendingPairingEnvelopeId.isEmpty ||
            inReplyTo.isEmpty ||
            inReplyTo == pendingPairingEnvelopeId,
          verifyHostEnvelope(envelope, profile: profile) else {
      cancelPairing(with: MacRemoteComputerError.unauthenticatedResponse)
      disconnect(keepReconnectIntent: false)
      return
    }

    let acceptedKey = envelope.body["hostPublicKeyPem"]?.stringValue ?? ""
    guard acceptedKey.isEmpty || macPublicKeysMatch(
      acceptedKey,
      payload.hostPublicKeyPem ?? ""
    ) else {
      cancelPairing(with: MacPairingError.hostIdentityChanged)
      disconnect(keepReconnectIntent: false)
      return
    }

    let capabilities: [String]
    if case .array(let values) = envelope.body["capabilities"] {
      capabilities = values.map(\.stringValue)
    } else {
      capabilities = payload.capabilities ?? []
    }
    let pairedAt = envelope.body["trustedAt"]?.stringValue ??
      RemoteCloudCodec.dateString(Date())
    let saved = MacPairedComputerProfile(
      displayName: envelope.body["hostName"]?.stringValue ?? payload.hostName ?? payload.hostId,
      platform: envelope.body["hostPlatform"]?.stringValue ?? payload.hostPlatform ?? "unknown",
      cloudUrl: payload.cloudUrl,
      accountId: payload.accountId,
      workspaceId: payload.workspaceId,
      hostId: payload.hostId,
      hostPublicKeyPem: acceptedKey.isEmpty ? (payload.hostPublicKeyPem ?? "") : acceptedKey,
      pairedAt: pairedAt,
      capabilities: capabilities,
      lastUsedAt: RemoteCloudCodec.dateString(Date())
    )

    do {
      let relayToken = envelope.body["relayAccessToken"]?.stringValue ?? ""
      guard !relayToken.isEmpty else {
        throw MacRemoteComputerError.relayCredentialMissing
      }
      try identity.saveRelayAccessToken(relayToken, for: saved)
      profiles = MacPairedComputerRegistry.upserting(saved, into: profiles)
      MacPairedComputerRegistry.save(profiles)
      activeProfile = saved
      pendingPairing = nil
      pendingPairingEnvelopeId = ""
      pairingTimeoutTask?.cancel()
      pairingTimeoutTask = nil
      let continuation = pairingContinuation
      pairingContinuation = nil
      connectionState = .connected(hostOnline: true)
      rememberEnvelope(envelope.id)
      publishChange()
      continuation?.resume(returning: saved)
      shouldReconnect = true
      startHeartbeat(for: saved)
    } catch {
      cancelPairing(with: error)
      disconnect(keepReconnectIntent: false)
    }
  }

  private func sendEnvelope(
    type: String,
    body: [String: RemoteJSONValue],
    envelopeId: String = "",
    profile: MacPairedComputerProfile
  ) async throws {
    guard let socket else {
      throw MacRemoteComputerError.relayUnavailable
    }
    sequence += 1
    var envelope = RemoteCloudEnvelope(
      type: type,
      accountId: profile.accountId,
      workspaceId: profile.workspaceId,
      sourceDeviceId: try identity.deviceId(),
      targetHostId: profile.hostId,
      seq: sequence,
      body: body
    )
    if !envelopeId.isEmpty {
      envelope.id = envelopeId
    }
    envelope.signature = try identity.sign(RemoteCloudCodec.canonicalData(envelope))
    let data = try RemoteCloudCodec.encoder.encode(envelope)
    guard let text = String(data: data, encoding: .utf8) else {
      throw URLError(.cannotParseResponse)
    }
    try await socket.send(.string(text))
  }

  private func verifyHostEnvelope(
    _ envelope: RemoteCloudEnvelope,
    profile: MacPairedComputerProfile
  ) -> Bool {
    guard envelope.sourceDeviceId == profile.hostId,
          envelope.accountId == profile.accountId,
          envelope.workspaceId == profile.workspaceId,
          envelope.targetHostId == (try? identity.deviceId()),
          let expiresAt = macCloudDate(envelope.expiresAt),
          expiresAt.addingTimeInterval(5) >= Date(),
          let signature = envelope.signature,
          signature.alg == "ES256",
          let signatureData = Data(base64UrlEncoded: signature.value) else {
      return false
    }
    do {
      let key = try P256.Signing.PublicKey(pemRepresentation: profile.hostPublicKeyPem)
      let ecdsa = try P256.Signing.ECDSASignature(derRepresentation: signatureData)
      return key.isValidSignature(
        ecdsa,
        for: try RemoteCloudCodec.canonicalData(envelope)
      )
    } catch {
      return false
    }
  }

  private func macPublicKeysMatch(_ left: String, _ right: String) -> Bool {
    do {
      let leftKey = try P256.Signing.PublicKey(pemRepresentation: left)
      let rightKey = try P256.Signing.PublicKey(pemRepresentation: right)
      return leftKey.rawRepresentation == rightKey.rawRepresentation
    } catch {
      return false
    }
  }

  private func startHeartbeat(for profile: MacPairedComputerProfile) {
    heartbeatTask?.cancel()
    heartbeatTask = Task { @MainActor [weak self] in
      guard let self else {
        return
      }
      while !Task.isCancelled, self.socket != nil,
            self.activeProfile?.id == profile.id {
        try? await Task.sleep(nanoseconds: 15_000_000_000)
        guard !Task.isCancelled, self.socket != nil,
              self.activeProfile?.id == profile.id else {
          return
        }
        do {
          try await self.sendEnvelope(
            type: "ping",
            body: [
              "platform": .string("macos"),
              "role": .string("remote-assist-controller"),
              "sentAt": .string(RemoteCloudCodec.dateString(Date()))
            ],
            profile: profile
          )
        } catch {
          self.handleConnectionLoss(error)
          return
        }
      }
    }
  }

  private func handleConnectionLoss(_ error: Error) {
    let reconnect = shouldReconnect && pendingPairing == nil && activeProfile != nil
    disconnect(keepReconnectIntent: reconnect)
    connectionState = .failed(error.localizedDescription)
    publishChange()
    guard reconnect, reconnectTask == nil, let profile = activeProfile else {
      return
    }
    reconnectAttempt += 1
    let delay = min(30.0, pow(2.0, Double(min(reconnectAttempt - 1, 5))))
    reconnectTask = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
      guard !Task.isCancelled, let self,
            self.shouldReconnect, self.activeProfile?.id == profile.id else {
        return
      }
      self.reconnectTask = nil
      try? await self.connect(computerId: profile.id)
    }
  }

  private func disconnect(keepReconnectIntent: Bool) {
    shouldReconnect = keepReconnectIntent
    receiveTask?.cancel()
    receiveTask = nil
    heartbeatTask?.cancel()
    heartbeatTask = nil
    reconnectTask?.cancel()
    reconnectTask = nil
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    if !keepReconnectIntent {
      connectionState = .disconnected
    }
  }

  private func cancelPairing(with error: Error) {
    pairingTimeoutTask?.cancel()
    pairingTimeoutTask = nil
    pendingPairing = nil
    pendingPairingEnvelopeId = ""
    let continuation = pairingContinuation
    pairingContinuation = nil
    continuation?.resume(throwing: error)
  }

  private func rememberEnvelope(_ id: String) {
    seenEnvelopeIds.insert(id)
    seenEnvelopeOrder.append(id)
    if seenEnvelopeOrder.count > 512 {
      let removalCount = seenEnvelopeOrder.count - 384
      let removed = Array(seenEnvelopeOrder.prefix(removalCount))
      seenEnvelopeOrder.removeFirst(removalCount)
      for value in removed {
        seenEnvelopeIds.remove(value)
      }
    }
  }

  private func publishChange() {
    onChange?()
  }
}
