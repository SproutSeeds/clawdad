import Foundation
import SwiftUI
import CryptoKit
import AVFoundation
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class MobileReadAloudController: NSObject, ObservableObject {
  @Published private(set) var activeKey = ""
  @Published private(set) var phase = MobileReadAloudPhase.idle
  @Published private(set) var statusMessage = ""
  @Published private(set) var errorMessage = ""

  private var requestId = ""
  private var envelopeId = ""
  private var expectedPartCount = 0
  private var expectedChunkCounts: [Int: Int] = [:]
  private var chunksByPart: [Int: [Int: Data]] = [:]
  private var fileNamesByPart: [Int: String] = [:]
  private var mimeTypesByPart: [Int: String] = [:]
  private var audioFilesByPart: [Int: URL] = [:]
  private var playlist: [URL] = []
  private var playlistIndex = 0
  private var receivedBytes = 0
  private var player: AVAudioPlayer?
  private var timeoutTask: Task<Void, Never>?

  private let maximumAudioBytes = 256 * 1024 * 1024
  private let maximumChunkBytes = 512 * 1024
  private let prepareTimeoutNanoseconds: UInt64 = 3 * 60 * 1_000_000_000

  func phase(for key: String) -> MobileReadAloudPhase {
    activeKey == key ? phase : .idle
  }

  func message(for key: String) -> String {
    activeKey == key ? (errorMessage.isEmpty ? statusMessage : errorMessage) : ""
  }

  func begin(key: String, requestId: String, envelopeId: String) {
    resetPlayback()
    self.activeKey = key
    self.requestId = requestId
    self.envelopeId = envelopeId
    phase = .preparing
    statusMessage = "Sending text to your paired computer..."
    errorMessage = ""
    timeoutTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: self?.prepareTimeoutNanoseconds ?? 0)
      guard !Task.isCancelled else {
        return
      }
      self?.fail(
        requestId: requestId,
        message: "Audio is still preparing. Tap the speaker again in a moment."
      )
    }
  }

  func markAccepted(requestId: String) {
    guard requestId == self.requestId, phase == .preparing else {
      return
    }
    statusMessage = "Preparing audio on your paired computer..."
  }

  func receiveChunk(
    requestId: String,
    partIndex: Int,
    partCount: Int,
    chunkIndex: Int,
    chunkCount: Int,
    fileName: String,
    mimeType: String,
    declaredBytes: Int,
    dataBase64: String
  ) {
    guard requestId == self.requestId, phase == .preparing else {
      return
    }
    guard partCount > 0, partCount <= 200,
          partIndex >= 0, partIndex < partCount,
          chunkCount > 0, chunkCount <= 2_048,
          chunkIndex >= 0, chunkIndex < chunkCount,
          let data = Data(base64Encoded: dataBase64),
          !data.isEmpty,
          data.count <= maximumChunkBytes,
          (declaredBytes <= 0 || declaredBytes == data.count)
    else {
      fail(requestId: requestId, message: "The paired computer returned an invalid audio chunk.")
      return
    }

    if expectedPartCount > 0, expectedPartCount != partCount {
      fail(requestId: requestId, message: "The paired computer returned inconsistent audio parts.")
      return
    }
    if let expected = expectedChunkCounts[partIndex], expected != chunkCount {
      fail(requestId: requestId, message: "The paired computer returned inconsistent audio chunks.")
      return
    }

    expectedPartCount = partCount
    expectedChunkCounts[partIndex] = chunkCount
    fileNamesByPart[partIndex] = fileName
    mimeTypesByPart[partIndex] = mimeType
    var partChunks = chunksByPart[partIndex] ?? [:]
    if let existing = partChunks[chunkIndex] {
      guard existing == data else {
        fail(requestId: requestId, message: "The paired computer returned a conflicting audio chunk.")
        return
      }
    } else {
      receivedBytes += data.count
      guard receivedBytes <= maximumAudioBytes else {
        fail(requestId: requestId, message: "This response is too large to read aloud on iPhone.")
        return
      }
      partChunks[chunkIndex] = data
      chunksByPart[partIndex] = partChunks
    }

    statusMessage = "Receiving audio from your paired computer..."
    if partChunks.count == chunkCount {
      persistAudioPart(partIndex: partIndex, chunkCount: chunkCount)
    }
  }

  func complete(requestId: String, partCount: Int) {
    guard requestId == self.requestId, phase == .preparing else {
      return
    }
    guard partCount > 0,
          partCount == expectedPartCount,
          audioFilesByPart.count == partCount,
          (0..<partCount).allSatisfy({ audioFilesByPart[$0] != nil })
    else {
      fail(requestId: requestId, message: "The audio transfer ended before every part arrived.")
      return
    }

    timeoutTask?.cancel()
    timeoutTask = nil
    playlist = (0..<partCount).compactMap { audioFilesByPart[$0] }
    playlistIndex = 0
    do {
      try activatePlaybackSession()
      try playCurrentPart()
    } catch {
      fail(requestId: requestId, message: "ClawDad could not play this audio: \(error.localizedDescription)")
    }
  }

  func pause() {
    guard phase == .playing, let player else {
      return
    }
    player.pause()
    phase = .paused
    statusMessage = "Audio paused"
  }

  func resume() {
    guard phase == .paused, let player else {
      return
    }
    do {
      try activatePlaybackSession()
      guard player.play() else {
        throw URLError(.cannotOpenFile)
      }
      phase = .playing
      statusMessage = playbackStatusMessage()
    } catch {
      fail(requestId: requestId, message: "ClawDad could not resume this audio.")
    }
  }

  func stop() {
    activeKey = ""
    phase = .idle
    statusMessage = ""
    errorMessage = ""
    resetPlayback()
  }

  func connectionLostWhilePreparing() {
    guard phase == .preparing else {
      return
    }
    fail(requestId: requestId, message: "Connection to your paired computer was lost while preparing audio.")
  }

  func showFailure(key: String, message: String) {
    resetPlayback()
    activeKey = key
    phase = .failed
    statusMessage = ""
    errorMessage = message
  }

  @discardableResult
  func failIfMatchingEnvelope(_ candidateEnvelopeId: String, message: String) -> Bool {
    guard phase == .preparing,
          !candidateEnvelopeId.isEmpty,
          candidateEnvelopeId == envelopeId else {
      return false
    }
    fail(requestId: requestId, message: message)
    return true
  }

  private func persistAudioPart(partIndex: Int, chunkCount: Int) {
    guard audioFilesByPart[partIndex] == nil,
          let chunks = chunksByPart[partIndex],
          chunks.count == chunkCount else {
      return
    }
    var data = Data()
    for index in 0..<chunkCount {
      guard let chunk = chunks[index] else {
        fail(requestId: requestId, message: "An audio chunk is missing.")
        return
      }
      data.append(chunk)
    }

    let safeRequestId = requestId.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
    let fileExtension = audioFileExtension(
      fileName: fileNamesByPart[partIndex] ?? "",
      mimeType: mimeTypesByPart[partIndex] ?? ""
    )
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("clawdad-read-aloud-\(safeRequestId)-\(partIndex).\(fileExtension)")
    do {
      try data.write(to: url, options: .atomic)
      audioFilesByPart[partIndex] = url
      chunksByPart.removeValue(forKey: partIndex)
    } catch {
      fail(requestId: requestId, message: "ClawDad could not save the audio on this iPhone.")
    }
  }

  private func audioFileExtension(fileName: String, mimeType: String) -> String {
    let candidate = URL(fileURLWithPath: fileName).pathExtension.lowercased()
    if ["wav", "mp3", "m4a", "aac", "caf", "ogg", "flac"].contains(candidate) {
      return candidate
    }
    switch mimeType.lowercased().split(separator: ";").first.map(String.init) {
    case "audio/mpeg": return "mp3"
    case "audio/mp4": return "m4a"
    case "audio/aac": return "aac"
    case "audio/flac": return "flac"
    case "audio/ogg": return "ogg"
    default: return "wav"
    }
  }

  private func activatePlaybackSession() throws {
#if canImport(UIKit)
    let audioSession = AVAudioSession.sharedInstance()
    try audioSession.setCategory(
      .playback,
      mode: .spokenAudio
    )
    try audioSession.setActive(true)
#endif
  }

  private func playCurrentPart() throws {
    guard playlist.indices.contains(playlistIndex) else {
      finishPlayback()
      return
    }
    let nextPlayer = try AVAudioPlayer(contentsOf: playlist[playlistIndex])
    nextPlayer.delegate = self
    nextPlayer.prepareToPlay()
    guard nextPlayer.play() else {
      throw URLError(.cannotOpenFile)
    }
    player = nextPlayer
    phase = .playing
    statusMessage = playbackStatusMessage()
    errorMessage = ""
  }

  private func playbackStatusMessage() -> String {
    playlist.count > 1
      ? "Playing audio part \(playlistIndex + 1) of \(playlist.count)"
      : "Playing audio"
  }

  private func advancePlayback(successfully flag: Bool) {
    guard phase == .playing || phase == .paused else {
      return
    }
    guard flag else {
      fail(requestId: requestId, message: "Audio playback stopped unexpectedly.")
      return
    }
    playlistIndex += 1
    if playlist.indices.contains(playlistIndex) {
      do {
        try playCurrentPart()
      } catch {
        fail(requestId: requestId, message: "ClawDad could not play the next audio part.")
      }
    } else {
      finishPlayback()
    }
  }

  private func finishPlayback() {
    phase = .idle
    statusMessage = ""
    errorMessage = ""
    resetPlayback()
  }

  private func fail(requestId: String, message: String) {
    guard requestId.isEmpty || requestId == self.requestId else {
      return
    }
    resetPlayback()
    phase = .failed
    statusMessage = ""
    errorMessage = message
  }

  private func resetPlayback() {
    timeoutTask?.cancel()
    timeoutTask = nil
    player?.stop()
    player = nil
    requestId = ""
    envelopeId = ""
    expectedPartCount = 0
    expectedChunkCounts = [:]
    chunksByPart = [:]
    fileNamesByPart = [:]
    mimeTypesByPart = [:]
    playlist = []
    playlistIndex = 0
    receivedBytes = 0
    removeAudioFiles()
#if canImport(UIKit)
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
#endif
  }

  private func removeAudioFiles() {
    for url in audioFilesByPart.values {
      try? FileManager.default.removeItem(at: url)
    }
    audioFilesByPart = [:]
  }
}

extension MobileReadAloudController: AVAudioPlayerDelegate {
  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    Task { @MainActor [weak self] in
      self?.advancePlayback(successfully: flag)
    }
  }

  nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    Task { @MainActor [weak self] in
      guard let self else {
        return
      }
      self.fail(
        requestId: self.requestId,
        message: error.map { "Audio playback failed: \($0.localizedDescription)" }
          ?? "Audio playback failed."
      )
    }
  }
}

@MainActor
final class CloudSession: ObservableObject {
  let readAloud = MobileReadAloudController()

