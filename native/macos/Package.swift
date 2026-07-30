// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "ClawDadMac",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "ClawDad", targets: ["ClawDad"])
  ],
  dependencies: [
    .package(path: "../ClawDadRemoteAssistProtocol"),
    .package(path: "../../vendor/WebRTCPackage")
  ],
  targets: [
    .executableTarget(
      name: "ClawDad",
      dependencies: [
        .product(
          name: "ClawDadRemoteAssistProtocol",
          package: "ClawDadRemoteAssistProtocol"
        ),
        .product(name: "WebRTC", package: "WebRTCPackage")
      ],
      path: "Sources/ClawDad"
    ),
    .testTarget(
      name: "ClawDadTests",
      dependencies: ["ClawDad"],
      path: "Tests/ClawDadTests"
    )
  ]
)
