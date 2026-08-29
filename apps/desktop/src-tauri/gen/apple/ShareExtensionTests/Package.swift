// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ShareIngress",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .library(name: "ShareIngress", targets: ["ShareIngress"])
    ],
    targets: [
        // Sources/ShareIngress holds symlinks into ../ShareExtension (the real
        // shipped ShareExtension target) — SwiftPM refuses a target `path`
        // that escapes the package root, so the symlinks are the way to
        // compile the real files here instead of copies of them.
        .target(
            name: "ShareIngress",
            path: "Sources/ShareIngress"
        ),
        .testTarget(
            name: "ShareIngressTests",
            dependencies: ["ShareIngress"],
            path: "Tests/ShareIngressTests"
        ),
    ]
)
