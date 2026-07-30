// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "ClawDadRemoteAssistProtocol",
  platforms: [
    .iOS(.v17),
    .macOS(.v13)
  ],
  products: [
    .library(
      name: "ClawDadRemoteAssistProtocol",
      targets: ["ClawDadRemoteAssistProtocol"]
    )
  ],
  targets: [
    .target(name: "ClawDadRemoteAssistProtocol"),
    .testTarget(
      name: "ClawDadRemoteAssistProtocolTests",
      dependencies: ["ClawDadRemoteAssistProtocol"]
    )
  ]
)
