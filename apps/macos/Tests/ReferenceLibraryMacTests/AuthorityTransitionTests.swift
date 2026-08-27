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
}
