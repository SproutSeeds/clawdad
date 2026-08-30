import AppKit
import ClawDadRemoteAssistProtocol
import Foundation
@preconcurrency import WebRTC

struct RemoteAnswerApplicationGate {
  enum Phase: Equatable {
    case ready
    case applying
    case applied
    case invalidated
  }

  private(set) var phase: Phase = .ready
  private var generation: UInt64 = 0

  mutating func begin() -> UInt64? {
    guard phase == .ready else {
      return nil
    }
    phase = .applying
    return generation
  }

  @discardableResult
  mutating func markApplied(generation expectedGeneration: UInt64) -> Bool {
    guard generation == expectedGeneration, phase == .applying else {
      return false
    }
    phase = .applied
    return true
  }

  @discardableResult
  mutating func resetAfterFailure(
    generation expectedGeneration: UInt64
  ) -> Bool {
    guard generation == expectedGeneration, phase == .applying else {
      return false
    }
    generation &+= 1
    phase = .ready
    return true
  }

  mutating func invalidate() {
    generation &+= 1
    phase = .invalidated
  }
}

struct RemoteDisplayAdvertisementPolicy {
  static let retryIntervalsNanoseconds: [UInt64] = [
    250_000_000,
    750_000_000,
    2_000_000_000,
    5_000_000_000,
  ]

  static var retryOffsetsNanoseconds: [UInt64] {
    retryIntervalsNanoseconds.reduce(into: []) { offsets, interval in
      offsets.append((offsets.last ?? 0) + interval)
    }
  }
}

struct RemoteDisplayAdvertisementGate {
  private(set) var generation: UInt64 = 0

  mutating func begin() -> UInt64 {
    generation &+= 1
    return generation
  }

  mutating func invalidate() {
    generation &+= 1
  }

  func isCurrent(_ expectedGeneration: UInt64) -> Bool {
    generation == expectedGeneration
  }
}

@MainActor
final class MacRemotePeer: NSObject {
  struct Offer {
    var sdp: String
    var width: Int
    var height: Int
  }

  var onIceCandidate: ((RTCIceCandidate) -> Void)?
  var onConnectionState: ((RTCPeerConnectionState) -> Void)?
  var onFatalError: ((Error) -> Void)?

  private let factory: RTCPeerConnectionFactory
  private let inputController: MacInputController
  private let terminalTabController = MacTerminalTabController()
  private let iceServers: [RemoteIceServerConfiguration]
  private var peerConnection: RTCPeerConnection?
  private var controlChannel: RTCDataChannel?
  private var screenCapturer: MacScreenCapturer?
  private var pendingRemoteCandidates: [RTCIceCandidate] = []
  private var sessionStateTask: Task<Void, Never>?
  private var displaySelectionTask: Task<Void, Never>?
  private var displayRefreshTask: Task<Void, Never>?
  private var displayAdvertisementTask: Task<Void, Never>?
  private var terminalOperationTask: Task<Void, Never>?
  private var displayAdvertisementGate = RemoteDisplayAdvertisementGate()
  private var displayOperationInProgress = false
  private var displayRefreshPending = false
  private var screenParametersObserver: NSObjectProtocol?
  private var lastPublishedScreenLocked: Bool?
  private var answerApplicationGate = RemoteAnswerApplicationGate()

  init(
    factory: RTCPeerConnectionFactory,
    iceServers: [RemoteIceServerConfiguration]
  ) throws {
    guard let inputController = MacInputController() else {
      throw RemoteAssistHostError.inputEventSourceUnavailable
    }
    self.factory = factory
    self.inputController = inputController
    self.iceServers = iceServers
    super.init()
  }

  func createOffer() async throws -> Offer {
    let videoSource = factory.videoSource(forScreenCast: true)
    let capturer = MacScreenCapturer(videoSource: videoSource)
    capturer.onStreamFailure = { [weak self] _ in
      self?.scheduleDisplayTopologyRefresh()
    }
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
    guard let activeDisplayID = capturer.activeDisplayID else {
      throw RemoteAssistHostError.noDisplayAvailable
    }
    inputController.commitDisplayTransition(to: activeDisplayID)
    startDisplayTopologyMonitoring()
    let offer = try await offer(on: peer)
    try await setLocalDescription(offer, on: peer)
    return Offer(
      sdp: offer.sdp,
      width: capturer.captureWidth,
      height: capturer.captureHeight
    )
  }

