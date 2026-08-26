// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ReferenceLibraryMac",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ReferenceLibraryMac", targets: ["ReferenceLibraryMac"])
    ],
    targets: [
        .executableTarget(name: "ReferenceLibraryMac"),
        .testTarget(
            name: "ReferenceLibraryMacTests",
            dependencies: ["ReferenceLibraryMac"]
        )
    ],
    swiftLanguageModes: [.v5]
)
