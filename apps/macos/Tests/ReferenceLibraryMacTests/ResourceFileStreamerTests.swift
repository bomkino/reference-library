import Foundation
import XCTest
@testable import ReferenceLibraryMac

final class ResourceFileStreamerTests: XCTestCase {
    func testVerifiedHandleUsesBoundedChunks() async throws {
        try await withTemporary { directory in
            let file = directory.appendingPathComponent("large.png")
            let bytes = Data(repeating: 7, count: ResourceFileStreamer.chunkBytes * 3 + 17)
            try bytes.write(to: file)
            let chunks = LockedBox<[Data]>([])
            let closes = LockedBox(0)
            try await ResourceFileStreamer.stream(
                path: file.path,
                expectedSize: bytes.count,
                cacheRoot: directory,
                onClose: { closes.withValue { $0 += 1 } }
            ) { chunk in chunks.withValue { $0.append(chunk) } }
            let delivered = chunks.read()
            XCTAssertEqual(Data(delivered.joined()), bytes)
            XCTAssertTrue(delivered.allSatisfy { $0.count <= ResourceFileStreamer.chunkBytes })
            XCTAssertEqual(closes.read(), 1)
        }
    }

    func testPathReplacementAfterValidationCannotReplaceBytes() async throws {
        try await withTemporary { directory in
            let candidate = directory.appendingPathComponent("candidate.png")
            let replacement = directory.appendingPathComponent("replacement.png")
            let retained = directory.appendingPathComponent("retained.png")
            try Data("original".utf8).write(to: candidate)
            try Data("replaced".utf8).write(to: replacement)
            let result = LockedBox(Data())
            try await ResourceFileStreamer.stream(
                path: candidate.path,
                expectedSize: 8,
                cacheRoot: directory,
                afterValidation: {
                    try FileManager.default.moveItem(at: candidate, to: retained)
                    try FileManager.default.moveItem(at: replacement, to: candidate)
                }
            ) { chunk in result.withValue { $0.append(chunk) } }
            XCTAssertEqual(String(data: result.read(), encoding: .utf8), "original")
        }
    }

    func testSymlinkIsRejectedBeforeOpen() async throws {
        try await withTemporary { directory in
            let target = directory.appendingPathComponent("target.png")
            let link = directory.appendingPathComponent("link.png")
            try Data(repeating: 1, count: 8).write(to: target)
            try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
            await XCTAssertThrowsErrorAsync {
                try await ResourceFileStreamer.stream(
                    path: link.path,
                    expectedSize: 8,
                    cacheRoot: directory
                ) { _ in }
            }
        }
    }

    func testSymlinkSwapAfterValidationCannotRedirectHandle() async throws {
        try await withTemporary { directory in
            let candidate = directory.appendingPathComponent("candidate.png")
            let other = directory.appendingPathComponent("other.png")
            let retained = directory.appendingPathComponent("retained.png")
            try Data("trusted!".utf8).write(to: candidate)
            try Data("hostile!".utf8).write(to: other)
            let result = LockedBox(Data())
            try await ResourceFileStreamer.stream(
                path: candidate.path,
                expectedSize: 8,
                cacheRoot: directory,
                afterValidation: {
                    try FileManager.default.moveItem(at: candidate, to: retained)
                    try FileManager.default.createSymbolicLink(at: candidate, withDestinationURL: other)
                }
            ) { chunk in result.withValue { $0.append(chunk) } }
            XCTAssertEqual(String(data: result.read(), encoding: .utf8), "trusted!")
        }
    }

