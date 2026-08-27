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