  @Published var cloudUrl: String {
    didSet { defaults.set(cloudUrl, forKey: "clawdad.cloudUrl") }
  }
  @Published var accountId: String {
    didSet { defaults.set(accountId, forKey: "clawdad.accountId") }
  }
  @Published var workspaceId: String {
    didSet { defaults.set(workspaceId, forKey: "clawdad.workspaceId") }
  }
  @Published var hostId: String {
    didSet { defaults.set(hostId, forKey: "clawdad.hostId") }
  }
  @Published var state: CloudConnectionState = .disconnected
  @Published var workspace = MobileWorkspace(
    id: "scratchpad",
    title: "Scratchpad",
    hostId: "cody-mac",
    projects: []
  )
  @Published var selectedProjectPath: String {
    didSet { defaults.set(selectedProjectPath, forKey: "clawdad.selectedProjectPath") }
  }
  @Published var selectedSessionId: String {
    didSet { defaults.set(selectedSessionId, forKey: "clawdad.selectedSessionId") }
  }
  @Published var historyItems: [MobileHistoryItem] = []
  @Published var historyStatus = ""
  @Published var events: [String] = []
  @Published var pairingStatus = ""
  @Published var modelOptions: [CodexModelSummary] = []
  @Published var selectedModel: String {
    didSet { defaults.set(selectedModel, forKey: "clawdad.selectedModel") }
  }
  @Published var selectedReasoningEffort: String {
    didSet { defaults.set(selectedReasoningEffort, forKey: "clawdad.selectedReasoningEffort") }
  }
  @Published var allowUmbraReadAloudFallback = true {
    didSet {
      defaults.set(
        allowUmbraReadAloudFallback,
        forKey: "clawdad.allowUmbraReadAloudFallback"
      )
    }
  }
  @Published var sessionCreatePending = false
  @Published var projectCreatePending = false
  @Published var projectCreateStatus = ""
  @Published var projectCreateError = ""
  @Published private(set) var lastCreatedProjectPath = ""
  @Published var voiceTranscriptionPending = false
  @Published var voiceTranscriptionStatus = ""
  @Published var voiceTranscription: MobileVoiceTranscription?
  @Published var voiceTranscriptionError = ""
  @Published var pendingApprovals: [MobileApprovalRequest] = []
  @Published var hostOnline = false
  @Published var pairedHostId: String {
    didSet { defaults.set(pairedHostId, forKey: "clawdad.pairedHostId") }
  }
  @Published var pairedAt: String {
    didSet { defaults.set(pairedAt, forKey: "clawdad.pairedAt") }
  }
  @Published var pairedHostPublicKeyPem: String {
    didSet { defaults.set(pairedHostPublicKeyPem, forKey: "clawdad.pairedHostPublicKeyPem") }
  }
  @Published private(set) var pairedComputers: [PairedComputerProfile] = []
  @Published private(set) var activeComputerId: String = "" {
    didSet {
      if activeComputerId.isEmpty {
        defaults.removeObject(forKey: PairedComputerRegistry.activeComputerKey)
      } else {
        defaults.set(activeComputerId, forKey: PairedComputerRegistry.activeComputerKey)
      }
    }
  }
  @Published private(set) var startupWorkspaceReady = false
  @Published private(set) var reconnecting = false

  private var task: URLSessionWebSocketTask?
  private var receiveTask: Task<Void, Never>?
  private var monitorTask: Task<Void, Never>?
  private var reconnectTask: Task<Void, Never>?
  private var voiceTranscriptionTimeoutTask: Task<Void, Never>?
  private var lastObservedTerminalRequest = ""
  private var pendingVoiceRequestId = ""
  private var pendingVoiceEnvelopeId = ""
  private var pendingProjectCreateEnvelopeId = ""
  private var pendingCatalogHistoryLimit: Int?
  private var pendingPairingHostPublicKeyPem = ""
  private var pendingPairingRelayToken = ""
  private var pendingPairingHostName = ""
  private var pendingPairingHostPlatform = ""
  private var pendingPairingCapabilities: [String] = []
  private var pendingPairingEnvelopeId = ""
  private var pairingReturnComputerId = ""
  private var legacyRelayToken = ""
  private var lastEntitlementFingerprint = ""
  private var remoteAssistEnvelopeHandler: ((CloudEnvelope) -> Void)?
  private var connectionRequested = true
  private var reconnectAttempt = 0
  private var lastRelayPongAt = Date.distantPast
  private var lastHostSeenAt = Date.distantPast
  private var seq = 0
  private let defaults = UserDefaults.standard
  private var appStorePreviewMode = false

  init() {
    let bundledCloudUrl = String(
      describing: Bundle.main.object(forInfoDictionaryKey: "ClawDadCloudURL") ?? ""
    ).trimmingCharacters(in: .whitespacesAndNewlines)
    let defaultCloudUrl = bundledCloudUrl.isEmpty || bundledCloudUrl.contains("$(")
      ? "https://clawdad-cloud.frg.earth"
      : bundledCloudUrl
    self.cloudUrl = defaults.string(forKey: "clawdad.cloudUrl") ?? defaultCloudUrl
    self.accountId = defaults.string(forKey: "clawdad.accountId") ?? "local-account"
    self.workspaceId = defaults.string(forKey: "clawdad.workspaceId") ?? "scratchpad"
    self.hostId = defaults.string(forKey: "clawdad.hostId") ?? "cody-mac"
    self.legacyRelayToken = defaults.string(forKey: "clawdad.devToken") ?? ""
    defaults.removeObject(forKey: "clawdad.devToken")
    self.pairedHostId = defaults.string(forKey: "clawdad.pairedHostId") ?? ""
    self.pairedAt = defaults.string(forKey: "clawdad.pairedAt") ?? ""
    self.pairedHostPublicKeyPem =
      defaults.string(forKey: "clawdad.pairedHostPublicKeyPem") ?? ""
    self.selectedProjectPath = defaults.string(forKey: "clawdad.selectedProjectPath") ?? ""
    self.selectedSessionId = defaults.string(forKey: "clawdad.selectedSessionId") ?? ""
    self.selectedModel = defaults.string(forKey: "clawdad.selectedModel") ?? "gpt-5.6-sol"
    self.selectedReasoningEffort = defaults.string(forKey: "clawdad.selectedReasoningEffort") ?? "ultra"
    var storedComputers = PairedComputerRegistry.load(from: defaults)
    if !self.pairedHostId.isEmpty, self.pairedHostId == self.hostId {
      let legacyComputer = PairedComputerProfile(
        displayName: self.hostId,
        platform: "macos",
        cloudUrl: self.cloudUrl,
        accountId: self.accountId,
        workspaceId: self.workspaceId,
        hostId: self.hostId,
        hostPublicKeyPem: self.pairedHostPublicKeyPem,
        pairedAt: self.pairedAt,
        selectedProjectPath: self.selectedProjectPath,
        selectedSessionId: self.selectedSessionId,
        selectedModel: self.selectedModel,
        selectedReasoningEffort: self.selectedReasoningEffort,
        capabilities: [],
        lastUsedAt: self.pairedAt
      )
      storedComputers = PairedComputerRegistry.migratingLegacy(
        legacyComputer,
        into: storedComputers
      )
    }
    let storedActiveId = defaults.string(
      forKey: PairedComputerRegistry.activeComputerKey
    ) ?? ""
    let legacyActiveId = pairedComputerIdentifier(
      accountId: self.accountId,
      workspaceId: self.workspaceId,
      hostId: self.hostId
    )
    let activeComputer = storedComputers.first { $0.id == storedActiveId }
      ?? storedComputers.first { $0.id == legacyActiveId }
      ?? storedComputers.first
    self.pairedComputers = storedComputers
    if let activeComputer {
      self.activeComputerId = activeComputer.id
      self.cloudUrl = activeComputer.cloudUrl
      self.accountId = activeComputer.accountId
      self.workspaceId = activeComputer.workspaceId
      self.hostId = activeComputer.hostId
      self.pairedHostId = activeComputer.hostId
      self.pairedAt = activeComputer.pairedAt
      self.pairedHostPublicKeyPem = activeComputer.hostPublicKeyPem
      self.selectedProjectPath = activeComputer.selectedProjectPath
      self.selectedSessionId = activeComputer.selectedSessionId
      self.selectedModel = activeComputer.selectedModel
      self.selectedReasoningEffort = activeComputer.selectedReasoningEffort
    }
    PairedComputerRegistry.save(storedComputers, to: defaults)
    if defaults.object(forKey: "clawdad.allowUmbraReadAloudFallback") != nil {
      self.allowUmbraReadAloudFallback = defaults.bool(
        forKey: "clawdad.allowUmbraReadAloudFallback"
      )
    }
    self.startupWorkspaceReady = !self.paired
  }

#if DEBUG
  init(appStorePreview fixture: ClawDadAppStorePreviewFixture) {
    self.cloudUrl = "https://clawdad-cloud.frg.earth"
    self.accountId = "preview-account"
    self.workspaceId = fixture.workspace.id
    self.hostId = fixture.workspace.hostId
    self.pairedHostId = fixture.workspace.hostId
    self.pairedAt = "2026-07-30T14:00:00.000Z"
    self.pairedHostPublicKeyPem = "app-store-preview"
    self.selectedProjectPath = fixture.selectedProjectPath
    self.selectedSessionId = fixture.selectedSessionId
    self.selectedModel = fixture.modelOptions.first?.model ?? "gpt-5.6-sol"
    self.selectedReasoningEffort = "ultra"
    let previewComputer = PairedComputerProfile(
      displayName: "Preview Mac",
      platform: "macos",
      cloudUrl: "https://clawdad-cloud.frg.earth",
      accountId: "preview-account",
      workspaceId: fixture.workspace.id,
      hostId: fixture.workspace.hostId,
      hostPublicKeyPem: "app-store-preview",
      pairedAt: "2026-07-30T14:00:00.000Z",
      selectedProjectPath: fixture.selectedProjectPath,
      selectedSessionId: fixture.selectedSessionId,
      selectedModel: fixture.modelOptions.first?.model ?? "gpt-5.6-sol",
      selectedReasoningEffort: "ultra"
    )
    self.pairedComputers = [previewComputer]
    self.activeComputerId = previewComputer.id
    self.allowUmbraReadAloudFallback = true
    self.appStorePreviewMode = true
    self.state = .connected
    self.workspace = fixture.workspace
    self.historyItems = fixture.historyItems
    self.historyStatus = "Thread ready"
    self.modelOptions = fixture.modelOptions
    self.hostOnline = true
    self.startupWorkspaceReady = true
  }
#endif

  var connected: Bool {
    if case .connected = state {
      return true
    }
    return false
  }

  var paired: Bool {
    !pairedHostId.isEmpty && pairedHostId == hostId
  }

  var activeComputer: PairedComputerProfile? {
    pairedComputers.first { $0.id == activeComputerId }
  }

  var activeComputerName: String {
    activeComputer?.displayName ?? pairedComputerDisplayName("", hostId: hostId)
  }

  var activeComputerPlatformLabel: String {
    activeComputer?.platformLabel ?? "Computer"
  }

  var activeComputerSupportsRemoteAssist: Bool {
    activeComputer?.supportsRemoteAssist ?? true
  }

  var ready: Bool {
    connected && paired && hostOnline
  }

  var remoteAssistAuthenticated: Bool {
    ready && remoteAssistIdentityReady
  }

