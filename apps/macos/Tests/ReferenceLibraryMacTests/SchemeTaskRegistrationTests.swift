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
