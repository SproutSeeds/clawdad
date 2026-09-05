import Foundation
import ClawDadRemoteAssistProtocol
@preconcurrency import WebRTC

/// A separate paired connection with one reliable data channel. No capture,
/// microphone, input events, or TURN credentials enter the file transport.
@MainActor
public final class PairedFilePeer: NSObject {
  public var onCandidate: ((String, String?, Int32) -> Void)?
  public var onOpen: (() -> Void)?
  public var onMessage: ((Data) -> Void)?
  public var onFailure: ((Error) -> Void)?
  private let factory: RTCPeerConnectionFactory
  private var peer: RTCPeerConnection?
  private var channel: RTCDataChannel?
  private var candidates: [RTCIceCandidate] = []
  private var assembler = RemoteFileAssembler()
  private var sending = false
  public var isOpen: Bool { channel?.readyState == .open }

  public override init() {
    RTCInitializeSSL()
    factory = RTCPeerConnectionFactory()
    super.init()
  }

  private func makePeer() throws -> RTCPeerConnection {
    if let peer { return peer }
    let configuration = RTCConfiguration()
    configuration.sdpSemantics = .unifiedPlan
    configuration.iceServers = [RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])]
    configuration.continualGatheringPolicy = .gatherContinually
    guard let peer = factory.peerConnection(with: configuration,
      constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self) else { throw RemoteFileError.disconnected }
    self.peer = peer
    return peer
  }

  public func createOffer() async throws -> String {
    let peer = try makePeer()
    let config = RTCDataChannelConfiguration()
    config.isOrdered = true
    guard let channel = peer.dataChannel(forLabel: "clawdad-files", configuration: config) else { throw RemoteFileError.disconnected }
    self.channel = channel; channel.delegate = self
    let offer: RTCSessionDescription = try await withCheckedThrowingContinuation { continuation in
      peer.offer(for: RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "false", "OfferToReceiveVideo": "false"], optionalConstraints: nil)) { description, error in
        if let description { continuation.resume(returning: description) }
        else { continuation.resume(throwing: error ?? RemoteFileError.disconnected) }
      }
    }
    try await set(offer, local: true, peer: peer)
    return offer.sdp
  }

  public func acceptOffer(_ sdp: String) async throws -> String {
    let peer = try makePeer()
    try await set(RTCSessionDescription(type: .offer, sdp: sdp), local: false, peer: peer)
    let answer: RTCSessionDescription = try await withCheckedThrowingContinuation { continuation in
      peer.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { description, error in
        if let description { continuation.resume(returning: description) }
        else { continuation.resume(throwing: error ?? RemoteFileError.disconnected) }
      }
    }
    try await set(answer, local: true, peer: peer)
    await drainCandidates()
    return answer.sdp
  }

  public func acceptAnswer(_ sdp: String) async throws {
    guard let peer else { throw RemoteFileError.disconnected }
    try await set(RTCSessionDescription(type: .answer, sdp: sdp), local: false, peer: peer)
    await drainCandidates()
  }

  public func addCandidate(sdp: String, mid: String?, index: Int32) async {
    // Even an old or misconfigured peer cannot introduce a paid relay route.
    guard !sdp.contains(" typ relay ") else { return }
    let candidate = RTCIceCandidate(sdp: sdp, sdpMLineIndex: index, sdpMid: mid)
    guard let peer, peer.remoteDescription != nil else { candidates.append(candidate); return }
    try? await peer.add(candidate)
  }

  private func drainCandidates() async {
    guard let peer else { return }
    let pending = candidates; candidates = []
    for candidate in pending { try? await peer.add(candidate) }
  }

  private func set(_ description: RTCSessionDescription, local: Bool, peer: RTCPeerConnection) async throws {
    // Files offers never negotiate media, including when received from a peer.
    guard !description.sdp.contains("m=video"), !description.sdp.contains("m=audio"),
          !description.sdp.contains(" typ relay "), description.sdp.utf8.count <= 64 * 1024 else { throw RemoteFileError.invalidMessage }
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let completion: (Error?) -> Void = { error in
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
      }
      if local { peer.setLocalDescription(description, completionHandler: completion) }
      else { peer.setRemoteDescription(description, completionHandler: completion) }
    }
  }

  public func send(_ data: Data) async throws {
    guard !sending else { throw RemoteFileError.invalidMessage }
    sending = true
    defer { sending = false }
    let frames = try RemoteFileFrame.split(data)
    let deadline = Date().addingTimeInterval(15)
    for frame in frames {
      let buffer = RTCDataBuffer(data: try JSONEncoder().encode(frame), isBinary: true)
      while true {
        try Task.checkCancellation()
        guard let channel, channel.readyState == .open else { throw RemoteFileError.disconnected }
        guard Date() < deadline else { throw RemoteFileError.timedOut }
        if channel.bufferedAmount < 128 * 1024, channel.sendData(buffer) { break }
        try await Task.sleep(nanoseconds: 20_000_000)
      }
    }
  }

  public func stop() {
    channel?.delegate = nil; channel?.close(); channel = nil
    peer?.delegate = nil; peer?.close(); peer = nil
    candidates = []; assembler = RemoteFileAssembler()
  }
}

extension PairedFilePeer: RTCPeerConnectionDelegate {
  nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
  nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
  nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
  nonisolated public func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
  nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
  nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
  nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
  nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
    let sdp = candidate.sdp, mid = candidate.sdpMid, index = candidate.sdpMLineIndex
    Task { @MainActor [weak self] in self?.onCandidate?(sdp, mid, index) }
  }
  nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
    Task { @MainActor [weak self] in
      guard let self, dataChannel.label == "clawdad-files", self.channel == nil else { return }
      self.channel = dataChannel; dataChannel.delegate = self
      if dataChannel.readyState == .open { self.onOpen?() }
    }
  }
  nonisolated public func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
    Task { @MainActor [weak self] in
      if newState == .failed || newState == .closed { self?.onFailure?(RemoteFileError.disconnected) }
    }
  }
}

extension PairedFilePeer: RTCDataChannelDelegate {
  nonisolated public func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
    Task { @MainActor [weak self] in
      if dataChannel.readyState == .open { self?.onOpen?() }
      if dataChannel.readyState == .closed { self?.onFailure?(RemoteFileError.disconnected) }
    }
  }
  nonisolated public func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
    let data = buffer.data
    Task { @MainActor [weak self] in
      guard let self else { return }
      do { if let message = try self.assembler.receive(data) { self.onMessage?(message) } }
      catch { self.onFailure?(error) }
    }
  }
}