  var remoteAssistIdentityReady: Bool {
    paired && !pairedHostPublicKeyPem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var startupLoading: Bool {
    paired && !startupWorkspaceReady
  }

  var selectedModelOption: CodexModelSummary? {
    modelOptions.first { $0.model == selectedModel }
  }

  var selectedModelDisplayName: String {
    selectedModelOption?.displayName ?? selectedModel
  }

  var supportedReasoningEfforts: [String] {
    let efforts = selectedModelOption?.supportedReasoningEfforts ?? []
    return efforts.isEmpty ? [selectedReasoningEffort] : efforts
  }

  func connectIfPaired() {
    guard !appStorePreviewMode else {
      return
    }
    guard paired else {
      return
    }
    connectionRequested = true
    if connected {
      let relayIsStale = lastRelayPongAt != .distantPast &&
        Date().timeIntervalSince(lastRelayPongAt) > 35
      if task?.state != .running || relayIsStale {
        handleConnectionLoss(URLError(.networkConnectionLost))
        return
      }
      pingHost()
      if hostOnline {
        requestCatalog()
      }
      return
    }
    if case .connecting = state {
      return
    }
    connect()
  }

  func connect() {
    guard paired else {
      pairingStatus = "Scan a ClawDad computer QR to pair this iPhone."
      events.insert("Pair with a computer first", at: 0)
      return
    }
    if case .connecting = state {
      return
    }
    if connected {
      requestCatalog()
      return
    }
    connectionRequested = true
    reconnectTask?.cancel()
    reconnectTask = nil
    Task {
      do {
        try await connectAsync()
      } catch {
        handleConnectionLoss(error)
      }
    }
  }

  func disconnect() {
    connectionRequested = false
    reconnectTask?.cancel()
    reconnectTask = nil
    resetSocket()
    state = .disconnected
    reconnecting = false
  }

  private func resetSocket() {
    monitorTask?.cancel()
    monitorTask = nil
    receiveTask?.cancel()
    receiveTask = nil
    task?.cancel(with: .normalClosure, reason: nil)
    task = nil
    voiceTranscriptionTimeoutTask?.cancel()
    voiceTranscriptionTimeoutTask = nil
    voiceTranscriptionPending = false
    voiceTranscriptionStatus = ""
    pendingVoiceRequestId = ""
    pendingVoiceEnvelopeId = ""
    if projectCreatePending {
      projectCreatePending = false
      projectCreateStatus = ""
      projectCreateError = "The connection was interrupted before the project was created. Reconnect and try again."
    }
    pendingProjectCreateEnvelopeId = ""
    readAloud.connectionLostWhilePreparing()
    lastEntitlementFingerprint = ""
    hostOnline = false
    lastRelayPongAt = .distantPast
    lastHostSeenAt = .distantPast
  }

  func forgetPairing() {
    let forgottenComputerId = activeComputerId
    let forgottenComputerName = activeComputerName
    disconnect()
    try? DeviceIdentity.shared.deleteRelayAccessToken(
      accountId: accountId,
      workspaceId: workspaceId,
      hostId: hostId
    )
    pendingPairingRelayToken = ""
    legacyRelayToken = ""
    pairedComputers = PairedComputerRegistry.removing(
      id: forgottenComputerId,
      from: pairedComputers
    )
    PairedComputerRegistry.save(pairedComputers, to: defaults)
    if let nextComputer = pairedComputers.first {
      activateComputer(nextComputer, shouldConnect: true)
      pairingStatus = "Forgot \(forgottenComputerName). Switched to \(nextComputer.displayName)."
      events.insert("Forgot \(forgottenComputerName)", at: 0)
      return
    }
    activeComputerId = ""
    pairedHostId = ""
    pairedAt = ""
    pairedHostPublicKeyPem = ""
    pendingPairingHostPublicKeyPem = ""
    selectedProjectPath = ""
    selectedSessionId = ""
    historyItems = []
    historyStatus = ""
    pendingApprovals = []
    startupWorkspaceReady = true
    workspace = MobileWorkspace(
      id: workspaceId,
      title: "Scratchpad",
      hostId: hostId,
      projects: []
    )
    pairingStatus = "Pairing cleared. Scan a ClawDad computer QR to pair this iPhone again."
    events.insert("Pairing cleared", at: 0)
  }

  func switchComputer(to computerId: String) {
    guard let computer = pairedComputers.first(where: { $0.id == computerId }) else {
      pairingStatus = "That saved computer is no longer available on this iPhone."
      return
    }
    if computer.id == activeComputerId {
      connectIfPaired()
      return
    }
    persistActiveComputerSnapshot()
    activateComputer(computer, shouldConnect: true)
    pairingStatus = "Switching to \(computer.displayName)..."
    events.insert("Switched to \(computer.displayName)", at: 0)
  }

  private func activateComputer(
    _ computer: PairedComputerProfile,
    shouldConnect: Bool
  ) {
    disconnect()
    let activatedComputer = PairedComputerProfile(
      displayName: computer.displayName,
      platform: computer.platform,
      cloudUrl: computer.cloudUrl,
      accountId: computer.accountId,
      workspaceId: computer.workspaceId,
      hostId: computer.hostId,
      hostPublicKeyPem: computer.hostPublicKeyPem,
      pairedAt: computer.pairedAt,
      selectedProjectPath: computer.selectedProjectPath,
      selectedSessionId: computer.selectedSessionId,
      selectedModel: computer.selectedModel,
      selectedReasoningEffort: computer.selectedReasoningEffort,
      capabilities: computer.capabilities,
      lastUsedAt: ISO8601DateFormatter().string(from: Date())
    )
    pairedComputers = PairedComputerRegistry.upserting(
      activatedComputer,
      into: pairedComputers
    )
    PairedComputerRegistry.save(pairedComputers, to: defaults)
    activeComputerId = activatedComputer.id
    cloudUrl = activatedComputer.cloudUrl
    accountId = activatedComputer.accountId
    workspaceId = activatedComputer.workspaceId
    hostId = activatedComputer.hostId
    pairedHostId = activatedComputer.hostId
    pairedAt = activatedComputer.pairedAt
    pairedHostPublicKeyPem = activatedComputer.hostPublicKeyPem
    selectedProjectPath = activatedComputer.selectedProjectPath
    selectedSessionId = activatedComputer.selectedSessionId
    selectedModel = activatedComputer.selectedModel.isEmpty
      ? "gpt-5.6-sol"
      : activatedComputer.selectedModel
    selectedReasoningEffort = activatedComputer.selectedReasoningEffort.isEmpty
      ? "ultra"
      : activatedComputer.selectedReasoningEffort
    historyItems = []
    historyStatus = ""
    pendingApprovals = []
    modelOptions = []
    pairingStatus = ""
    pendingCatalogHistoryLimit = nil
    pendingPairingHostPublicKeyPem = ""
    pendingPairingRelayToken = ""
    pendingPairingHostName = ""
    pendingPairingHostPlatform = ""
    pendingPairingCapabilities = []
    pendingPairingEnvelopeId = ""
    pairingReturnComputerId = ""
    startupWorkspaceReady = false
    workspace = MobileWorkspace(
      id: workspaceId,
      title: "Scratchpad",
      hostId: hostId,
      projects: []
    )
    seq = 0
    connectionRequested = shouldConnect
    if shouldConnect {
      connectIfPaired()
    }
  }

  private func persistActiveComputerSnapshot(markUsed: Bool = false) {
    guard paired, !activeComputerId.isEmpty else {
      return
    }
    let existing = pairedComputers.first { $0.id == activeComputerId }
    let snapshot = PairedComputerProfile(
      displayName: existing?.displayName ?? hostId,
      platform: existing?.platform ?? pairedComputerPlatform("", hostId: hostId),
      cloudUrl: cloudUrl,
      accountId: accountId,
      workspaceId: workspaceId,
      hostId: hostId,
      hostPublicKeyPem: pairedHostPublicKeyPem,
      pairedAt: pairedAt,
      selectedProjectPath: selectedProjectPath,
      selectedSessionId: selectedSessionId,
      selectedModel: selectedModel,
      selectedReasoningEffort: selectedReasoningEffort,
      capabilities: existing?.capabilities ?? [],
      lastUsedAt: markUsed
        ? ISO8601DateFormatter().string(from: Date())
        : (existing?.lastUsedAt ?? pairedAt)
    )
    pairedComputers = PairedComputerRegistry.upserting(
      snapshot,
      into: pairedComputers
    )
    PairedComputerRegistry.save(pairedComputers, to: defaults)
  }

  func selectProject(_ project: ProjectSummary) {
    selectedProjectPath = project.path
    selectedSessionId = project.activeSessionId
    historyItems = []
    historyStatus = "Loading threads for \(project.name)..."
    persistActiveComputerSnapshot()
    requestCatalog()
    requestModels()
  }

  func selectThread(_ thread: MobileThreadSummary, historyLimit: Int = 20) {
    selectedProjectPath = thread.projectPath
    selectedSessionId = thread.sessionId
    historyItems = []
    historyStatus = "Loading \(thread.title)..."
    persistActiveComputerSnapshot()
    events.insert("Opened \(thread.projectName) ...\(thread.sessionId.suffix(5))", at: 0)
    let project = workspace.projects.first { $0.path == thread.projectPath }
    let threadIsTracked: Bool
    if let project {
      let resolvedSessionId = resolveMobileSessionAlias(thread.sessionId, in: project)
      threadIsTracked = project.sessions.contains {
        resolveMobileSessionAlias($0.sessionId, in: project) == resolvedSessionId
      }
    } else {
      threadIsTracked = false
    }
    if threadIsTracked {
      requestHistory(limit: historyLimit)
      requestStatus()
    } else {
      pendingCatalogHistoryLimit = historyLimit
      requestCatalog()
    }
  }

  func requestCatalog() {
    guard paired else {
      pairingStatus = "Pair this iPhone before loading projects."
      return
    }
    guard connected else {
      connectIfPaired()
      return
    }
    Task {
      do {
        var body: [String: JSONValue] = [:]
        let project = selectedProjectPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if !project.isEmpty {
          body["project"] = .string(project)
        }
        try await sendEnvelope(type: "catalog.request", body: body)
      } catch {
        state = .failed(describe(error))
      }
    }
  }

  func requestModels() {
    guard ready else {
      return
    }
    Task {
      do {
        try await sendEnvelope(type: "models.request", body: [
          "project": .string(selectedProjectPath)
        ])
      } catch {
        events.insert("Model catalog failed: \(describe(error))", at: 0)
      }
    }
  }

  func chooseModel(_ model: CodexModelSummary) {
    selectedModel = model.model
    if !model.supportedReasoningEfforts.contains(selectedReasoningEffort) {
      selectedReasoningEffort = model.defaultReasoningEffort
    }
    persistActiveComputerSnapshot()
  }

  func chooseReasoningEffort(_ effort: String) {
    guard supportedReasoningEfforts.contains(effort) else {
      return
    }
    selectedReasoningEffort = effort
    persistActiveComputerSnapshot()
  }

  func createSession(title: String = "") {
    guard ready, !selectedProjectPath.isEmpty, !sessionCreatePending else {
      return
    }
    let normalizedTitle = String(
      title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)
    )
    sessionCreatePending = true
    historyStatus = "Starting a new Codex thread..."
    Task {
      do {
        try await sendEnvelope(type: "session.create.request", body: [
          "project": .string(selectedProjectPath),
          "provider": .string("codex"),
          "model": .string(selectedModel),
          "reasoningEffort": .string(selectedReasoningEffort),
          "title": .string(normalizedTitle)
        ])
      } catch {
        sessionCreatePending = false
        let message = describe(error)
        historyStatus = message
        events.insert("New thread failed: \(message)", at: 0)
      }
    }
  }

