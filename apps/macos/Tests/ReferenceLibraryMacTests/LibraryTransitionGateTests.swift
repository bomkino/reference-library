import XCTest
@testable import ReferenceLibraryMac

final class LibraryTransitionGateTests: XCTestCase {
    func testQueuedTransitionSamplesStateOnlyAfterPredecessorCompletes() async throws {
        let gate = LibraryTransitionGate()
        let state = StateBox()
        let first = Task {
            try await gate.run {
                try await Task.sleep(nanoseconds: 20_000_000)
                await state.setActive()
                return true
            }
        }
        let second = Task {
            try await gate.run { await state.isActive() }
        }
        let firstValue = try await first.value
        let secondValue = try await second.value
        XCTAssertTrue(firstValue)
        XCTAssertTrue(secondValue)
    }
}

private actor StateBox {
    private var active = false
    func setActive() { active = true }
    func isActive() -> Bool { active }
}
