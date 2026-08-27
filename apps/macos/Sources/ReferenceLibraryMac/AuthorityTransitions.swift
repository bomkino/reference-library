import Foundation

enum AuthorityTransitionFailure: LocalizedError {
    case rollbackPersistenceFailed

    var errorDescription: String? {
        "Authorization recovery could not be persisted. Restart before continuing."
    }
}

@MainActor
enum LibraryAuthorityTransition {
    static func perform(
        persistAndActivate: () throws -> Void,
        adopt: () async throws -> Void,
        rollback: () async -> Bool
    ) async throws {
        do {
            try persistAndActivate()
            try await adopt()
        } catch {
            guard await rollback() else {
                throw AuthorityTransitionFailure.rollbackPersistenceFailed
            }
            throw error
        }
    }
}

@MainActor
enum RootAuthorityTransition {
    static func perform<Provisional, Added>(
        prepare: () throws -> Provisional,
        adoptInCore: () async throws -> Added,
        finalizeHostAuthority: (Provisional, Added) throws -> Void,
        discardBeforeAdoption: (Provisional) -> Bool
    ) async throws -> Added {
        let provisional = try prepare()
        let added: Added
        do {
            added = try await adoptInCore()
        } catch {
            guard discardBeforeAdoption(provisional) else {
                throw AuthorityTransitionFailure.rollbackPersistenceFailed
            }
            throw error
        }
        try finalizeHostAuthority(provisional, added)
        return added
    }
}

@MainActor
enum ProvisionalSessionCleanup {
    enum Outcome: Equatable {
        case closed
        case helperRestarted
        case helperUnavailable
    }

    static func perform(
        close: () async throws -> Void,
        restartHelper: () async throws -> Void
    ) async -> Outcome {
        do {
            try await close()
            return .closed
        } catch {
            do {
                try await restartHelper()
                return .helperRestarted
            } catch {
                return .helperUnavailable
            }
        }
    }
}
