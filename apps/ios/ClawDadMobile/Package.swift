// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "ClawDadMobile",
  platforms: [
    .iOS(.v18),
    .macOS(.v14)
  ],
  products: [
    .library(name: "ClawDadMobile", targets: ["ClawDadMobile"])
  ],
  dependencies: [
    .package(path: "../../../native/ClawDadRemoteAssistProtocol"),
    .package(path: "../../../vendor/WebRTCPackage")
  ],
  targets: [
    .target(
      name: "ClawDadMobile",
      dependencies: [
        .product(
          name: "ClawDadRemoteAssistProtocol",
          package: "ClawDadRemoteAssistProtocol"
        ),
        .product(name: "WebRTC", package: "WebRTCPackage")
      ],
      exclude: ["ClawDadMobileApp.swift"]
    ),
    .testTarget(
      name: "ClawDadMobileTests",
      dependencies: ["ClawDadMobile"]
    )
  ]
)
