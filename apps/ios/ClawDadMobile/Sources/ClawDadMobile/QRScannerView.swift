@preconcurrency import AVFoundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

#if canImport(UIKit)
struct QRScannerView: UIViewControllerRepresentable {
  var onCode: (String) -> Void
  var onError: (String) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onCode: onCode, onError: onError)
  }

  func makeUIViewController(context: Context) -> QRScannerViewController {
    QRScannerViewController(coordinator: context.coordinator)
  }

  func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {}

  final class Coordinator: NSObject {
    private var didScan = false
    let onCode: (String) -> Void
    let onError: (String) -> Void

    init(onCode: @escaping (String) -> Void, onError: @escaping (String) -> Void) {
      self.onCode = onCode
      self.onError = onError
    }

    func handle(_ value: String) {
      guard !didScan else {
        return
      }
      didScan = true
      onCode(value)
    }
  }
}
@MainActor
final class QRScannerViewController: UIViewController, @preconcurrency AVCaptureMetadataOutputObjectsDelegate {
  private let coordinator: QRScannerView.Coordinator
  private let session = AVCaptureSession()
  private var previewLayer: AVCaptureVideoPreviewLayer?

  init(coordinator: QRScannerView.Coordinator) {
    self.coordinator = coordinator
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.09, green: 0.0, blue: 0.01, alpha: 1)
    authorizeAndStart()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    previewLayer?.frame = view.bounds
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    if session.isRunning {
      DispatchQueue.global(qos: .userInitiated).async { [session] in
        session.stopRunning()
      }
    }
  }

  private func authorizeAndStart() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      configureSession()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        DispatchQueue.main.async {
          if granted {
            self?.configureSession()
          } else {
            self?.coordinator.onError("Camera access is needed to scan the ClawDad pairing QR.")
          }
        }
      }
    default:
      coordinator.onError("Camera access is needed to scan the ClawDad pairing QR.")
    }
  }

  private func configureSession() {
    guard let device = AVCaptureDevice.default(for: .video) else {
      coordinator.onError("No camera is available on this iPhone.")
      return
    }

    do {
      let input = try AVCaptureDeviceInput(device: device)
      guard session.canAddInput(input) else {
        coordinator.onError("ClawDad could not open the camera.")
        return
      }
      session.addInput(input)
    } catch {
      coordinator.onError(error.localizedDescription)
      return
    }

    let output = AVCaptureMetadataOutput()
    guard session.canAddOutput(output) else {
      coordinator.onError("ClawDad could not read QR codes from the camera.")
      return
    }
    session.addOutput(output)
    output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
    output.metadataObjectTypes = [.qr]

    let layer = AVCaptureVideoPreviewLayer(session: session)
    layer.videoGravity = .resizeAspectFill
    layer.frame = view.bounds
    view.layer.insertSublayer(layer, at: 0)
    previewLayer = layer

    DispatchQueue.global(qos: .userInitiated).async { [session] in
      session.startRunning()
    }
  }

  func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard
      let object = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
      object.type == .qr,
      let value = object.stringValue
    else {
      return
    }
    coordinator.handle(value)
  }
}
#else
struct QRScannerView: View {
  var onCode: (String) -> Void
  var onError: (String) -> Void

  var body: some View {
    ContentUnavailableView("QR scanning is available on iPhone", systemImage: "qrcode.viewfinder")
      .onAppear {
        onError("QR scanning is available on iPhone.")
      }
  }
}
#endif