    func testCancellationStopsWithoutFinishAndClosesHandle() async throws {
        try await withTemporary { directory in
            let file = directory.appendingPathComponent("large.png")
            try Data(repeating: 1, count: ResourceFileStreamer.chunkBytes * 4).write(to: file)
            let firstChunk = expectation(description: "first chunk")
            let closed = expectation(description: "closed")
            let stream = Task {
                try await ResourceFileStreamer.stream(
                    path: file.path,
                    expectedSize: ResourceFileStreamer.chunkBytes * 4,
                    cacheRoot: directory,
                    onClose: { closed.fulfill() }
                ) { _ in
                    firstChunk.fulfill()
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                }
            }
            await fulfillment(of: [firstChunk], timeout: 1)
            stream.cancel()
            await XCTAssertThrowsErrorAsync { try await stream.value }
            await fulfillment(of: [closed], timeout: 1)
        }
    }

    func testOutsideCacheAndPrefixCollisionAreRejected() async throws {
        try await withTemporary { directory in
            let cache = directory.appendingPathComponent("cache", isDirectory: true)
            let prefixCollision = directory.appendingPathComponent("cache-escape", isDirectory: true)
            let outside = directory.appendingPathComponent("outside.png")
            try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: prefixCollision, withIntermediateDirectories: true)
            try Data(repeating: 1, count: 8).write(to: outside)
            let colliding = prefixCollision.appendingPathComponent("still.png")
            try Data(repeating: 2, count: 8).write(to: colliding)

            await XCTAssertThrowsErrorAsync {
                try await ResourceFileStreamer.stream(
                    path: outside.path,
                    expectedSize: 8,
                    cacheRoot: cache
                ) { _ in }
            }
            await XCTAssertThrowsErrorAsync {
                try await ResourceFileStreamer.stream(
                    path: colliding.path,
                    expectedSize: 8,
                    cacheRoot: cache
                ) { _ in }
            }
        }
    }

    func testIntermediateSymlinkEscapeIsRejected() async throws {
        try await withTemporary { directory in
            let cache = directory.appendingPathComponent("cache", isDirectory: true)
            let outside = directory.appendingPathComponent("outside", isDirectory: true)
            try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
            let outsideFile = outside.appendingPathComponent("still.png")
            try Data(repeating: 3, count: 8).write(to: outsideFile)
            let escape = cache.appendingPathComponent("escape", isDirectory: true)
            try FileManager.default.createSymbolicLink(at: escape, withDestinationURL: outside)

            await XCTAssertThrowsErrorAsync {
                try await ResourceFileStreamer.stream(
                    path: escape.appendingPathComponent("still.png").path,
                    expectedSize: 8,
                    cacheRoot: cache
                ) { _ in }
            }
        }
    }

    func testWritableOrMultiplyLinkedCacheFileIsRejected() async throws {
        try await withTemporary { directory in
            let writable = directory.appendingPathComponent("writable.png")
            try Data(repeating: 4, count: 8).write(to: writable)
            try FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: 0o666)],
                ofItemAtPath: writable.path
            )
            await XCTAssertThrowsErrorAsync {
                try await ResourceFileStreamer.stream(
                    path: writable.path,
                    expectedSize: 8,
                    cacheRoot: directory
                ) { _ in }
            }

            let linked = directory.appendingPathComponent("linked.png")
            let alias = directory.appendingPathComponent("alias.png")
            try Data(repeating: 5, count: 8).write(to: linked)
            try FileManager.default.linkItem(at: linked, to: alias)
            await XCTAssertThrowsErrorAsync {
                try await ResourceFileStreamer.stream(
                    path: linked.path,
                    expectedSize: 8,
                    cacheRoot: directory
                ) { _ in }
            }
        }
    }

    private func withTemporary(_ body: (URL) async throws -> Void) async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("reference-stream-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try await body(directory)
    }
}

private final class LockedBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) {
        self.value = value
    }

    func withValue<Result>(_ body: (inout Value) -> Result) -> Result {
        lock.lock()
        defer { lock.unlock() }
        return body(&value)
    }

    func read() -> Value {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

private func XCTAssertThrowsErrorAsync(
    _ operation: () async throws -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await operation()
        XCTFail("Expected an error", file: file, line: line)
    } catch {}
}
