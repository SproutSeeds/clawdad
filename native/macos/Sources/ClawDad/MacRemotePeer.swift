import ClawDadRemoteAssistProtocol
import Foundation
@preconcurrency import WebRTC

@MainActor
final class MacRemotePeer: NSObject {
  struct Offer {
    var sdp: String
    var width: Int
    var height: Int
  }

  var onIceCandidate: ((RTCIceCandidate) -> Void)?
  var onConnectionState: ((RTCPeerConnectionState) -> Void)?

  private let factory: RTCPeerConnectionFactory
  private let inputController = MacInputController()
  private let iceServers: [RemoteIceServerConfiguration]
  private var peerConnection: RTCPeerConnection?
  private var controlChannel: RTCDataChannel?
  private var screenCapturer: MacScreenCapturer?
  private var pendingRemoteCandidates: [RTCIceCandidate] = []
  private var sessionStateTask: Task<Void, Never>?
  private var lastPublishedScreenLocked: Bool?

  init(
    factory: RTCPeerConnectionFactory,
    iceServers: [RemoteIceServerConfiguration]
  ) {
    self.factory = factory
    self.iceServers = iceServers
    super.init()
  }

  func createOffer() async throws -> Offer {
    let videoSource = factory.videoSource(forScreenCast: true)
    let capturer = MacScreenCapturer(videoSource: videoSource)
    screenCapturer = capturer

    let videoTrack = factory.videoTrack(
      with: videoSource,
      trackId: "clawdad-screen"
    )
    let configuration = RTCConfiguration()
    configuration.sdpSemantics = .unifiedPlan
    configuration.continualGatheringPolicy = .gatherContinually
    configuration.iceServers = iceServers.map { server in
      if let username = server.username, let credential = server.credential {
        return RTCIceServer(
          urlStrings: server.urls,
          username: username,
          credential: credential
        )
      }
      return RTCIceServer(urlStrings: server.urls)
    }
    let constraints = RTCMediaConstraints(
      mandatoryConstraints: nil,
      optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
    )
    guard let peer = factory.peerConnection(
      with: configuration,
      constraints: constraints,
      delegate: self
    ) else {
      throw RemoteAssistHostError.peerConnectionUnavailable
    }
    peerConnection = peer
    guard peer.add(videoTrack, streamIds: ["clawdad-screen"]) != nil else {
      throw RemoteAssistHostError.videoTrackUnavailable
    }

    let channelConfiguration = RTCDataChannelConfiguration()
    channelConfiguration.isOrdered = true
    guard let channel = peer.dataChannel(
      forLabel: "clawdad-control",
      configuration: channelConfiguration
    ) else {
      throw RemoteAssistHostError.controlChannelUnavailable
    }
    channel.delegate = self
    controlChannel = channel

    try await capturer.start()
    let offer = try await offer(on: peer)
    try await setLocalDescription(offer, on: peer)
    return Offer(
      sdp: offer.sdp,
      width: capturer.captureWidth,
      height: capturer.captureHeight
    )
  }

  func acceptAnswer(_ sdp: String) async throws {
    guard let peerConnection else {
      throw RemoteAssistHostError.peerConnectionUnavailable
    }
    let answer = RTCSessionDescription(type: .answer, sdp: sdp)
    try await setRemoteDescription(answer, on: peerConnection)
    for candidate in pendingRemoteCandidates {
      try? await peerConnection.add(candidate)
    }
    pendingRemoteCandidates.removeAll()
  }

  func addRemoteCandidate(_ candidate: RTCIceCandidate) {
    guard let peerConnection, peerConnection.remoteDescription != nil else {
      pendingRemoteCandidates.append(candidate)
      return
    }
    Task {
      try? await peerConnection.add(candidate)
    }
  }

  @discardableResult
  func updateIceServers(
    _ servers: [RemoteIceServerConfiguration]
  ) -> Bool {
    guard let peerConnection else {
      return false
    }
    let configuration = peerConnection.configuration
    configuration.iceServers = servers.map { server in
      if let username = server.username, let credential = server.credential {
        return RTCIceServer(
          urlStrings: server.urls,
          username: username,
          credential: credential
        )
      }
      return RTCIceServer(urlStrings: server.urls)
    }
    return peerConnection.setConfiguration(configuration)
  }

