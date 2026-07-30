import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit
@preconcurrency import WebRTC

final class MacScreenCapturer: NSObject, SCStreamOutput, SCStreamDelegate {
  private let videoSource: RTCVideoSource
  private let webRTCCapturer: RTCVideoCapturer
  private let sampleQueue = DispatchQueue(
    label: "earth.frg.ClawDad.remote-assist.capture",
    qos: .userInteractive
  )
  private var stream: SCStream?

  private(set) var captureWidth = 1920
  private(set) var captureHeight = 1080

  init(videoSource: RTCVideoSource) {
    self.videoSource = videoSource
    self.webRTCCapturer = RTCVideoCapturer(delegate: videoSource)
    super.init()
  }

  func start() async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(
      false,
      onScreenWindowsOnly: true
    )
    let mainDisplayId = CGMainDisplayID()
    guard let display = content.displays.first(where: { $0.displayID == mainDisplayId })
      ?? content.displays.first else {
      throw RemoteAssistHostError.noDisplayAvailable
    }

    let nativeWidth = max(1, display.width)
    let nativeHeight = max(1, display.height)
    let scale = min(1, 1920.0 / Double(nativeWidth))
    captureWidth = max(2, Int(Double(nativeWidth) * scale) & ~1)
    captureHeight = max(2, Int(Double(nativeHeight) * scale) & ~1)

    videoSource.adaptOutputFormat(
      toWidth: Int32(captureWidth),
      height: Int32(captureHeight),
      fps: 15
    )

    let filter = SCContentFilter(display: display, excludingWindows: [])
    let configuration = SCStreamConfiguration()
    configuration.width = captureWidth
    configuration.height = captureHeight
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 15)
    configuration.queueDepth = 3
    configuration.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    configuration.showsCursor = true
    configuration.capturesAudio = false

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
    try await stream.startCapture()
  }

  func stop() async {
    guard let stream else {
      return
    }
    self.stream = nil
    try? await stream.stopCapture()
  }

  func stream(
    _ stream: SCStream,
    didStopWithError error: Error
  ) {
    self.stream = nil
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
  }
}
