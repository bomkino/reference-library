import Foundation
import XCTest
@testable import ReferenceLibraryMac

@MainActor
final class AuthorityTransitionTests: XCTestCase {
    private enum ExpectedFailure: Error { case failed }

    func testLibraryPersistenceFailureRollsBackBeforeAdoption() async {
        var trace: [String] = []
        do {
            try await LibraryAuthorityTransition.perform(
                persistAndActivate: {
                    trace.append("persist")
                    throw ExpectedFailure.failed
                },
                adopt: { trace.append("adopt") },
                rollback: { trace.append("rollback") }
            )
            XCTFail("expected persistence failure")
        } catch ExpectedFailure.failed {
            XCTAssertEqual(trace, ["persist", "rollback"])
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testLibraryAdoptionFailureAlsoRollsBackProvisionalSession() async {
        var trace: [String] = []
        do {
            try await LibraryAuthorityTransition.perform(
                persistAndActivate: { trace.append("persist") },
                adopt: {
                    trace.append("adopt")
                    throw ExpectedFailure.failed
                },
                rollback: { trace.append("rollback") }
            )
            XCTFail("expected adoption failure")
        } catch ExpectedFailure.failed {
            XCTAssertEqual(trace, ["persist", "adopt", "rollback"])
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testRootPreparationFailureNeverAddsCanonicalAuthority() async {
        var trace: [String] = []
        do {
            _ = try await RootAuthorityTransition.perform(
                prepare: { () -> String in
                    trace.append("prepare")
                    throw ExpectedFailure.failed
                },
                add: {
                    trace.append("add")
                    return "added"
                },
                commit: { _, _ in trace.append("commit") },
                rollbackAdded: { _ in trace.append("rollback") },
                discard: { _ in trace.append("discard") }
            )
            XCTFail("expected preparation failure")
        } catch ExpectedFailure.failed {
            XCTAssertEqual(trace, ["prepare"])
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testRootCommitFailureRollsBackAddedRootThenDiscardsProvisionalGrant() async {
        var trace: [String] = []
        do {
            _ = try await RootAuthorityTransition.perform(
                prepare: {
                    trace.append("prepare")
                    return "provisional"
                },
                add: {
                    trace.append("add")
                    return "root"
                },
                commit: { _, _ in
                    trace.append("commit")
                    throw ExpectedFailure.failed
                },
                rollbackAdded: { _ in trace.append("rollback") },
                discard: { _ in trace.append("discard") }
            )
            XCTFail("expected commit failure")
        } catch ExpectedFailure.failed {
            XCTAssertEqual(trace, ["prepare", "add", "commit", "rollback", "discard"])
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testRootSuccessKeepsCommittedGrant() async throws {
        var trace: [String] = []
        let result = try await RootAuthorityTransition.perform(
            prepare: {
                trace.append("prepare")
                return "provisional"
            },
            add: {
                trace.append("add")
                return "root"
            },
            commit: { _, _ in trace.append("commit") },
            rollbackAdded: { _ in trace.append("rollback") },
            discard: { _ in trace.append("discard") }
        )
        XCTAssertEqual(result, "root")
        XCTAssertEqual(trace, ["prepare", "add", "commit"])
    }

    func testFailedProvisionalCloseRestartsHelperToReleaseUnknownLock() async {
        var trace: [String] = []
        let outcome = await ProvisionalSessionCleanup.perform(
            close: {
                trace.append("close")
                throw ExpectedFailure.failed
            },
            restartHelper: { trace.append("restart") }
        )

        XCTAssertEqual(outcome, .helperRestarted)
        XCTAssertEqual(trace, ["close", "restart"])
    }

    func testSuccessfulProvisionalCloseDoesNotRestartHelper() async {
        var trace: [String] = []
        let outcome = await ProvisionalSessionCleanup.perform(
            close: { trace.append("close") },
            restartHelper: { trace.append("restart") }
        )

        XCTAssertEqual(outcome, .closed)
        XCTAssertEqual(trace, ["close"])
    }

    func testFailedProvisionalCloseAndRestartReportsUnavailable() async {
        var trace: [String] = []
        let outcome = await ProvisionalSessionCleanup.perform(
            close: {
                trace.append("close")
                throw ExpectedFailure.failed
            },
            restartHelper: {
                trace.append("restart")
                throw ExpectedFailure.failed
            }
        )

        XCTAssertEqual(outcome, .helperUnavailable)
        XCTAssertEqual(trace, ["close", "restart"])
    }

    func testRootRollbackCancelsBeforeUnbindingCanonicalRoot() async {
        var trace: [String] = []
        let succeeded = await RootCanonicalRollback.perform(
            cancelJob: { trace.append("cancel") },
            unbindRoot: { trace.append("unbind") }
        )

        XCTAssertTrue(succeeded)
        XCTAssertEqual(trace, ["cancel", "unbind"])
    }

    func testRootRollbackReportsUnbindFailureAfterCancellation() async {
        var trace: [String] = []
        let succeeded = await RootCanonicalRollback.perform(
            cancelJob: { trace.append("cancel") },
            unbindRoot: {
                trace.append("unbind")
                throw ExpectedFailure.failed
            }
        )

        XCTAssertFalse(succeeded)
        XCTAssertEqual(trace, ["cancel", "unbind"])
    }
}
