// swift-tools-version: 5.9
import PackageDescription
let package = Package(
  name: "ClawDadFileTransport",
  platforms: [.iOS(.v17), .macOS(.v13)],
  products: [.library(name: "ClawDadFileTransport", targets: ["ClawDadFileTransport"])],
  dependencies: [.package(path: "../ClawDadRemoteAssistProtocol"), .package(path: "../../vendor/WebRTCPackage")],
  targets: [.target(name: "ClawDadFileTransport", dependencies: [
    .product(name: "ClawDadRemoteAssistProtocol", package: "ClawDadRemoteAssistProtocol"),
    .product(name: "WebRTC", package: "WebRTCPackage")
  ])]
)
