import AppKit
import ClawDadRemoteAssistProtocol
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit
@preconcurrency import WebRTC

struct MacCaptureDimensions: Equatable {
  let width: Int
  let height: Int
}

func macCaptureDimensions(
  displayWidth: Int,
  displayHeight: Int
) -> MacCaptureDimensions {
  let nativeWidth = max(1, displayWidth)
  let nativeHeight = max(1, displayHeight)
  let width = max(2, min(1920, nativeWidth) & ~1)
  let heightScale = Double(width) / Double(nativeWidth)
  return MacCaptureDimensions(
    width: width,
    height: max(2, Int(Double(nativeHeight) * heightScale) & ~1)
  )
}

func macRemoteScreenPoint(
  x: Double,
  y: Double,
  bounds: CGRect
) -> CGPoint {
  CGPoint(
    x: bounds.minX + min(1, max(0, x)) * bounds.width,
    y: bounds.minY + min(1, max(0, y)) * bounds.height
  )
}

enum MacDisplaySelectionDisposition: Equatable {
  case alreadySelected
  case staleTopology
  case switchDisplay
  case unavailable
}

func macDisplaySelectionDisposition(
  state: RemoteDisplayState,
  requestedDisplayId: String,
  expectedTopologyRevision: Int
) -> MacDisplaySelectionDisposition {
  guard expectedTopologyRevision == state.topologyRevision else {
    return .staleTopology
  }
  guard state.displays.contains(where: { $0.id == requestedDisplayId }) else {
    return .unavailable
  }
  return state.selectedDisplayId == requestedDisplayId
    ? .alreadySelected
    : .switchDisplay
}

func macPreferredDisplayId(
  currentDisplayId: String?,
  displays: [RemoteDisplayDescriptor]
) -> String? {
  if let currentDisplayId,
     displays.contains(where: { $0.id == currentDisplayId }) {
    return currentDisplayId
  }
  return displays.first(where: \.isPrimary)?.id ?? displays.first?.id
}

struct MacDisplaySelectionFailure: LocalizedError {
  let code: String
  let message: String
  let state: RemoteDisplayState

  var errorDescription: String? {
    message
  }
}

enum MacScreenCaptureError: LocalizedError {
  case firstFrameTimeout
  case streamUnavailable
  case rollbackFailed(String)

  var errorDescription: String? {
    switch self {
    case .firstFrameTimeout:
      return "The selected screen did not produce a video frame."
    case .streamUnavailable:
      return "The screen video stream stopped during the display change."
    case .rollbackFailed(let message):
      return "ClawDad could not restore the previous screen: \(message)"
    }
  }
}

private struct MacCaptureDisplay {
  let screenCaptureDisplay: SCDisplay
  let descriptor: RemoteDisplayDescriptor
  let globalBounds: CGRect

  var displayID: CGDirectDisplayID {
    screenCaptureDisplay.displayID
  }
}

private struct MacDisplayTopologySignature: Equatable {
  let descriptor: RemoteDisplayDescriptor
  let globalBounds: CGRect
}

private struct MacPendingFrameWaiter {
  let id: UUID
  let continuation: CheckedContinuation<Void, Error>
}

final class MacScreenCapturer: NSObject, SCStreamOutput, SCStreamDelegate {
  var onStreamFailure: ((Error) -> Void)?

  private let videoSource: RTCVideoSource
  private let webRTCCapturer: RTCVideoCapturer
  private let sampleQueue = DispatchQueue(
    label: "earth.frg.ClawDad.remote-assist.capture",
    qos: .userInteractive
  )
  private let frameLock = NSLock()
  private var stream: SCStream?
  private var activeFilter: SCContentFilter?
  private var activeConfiguration: SCStreamConfiguration?
  private var catalog: [MacCaptureDisplay] = []
  private var topologySignature: [MacDisplayTopologySignature] = []
  private var selectedDisplay: MacCaptureDisplay?
  private var topologyRevision = 1
  private var framesSuppressed = false
  private var pendingFrameWaiter: MacPendingFrameWaiter?

  private(set) var captureWidth = 1920
  private(set) var captureHeight = 1080

  var activeDisplayID: CGDirectDisplayID? {
    selectedDisplay?.displayID
  }

  var displayState: RemoteDisplayState? {
    guard let selectedDisplay else {
      return nil
    }
    return RemoteDisplayState(
      topologyRevision: topologyRevision,
      selectedDisplayId: selectedDisplay.descriptor.id,
      displays: catalog.map(\.descriptor)
    )
  }

  init(videoSource: RTCVideoSource) {
    self.videoSource = videoSource
    self.webRTCCapturer = RTCVideoCapturer(delegate: videoSource)
    super.init()
  }