  func createProjectDirectory(name: String) {
    let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard ready, !projectCreatePending else {
      projectCreateError = "Reconnect to \(activeComputerName) before creating a project."
      return
    }
    guard mobileProjectDirectoryNameIsValid(normalizedName) else {
      projectCreateError = "Use one visible folder name without slashes or a leading period."
      return
    }

    let requestId = UUID().uuidString.lowercased()
    projectCreatePending = true
    projectCreateStatus = "Creating the project on \(activeComputerName)..."
    projectCreateError = ""
    lastCreatedProjectPath = ""
    pendingProjectCreateEnvelopeId = requestId
    Task {
      do {
        try await sendEnvelope(
          type: "project.create.request",
          body: [
            "requestId": .string(requestId),
            "name": .string(normalizedName)
          ],
          envelopeId: requestId
        )
      } catch {
        guard pendingProjectCreateEnvelopeId == requestId else {
          return
        }
        projectCreatePending = false
        pendingProjectCreateEnvelopeId = ""
        projectCreateStatus = ""
        projectCreateError = describe(error)
      }
    }
  }

  func clearProjectCreateFeedback() {
    guard !projectCreatePending else {
      return
    }
    projectCreateStatus = ""
    projectCreateError = ""
    lastCreatedProjectPath = ""
  }

  func requestHistory(limit: Int = 8) {
    guard paired else {
      historyItems = []
      historyStatus = "Pair this iPhone to load thread history."
      return
    }
    guard connected else {
      historyStatus = "Connect to load thread history."
      return
    }
    guard !selectedProjectPath.isEmpty else {
      historyItems = []
      historyStatus = "Choose a project to load its active thread."
      return
    }
    guard !selectedSessionId.isEmpty else {
      historyItems = []
      historyStatus = "This project does not have an active thread yet."
      return
    }

    historyStatus = "Loading thread..."
    Task {
      do {
        try await sendEnvelope(type: "history.request", body: [
          "project": .string(selectedProjectPath),
          "sessionId": .string(selectedSessionId),
          "cursor": .string("0"),
          "limit": .string(String(limit))
        ])
      } catch {
        self.pendingPairingRelayToken = ""
        let message = describe(error)
        historyStatus = message
        events.insert("Thread history failed: \(message)", at: 0)
      }
    }
  }

  func requestStatus() {
    guard ready, !selectedProjectPath.isEmpty else {
      return
    }
    Task {
      do {
        try await sendEnvelope(type: "status.request", body: [
          "project": .string(selectedProjectPath),
          "sessionId": .string(selectedSessionId)
        ])
      } catch {
        events.insert("Status check failed: \(describe(error))", at: 0)
      }
    }
  }

  func decideApproval(_ approval: MobileApprovalRequest, approve: Bool) {
    guard ready else {
      historyStatus = "Reconnect to \(activeComputerName) before responding to this approval."
      return
    }
    Task {
      do {
        try await sendEnvelope(type: "approval.decision", body: [
          "project": .string(selectedProjectPath),
          "approvalId": .string(approval.approvalId),
          "decision": .string(approve ? "approve" : "decline")
        ])
        pendingApprovals.removeAll { $0.approvalId == approval.approvalId }
        historyStatus = approve ? "Approval sent. Codex is continuing." : "Request declined."
        events.insert(approve ? "Approved Codex action" : "Declined Codex action", at: 0)
        requestStatus()
      } catch {
        let message = describe(error)
        historyStatus = message
        events.insert("Approval response failed: \(message)", at: 0)
        handleConnectionLoss(error)
      }
    }
  }

  func sendMessage(
    _ message: String,
    dispatchMode: String = "direct",
    permissionMode: String = "approve",
    imageAttachments: [MobileImageAttachment] = []
  ) {
    let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty || !imageAttachments.isEmpty else {
      return
    }
    guard paired else {
      pairingStatus = "Pair this iPhone before sending."
      events.insert("Pairing required", at: 0)
      return
    }
    guard connected else {
      pairingStatus = "Connect to \(activeComputerName) before sending."
      events.insert("Connect to host first", at: 0)
      return
    }
    Task {
      do {
        var body: [String: JSONValue] = [
          "project": .string(selectedProjectPath),
          "sessionId": .string(selectedSessionId),
          "message": .string(text),
          "dispatchMode": .string(dispatchMode),
          "permissionMode": .string(permissionMode),
          "model": .string(selectedModel),
          "reasoningEffort": .string(selectedReasoningEffort)
        ]
        if !imageAttachments.isEmpty {
          body["attachments"] = .array(imageAttachments.map { attachment in
            .object([
              "fileName": .string(attachment.fileName),
              "mimeType": .string(attachment.mimeType),
              "size": .number(Double(attachment.data.count)),
              "dataBase64": .string(attachment.data.base64EncodedString())
            ])
          })
        }
        try await sendEnvelope(type: "message.send", body: body)
        let projectName = URL(fileURLWithPath: selectedProjectPath).lastPathComponent
        let threadSuffix = selectedSessionId.isEmpty ? "new thread" : "...\(selectedSessionId.suffix(5))"
        let attachmentNote = imageAttachments.isEmpty ? "" : " with \(imageAttachments.count) image\(imageAttachments.count == 1 ? "" : "s")"
        events.insert("Sent to \(projectName) \(threadSuffix)\(attachmentNote)", at: 0)
        historyStatus = "Message sent. Waiting for desktop history..."
        requestHistory()
      } catch {
        state = .failed(describe(error))
      }
    }
  }

  func transcribeVoice(
    _ data: Data,
    fileName: String = "clawdad-voice.m4a",
    mimeType: String = "audio/mp4",
    duration: TimeInterval = 0
  ) {
    guard ready else {
      voiceTranscriptionError = "ClawDad must be connected before voice transcription."
      return
    }
    guard !voiceTranscriptionPending else {
      return
    }
    guard !data.isEmpty else {
      voiceTranscriptionError = "The recording did not contain any audio."
      return
    }
    guard data.count <= 12 * 1024 * 1024 else {
      voiceTranscriptionError = "The recording is too large. Keep voice notes under 12 MB."
      return
    }

    let requestId = UUID().uuidString.lowercased()
    let envelopeId = UUID().uuidString.lowercased()
    pendingVoiceRequestId = requestId
    pendingVoiceEnvelopeId = envelopeId
    voiceTranscription = nil
    voiceTranscriptionError = ""
    voiceTranscriptionPending = true
    voiceTranscriptionStatus = "Uploading recording..."
    startVoiceTranscriptionTimeout(requestId: requestId, duration: duration)

    Task {
      do {
        try await sendEnvelope(
          type: "speech.transcribe.request",
          body: [
            "requestId": .string(requestId),
            "project": .string(selectedProjectPath),
            "fileName": .string(fileName),
            "mimeType": .string(mimeType),
            "size": .number(Double(data.count)),
            "dataBase64": .string(data.base64EncodedString())
          ],
          envelopeId: envelopeId
        )
        if voiceTranscriptionPending, pendingVoiceRequestId == requestId {
          voiceTranscriptionStatus = "Waiting for \(activeComputerName)..."
        }
        events.insert("Voice note sent for transcription", at: 0)
      } catch {
        finishVoiceTranscription(error: describe(error))
      }
    }
  }

  func toggleReadAloud(
    item: MobileHistoryItem,
    projectPath: String,
    sessionId: String,
    kind: MobileReadAloudKind,
    text: String
  ) {
    let spokenText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let key = mobileReadAloudKey(item: item, kind: kind, text: spokenText)
    switch readAloud.phase(for: key) {
    case .playing:
      readAloud.pause()
      return
    case .paused:
      readAloud.resume()
      return
    case .preparing:
      return
    case .idle, .failed:
      break
    }

    guard !spokenText.isEmpty else {
      readAloud.showFailure(key: key, message: "There is no text available to read aloud yet.")
      return
    }
    guard ready else {
      readAloud.showFailure(
        key: key,
        message: "Reconnect to \(activeComputerName) before using Read Aloud."
      )
      return
    }

    let audioRequestId = UUID().uuidString.lowercased()
    let envelopeId = UUID().uuidString.lowercased()
    readAloud.begin(key: key, requestId: audioRequestId, envelopeId: envelopeId)
    Task {
      do {
        try await sendEnvelope(
          type: "speech.synthesize.request",
          body: [
            "requestId": .string(audioRequestId),
            "project": .string(projectPath),
            "sessionId": .string(sessionId),
            "historyRequestId": .string(item.requestId),
            "kind": .string(kind.rawValue),
            "text": .string(spokenText),
            "executionPreference": .string("paired-mac-first"),
            "allowRemoteFallback": .bool(allowUmbraReadAloudFallback)
          ],
          envelopeId: envelopeId
        )
        events.insert("Requested \(kind.accessibilitySubject) audio from \(activeComputerName)", at: 0)
      } catch {
        readAloud.failIfMatchingEnvelope(envelopeId, message: describe(error))
      }
    }
  }

  func pairWithScannedCode(_ text: String) {
    Task {
      do {
        let payload = try parsePairingPayload(text)
        try await pair(with: payload)
      } catch {
        let message = describe(error)
        restoreComputerAfterPairingFailureIfNeeded()
        pairingStatus = message
        events.insert("Pairing failed: \(message)", at: 0)
      }
    }
  }

  func setRemoteAssistEnvelopeHandler(_ handler: ((CloudEnvelope) -> Void)?) {
    remoteAssistEnvelopeHandler = handler
  }

  func syncEntitlement(
    _ entitlement: ClawDadEntitlementSnapshot?,
    foundingBetaAccess: Bool
  ) {
    guard ready else {
      return
    }
    let formatter = ISO8601DateFormatter()
    let productId = entitlement?.productId ?? ""
    let transactionId = entitlement?.transactionId ?? ""
    let expiresAt = entitlement?.expiresAt.map(formatter.string) ?? ""
    let revokedAt = entitlement?.revokedAt.map(formatter.string) ?? ""
    let active = foundingBetaAccess || entitlement?.active == true
    let fingerprint = [
      productId,
      transactionId,
      expiresAt,
      revokedAt,
      active ? "active" : "inactive",
      foundingBetaAccess ? "founding-beta" : "storekit"
    ].joined(separator: "|")
    guard fingerprint != lastEntitlementFingerprint else {
      return
    }
    lastEntitlementFingerprint = fingerprint

    Task {
      do {
        try await sendEnvelope(type: "entitlement.sync", body: [
          "active": .bool(active),
          "source": .string(
            foundingBetaAccess ? "founding-beta" : "storekit-2"
          ),
          "productId": .string(productId),
          "transactionId": .string(transactionId),
          "originalTransactionId": .string(
            entitlement?.originalTransactionId ?? ""
          ),
          "purchasedAt": .string(
            entitlement?.purchasedAt.map(formatter.string) ?? ""
          ),
          "expiresAt": .string(expiresAt),
          "revokedAt": .string(revokedAt),
          "introductoryOffer": .bool(
            entitlement?.isInIntroductoryOffer ?? false
          ),
          "environment": .string(entitlement?.environment ?? ""),
          "signedTransaction": .string(
            entitlement?.signedTransaction ?? ""
          ),
          "observedAt": .string(
            formatter.string(from: entitlement?.observedAt ?? Date())
          )
        ])
      } catch {
        lastEntitlementFingerprint = ""
        events.insert("Subscription sync will retry after reconnect", at: 0)
      }
    }
  }

