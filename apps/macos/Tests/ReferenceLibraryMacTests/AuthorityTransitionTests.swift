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
                rollback: {
                    trace.append("rollback")
                    return true
                }
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
                rollback: {
                    trace.append("rollback")
                    return true
                }
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
                adoptInCore: {
                    trace.append("add")
                    return "added"
                },
                finalizeHostAuthority: { _, _ in trace.append("finalize") },
                discardBeforeAdoption: { _ in
                    trace.append("discard")
                    return true
                }
            )
            XCTFail("expected preparation failure")
        } catch ExpectedFailure.failed {
            XCTAssertEqual(trace, ["prepare"])
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testRootAdoptionFailureDiscardsOnlyProvisionalHostAuthority() async {
        var trace: [String] = []
        do {
            _ = try await RootAuthorityTransition.perform(
                prepare: {
                    trace.append("prepare")
                    return "provisional"
                },
                adoptInCore: { () -> String in
                    trace.append("add")
                    throw ExpectedFailure.failed
                },
                finalizeHostAuthority: { _, _ in trace.append("finalize") },
                discardBeforeAdoption: { _ in
                    trace.append("discard")
                    return true
                }
            )
            XCTFail("expected adoption failure")
        } catch ExpectedFailure.failed {
            XCTAssertEqual(trace, ["prepare", "add", "discard"])
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testRootFinalizeFailureDoesNotInventCanonicalDeletion() async {
        var trace: [String] = []
        do {
            _ = try await RootAuthorityTransition.perform(
                prepare: {
                    trace.append("prepare")
                    return "provisional"
                },
                adoptInCore: {
                    trace.append("add")
                    return "root"
                },
                finalizeHostAuthority: { _, _ in
                    trace.append("finalize")
                    throw ExpectedFailure.failed
                },
                discardBeforeAdoption: { _ in
                    trace.append("discard")
                    return true
                }
            )
            XCTFail("expected finalize failure")
        } catch ExpectedFailure.failed {
            XCTAssertEqual(trace, ["prepare", "add", "finalize"])
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testRootPreAdoptionCleanupPersistenceFailureIsExplicit() async {
        do {
            _ = try await RootAuthorityTransition.perform(
                prepare: { "provisional" },
                adoptInCore: { () -> String in throw ExpectedFailure.failed },
                finalizeHostAuthority: { _, _ in },
                discardBeforeAdoption: { _ in false }
            )
            XCTFail("expected cleanup persistence failure")
        } catch AuthorityTransitionFailure.rollbackPersistenceFailed {
            // Expected fail-closed result.
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
            adoptInCore: {
                trace.append("add")
                return "root"
            },
            finalizeHostAuthority: { _, _ in trace.append("finalize") },
            discardBeforeAdoption: { _ in
                trace.append("discard")
                return true
            }
        )
        XCTAssertEqual(result, "root")
        XCTAssertEqual(trace, ["prepare", "add", "finalize"])
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

    func testRollbackPersistenceFailureOverridesOriginalTransitionError() async {
        var trace: [String] = []
        do {
            try await LibraryAuthorityTransition.perform(
                persistAndActivate: { throw ExpectedFailure.failed },
                adopt: { trace.append("adopt") },
                rollback: {
                    trace.append("rollback")
                    return false
                }
            )
            XCTFail("expected rollback persistence failure")
        } catch AuthorityTransitionFailure.rollbackPersistenceFailed {
            XCTAssertEqual(trace, ["rollback"])
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }
}