  @MainActor
  func start() async throws {
    let nextCatalog = try await loadCatalog()
    guard let initialDisplay = preferredDisplay(
      currentDisplayId: nil,
      in: nextCatalog
    ) else {
      throw RemoteAssistHostError.noDisplayAvailable
    }
    catalog = nextCatalog
    topologySignature = signature(for: nextCatalog)
    topologyRevision = 1
    selectedDisplay = initialDisplay

    let filter = makeFilter(for: initialDisplay)
    let configuration = makeConfiguration(for: initialDisplay)
    let stream = SCStream(
      filter: filter,
      configuration: configuration,
      delegate: self
    )
    try stream.addStreamOutput(
      self,
      type: .screen,
      sampleHandlerQueue: sampleQueue
    )
    self.stream = stream
    activeFilter = filter
    activeConfiguration = configuration
    captureWidth = initialDisplay.descriptor.width
    captureHeight = initialDisplay.descriptor.height
    adaptVideoSource(to: initialDisplay.descriptor)
    do {
      try await stream.startCapture()
    } catch {
      self.stream = nil
      activeFilter = nil
      activeConfiguration = nil
      selectedDisplay = nil
      throw error
    }
  }

  @MainActor
  func selectDisplay(
    displayId: String,
    expectedTopologyRevision: Int
  ) async throws -> RemoteDisplayState {
    do {
      _ = try await refreshDisplays()
    } catch let error as MacScreenCaptureError {
      if case .rollbackFailed = error {
        throw error
      }
      guard let state = displayState else {
        throw error
      }
      throw MacDisplaySelectionFailure(
        code: "switch_failed",
        message: error.localizedDescription,
        state: state
      )
    } catch {
      guard let state = displayState else {
        throw error
      }
      throw MacDisplaySelectionFailure(
        code: "switch_failed",
        message: error.localizedDescription,
        state: state
      )
    }
    guard let state = displayState else {
      throw RemoteAssistHostError.noDisplayAvailable
    }

    switch macDisplaySelectionDisposition(
      state: state,
      requestedDisplayId: displayId,
      expectedTopologyRevision: expectedTopologyRevision
    ) {
    case .alreadySelected:
      return state
    case .staleTopology:
      throw MacDisplaySelectionFailure(
        code: "stale_topology",
        message: "The available screens changed. Choose a screen again.",
        state: state
      )
    case .unavailable:
      throw MacDisplaySelectionFailure(
        code: "display_unavailable",
        message: "That screen is no longer available.",
        state: state
      )
    case .switchDisplay:
      break
    }

    guard let target = catalog.first(where: {
      $0.descriptor.id == displayId
    }) else {
      throw MacDisplaySelectionFailure(
        code: "display_unavailable",
        message: "That screen is no longer available.",
        state: state
      )
    }

    do {
      try await transitionStream(to: target)
    } catch let error as MacScreenCaptureError {
      if case .rollbackFailed = error {
        throw error
      }
      throw MacDisplaySelectionFailure(
        code: "switch_failed",
        message: error.localizedDescription,
        state: displayState ?? state
      )
    } catch {
      throw MacDisplaySelectionFailure(
        code: "switch_failed",
        message: error.localizedDescription,
        state: displayState ?? state
      )
    }
    selectedDisplay = target
    guard let selectedState = displayState else {
      throw RemoteAssistHostError.noDisplayAvailable
    }
    return selectedState
  }

  @MainActor
  func refreshDisplays() async throws -> RemoteDisplayState {
    let nextCatalog = try await loadCatalog()
    let previousDisplay = selectedDisplay
    guard let target = preferredDisplay(
      currentDisplayId: previousDisplay?.descriptor.id,
      in: nextCatalog
    ) else {
      throw RemoteAssistHostError.noDisplayAvailable
    }

    let nextSignature = signature(for: nextCatalog)
    var nextTopologyRevision = topologyRevision
    if !topologySignature.isEmpty, nextSignature != topologySignature {
      if nextTopologyRevision < Int.max {
        nextTopologyRevision += 1
      }
    }
    let needsCaptureUpdate = previousDisplay == nil ||
      previousDisplay?.displayID != target.displayID ||
      previousDisplay?.descriptor.width != target.descriptor.width ||
      previousDisplay?.descriptor.height != target.descriptor.height

    if needsCaptureUpdate {
      try await transitionStream(to: target)
    }
    catalog = nextCatalog
    topologySignature = nextSignature
    topologyRevision = nextTopologyRevision
    selectedDisplay = target
    guard let state = displayState else {
      throw RemoteAssistHostError.noDisplayAvailable
    }
    return state
  }

  @MainActor
  func stop() async {
    failPendingFrameWaiter(with: CancellationError())
    guard let stream else {
      return
    }
    self.stream = nil
    activeFilter = nil
    activeConfiguration = nil
    try? await stream.stopCapture()
  }

