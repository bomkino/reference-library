import XCTest
@testable import ReferenceLibraryMac

final class LibraryTransitionGateTests: XCTestCase {
    func testQueuedTransitionSamplesStateOnlyAfterPredecessorCompletes() async throws {
        let gate = LibraryTransitionGate()
        let state = StateBox()
        let firstEntered = AsyncLatch()
        let releaseFirst = AsyncLatch()
        let first = Task {
            try await gate.run {
                await firstEntered.signal()
                await releaseFirst.wait()
                await state.setActive()
                return true
            }
        }
        await firstEntered.wait()
        let second = Task {
            await gate.run { await state.isActive() }
        }
        await releaseFirst.signal()
        let firstValue = try await first.value
        let secondValue = await second.value
        XCTAssertTrue(firstValue)
        XCTAssertTrue(secondValue)
    }
}

private actor StateBox {
    private var active = false
    func setActive() { active = true }
    func isActive() -> Bool { active }
}

private actor AsyncLatch {
    private var isSignalled = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func signal() {
        guard !isSignalled else { return }
        isSignalled = true
        let continuations = waiters
        waiters.removeAll()
        for continuation in continuations { continuation.resume() }
    }

    func wait() async {
        guard !isSignalled else { return }
        await withCheckedContinuation { waiters.append($0) }
    }
}