  func acceptAnswer(_ sdp: String) async throws {
    guard let answerGeneration = answerApplicationGate.begin() else {
      return
    }
    guard let peerConnection else {
      answerApplicationGate.resetAfterFailure(
        generation: answerGeneration
      )
      throw RemoteAssistHostError.peerConnectionUnavailable
    }
    let answer = RTCSessionDescription(type: .answer, sdp: sdp)
    do {
      try await setRemoteDescription(answer, on: peerConnection)
    } catch {
      guard answerApplicationGate.resetAfterFailure(
        generation: answerGeneration
      ) else {
        return
      }
      throw error
    }
    guard self.peerConnection === peerConnection,
          answerApplicationGate.markApplied(
            generation: answerGeneration
          ) else {
      return
    }
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
    answerApplicationGate.invalidate()
    cancelDisplayAdvertisement()
    terminalOperationTask?.cancel()
    terminalOperationTask = nil
    displaySelectionTask?.cancel()
    displaySelectionTask = nil
    displayRefreshTask?.cancel()
    displayRefreshTask = nil
    displayOperationInProgress = false
    displayRefreshPending = false
    if let screenParametersObserver {
      NotificationCenter.default.removeObserver(screenParametersObserver)
      self.screenParametersObserver = nil
    }
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

  private func sendControl(_ message: RemoteDisplayMessage) {
    guard let data = try? RemoteDisplayCodec.encode(message) else {
      return
    }
    sendControlData(data)
  }

  private func sendControl(_ message: RemoteTerminalTabMessage) {
    guard let data = try? RemoteTerminalTabCodec.encode(message) else {
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
      inputController.cancelPendingOperations()
      cancelDisplayAdvertisement()
      sessionStateTask?.cancel()
      sessionStateTask = nil
      lastPublishedScreenLocked = nil
      return
    }
    publishSessionState(force: true)
    startDisplayAdvertisement()
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

  private func publishDisplayState() {
    guard let state = screenCapturer?.displayState else {
      return
    }
    sendControl(RemoteDisplayMessage.state(state))
  }

  private func startDisplayAdvertisement() {
    let generation = displayAdvertisementGate.begin()
    displayAdvertisementTask?.cancel()
    publishDisplayState()
    displayAdvertisementTask = Task { @MainActor [weak self] in
      for interval in RemoteDisplayAdvertisementPolicy.retryIntervalsNanoseconds {
        do {
          try await Task.sleep(nanoseconds: interval)
        } catch {
          break
        }
        guard let self,
              !Task.isCancelled,
              self.displayAdvertisementGate.isCurrent(generation),
              self.controlChannel?.readyState == .open else {
          break
        }
        self.publishDisplayState()
      }
      guard let self,
            self.displayAdvertisementGate.isCurrent(generation) else {
        return
      }
      self.displayAdvertisementTask = nil
    }
  }

  private func cancelDisplayAdvertisement() {
    displayAdvertisementGate.invalidate()
    displayAdvertisementTask?.cancel()
    displayAdvertisementTask = nil
  }

  private func handleDisplaySelection(_ message: RemoteDisplayMessage) {
    guard message.type == RemoteDisplayMessage.selectType,
          let requestId = message.requestId,
          let displayId = message.displayId,
          let expectedRevision = message.expectedTopologyRevision,
          let capturer = screenCapturer,
          let currentState = capturer.displayState else {
      return
    }

    guard displaySelectionTask == nil,
          !displayOperationInProgress else {
      sendControl(.selectFailure(
        requestId: requestId,
        errorCode: "switch_in_progress",
        error: "ClawDad is already switching screens.",
        state: currentState
      ))
      return
    }

    displayRefreshTask?.cancel()
    displayRefreshTask = nil
    displayOperationInProgress = true
    inputController.prepareForDisplayTransition()
    displaySelectionTask = Task { @MainActor [weak self, weak capturer] in
      guard let self, let capturer else {
        return
      }
      defer {
        self.displaySelectionTask = nil
        self.displayOperationInProgress = false
        if self.displayRefreshPending {
          self.scheduleDisplayTopologyRefresh()
        }
      }
      do {
        let state = try await capturer.selectDisplay(
          displayId: displayId,
          expectedTopologyRevision: expectedRevision
        )
        guard !Task.isCancelled,
              self.screenCapturer === capturer,
              let activeDisplayID = capturer.activeDisplayID else {
          return
        }
        self.inputController.commitDisplayTransition(to: activeDisplayID)
        self.sendControl(.selectSuccess(
          requestId: requestId,
          state: state
        ))
        self.sendControl(RemoteDisplayMessage.state(state))
      } catch let failure as MacDisplaySelectionFailure {
        guard !Task.isCancelled,
              self.screenCapturer === capturer else {
          return
        }
        if let activeDisplayID = capturer.activeDisplayID {
          self.inputController.commitDisplayTransition(to: activeDisplayID)
        } else {
          self.inputController.cancelDisplayTransition()
        }
        self.sendControl(.selectFailure(
          requestId: requestId,
          errorCode: failure.code,
          error: failure.message,
          state: failure.state
        ))
        self.sendControl(RemoteDisplayMessage.state(failure.state))
      } catch {
        guard !Task.isCancelled,
              self.screenCapturer === capturer else {
          return
        }
        self.inputController.cancelDisplayTransition()
        self.onFatalError?(error)
      }
    }
  }

  private func handleTerminalRequest(_ message: RemoteTerminalTabMessage) {
    guard message.type == RemoteTerminalTabMessage.listType ||
            message.type == RemoteTerminalTabMessage.focusType else {
      return
    }
    guard !MacConsoleSessionState.isLocked() else {
      sendTerminalFailure(
        for: message,
        code: "mac_locked",
        error: "Unlock the Mac before choosing a Terminal tab.",
        state: nil
      )
      return
    }
    guard terminalOperationTask == nil else {
      sendTerminalFailure(
        for: message,
        code: "request_in_progress",
        error: "ClawDad is already refreshing Terminal tabs.",
        state: nil
      )
      return
    }

    terminalOperationTask = Task { @MainActor [weak self] in
      guard let self else {
        return
      }
      defer {
        self.terminalOperationTask = nil
      }
      do {
        switch message.type {
        case RemoteTerminalTabMessage.listType:
          let state = try await self.terminalTabController.catalog()
          guard !Task.isCancelled else {
            return
          }
          self.sendControl(.listSuccess(
            requestId: message.requestId,
            state: state
          ))
        case RemoteTerminalTabMessage.focusType:
          guard let tabID = message.tabId,
                let expectedRevision = message.expectedRevision else {
            return
          }
          let state = try await self.terminalTabController.focus(
            tabID: tabID,
            expectedRevision: expectedRevision
          )
          guard !Task.isCancelled else {
            return
          }
          self.sendControl(.focusSuccess(
            requestId: message.requestId,
            state: state
          ))
        default:
          return
        }
      } catch let failure as MacTerminalTabFailure {
        guard !Task.isCancelled else {
          return
        }
        self.sendTerminalFailure(
          for: message,
          code: failure.code,
          error: failure.message,
          state: failure.state
        )
      } catch {
        guard !Task.isCancelled else {
          return
        }
        self.sendTerminalFailure(
          for: message,
          code: "automation_failed",
          error: error.localizedDescription,
          state: nil
        )
      }
    }
  }

  private func sendTerminalFailure(
    for request: RemoteTerminalTabMessage,
    code: String,
    error: String,
    state: RemoteTerminalTabState?
  ) {
    if request.type == RemoteTerminalTabMessage.focusType {
      sendControl(.focusFailure(
        requestId: request.requestId,
        errorCode: code,
        error: error,
        state: state
      ))
    } else {
      sendControl(.listFailure(
        requestId: request.requestId,
        errorCode: code,
        error: error,
        state: state
      ))
    }
  }

  private func startDisplayTopologyMonitoring() {
    guard screenParametersObserver == nil else {
      return
    }
    screenParametersObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      Task { @MainActor [weak self] in
        self?.scheduleDisplayTopologyRefresh()
      }
    }
  }

  private func scheduleDisplayTopologyRefresh() {
    displayRefreshPending = true
    guard !displayOperationInProgress else {
      return
    }
    displayRefreshTask?.cancel()
    displayRefreshTask = Task { @MainActor [weak self] in
      do {
        try await Task.sleep(nanoseconds: 400_000_000)
      } catch {
        return
      }
      guard !Task.isCancelled, let self else {
        return
      }
      guard self.displaySelectionTask == nil,
            !self.displayOperationInProgress else {
        self.displayRefreshTask = nil
        return
      }
      self.displayRefreshPending = false
      self.displayOperationInProgress = true
      await self.refreshDisplayTopology()
      self.displayOperationInProgress = false
      self.displayRefreshTask = nil
      if self.displayRefreshPending {
        self.scheduleDisplayTopologyRefresh()
      }
    }
  }

  private func refreshDisplayTopology() async {
    guard let capturer = screenCapturer else {
      return
    }
    inputController.prepareForDisplayTransition()
    do {
      let state = try await capturer.refreshDisplays()
      guard !Task.isCancelled,
            screenCapturer === capturer,
            let activeDisplayID = capturer.activeDisplayID else {
        return
      }
      inputController.commitDisplayTransition(to: activeDisplayID)
      sendControl(RemoteDisplayMessage.state(state))
    } catch {
      guard screenCapturer === capturer else {
        return
      }
      inputController.cancelDisplayTransition()
      onFatalError?(error)
    }
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
      if let displayMessage = try? RemoteDisplayCodec.decode(data),
         displayMessage.type == RemoteDisplayMessage.selectType {
        self.handleDisplaySelection(displayMessage)
        return
      }
      if let terminalMessage = try? RemoteTerminalTabCodec.decode(data),
         terminalMessage.type == RemoteTerminalTabMessage.listType ||
           terminalMessage.type == RemoteTerminalTabMessage.focusType {
        self.handleTerminalRequest(terminalMessage)
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