  func stream(
    _ stoppedStream: SCStream,
    didStopWithError error: Error
  ) {
    Task { @MainActor [weak self, weak stoppedStream] in
      guard let self,
            let stoppedStream,
            self.stream === stoppedStream else {
        return
      }
      self.stream = nil
      self.activeFilter = nil
      self.activeConfiguration = nil
      self.failPendingFrameWaiter(with: error)
      self.onStreamFailure?(error)
    }
  }

  func stream(
    _ stream: SCStream,
    didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    guard type == .screen,
          sampleBuffer.isValid,
          sampleBuffer.dataReadiness == .ready,
          let pixelBuffer = sampleBuffer.imageBuffer else {
      return
    }

    var frameWaiter: MacPendingFrameWaiter?
    frameLock.lock()
    if framesSuppressed {
      guard let pendingFrameWaiter else {
        frameLock.unlock()
        return
      }
      frameWaiter = pendingFrameWaiter
      self.pendingFrameWaiter = nil
      framesSuppressed = false
    }
    frameLock.unlock()

    let rtcBuffer = RTCCVPixelBuffer(pixelBuffer: pixelBuffer)
    let presentation = sampleBuffer.presentationTimeStamp
    let timestamp: Int64
    if presentation.isValid && presentation.isNumeric {
      timestamp = Int64(max(0, CMTimeGetSeconds(presentation) * 1_000_000_000))
    } else {
      timestamp = Int64(DispatchTime.now().uptimeNanoseconds)
    }
    let frame = RTCVideoFrame(
      buffer: rtcBuffer,
      rotation: ._0,
      timeStampNs: timestamp
    )
    videoSource.capturer(webRTCCapturer, didCapture: frame)
    frameWaiter?.continuation.resume(returning: ())
  }

  @MainActor
  private func transitionStream(to target: MacCaptureDisplay) async throws {
    guard let stream,
          let previousFilter = activeFilter,
          let previousConfiguration = activeConfiguration else {
      try await replaceStoppedStream(with: target)
      return
    }

    let nextFilter = makeFilter(for: target)
    let nextConfiguration = makeConfiguration(for: target)
    suppressFrames()
    do {
      try await stream.updateConfiguration(nextConfiguration)
      try await stream.updateContentFilter(nextFilter)
      sampleQueue.sync {}
      adaptVideoSource(to: target.descriptor)
      try await waitForFirstFrame(on: stream)
      activeFilter = nextFilter
      activeConfiguration = nextConfiguration
      captureWidth = target.descriptor.width
      captureHeight = target.descriptor.height
    } catch {
      do {
        suppressFrames()
        try await stream.updateConfiguration(previousConfiguration)
        try await stream.updateContentFilter(previousFilter)
        sampleQueue.sync {}
        if let selectedDisplay {
          adaptVideoSource(to: selectedDisplay.descriptor)
        }
        try await waitForFirstFrame(on: stream)
      } catch let rollbackError {
        throw MacScreenCaptureError.rollbackFailed(
          rollbackError.localizedDescription
        )
      }
      throw error
    }
  }

  @MainActor
  private func replaceStoppedStream(
    with target: MacCaptureDisplay
  ) async throws {
    let filter = makeFilter(for: target)
    let configuration = makeConfiguration(for: target)
    let replacement = SCStream(
      filter: filter,
      configuration: configuration,
      delegate: self
    )
    try replacement.addStreamOutput(
      self,
      type: .screen,
      sampleHandlerQueue: sampleQueue
    )
    suppressFrames()
    stream = replacement
    adaptVideoSource(to: target.descriptor)
    do {
      try await replacement.startCapture()
      sampleQueue.sync {}
      try await waitForFirstFrame(on: replacement)
      activeFilter = filter
      activeConfiguration = configuration
      captureWidth = target.descriptor.width
      captureHeight = target.descriptor.height
    } catch {
      if stream === replacement {
        stream = nil
      }
      failPendingFrameWaiter(with: error)
      try? await replacement.stopCapture()
      throw MacScreenCaptureError.rollbackFailed(
        error.localizedDescription
      )
    }
  }

