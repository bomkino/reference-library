import Foundation

private let grantPersistenceSchemaVersion = 1

struct ProvisionalLibraryGrant: Equatable {
    let token: String
    let libraryID: String
    let bookmarkData: Data
    let previousBookmarkData: Data?
}

struct ProvisionalRootGrant: Equatable {
    let token: String
    let libraryID: String
    let bookmarkData: Data
}

@MainActor
protocol SecurityScopedGrantManaging: AnyObject {
    var activeLibraryID: String? { get }

    func prepareLibraryGrant(url: URL, libraryID: String) -> ProvisionalLibraryGrant?
    func commitLibraryGrant(_ provisional: ProvisionalLibraryGrant) -> Bool
    func rollbackLibraryGrant(_ provisional: ProvisionalLibraryGrant)
    func activatePersistedLibrary(libraryID: String) -> Bool

    func prepareRootGrant(url: URL, libraryID: String) -> ProvisionalRootGrant?
    func commitRootGrant(_ provisional: ProvisionalRootGrant, rootID: String) -> Bool
    func discardRootGrant(_ provisional: ProvisionalRootGrant)
    func activatePersistedRoots(libraryID: String) -> [String: URL]
    func activeRootURL(libraryID: String, rootID: String) -> URL?
    func removeRootGrant(libraryID: String, rootID: String) -> Bool

    func deactivateAll()
}

struct SecurityScopedGrantOperations {
    enum BookmarkScope: Equatable {
        case libraryReadWrite
        case rootReadOnly
    }

    struct ResolvedBookmark {
        let url: URL
        let isStale: Bool
    }

    let createBookmark: @MainActor (URL, BookmarkScope) throws -> Data
    let resolveBookmark: @MainActor (Data) throws -> ResolvedBookmark
    let startAccess: @MainActor (URL) -> Bool
    let stopAccess: @MainActor (URL) -> Void

    static let live = SecurityScopedGrantOperations(
        createBookmark: { url, scope in
            let options: URL.BookmarkCreationOptions = switch scope {
            case .libraryReadWrite:
                [.withSecurityScope]
            case .rootReadOnly:
                [.withSecurityScope, .securityScopeAllowOnlyReadAccess]
            }
            return try url.bookmarkData(
                options: options,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
        },
        resolveBookmark: { data in
            var stale = false
            let url = try URL(
                resolvingBookmarkData: data,
                options: [.withSecurityScope, .withoutUI],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            )
            return ResolvedBookmark(url: url, isStale: stale)
        },
        startAccess: { $0.startAccessingSecurityScopedResource() },
        stopAccess: { $0.stopAccessingSecurityScopedResource() }
    )
}

@MainActor
final class SecurityScopedGrantStore: SecurityScopedGrantManaging {
    static let shared = SecurityScopedGrantStore()

    private struct ProvisionalRootRecord: Codable, Equatable {
        let libraryID: String
        let bookmarkData: Data
    }

    private struct PersistedState: Codable, Equatable {
        var schemaVersion = grantPersistenceSchemaVersion
        var libraries: [String: Data] = [:]
        var roots: [String: [String: Data]] = [:]
        var provisionalRoots: [String: ProvisionalRootRecord] = [:]
    }

    private let storageURL: URL
    private let operations: SecurityScopedGrantOperations
    private var state: PersistedState
    private var activeLibraryURL: URL?
    private var activeRootURLs: [String: URL] = [:]

    private(set) var activeLibraryID: String?

    init(
        storageURL: URL? = nil,
        operations: SecurityScopedGrantOperations = .live
    ) {
        self.storageURL = storageURL ?? Self.defaultStorageURL()
        self.operations = operations
        state = Self.readState(from: self.storageURL) ?? PersistedState()
        if state.schemaVersion != grantPersistenceSchemaVersion {
            state = PersistedState()
        }
        if !state.provisionalRoots.isEmpty {
            state.provisionalRoots.removeAll()
            _ = persist()
        }
    }

    func prepareLibraryGrant(url: URL, libraryID: String) -> ProvisionalLibraryGrant? {
        guard BridgeValidation.isOpaqueID(libraryID),
              let data = try? operations.createBookmark(url, .libraryReadWrite) else {
            return nil
        }
        return ProvisionalLibraryGrant(
            token: UUID().uuidString.lowercased(),
            libraryID: libraryID,
            bookmarkData: data,
            previousBookmarkData: state.libraries[libraryID]
        )
    }

    func commitLibraryGrant(_ provisional: ProvisionalLibraryGrant) -> Bool {
        guard BridgeValidation.isOpaqueID(provisional.libraryID) else { return false }
        let previousState = state
        state.libraries[provisional.libraryID] = provisional.bookmarkData
        guard persist(),
              let activated = activate(
                bookmarkData: provisional.bookmarkData,
                scope: .libraryReadWrite,
                refresh: { refreshed in
                    self.state.libraries[provisional.libraryID] = refreshed
                }
              ) else {
            state = previousState
            _ = persist()
            return false
        }
        deactivateAll()
        activeLibraryID = provisional.libraryID
        activeLibraryURL = activated
        return true
    }

    func rollbackLibraryGrant(_ provisional: ProvisionalLibraryGrant) {
        if let previous = provisional.previousBookmarkData {
            state.libraries[provisional.libraryID] = previous
        } else {
            state.libraries.removeValue(forKey: provisional.libraryID)
        }
        _ = persist()
        if activeLibraryID == provisional.libraryID { deactivateAll() }
    }

