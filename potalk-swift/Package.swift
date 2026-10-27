// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "PotalkMac",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "PotalkMac",
            path: "Sources/PotalkMac",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