  @MainActor
  private func loadCatalog() async throws -> [MacCaptureDisplay] {
    let content = try await SCShareableContent.excludingDesktopWindows(
      false,
      onScreenWindowsOnly: true
    )
    let mainDisplayID = CGMainDisplayID()
    let screenNames: [CGDirectDisplayID: String] = Dictionary(
      uniqueKeysWithValues: NSScreen.screens.compactMap { screen in
        guard let number = screen.deviceDescription[
          NSDeviceDescriptionKey("NSScreenNumber")
        ] as? NSNumber else {
          return nil
        }
        return (CGDirectDisplayID(number.uint32Value), screen.localizedName)
      }
    )

    return Array(
      content.displays.map { display in
        let dimensions = macCaptureDimensions(
          displayWidth: display.width,
          displayHeight: display.height
        )
        let id = display.displayID
        let primary = id == mainDisplayID
        let trimmedName = screenNames[id]?.trimmingCharacters(
          in: .whitespacesAndNewlines
        ) ?? ""
        return MacCaptureDisplay(
          screenCaptureDisplay: display,
          descriptor: RemoteDisplayDescriptor(
            id: String(id),
            name: trimmedName.isEmpty
              ? (primary ? "Main Display" : "Display \(id)")
              : trimmedName,
            width: dimensions.width,
            height: dimensions.height,
            isPrimary: primary
          ),
          globalBounds: CGDisplayBounds(id)
        )
      }.sorted { lhs, rhs in
        if lhs.descriptor.isPrimary != rhs.descriptor.isPrimary {
          return lhs.descriptor.isPrimary
        }
        if lhs.globalBounds.minX != rhs.globalBounds.minX {
          return lhs.globalBounds.minX < rhs.globalBounds.minX
        }
        if lhs.globalBounds.minY != rhs.globalBounds.minY {
          return lhs.globalBounds.minY < rhs.globalBounds.minY
        }
        return lhs.displayID < rhs.displayID
      }.prefix(RemoteDisplayState.maximumDisplays)
    )
  }

  private func preferredDisplay(
    currentDisplayId: String?,
    in displays: [MacCaptureDisplay]
  ) -> MacCaptureDisplay? {
    guard let preferredId = macPreferredDisplayId(
      currentDisplayId: currentDisplayId,
      displays: displays.map(\.descriptor)
    ) else {
      return nil
    }
    return displays.first(where: { $0.descriptor.id == preferredId })
  }

  private func signature(
    for displays: [MacCaptureDisplay]
  ) -> [MacDisplayTopologySignature] {
    displays.map {
      MacDisplayTopologySignature(
        descriptor: $0.descriptor,
        globalBounds: $0.globalBounds
      )
    }
  }

  private func makeFilter(
    for display: MacCaptureDisplay
  ) -> SCContentFilter {
    SCContentFilter(
      display: display.screenCaptureDisplay,
      excludingWindows: []
    )
  }

  private func makeConfiguration(
    for display: MacCaptureDisplay
  ) -> SCStreamConfiguration {
    let configuration = SCStreamConfiguration()
    configuration.width = display.descriptor.width
    configuration.height = display.descriptor.height
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 15)
    configuration.queueDepth = 3
    configuration.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    configuration.showsCursor = true
    configuration.capturesAudio = false
    return configuration
  }

  private func adaptVideoSource(
    to descriptor: RemoteDisplayDescriptor
  ) {
    videoSource.adaptOutputFormat(
      toWidth: Int32(descriptor.width),
      height: Int32(descriptor.height),
      fps: 15
    )
  }

  private func suppressFrames() {
    frameLock.lock()
    framesSuppressed = true
    frameLock.unlock()
  }

  @MainActor
  private func waitForFirstFrame(on expectedStream: SCStream) async throws {
    guard stream === expectedStream else {
      throw MacScreenCaptureError.streamUnavailable
    }
    let waiterID = UUID()
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<Void, Error>) in
        frameLock.lock()
        framesSuppressed = true
        pendingFrameWaiter = MacPendingFrameWaiter(
          id: waiterID,
          continuation: continuation
        )
        frameLock.unlock()

        if Task.isCancelled {
          finishFrameWaiter(
            waiterID,
            result: .failure(CancellationError())
          )
        }

        Task { [weak self] in
          try? await Task.sleep(nanoseconds: 3_000_000_000)
          self?.finishFrameWaiter(
            waiterID,
            result: .failure(MacScreenCaptureError.firstFrameTimeout)
          )
        }
      }
    } onCancel: { [weak self] in
      self?.finishFrameWaiter(
        waiterID,
        result: .failure(CancellationError())
      )
    }
  }

  private func finishFrameWaiter(
    _ waiterID: UUID,
    result: Result<Void, Error>
  ) {
    var continuation: CheckedContinuation<Void, Error>?
    frameLock.lock()
    if pendingFrameWaiter?.id == waiterID {
      continuation = pendingFrameWaiter?.continuation
      pendingFrameWaiter = nil
      framesSuppressed = false
    }
    frameLock.unlock()
    continuation?.resume(with: result)
  }

  private func failPendingFrameWaiter(with error: Error) {
    var continuation: CheckedContinuation<Void, Error>?
    frameLock.lock()
    continuation = pendingFrameWaiter?.continuation
    pendingFrameWaiter = nil
    framesSuppressed = false
    frameLock.unlock()
    continuation?.resume(throwing: error)
  }
}
