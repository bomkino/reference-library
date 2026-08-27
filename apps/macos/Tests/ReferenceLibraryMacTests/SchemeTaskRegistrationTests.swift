import Foundation
import XCTest
@testable import ReferenceLibraryMac

final class SchemeTaskRegistrationTests: XCTestCase {
    func testStopBeforeAttachPreventsTaskBody() async {
        let registration = SchemeTaskRegistration()
        let permitted = LockedBoolean()
        let task = Task<Void, Never> {
            permitted.set(await registration.waitUntilAttached())
        }

        registration.cancel()
        registration.attach(task)
        await task.value

        XCTAssertFalse(permitted.value)
        XCTAssertTrue(task.isCancelled)
    }

    func testStopAfterAttachCancelsTask() async {
        let registration = SchemeTaskRegistration()
        let task = Task<Void, Never> {
            guard await registration.waitUntilAttached() else { return }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }

        registration.attach(task)
        registration.cancel()
        await task.value

        XCTAssertTrue(task.isCancelled)
    }

    func testCloseDuringStreamDrainsWithoutPostCloseBytesAndReleasesCapacity() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("reference-close-stream-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("still.png")
        try Data(repeating: 9, count: ResourceFileStreamer.chunkBytes * 4).write(to: file)

        let registration = SchemeTaskRegistration()
        let capacity = ResourceStreamCapacity(limit: 1)
        let firstChunk = expectation(description: "first streamed chunk")
        let delivered = LockedInteger()
        let closed = LockedInteger()
        let task = Task<Void, Never> {
            guard await registration.waitUntilAttached(), registration.markStreaming() else { return }
            do {
                try await ResourceFileStreamer.stream(
                    path: file.path,
                    expectedSize: ResourceFileStreamer.chunkBytes * 4,
                    cacheRoot: directory,
                    capacity: capacity,
                    pacingNanoseconds: 0,
                    onClose: { closed.increment() }
                ) { _ in
                    let count = delivered.increment()
                    if count == 1 { firstChunk.fulfill() }
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                }
            } catch {}
        }
        registration.attach(task)
        await fulfillment(of: [firstChunk], timeout: 1)

        let drain = registration.cancel()
        if let drain { await drain.value }
        let countAtClose = delivered.value
        try await Task.sleep(nanoseconds: 10_000_000)

        XCTAssertEqual(countAtClose, 1)
        XCTAssertEqual(delivered.value, countAtClose)
        XCTAssertEqual(closed.value, 1)
        let activeStreams = await capacity.activeCount()
        XCTAssertEqual(activeStreams, 0)
    }
}

private final class LockedBoolean: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = false

    var value: Bool {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func set(_ value: Bool) {
        lock.lock()
        storage = value
        lock.unlock()
    }
}

private final class LockedInteger: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = 0

    var value: Int {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    @discardableResult
    func increment() -> Int {
        lock.lock()
        storage += 1
        let value = storage
        lock.unlock()
        return value
    }
}