  func stop() {
    inputController.cancelPendingOperations()
    sessionStateTask?.cancel()
    sessionStateTask = nil
    lastPublishedScreenLocked = nil
    controlChannel?.delegate = nil
    controlChannel?.close()
    controlChannel = nil
    peerConnection?.delegate = nil
    peerConnection?.close()
    peerConnection = nil
    pendingRemoteCandidates.removeAll()
    if let screenCapturer {
      Task {
        await screenCapturer.stop()
      }
    }
    screenCapturer = nil
  }

  private func sendControl(_ message: RemoteClipboardMessage) {
    guard let data = try? RemoteClipboardCodec.encode(message) else {
      return
    }
    sendControlData(data)
  }

  private func sendControl(_ message: RemoteInputMessage) {
    guard let data = try? RemoteInputCodec.encode(message) else {
      return
    }
    sendControlData(data)
  }

  private func sendControl(_ message: RemoteSessionStateMessage) {
    guard let data = try? RemoteSessionStateCodec.encode(message) else {
      return
    }
    sendControlData(data)
  }

  private func sendControlData(_ data: Data) {
    guard let controlChannel,
          controlChannel.readyState == .open else {
      return
    }
    _ = controlChannel.sendData(RTCDataBuffer(data: data, isBinary: false))
  }

  private func controlChannelStateChanged() {
    guard controlChannel?.readyState == .open else {
      sessionStateTask?.cancel()
      sessionStateTask = nil
      lastPublishedScreenLocked = nil
      return
    }
    publishSessionState(force: true)
    guard sessionStateTask == nil else {
      return
    }
    sessionStateTask = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        do {
          try await Task.sleep(nanoseconds: 500_000_000)
        } catch {
          break
        }
        self?.publishSessionState(force: false)
      }
      self?.sessionStateTask = nil
    }
  }

  private func publishSessionState(force: Bool) {
    let screenLocked = MacConsoleSessionState.isLocked()
    guard force || screenLocked != lastPublishedScreenLocked else {
      return
    }
    lastPublishedScreenLocked = screenLocked
    sendControl(.state(screenLocked: screenLocked))
  }

  private func offer(on peer: RTCPeerConnection) async throws -> RTCSessionDescription {
    try await withCheckedThrowingContinuation { continuation in
      let constraints = RTCMediaConstraints(
        mandatoryConstraints: [
          "OfferToReceiveAudio": "false",
          "OfferToReceiveVideo": "false"
        ],
        optionalConstraints: nil
      )
      peer.offer(for: constraints) { offer, error in
        if let error {
          continuation.resume(throwing: error)
        } else if let offer {
          continuation.resume(returning: offer)
        } else {
          continuation.resume(
            throwing: RemoteAssistHostError.invalidSessionDescription
          )
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
}

extension MacRemotePeer: RTCPeerConnectionDelegate {
  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didChange stateChanged: RTCSignalingState
  ) {}

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didAdd stream: RTCMediaStream
  ) {}

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
      self?.onIceCandidate?(candidate)
    }
  }

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didRemove candidates: [RTCIceCandidate]
  ) {}

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didOpen dataChannel: RTCDataChannel
  ) {}

  nonisolated func peerConnection(
    _ peerConnection: RTCPeerConnection,
    didChange newState: RTCPeerConnectionState
  ) {
    Task { @MainActor [weak self] in
      self?.onConnectionState?(newState)
    }
  }
}

extension MacRemotePeer: RTCDataChannelDelegate {
  nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
    Task { @MainActor [weak self] in
      self?.controlChannelStateChanged()
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
      guard let self else {
        return
      }
      self.inputController.handle(
        data,
        respondClipboard: { [weak self] response in
          self?.sendControl(response)
        },
        respondInput: { [weak self] response in
          self?.sendControl(response)
        }
      )
    }
  }
}
