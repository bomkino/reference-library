import Foundation
import XCTest
@testable import ReferenceLibraryMac

final class ResourceFileStreamerTests: XCTestCase {
    func testVerifiedHandleUsesBoundedChunks() async throws {
        try await withTemporary { directory in
            let file = directory.appendingPathComponent("large.png")
            let bytes = Data(repeating: 7, count: ResourceFileStreamer.chunkBytes * 3 + 17)
            try bytes.write(to: file)
            var chunks: [Data] = []
            var closes = 0
            try await ResourceFileStreamer.stream(
                path: file.path,
                expectedSize: bytes.count,
                onClose: { closes += 1 }
            ) { chunk in chunks.append(chunk) }
            XCTAssertEqual(Data(chunks.joined()), bytes)
            XCTAssertTrue(chunks.allSatisfy { $0.count <= ResourceFileStreamer.chunkBytes })
            XCTAssertEqual(closes, 1)
        }
    }

    func testPathReplacementAfterValidationCannotReplaceBytes() async throws {
        try await withTemporary { directory in
            let candidate = directory.appendingPathComponent("candidate.png")
            let replacement = directory.appendingPathComponent("replacement.png")
            let retained = directory.appendingPathComponent("retained.png")
            try Data("original".utf8).write(to: candidate)
            try Data("replaced".utf8).write(to: replacement)
            var result = Data()
            try await ResourceFileStreamer.stream(
                path: candidate.path,
                expectedSize: 8,
                afterValidation: {
                    try FileManager.default.moveItem(at: candidate, to: retained)
                    try FileManager.default.moveItem(at: replacement, to: candidate)
                }
            ) { result.append($0) }
            XCTAssertEqual(String(data: result, encoding: .utf8), "original")
        }
    }

    func testSymlinkIsRejectedBeforeOpen() async throws {
        try await withTemporary { directory in
            let target = directory.appendingPathComponent("target.png")
            let link = directory.appendingPathComponent("link.png")
            try Data(repeating: 1, count: 8).write(to: target)
            try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
            await XCTAssertThrowsErrorAsync {
                try await ResourceFileStreamer.stream(path: link.path, expectedSize: 8) { _ in }
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
            var result = Data()
            try await ResourceFileStreamer.stream(
                path: candidate.path,
                expectedSize: 8,
                afterValidation: {
                    try FileManager.default.moveItem(at: candidate, to: retained)
                    try FileManager.default.createSymbolicLink(at: candidate, withDestinationURL: other)
                }
            ) { result.append($0) }
            XCTAssertEqual(String(data: result, encoding: .utf8), "trusted!")
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

    private func withTemporary(_ body: (URL) async throws -> Void) async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("reference-stream-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try await body(directory)
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
