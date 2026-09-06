import AVFoundation
import Foundation
import SwiftUI

struct VoiceRecording {
  var data: Data
  var fileName: String
  var mimeType: String
  var duration: TimeInterval
}

enum VoiceRecorderState: Equatable {
  case idle
  case requestingPermission
  case recording
}

@MainActor
final class VoiceRecorder: ObservableObject {
  @Published private(set) var state = VoiceRecorderState.idle
  @Published private(set) var duration: TimeInterval = 0
  @Published private(set) var errorMessage = ""

  private var recorder: AVAudioRecorder?
  private var recordingURL: URL?
  private var durationTask: Task<Void, Never>?
  private var attempt = UUID()
  private let audioSession: MobileAudioSession
  private var audioSessionID: UUID?

  init(audioSession: MobileAudioSession = .shared) {
    self.audioSession = audioSession
  }

  func start() async {
    guard state == .idle else {
      return
    }
    state = .requestingPermission
    let attempt = UUID()
    self.attempt = attempt
    errorMessage = ""
    let permitted = await requestMicrophonePermission()
    guard self.attempt == attempt else { return }
    guard permitted else {
      state = .idle
      errorMessage = "Microphone access is off. Enable ClawDad in Settings > Privacy & Security > Microphone."
      return
    }

    do {
      audioSessionID = try audioSession.beginRecording()

      let fileURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("clawdad-voice-\(UUID().uuidString.lowercased())")
        .appendingPathExtension("m4a")
      recordingURL = fileURL
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 64_000,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
      ]
      let nextRecorder = try AVAudioRecorder(url: fileURL, settings: settings)
      guard nextRecorder.prepareToRecord(), nextRecorder.record() else {
        throw VoiceRecorderError.couldNotStart
      }

      recorder = nextRecorder
      recordingURL = fileURL
      duration = 0
      state = .recording
      startDurationUpdates()
    } catch {
      cancel()
      present(error)
    }
  }

  func stop() throws -> VoiceRecording {
    guard state == .recording,
          let recorder,
          let recordingURL else {
      throw VoiceRecorderError.noActiveRecording
    }
    let recordedDuration = recorder.currentTime
    recorder.stop()
    durationTask?.cancel()
    durationTask = nil
    self.recorder = nil
    self.recordingURL = nil
    duration = 0
    state = .idle
    finishAudioSession()

    defer {
      try? FileManager.default.removeItem(at: recordingURL)
    }
    guard recordedDuration >= 0.2 else {
      throw VoiceRecorderError.tooShort
    }
    let data = try Data(contentsOf: recordingURL, options: .mappedIfSafe)
    guard !data.isEmpty else {
      throw VoiceRecorderError.noAudio
    }
    return VoiceRecording(
      data: data,
      fileName: "clawdad-voice.m4a",
      mimeType: "audio/mp4",
      duration: recordedDuration
    )
  }

  func present(_ error: Error) {
    state = .idle
    errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
  }

  func cancel() {
    attempt = UUID()
    errorMessage = ""
    recorder?.stop()
    recorder = nil
    durationTask?.cancel()
    durationTask = nil
    if let recordingURL { try? FileManager.default.removeItem(at: recordingURL) }
    recordingURL = nil
    duration = 0
    finishAudioSession()
    state = .idle
  }

  private func requestMicrophonePermission() async -> Bool {
    switch AVAudioApplication.shared.recordPermission {
    case .granted:
      return true
    case .denied:
      return false
    case .undetermined:
      return await withCheckedContinuation { continuation in
        AVAudioApplication.requestRecordPermission { granted in
          continuation.resume(returning: granted)
        }
      }
    @unknown default:
      return false
    }
  }

  private func startDurationUpdates() {
    durationTask?.cancel()
    durationTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 200_000_000)
        guard let self, self.state == .recording else {
          return
        }
        self.duration = self.recorder?.currentTime ?? 0
      }
    }
  }

  private func finishAudioSession() {
    guard let audioSessionID else { return }
    self.audioSessionID = nil
    audioSession.release(audioSessionID)
  }
}

enum VoiceRecorderError: LocalizedError {
  case couldNotStart
  case noActiveRecording
  case tooShort
  case noAudio

  var errorDescription: String? {
    switch self {
    case .couldNotStart:
      return "ClawDad could not start the microphone."
    case .noActiveRecording:
      return "There is no active voice recording."
    case .tooShort:
      return "That recording was too short. Hold for a moment and try again."
    case .noAudio:
      return "The recording did not contain any audio."
    }
  }
}
