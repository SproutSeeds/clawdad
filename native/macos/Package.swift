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
    .package(path: "../../vendor/WebRTCPackage"),
    .package(
      url: "https://github.com/sparkle-project/Sparkle",
      exact: "2.9.2"
    )
  ],
  targets: [
    .executableTarget(
      name: "ClawDad",
      dependencies: [
        .product(
          name: "ClawDadRemoteAssistProtocol",
          package: "ClawDadRemoteAssistProtocol"
        ),
        .product(name: "WebRTC", package: "WebRTCPackage"),
        .product(name: "Sparkle", package: "Sparkle")
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
