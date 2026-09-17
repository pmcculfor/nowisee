// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "NowiseeCore",
  platforms: [
    .macOS(.v13),
    .iOS(.v16),
  ],
  products: [
    .library(name: "NowiseeCore", targets: ["NowiseeCore"]),
  ],
  targets: [
    .target(
      name: "NowiseeCore",
      path: "Nowisee",
      exclude: [
        "NowiseeApp.swift",
        "RootViewController.swift",
        "DirectTouchOverlay.swift",
        "InputSurfaceView.swift",
        "Config.swift",
        "DeviceClipboard.swift",
        "OAuthHandoff.swift",
        "Assets.xcassets",
        "Nowisee.entitlements",
      ]
    ),
    .testTarget(
      name: "NowiseeCoreTests",
      dependencies: ["NowiseeCore"],
      path: "NowiseeCoreTests"
    ),
  ]
)