  @discardableResult
  func sendRemoteAssistEnvelope(
    type: String,
    body: [String: JSONValue]
  ) async throws -> String {
    guard type.hasPrefix("remote.assist.") else {
      throw URLError(.unsupportedURL)
    }
    guard remoteAssistIdentityReady else {
      throw RemoteAssistCloudError.authenticationRequired
    }
    guard ready else {
      throw RemoteAssistCloudError.connectionUnavailable
    }
    let envelopeId = UUID().uuidString.lowercased()
    try await sendEnvelope(type: type, body: body, envelopeId: envelopeId)
    return envelopeId
  }

  private func parsePairingPayload(_ text: String) throws -> PairingPayload {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let data = trimmed.data(using: .utf8) else {
      throw PairingError.invalidCode
    }
    let payload: PairingPayload
    do {
      payload = try JSONDecoder().decode(PairingPayload.self, from: data)
    } catch {
      throw PairingError.invalidCode
    }
    guard payload.type == "clawdad.pair.v1" else {
      throw PairingError.wrongCode
    }
    guard
      !payload.cloudUrl.isEmpty,
      !payload.accountId.isEmpty,
      !payload.workspaceId.isEmpty,
      !payload.hostId.isEmpty,
      !payload.token.isEmpty,
      let expiresAt = parseCloudDate(payload.expiresAt)
    else {
      throw PairingError.invalidCode
    }
    guard expiresAt > Date() else {
      throw PairingError.expiredCode
    }
    return payload
  }

  private func pair(with payload: PairingPayload) async throws {
    persistActiveComputerSnapshot()
    pairingReturnComputerId = activeComputerId
    disconnect()
    connectionRequested = true
    cloudUrl = payload.cloudUrl
    accountId = payload.accountId
    workspaceId = payload.workspaceId
    hostId = payload.hostId
    pendingPairingHostPublicKeyPem = payload.hostPublicKeyPem ?? ""
    pendingPairingRelayToken = payload.token
    pendingPairingHostName = payload.hostName ?? ""
    pendingPairingHostPlatform = payload.hostPlatform ?? ""
    pendingPairingCapabilities = payload.capabilities ?? []
    pendingPairingEnvelopeId = UUID().uuidString.lowercased()
    if let existing = pairedComputers.first(where: {
      $0.id == pairedComputerIdentifier(
        accountId: payload.accountId,
        workspaceId: payload.workspaceId,
        hostId: payload.hostId
      )
    }) {
      selectedProjectPath = existing.selectedProjectPath
      selectedSessionId = existing.selectedSessionId
      selectedModel = existing.selectedModel
      selectedReasoningEffort = existing.selectedReasoningEffort
    } else {
      selectedProjectPath = ""
      selectedSessionId = ""
    }
    historyItems = []
    historyStatus = ""
    pendingApprovals = []
    modelOptions = []
    startupWorkspaceReady = false
    workspace = MobileWorkspace(
      id: payload.workspaceId,
      title: "Scratchpad",
      hostId: payload.hostId,
      projects: []
    )
    pairingStatus = "Connecting to ClawDad..."
    try await connectAsync()
    pairingStatus = "Trusting this iPhone..."
    try await sendEnvelope(
      type: "pair.request",
      body: [
        "token": .string(payload.token),
        "publicKeyPem": .string(try DeviceIdentity.shared.publicKeyExport()),
        "keyId": .string(try DeviceIdentity.shared.publicKeyId()),
        "deviceName": .string(deviceName()),
        "platform": .string("ios")
      ],
      envelopeId: pendingPairingEnvelopeId
    )
  }

  private func restoreComputerAfterPairingFailureIfNeeded() {
    let returnId = pairingReturnComputerId
    pendingPairingHostPublicKeyPem = ""
    pendingPairingRelayToken = ""
    pendingPairingHostName = ""
    pendingPairingHostPlatform = ""
    pendingPairingCapabilities = []
    pendingPairingEnvelopeId = ""
    pairingReturnComputerId = ""
    guard !returnId.isEmpty,
          let computer = pairedComputers.first(where: { $0.id == returnId }) else {
      return
    }
    activateComputer(computer, shouldConnect: true)
  }

  private func deviceName() -> String {
    #if canImport(UIKit)
    return UIDevice.current.name
    #else
    return "ClawDad device"
    #endif
  }

  private func relayAccessToken() throws -> String {
    if !pendingPairingRelayToken.isEmpty {
      return pendingPairingRelayToken
    }
    let stored = try DeviceIdentity.shared.relayAccessToken(
      accountId: accountId,
      workspaceId: workspaceId,
      hostId: hostId
    )
    if !stored.isEmpty {
      return stored
    }
    if !legacyRelayToken.isEmpty {
      try DeviceIdentity.shared.saveRelayAccessToken(
        legacyRelayToken,
        accountId: accountId,
        workspaceId: workspaceId,
        hostId: hostId
      )
      let migrated = legacyRelayToken
      legacyRelayToken = ""
      return migrated
    }
    return ""
  }

  private func connectAsync() async throws {
    reconnectTask = nil
    resetSocket()
    state = .connecting
    let deviceId = try DeviceIdentity.shared.deviceId()
    var request = URLRequest(url: try realtimeURL(deviceId: deviceId))
    let accessToken = try relayAccessToken()
    if !accessToken.isEmpty {
      request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    }
    let socket = URLSession.shared.webSocketTask(with: request)
    socket.maximumMessageSize = 32 * 1024 * 1024
    task = socket
    socket.resume()
    lastRelayPongAt = Date()
    receiveTask = Task { [weak self, weak socket] in
      guard let self, let socket else {
        return
      }
      do {
        try await self.receiveLoop(socket)
      } catch {
        if self.task === socket {
          if self.voiceTranscriptionPending {
            self.finishVoiceTranscription(
              error: "The connection dropped before your transcript returned. Reconnect and try again."
            )
          }
          self.handleConnectionLoss(error)
        }
      }
    }
    try await sendEnvelope(type: "ping", body: [
      "platform": .string("ios"),
      "sentAt": .string(ISO8601DateFormatter().string(from: Date()))
    ])
    state = .connected
    reconnectAttempt = 0
    reconnecting = false
    workspace = MobileWorkspace(
      id: workspaceId,
      title: "Scratchpad",
      hostId: hostId,
      projects: workspace.projects,
      recentThreads: workspace.recentThreads
    )
    events.insert("Cloud relay connected", at: 0)
    startActivityMonitor()
  }