    func activatePersistedLibrary(libraryID: String) -> Bool {
        guard BridgeValidation.isOpaqueID(libraryID),
              let data = state.libraries[libraryID],
              let activated = activate(
                bookmarkData: data,
                scope: .libraryReadWrite,
                refresh: { refreshed in self.state.libraries[libraryID] = refreshed }
              ) else {
            return false
        }
        deactivateAll()
        activeLibraryID = libraryID
        activeLibraryURL = activated
        return true
    }

    func prepareRootGrant(url: URL, libraryID: String) -> ProvisionalRootGrant? {
        guard BridgeValidation.isOpaqueID(libraryID),
              let data = try? operations.createBookmark(url, .rootReadOnly) else {
            return nil
        }
        let provisional = ProvisionalRootGrant(
            token: UUID().uuidString.lowercased(),
            libraryID: libraryID,
            bookmarkData: data
        )
        state.provisionalRoots[provisional.token] = ProvisionalRootRecord(
            libraryID: libraryID,
            bookmarkData: data
        )
        guard persist() else {
            state.provisionalRoots.removeValue(forKey: provisional.token)
            return nil
        }
        return provisional
    }

    func commitRootGrant(_ provisional: ProvisionalRootGrant, rootID: String) -> Bool {
        guard activeLibraryID == provisional.libraryID,
              BridgeValidation.isOpaqueID(rootID),
              state.provisionalRoots[provisional.token] == ProvisionalRootRecord(
                libraryID: provisional.libraryID,
                bookmarkData: provisional.bookmarkData
              ) else {
            return false
        }
        let previousState = state
        state.provisionalRoots.removeValue(forKey: provisional.token)
        state.roots[provisional.libraryID, default: [:]][rootID] = provisional.bookmarkData
        guard persist(),
              let activated = activate(
                bookmarkData: provisional.bookmarkData,
                scope: .rootReadOnly,
                refresh: { refreshed in
                    self.state.roots[provisional.libraryID, default: [:]][rootID] = refreshed
                }
              ) else {
            state = previousState
            _ = persist()
            return false
        }
        if let previous = activeRootURLs.removeValue(forKey: rootID) {
            operations.stopAccess(previous)
        }
        activeRootURLs[rootID] = activated
        return true
    }

    func discardRootGrant(_ provisional: ProvisionalRootGrant) {
        guard state.provisionalRoots.removeValue(forKey: provisional.token) != nil else { return }
        _ = persist()
    }

    func activatePersistedRoots(libraryID: String) -> [String: URL] {
        guard activeLibraryID == libraryID else { return [:] }
        for url in activeRootURLs.values { operations.stopAccess(url) }
        activeRootURLs.removeAll()
        for (rootID, data) in state.roots[libraryID, default: [:]] {
            guard let activated = activate(
                bookmarkData: data,
                scope: .rootReadOnly,
                refresh: { refreshed in
                    self.state.roots[libraryID, default: [:]][rootID] = refreshed
                }
            ) else {
                continue
            }
            activeRootURLs[rootID] = activated
        }
        return activeRootURLs
    }

    func activeRootURL(libraryID: String, rootID: String) -> URL? {
        guard activeLibraryID == libraryID else { return nil }
        return activeRootURLs[rootID]
    }

    func removeRootGrant(libraryID: String, rootID: String) -> Bool {
        guard BridgeValidation.isOpaqueID(libraryID), BridgeValidation.isOpaqueID(rootID) else {
            return false
        }
        let previousState = state
        state.roots[libraryID]?.removeValue(forKey: rootID)
        guard persist() else {
            state = previousState
            return false
        }
        if activeLibraryID == libraryID, let url = activeRootURLs.removeValue(forKey: rootID) {
            operations.stopAccess(url)
        }
        return true
    }

    func deactivateAll() {
        for url in activeRootURLs.values { operations.stopAccess(url) }
        activeRootURLs.removeAll()
        if let activeLibraryURL { operations.stopAccess(activeLibraryURL) }
        activeLibraryURL = nil
        activeLibraryID = nil
    }

    var persistedProvisionalRootCountForTesting: Int { state.provisionalRoots.count }

    func hasPersistedRootForTesting(libraryID: String, rootID: String) -> Bool {
        state.roots[libraryID]?[rootID] != nil
    }

    private func activate(
        bookmarkData: Data,
        scope: SecurityScopedGrantOperations.BookmarkScope,
        refresh: (Data) -> Void
    ) -> URL? {
        guard let resolved = try? operations.resolveBookmark(bookmarkData) else { return nil }
        if resolved.isStale {
            guard let refreshed = try? operations.createBookmark(resolved.url, scope) else {
                return nil
            }
            refresh(refreshed)
            guard persist() else { return nil }
        }
        guard operations.startAccess(resolved.url) else { return nil }
        return resolved.url
    }

    private func persist() -> Bool {
        do {
            let parent = storageURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
            let data = try PropertyListEncoder().encode(state)
            try data.write(to: storageURL, options: [.atomic])
            return true
        } catch {
            return false
        }
    }

    private static func readState(from url: URL) -> PersistedState? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? PropertyListDecoder().decode(PersistedState.self, from: data)
    }

    private static func defaultStorageURL() -> URL {
        let base = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.temporaryDirectory
        return base
            .appendingPathComponent("ReferenceLibrary", isDirectory: true)
            .appendingPathComponent("SecurityScopedGrants.plist", isDirectory: false)
    }
}
