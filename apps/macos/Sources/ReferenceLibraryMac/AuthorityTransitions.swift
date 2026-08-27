import Foundation

@MainActor
enum LibraryAuthorityTransition {
    static func perform(
        persistAndActivate: () throws -> Void,
        adopt: () async throws -> Void,
        rollback: () async -> Void
    ) async throws {
        do {
            try persistAndActivate()
            try await adopt()
        } catch {
            await rollback()
            throw error
        }
    }
}

@MainActor
enum RootAuthorityTransition {
    static func perform<Provisional, Added>(
        prepare: () throws -> Provisional,
        add: () async throws -> Added,
        commit: (Provisional, Added) throws -> Void,
        rollbackAdded: (Added) async -> Void,
        discard: (Provisional) -> Void
    ) async throws -> Added {
        let provisional = try prepare()
        var committed = false
        defer {
            if !committed { discard(provisional) }
        }
        let added = try await add()
        do {
            try commit(provisional, added)
            committed = true
            return added
        } catch {
            await rollbackAdded(added)
            throw error
        }
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

@MainActor
enum RootCanonicalRollback {
    static func perform(
        cancelJob: () async -> Void,
        unbindRoot: () async throws -> Void
    ) async -> Bool {
        await cancelJob()
        do {
            try await unbindRoot()
            return true
        } catch {
            return false
        }
    }
}