  private func startActivityMonitor() {
    monitorTask?.cancel()
    monitorTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 5_000_000_000)
        guard let self else {
          return
        }
        guard self.connected else {
          self.scheduleReconnect()
          return
        }
        let now = Date()
        if self.lastRelayPongAt != .distantPast,
           now.timeIntervalSince(self.lastRelayPongAt) > 35 {
          self.handleConnectionLoss(URLError(.networkConnectionLost))
          return
        }
        if self.lastHostSeenAt != .distantPast,
           now.timeIntervalSince(self.lastHostSeenAt) > 40 {
          self.hostOnline = false
        }
        self.pingHost()
        if self.ready {
          self.requestStatus()
        }
      }
    }
  }

  private func pingHost() {
    guard connected else {
      return
    }
    Task {
      do {
        try await sendEnvelope(type: "ping", body: [
          "platform": .string("ios"),
          "sentAt": .string(ISO8601DateFormatter().string(from: Date()))
        ])
      } catch {
        handleConnectionLoss(error)
      }
    }
  }

  private func handleConnectionLoss(_ error: Error) {
    guard connectionRequested, paired else {
      resetSocket()
      state = .disconnected
      reconnecting = false
      return
    }
    let message = describe(error)
    resetSocket()
    state = .connecting
    reconnecting = true
    historyStatus = "Secure connection interrupted. Reconnecting to \(activeComputerName) automatically..."
    events.insert("Connection interrupted: \(message)", at: 0)
    scheduleReconnect()
  }

  private func scheduleReconnect() {
    guard connectionRequested, paired, reconnectTask == nil else {
      return
    }
    reconnectAttempt += 1
    let delaySeconds = min(30.0, pow(2.0, Double(min(reconnectAttempt - 1, 5))))
    reconnectTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(delaySeconds * 1_000_000_000))
      guard !Task.isCancelled, let self, self.connectionRequested, self.paired else {
        return
      }
      self.reconnectTask = nil
      do {
        try await self.connectAsync()
      } catch {
        self.handleConnectionLoss(error)
      }
    }
  }

  private func realtimeURL(deviceId: String) throws -> URL {
    guard var components = URLComponents(string: cloudUrl) else {
      throw URLError(.badURL)
    }
    components.scheme = components.scheme == "https" ? "wss" : "ws"
    components.path = "/workspaces/\(workspaceId)/realtime"
    components.queryItems = [
      URLQueryItem(name: "deviceId", value: deviceId),
      URLQueryItem(name: "accountId", value: accountId)
    ]
    guard let url = components.url else {
      throw URLError(.badURL)
    }
    return url
  }

  private func receiveLoop(_ socket: URLSessionWebSocketTask) async throws {
    while task === socket {
      let message = try await socket.receive()
      switch message {
      case .string(let text):
        try handleIncomingText(text)
      case .data(let data):
        if let text = String(data: data, encoding: .utf8) {
          try handleIncomingText(text)
        }
      @unknown default:
        break
      }
    }
  }

  private func handleIncomingText(_ text: String) throws {
    let data = Data(text.utf8)
    if let envelope = try? JSONDecoder().decode(CloudEnvelope.self, from: data) {
      apply(envelope)
      return
    }
    events.insert(text, at: 0)
  }

  private func apply(_ envelope: CloudEnvelope) {
    switch envelope.type {
    case "catalog.snapshot":
      let projects = parseProjects(envelope.body["projects"])
      let parsedRecentThreads = parseRecentThreadSummaries(
        envelope.body["recentThreads"],
        projects: projects
      )
      let recentThreads = parsedRecentThreads.isEmpty
        ? mobileRecentThreads(in: projects)
        : Array(mobileThreadsByRecentActivity(parsedRecentThreads).prefix(20))
      let nextWorkspace = MobileWorkspace(
        id: workspaceId,
        title: "Scratchpad",
        hostId: hostId,
        projects: projects,
        recentThreads: recentThreads
      )
      let catalogChanged = workspace != nextWorkspace
      if catalogChanged {
        workspace = nextWorkspace
      }
      if selectedProjectPath.isEmpty, let first = projects.first {
        selectedProjectPath = first.path
        selectedSessionId = first.activeSessionId
      } else if let selected = projects.first(where: { $0.path == selectedProjectPath }) {
        let resolvedSessionId = resolveMobileSessionAlias(selectedSessionId, in: selected)
        let sessionStillAvailable = selected.sessions.contains { $0.sessionId == resolvedSessionId }
        if sessionStillAvailable {
          selectedSessionId = resolvedSessionId
        } else {
          selectedSessionId = selected.activeSessionId
        }
      } else if let first = projects.first {
        selectedProjectPath = first.path
        selectedSessionId = first.activeSessionId
      }
      startupWorkspaceReady = true
      persistActiveComputerSnapshot()
      if catalogChanged {
        events.insert("Updated project catalog", at: 0)
      }
      let historyLimit = pendingCatalogHistoryLimit ?? 8
      pendingCatalogHistoryLimit = nil
      requestHistory(limit: historyLimit)
      requestStatus()
      requestModels()
    case "models.snapshot":
      applyModelsSnapshot(envelope)
    case "project.created":
      guard verifyPairedHostEnvelope(envelope) else {
        projectCreatePending = false
        projectCreateStatus = ""
        projectCreateError = "ClawDad ignored an unauthenticated project response."
        events.insert("Ignored an unauthenticated project response", at: 0)
        return
      }
      let requestId = envelope.body["requestId"]?.stringValue ?? ""
      guard !requestId.isEmpty, requestId == pendingProjectCreateEnvelopeId else {
        events.insert("Ignored a project response for an older request", at: 0)
        return
      }
      let projectPath = envelope.body["projectPath"]?.stringValue ?? ""
      let sessionId = envelope.body["sessionId"]?.stringValue ?? ""
      guard !projectPath.isEmpty else {
        projectCreatePending = false
        pendingProjectCreateEnvelopeId = ""
        projectCreateStatus = ""
        projectCreateError = "\(activeComputerName) did not return the new project path."
        return
      }
      projectCreatePending = false
      pendingProjectCreateEnvelopeId = ""
      projectCreateStatus = "Project created."
      projectCreateError = ""
      lastCreatedProjectPath = projectPath
      selectedProjectPath = projectPath
      selectedSessionId = sessionId
      persistActiveComputerSnapshot()
      historyItems = []
      historyStatus = "New project ready."
      events.insert("Created project \(URL(fileURLWithPath: projectPath).lastPathComponent)", at: 0)
      requestCatalog()
    case "session.created":
      sessionCreatePending = false
      let sessionId = envelope.body["sessionId"]?.stringValue ?? ""
      if !sessionId.isEmpty {
        selectedSessionId = sessionId
      }
      persistActiveComputerSnapshot()
      historyItems = []
      historyStatus = "New Codex thread ready."
      events.insert("Started new thread ...\(sessionId.suffix(5))", at: 0)
      requestCatalog()
    case "history.page":
      let pageSessionId = envelope.body["sessionId"]?.stringValue ?? ""
      let requestedSessionId = envelope.body["requestedSessionId"]?.stringValue ?? ""
      let matchesSelection = selectedSessionId.isEmpty ||
        pageSessionId == selectedSessionId ||
        requestedSessionId == selectedSessionId
      guard matchesSelection else {
        events.insert("Ignored history from a previously selected thread", at: 0)
        return
      }
      if !pageSessionId.isEmpty {
        selectedSessionId = pageSessionId
      }
      persistActiveComputerSnapshot()
      historyItems = parseHistoryItems(envelope.body["items"])
      historyStatus = historyItems.isEmpty ? "No mirrored messages yet." : "Thread loaded"
    case "status.snapshot":
      applyStatusSnapshot(envelope)
    case "host.ready", "host.heartbeat":
      if envelope.sourceDeviceId == hostId {
        updateActiveComputerMetadata(from: envelope)
        let firstHostSignal = !hostOnline
        hostOnline = true
        lastHostSeenAt = Date()
        if firstHostSignal || workspace.projects.isEmpty {
          requestCatalog()
        }
      }
    case "speech.transcribe.accepted":
      applyVoiceTranscriptionAccepted(envelope)
    case "speech.transcription":
      applyVoiceTranscription(envelope)
    case "speech.synthesize.accepted":
      guard verifyPairedHostEnvelope(envelope) else {
        events.insert("Ignored an unauthenticated Read Aloud response", at: 0)
        return
      }
      readAloud.markAccepted(
        requestId: envelope.body["requestId"]?.stringValue ?? ""
      )
    case "speech.synthesis.chunk":
      guard verifyPairedHostEnvelope(envelope) else {
        events.insert("Ignored unauthenticated Read Aloud audio", at: 0)
        return
      }
      readAloud.receiveChunk(
        requestId: envelope.body["requestId"]?.stringValue ?? "",
        partIndex: Int(envelope.body["partIndex"]?.numberValue ?? -1),
        partCount: Int(envelope.body["partCount"]?.numberValue ?? 0),
        chunkIndex: Int(envelope.body["chunkIndex"]?.numberValue ?? -1),
        chunkCount: Int(envelope.body["chunkCount"]?.numberValue ?? 0),
        fileName: envelope.body["fileName"]?.stringValue ?? "",
        mimeType: envelope.body["mimeType"]?.stringValue ?? "audio/wav",
        declaredBytes: Int(envelope.body["bytes"]?.numberValue ?? 0),
        dataBase64: envelope.body["dataBase64"]?.stringValue ?? ""
      )
    case "speech.synthesis.complete":
      guard verifyPairedHostEnvelope(envelope) else {
        events.insert("Ignored an unauthenticated Read Aloud completion", at: 0)
        return
      }
      readAloud.complete(
        requestId: envelope.body["requestId"]?.stringValue ?? "",
        partCount: Int(envelope.body["partCount"]?.numberValue ?? 0)
      )
    case "message.accepted":
      let requestId = envelope.body["requestId"]?.stringValue ?? envelope.body["queueId"]?.stringValue ?? ""
      let acceptedSessionId = envelope.body["sessionId"]?.stringValue ?? ""
      let requestState = (envelope.body["requestState"]?.stringValue ?? "").lowercased()
      let queued = envelope.body["queued"]?.boolValue ?? (requestState == "queued")
      let direct = envelope.body["direct"]?.boolValue
        ?? envelope.body["interjected"]?.boolValue
        ?? (requestState == "direct")
      if !acceptedSessionId.isEmpty {
        selectedSessionId = acceptedSessionId
        persistActiveComputerSnapshot()
      }
      let suffix = requestId.isEmpty ? "" : " ...\(requestId.suffix(5))"
      if queued {
        historyStatus = "Queued for after the current response\(suffix)."
        events.insert("Queued message\(suffix)", at: 0)
      } else if direct {
        historyStatus = "Sent directly to the active turn\(suffix)."
        events.insert("Sent Direct message\(suffix)", at: 0)
      } else {
        historyStatus = "Direct message started\(suffix). Loading thread..."
        events.insert("Started Direct message\(suffix)", at: 0)
      }
      requestCatalog()
      requestHistory()
    case "pair.accepted":
      let acceptedPairingEnvelopeId = envelope.body["inReplyTo"]?.stringValue ?? ""
      guard !pendingPairingEnvelopeId.isEmpty,
            acceptedPairingEnvelopeId.isEmpty ||
              acceptedPairingEnvelopeId == pendingPairingEnvelopeId,
            !pendingPairingHostPublicKeyPem.isEmpty,
            verifyHostEnvelope(
              envelope,
              publicKeyPem: pendingPairingHostPublicKeyPem
            ) else {
        let message = "ClawDad ignored an unauthenticated pairing response. Generate a fresh pairing code and try again."
        restoreComputerAfterPairingFailureIfNeeded()
        pairingStatus = message
        events.insert("Pairing failed: host identity could not be verified", at: 0)
        return
      }
      let relayAccessToken = envelope.body["relayAccessToken"]?.stringValue ?? ""
      if !relayAccessToken.isEmpty {
        do {
          try DeviceIdentity.shared.saveRelayAccessToken(
            relayAccessToken,
            accountId: accountId,
            workspaceId: workspaceId,
            hostId: hostId
          )
        } catch {
          pendingPairingRelayToken = ""
          let message = "Pairing could not protect this device credential in Keychain."
          events.insert("Pairing failed: Keychain could not save access", at: 0)
          disconnect()
          restoreComputerAfterPairingFailureIfNeeded()
          pairingStatus = message
          return
        }
      }
      pendingPairingRelayToken = ""
      pairedHostId = hostId
      pairedAt = envelope.body["trustedAt"]?.stringValue ?? ISO8601DateFormatter().string(from: Date())
      let acceptedHostKey = envelope.body["hostPublicKeyPem"]?.stringValue ?? ""
      guard acceptedHostKey.isEmpty || hostPublicKeysMatch(
        acceptedHostKey,
        pendingPairingHostPublicKeyPem
      ) else {
        let message = "ClawDad ignored a pairing response whose computer identity changed. Generate a fresh pairing code and try again."
        restoreComputerAfterPairingFailureIfNeeded()
        pairingStatus = message
        events.insert("Pairing failed: host identity changed", at: 0)
        return
      }
      pairedHostPublicKeyPem = acceptedHostKey.isEmpty
        ? pendingPairingHostPublicKeyPem
        : acceptedHostKey
      let acceptedHostName = envelope.body["hostName"]?.stringValue ?? ""
      let acceptedHostPlatform = envelope.body["hostPlatform"]?.stringValue ?? ""
      let acceptedCapabilities: [String]
      if case .array(let values) = envelope.body["capabilities"] {
        acceptedCapabilities = values.map(\.stringValue)
      } else {
        acceptedCapabilities = []
      }
      let computer = PairedComputerProfile(
        displayName: acceptedHostName.isEmpty
          ? pendingPairingHostName
          : acceptedHostName,
        platform: acceptedHostPlatform.isEmpty
          ? pendingPairingHostPlatform
          : acceptedHostPlatform,
        cloudUrl: cloudUrl,
        accountId: accountId,
        workspaceId: workspaceId,
        hostId: hostId,
        hostPublicKeyPem: pairedHostPublicKeyPem,
        pairedAt: pairedAt,
        selectedProjectPath: selectedProjectPath,
        selectedSessionId: selectedSessionId,
        selectedModel: selectedModel,
        selectedReasoningEffort: selectedReasoningEffort,
        capabilities: acceptedCapabilities.isEmpty
          ? pendingPairingCapabilities
          : acceptedCapabilities,
        lastUsedAt: ISO8601DateFormatter().string(from: Date())
      )
      pairedComputers = PairedComputerRegistry.upserting(
        computer,
        into: pairedComputers
      )
      PairedComputerRegistry.save(pairedComputers, to: defaults)
      activeComputerId = computer.id
      pendingPairingHostPublicKeyPem = ""
      pendingPairingHostName = ""
      pendingPairingHostPlatform = ""
      pendingPairingCapabilities = []
      pendingPairingEnvelopeId = ""
      pairingReturnComputerId = ""
      pairingStatus = "iPhone paired with \(computer.displayName)"
      events.insert("iPhone paired with \(computer.displayName)", at: 0)
      requestCatalog()
    case "entitlement.accepted":
      events.insert("Subscription access synced to \(activeComputerName)", at: 0)
    case "remote.assist.available",
         "remote.assist.offer",
         "remote.assist.ice",
         "remote.assist.stop",
         "remote.assist.error":
      guard verifyPairedHostEnvelope(envelope) else {
        events.insert("Ignored an unauthenticated Remote Assist response", at: 0)
        return
      }
      remoteAssistEnvelopeHandler?(envelope)
    case "error":
      sessionCreatePending = false
      let message = envelope.body["error"]?.stringValue ?? "Cloud error"
      let inReplyTo = envelope.body["inReplyTo"]?.stringValue ?? ""
      let code = envelope.body["code"]?.stringValue ?? ""
      if !pendingPairingEnvelopeId.isEmpty,
         inReplyTo == pendingPairingEnvelopeId {
        restoreComputerAfterPairingFailureIfNeeded()
        pairingStatus = message
        events.insert("Pairing failed: \(message)", at: 0)
        return
      }
      if projectCreatePending,
         !pendingProjectCreateEnvelopeId.isEmpty,
         inReplyTo == pendingProjectCreateEnvelopeId {
        projectCreatePending = false
        pendingProjectCreateEnvelopeId = ""
        projectCreateStatus = ""
        projectCreateError = message
        events.insert("Project creation failed: \(message)", at: 0)
        return
      }
      if readAloud.failIfMatchingEnvelope(inReplyTo, message: message) {
        events.insert("Read Aloud failed: \(message)", at: 0)
        return
      }
      if code == "host_unavailable" {
        hostOnline = false
        lastHostSeenAt = .distantPast
        historyStatus = "\(activeComputerName) is offline. ClawDad will reconnect automatically."
        events.insert("\(activeComputerName) unavailable", at: 0)
        return
      }
      if voiceTranscriptionPending,
         !pendingVoiceEnvelopeId.isEmpty,
         inReplyTo == pendingVoiceEnvelopeId {
        finishVoiceTranscription(error: message)
        return
      }
      historyStatus = message
      events.insert(message, at: 0)
    case "pong":
      if envelope.sourceDeviceId == "cloud-relay" {
        let firstRelayPong = lastRelayPongAt == .distantPast
        lastRelayPongAt = Date()
        if firstRelayPong {
          events.insert("Cloud relay online", at: 0)
        }
        if case .array(let hostValues) = envelope.body["availableHostIds"] {
          let hostAvailable = hostValues.contains(where: { $0.stringValue == hostId })
          let firstHostSignal = hostAvailable && !hostOnline
          hostOnline = hostAvailable
          if hostAvailable {
            lastHostSeenAt = Date()
            if firstHostSignal {
              requestCatalog()
            }
          } else {
            lastHostSeenAt = .distantPast
          }
        }
      } else if envelope.sourceDeviceId == hostId {
        let firstHostPong = !hostOnline
        hostOnline = true
        lastHostSeenAt = Date()
        if firstHostPong {
          events.insert("\(activeComputerName) online", at: 0)
          requestCatalog()
        }
      }
    default:
      events.insert(envelope.type, at: 0)
    }
  }

  private func applyVoiceTranscription(_ envelope: CloudEnvelope) {
    let requestId = envelope.body["requestId"]?.stringValue ?? ""
    guard voiceTranscriptionPending,
          !requestId.isEmpty,
          requestId == pendingVoiceRequestId else {
      return
    }
    let text = (envelope.body["text"]?.stringValue ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else {
      finishVoiceTranscription(error: "ClawDad could not hear any speech in that recording.")
      return
    }
    voiceTranscriptionTimeoutTask?.cancel()
    voiceTranscriptionTimeoutTask = nil
    voiceTranscriptionPending = false
    voiceTranscriptionStatus = ""
    pendingVoiceRequestId = ""
    pendingVoiceEnvelopeId = ""
    voiceTranscriptionError = ""
    voiceTranscription = MobileVoiceTranscription(id: requestId, text: text)
    events.insert("Voice transcription ready", at: 0)
  }

  private func applyVoiceTranscriptionAccepted(_ envelope: CloudEnvelope) {
    let requestId = envelope.body["requestId"]?.stringValue ?? ""
    guard voiceTranscriptionPending,
          !requestId.isEmpty,
          requestId == pendingVoiceRequestId else {
      return
    }
    voiceTranscriptionStatus = "Transcribing on \(activeComputerName)..."
    events.insert("\(activeComputerName) accepted voice transcription", at: 0)
  }

  private func finishVoiceTranscription(error: String) {
    voiceTranscriptionTimeoutTask?.cancel()
    voiceTranscriptionTimeoutTask = nil
    voiceTranscriptionPending = false
    voiceTranscriptionStatus = ""
    pendingVoiceRequestId = ""
    pendingVoiceEnvelopeId = ""
    voiceTranscriptionError = error
    events.insert("Voice transcription failed: \(error)", at: 0)
  }

  private func startVoiceTranscriptionTimeout(requestId: String, duration: TimeInterval) {
    voiceTranscriptionTimeoutTask?.cancel()
    let timeoutSeconds = min(600, max(60, duration * 3 + 30))
    voiceTranscriptionTimeoutTask = Task { [weak self] in
      try? await Task.sleep(
        nanoseconds: UInt64(timeoutSeconds * 1_000_000_000)
      )
      guard !Task.isCancelled,
            let self,
            self.voiceTranscriptionPending,
            self.pendingVoiceRequestId == requestId else {
        return
      }
      self.finishVoiceTranscription(
        error: "The transcript did not return. Confirm ClawDad is running on \(self.activeComputerName), then try again."
      )
    }
  }

  private func applyModelsSnapshot(_ envelope: CloudEnvelope) {
    let models = parseModels(envelope.body["models"])
    guard !models.isEmpty else {
      return
    }
    if modelOptions != models {
      modelOptions = models
    }
    let configuredModel = envelope.body["configuredModel"]?.stringValue ?? ""
    let configuredEffort = envelope.body["configuredReasoningEffort"]?.stringValue ?? ""
    if !models.contains(where: { $0.model == selectedModel }) {
      selectedModel = models.contains(where: { $0.model == configuredModel })
        ? configuredModel
        : models[0].model
    }
    guard let selected = models.first(where: { $0.model == selectedModel }) else {
      return
    }
    if !selected.supportedReasoningEfforts.contains(selectedReasoningEffort) {
      selectedReasoningEffort = selected.model == configuredModel && selected.supportedReasoningEfforts.contains(configuredEffort)
        ? configuredEffort
        : selected.defaultReasoningEffort
    }
    persistActiveComputerSnapshot()
  }

  private func updateActiveComputerMetadata(from envelope: CloudEnvelope) {
    guard envelope.sourceDeviceId == hostId,
          paired,
          let existing = activeComputer else {
      return
    }
    let hostName = envelope.body["hostName"]?.stringValue ?? ""
    let hostPlatform = envelope.body["hostPlatform"]?.stringValue ?? ""
    let capabilities: [String]
    if case .array(let values) = envelope.body["capabilities"] {
      capabilities = values.map(\.stringValue)
    } else {
      capabilities = []
    }
    guard !hostName.isEmpty || !hostPlatform.isEmpty || !capabilities.isEmpty else {
      return
    }
    let updated = PairedComputerProfile(
      displayName: hostName.isEmpty ? existing.displayName : hostName,
      platform: hostPlatform.isEmpty ? existing.platform : hostPlatform,
      cloudUrl: existing.cloudUrl,
      accountId: existing.accountId,
      workspaceId: existing.workspaceId,
      hostId: existing.hostId,
      hostPublicKeyPem: existing.hostPublicKeyPem,
      pairedAt: existing.pairedAt,
      selectedProjectPath: selectedProjectPath,
      selectedSessionId: selectedSessionId,
      selectedModel: selectedModel,
      selectedReasoningEffort: selectedReasoningEffort,
      capabilities: capabilities.isEmpty ? existing.capabilities : capabilities,
      lastUsedAt: existing.lastUsedAt
    )
    guard updated != existing else {
      return
    }
    pairedComputers = PairedComputerRegistry.upserting(
      updated,
      into: pairedComputers
    )
    PairedComputerRegistry.save(pairedComputers, to: defaults)
  }

  private func applyStatusSnapshot(_ envelope: CloudEnvelope) {
    pendingApprovals = parsePendingApprovals(envelope.body["pendingApprovals"])
    guard let mailboxValue = envelope.body["mailboxStatus"],
          case .object(let mailboxStatus) = mailboxValue else {
      return
    }
    let lifecycle = mailboxStatus["state"]?.stringValue.lowercased() ?? "idle"
    let requestId = mailboxStatus["request_id"]?.stringValue ?? mailboxStatus["requestId"]?.stringValue ?? ""
    let terminalObservation = "\(requestId)::\(lifecycle)"
    if (lifecycle == "completed" || lifecycle == "failed"),
       !requestId.isEmpty,
       terminalObservation == lastObservedTerminalRequest {
      return
    }
    let nextStatus: String
    let phase = mailboxStatus["phase"]?.stringValue.lowercased() ?? ""
    if phase == "awaiting_approval", let approval = pendingApprovals.first {
      let nextStatus = "\(approval.title). Review it below so Codex can continue."
      if historyStatus != nextStatus {
        historyStatus = nextStatus
      }
      return
    }
    switch lifecycle {
    case "running", "dispatched", "starting":
      nextStatus = "Codex is working. ClawDad is monitoring the turn."
    case "queued":
      nextStatus = "Message queued for after the current response."
    case "completed":
      nextStatus = "Response complete."
      refreshTerminalRequestOnce(requestId: requestId, lifecycle: lifecycle)
    case "failed":
      nextStatus = "The last turn failed. This thread is ready for another message."
      refreshTerminalRequestOnce(requestId: requestId, lifecycle: lifecycle)
    default:
      return
    }
    if historyStatus != nextStatus {
      historyStatus = nextStatus
    }
  }

  private func parsePendingApprovals(_ value: JSONValue?) -> [MobileApprovalRequest] {
    guard case .array(let entries) = value else {
      return []
    }
    return entries.compactMap { entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let approvalId = object["approvalId"]?.stringValue ?? ""
      guard !approvalId.isEmpty else {
        return nil
      }
      let questions: [MobileApprovalQuestion]
      if case .array(let questionValues) = object["questions"] {
        questions = questionValues.compactMap { questionValue in
          guard case .object(let questionObject) = questionValue else {
            return nil
          }
          let questionId = questionObject["id"]?.stringValue ?? ""
          let options: [MobileApprovalOption]
          if case .array(let optionValues) = questionObject["options"] {
            options = optionValues.compactMap { optionValue in
              guard case .object(let optionObject) = optionValue else {
                return nil
              }
              let label = optionObject["label"]?.stringValue ?? ""
              guard !label.isEmpty else {
                return nil
              }
              return MobileApprovalOption(
                label: label,
                description: optionObject["description"]?.stringValue ?? ""
              )
            }
          } else {
            options = []
          }
          return MobileApprovalQuestion(
            id: questionId,
            header: questionObject["header"]?.stringValue ?? "",
            question: questionObject["question"]?.stringValue ?? "",
            options: options
          )
        }
      } else {
        questions = []
      }
      return MobileApprovalRequest(
        approvalId: approvalId,
        title: object["title"]?.stringValue ?? "Codex needs approval",
        prompt: object["prompt"]?.stringValue ?? "",
        method: object["method"]?.stringValue ?? "",
        createdAt: object["createdAt"]?.stringValue ?? "",
        questions: questions
      )
    }
  }

  private func refreshTerminalRequestOnce(requestId: String, lifecycle: String) {
    let key = "\(requestId)::\(lifecycle)"
    guard !requestId.isEmpty, key != lastObservedTerminalRequest else {
      return
    }
    lastObservedTerminalRequest = key
    requestCatalog()
    requestHistory(limit: 50)
  }

  private func parseProjects(_ value: JSONValue?) -> [ProjectSummary] {
    guard case .array(let entries) = value else {
      return []
    }
    return entries.compactMap { entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let path = object["path"]?.stringValue ?? ""
      guard !path.isEmpty else {
        return nil
      }
      let name = object["displayName"]?.stringValue ?? object["name"]?.stringValue ?? URL(fileURLWithPath: path).lastPathComponent
      let activeSessionId = object["activeSessionId"]?.stringValue ?? ""
      let sessions = parseThreadSummaries(
        object["sessions"],
        projectName: name,
        projectPath: path,
        activeSessionId: activeSessionId
      )
      return ProjectSummary(
        name: name,
        path: path,
        activeSessionId: activeSessionId,
        sessions: sessions,
        sessionAliases: parseStringMap(object["sessionAliases"])
      )
    }
  }

  private func parseRecentThreadSummaries(
    _ value: JSONValue?,
    projects: [ProjectSummary]
  ) -> [MobileThreadSummary] {
    guard case .array(let entries) = value else {
      return []
    }
    let projectsByPath = Dictionary(uniqueKeysWithValues: projects.map { ($0.path, $0) })

    return entries.compactMap { entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let projectPath = object["projectPath"]?.stringValue ?? ""
      let sessionId = object["sessionId"]?.stringValue ?? ""
      guard !projectPath.isEmpty, !sessionId.isEmpty else {
        return nil
      }
      let project = projectsByPath[projectPath]
      let projectName = object["projectName"]?.stringValue
        ?? project?.name
        ?? URL(fileURLWithPath: projectPath).lastPathComponent

      return MobileThreadSummary(
        projectName: projectName,
        projectPath: projectPath,
        title: object["title"]?.stringValue
          ?? object["slug"]?.stringValue
          ?? "\(projectName) Chat",
        provider: object["provider"]?.stringValue ?? "codex",
        sessionId: sessionId,
        active: object["active"]?.boolValue
          ?? (project?.activeSessionId == sessionId),
        status: object["status"]?.stringValue ?? "",
        lastDispatch: object["lastDispatch"]?.stringValue ?? "",
        lastResponse: object["lastResponse"]?.stringValue ?? "",
        lastActivityAt: object["lastActivityAt"]?.stringValue ?? ""
      )
    }
  }

  private func parseStringMap(_ value: JSONValue?) -> [String: String] {
    guard case .object(let object) = value else {
      return [:]
    }
    return object.reduce(into: [:]) { result, entry in
      let key = entry.key.trimmingCharacters(in: .whitespacesAndNewlines)
      let mapped = entry.value.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
      if !key.isEmpty && !mapped.isEmpty && key != mapped {
        result[key] = mapped
      }
    }
  }

  private func parseModels(_ value: JSONValue?) -> [CodexModelSummary] {
    guard case .array(let entries) = value else {
      return []
    }
    return entries.compactMap { entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let model = object["model"]?.stringValue ?? object["id"]?.stringValue ?? ""
      guard !model.isEmpty else {
        return nil
      }
      let efforts: [String]
      if case .array(let values) = object["supportedReasoningEfforts"] {
        efforts = values.compactMap { value in
          if case .string(let effort) = value {
            return effort
          }
          return nil
        }
      } else {
        efforts = []
      }
      return CodexModelSummary(
        model: model,
        displayName: object["displayName"]?.stringValue ?? model,
        description: object["description"]?.stringValue ?? "",
        isDefault: object["isDefault"]?.boolValue ?? false,
        defaultReasoningEffort: object["defaultReasoningEffort"]?.stringValue ?? efforts.first ?? "",
        supportedReasoningEfforts: efforts
      )
    }
  }

  private func parseThreadSummaries(
    _ value: JSONValue?,
    projectName: String,
    projectPath: String,
    activeSessionId: String
  ) -> [MobileThreadSummary] {
    guard case .array(let entries) = value else {
      if activeSessionId.isEmpty {
        return []
      }
      return [
        MobileThreadSummary(
          projectName: projectName,
          projectPath: projectPath,
          title: "\(projectName) Chat",
          provider: "codex",
          sessionId: activeSessionId,
          active: true,
          status: "",
          lastDispatch: "",
          lastResponse: "",
          lastActivityAt: ""
        )
      ]
    }

    return entries.compactMap { entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let sessionId = object["sessionId"]?.stringValue ?? ""
      guard !sessionId.isEmpty else {
        return nil
      }
      return MobileThreadSummary(
        projectName: projectName,
        projectPath: projectPath,
        title: object["slug"]?.stringValue ?? "\(projectName) Chat",
        provider: object["provider"]?.stringValue ?? "codex",
        sessionId: sessionId,
        active: sessionId == activeSessionId,
        status: object["status"]?.stringValue ?? "",
        lastDispatch: object["lastDispatch"]?.stringValue ?? "",
        lastResponse: object["lastResponse"]?.stringValue ?? "",
        lastActivityAt: object["lastActivityAt"]?.stringValue ?? ""
      )
    }
  }

  private func parseHistoryItems(_ value: JSONValue?) -> [MobileHistoryItem] {
    guard case .array(let entries) = value else {
      return []
    }
    return entries.enumerated().compactMap { index, entry in
      guard case .object(let object) = entry else {
        return nil
      }
      let message = object["message"]?.stringValue ?? ""
      let response = object["response"]?.stringValue ?? ""
      let requestId = object["requestId"]?.stringValue ?? ""
      let sentAt = object["sentAt"]?.stringValue ?? ""
      let answeredAt = object["answeredAt"]?.stringValue ?? ""
      guard !message.isEmpty || !response.isEmpty else {
        return nil
      }
      return MobileHistoryItem(
        id: requestId.isEmpty ? "\(sentAt)-\(index)" : requestId,
        requestId: requestId,
        message: message,
        response: response,
        status: object["status"]?.stringValue ?? "",
        sentAt: sentAt,
        answeredAt: answeredAt,
        scheduleMode: object["scheduleMode"]?.stringValue ?? "",
        deliveryMechanism: object["deliveryMechanism"]?.stringValue ?? ""
      )
    }
  }

  private func sendEnvelope(
    type: String,
    body: [String: JSONValue],
    envelopeId: String = ""
  ) async throws {
    guard let socket = task else {
      throw URLError(.notConnectedToInternet)
    }
    seq += 1
    var envelope = CloudEnvelope(
      type: type,
      accountId: accountId,
      workspaceId: workspaceId,
      sourceDeviceId: try DeviceIdentity.shared.deviceId(),
      targetHostId: hostId,
      seq: seq,
      body: body
    )
    if !envelopeId.isEmpty {
      envelope.id = envelopeId
    }
    envelope.signature = try DeviceIdentity.shared.sign(canonicalEnvelopeData(envelope))
    let data = try JSONEncoder.clawDadSorted.encode(envelope)
    guard let text = String(data: data, encoding: .utf8) else {
      throw URLError(.cannotParseResponse)
    }
    try await socket.send(.string(text))
  }

  private func canonicalEnvelopeData(_ envelope: CloudEnvelope) throws -> Data {
    var unsigned = envelope
    unsigned.signature = nil
    return try JSONEncoder.clawDadSorted.encode(unsigned)
  }

  private func verifyPairedHostEnvelope(_ envelope: CloudEnvelope) -> Bool {
    verifyHostEnvelope(envelope, publicKeyPem: pairedHostPublicKeyPem)
  }

  private func verifyHostEnvelope(
    _ envelope: CloudEnvelope,
    publicKeyPem: String
  ) -> Bool {
    guard envelope.sourceDeviceId == hostId,
          envelope.accountId == accountId,
          envelope.workspaceId == workspaceId,
          envelope.targetHostId == (try? DeviceIdentity.shared.deviceId()),
          let expiresAt = parseCloudDate(envelope.expiresAt),
          expiresAt.addingTimeInterval(5) >= Date(),
          let signature = envelope.signature,
          signature.alg == "ES256",
          !publicKeyPem.isEmpty,
          let signatureData = Data(base64URLEncoded: signature.value)
    else {
      return false
    }

    do {
      let publicKey = try P256.Signing.PublicKey(
        pemRepresentation: publicKeyPem
      )
      let ecdsaSignature = try P256.Signing.ECDSASignature(
        derRepresentation: signatureData
      )
      return publicKey.isValidSignature(
        ecdsaSignature,
        for: try canonicalEnvelopeData(envelope)
      )
    } catch {
      return false
    }
  }

  private func hostPublicKeysMatch(_ leftPem: String, _ rightPem: String) -> Bool {
    do {
      let left = try P256.Signing.PublicKey(pemRepresentation: leftPem)
      let right = try P256.Signing.PublicKey(pemRepresentation: rightPem)
      return left.rawRepresentation == right.rawRepresentation
    } catch {
      return false
    }
  }

  private func parseCloudDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) {
      return date
    }

    let internet = ISO8601DateFormatter()
    internet.formatOptions = [.withInternetDateTime]
    return internet.date(from: value)
  }

  private func describe(_ error: Error) -> String {
    if let pairingError = error as? PairingError {
      return pairingError.errorDescription ?? "Pairing failed."
    }
    if let urlError = error as? URLError {
      switch urlError.code {
      case .cannotFindHost, .dnsLookupFailed:
        return "ClawDad cloud could not be found. Check the cloud URL and connection."
      case .notConnectedToInternet, .networkConnectionLost:
        return "The network dropped before ClawDad could finish."
      case .badURL, .unsupportedURL:
        return "The ClawDad cloud URL is invalid."
      default:
        break
      }
    }
    let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
    return message.isEmpty ? "ClawDad could not finish that operation." : message
  }
}

enum RemoteAssistCloudError: LocalizedError {
  case authenticationRequired
  case connectionUnavailable

  var errorDescription: String? {
    switch self {
    case .authenticationRequired:
      return "Re-pair this iPhone from ClawDad Settings on the selected computer to enable Remote Assist."
    case .connectionUnavailable:
      return "The secure connection to the selected computer is reconnecting. Try Remote Assist again when it shows connected."
    }
  }
}

enum PairingError: LocalizedError {
  case invalidCode
  case wrongCode
  case expiredCode

  var errorDescription: String? {
    switch self {
    case .invalidCode:
      return "That QR code is not a valid ClawDad pairing code."
    case .wrongCode:
      return "That QR code is for something else. Open ClawDad Settings on the computer and scan the Pair iPhone code."
    case .expiredCode:
      return "That pairing QR expired. Generate a fresh code in ClawDad Settings on the computer."
    }
  }
}

extension JSONEncoder {
  static var clawDadSorted: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return encoder
  }
}

extension Data {
  init?(base64URLEncoded value: String) {
    var normalized = value
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let remainder = normalized.count % 4
    if remainder != 0 {
      normalized.append(String(repeating: "=", count: 4 - remainder))
    }
    self.init(base64Encoded: normalized)
  }
}
