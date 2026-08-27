import Foundation

private let grantPersistenceSchemaVersion = 1

@MainActor
private func writeGrantStateAtomically(_ data: Data, to url: URL) -> Bool {
    do {
        let parent = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic])
        return true
    } catch {
        return false
    }
}

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
    func rollbackLibraryGrant(_ provisional: ProvisionalLibraryGrant) -> Bool
    func activatePersistedLibrary(libraryID: String) -> Bool

    func prepareRootGrant(url: URL, libraryID: String) -> ProvisionalRootGrant?
    func commitRootGrant(_ provisional: ProvisionalRootGrant, rootID: String) -> Bool
    func discardRootGrant(_ provisional: ProvisionalRootGrant) -> Bool
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
    private let writeState: @MainActor (Data, URL) -> Bool
    private var state: PersistedState
    private var persistenceQuarantined: Bool
    private var activeLibraryURL: URL?
    private var activeRootURLs: [String: URL] = [:]
    private var activeProvisionalRootURLs: [String: URL] = [:]

    private(set) var activeLibraryID: String?

    init(
        storageURL: URL? = nil,
        operations: SecurityScopedGrantOperations = .live,
        writeState: (@MainActor (Data, URL) -> Bool)? = nil
    ) {
        self.storageURL = storageURL ?? Self.defaultStorageURL()
        self.operations = operations
        self.writeState = writeState ?? writeGrantStateAtomically
        let fileExists = FileManager.default.fileExists(atPath: self.storageURL.path)
        if let restored = Self.readState(from: self.storageURL),
           restored.schemaVersion == grantPersistenceSchemaVersion {
            state = restored
            persistenceQuarantined = false
        } else {
            state = PersistedState()
            persistenceQuarantined = fileExists
        }
        if !persistenceQuarantined, !state.provisionalRoots.isEmpty {
            state.provisionalRoots.removeAll()
            if !persist() { quarantinePersistence() }
        }
    }

    func prepareLibraryGrant(url: URL, libraryID: String) -> ProvisionalLibraryGrant? {
        guard !persistenceQuarantined,
              BridgeValidation.isOpaqueID(libraryID),
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
            if !persist() { quarantinePersistence() }
            return false
        }
        deactivateAll()
        activeLibraryID = provisional.libraryID
        activeLibraryURL = activated
        return true
    }

    func rollbackLibraryGrant(_ provisional: ProvisionalLibraryGrant) -> Bool {
        if let previous = provisional.previousBookmarkData {
            state.libraries[provisional.libraryID] = previous
        } else {
            state.libraries.removeValue(forKey: provisional.libraryID)
        }
        let persisted = persist()
        if !persisted { quarantinePersistence() }
        if activeLibraryID == provisional.libraryID { deactivateAll() }
        return persisted
    }

    func activatePersistedLibrary(libraryID: String) -> Bool {
        guard !persistenceQuarantined,
              BridgeValidation.isOpaqueID(libraryID),
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
        guard !persistenceQuarantined,
              BridgeValidation.isOpaqueID(libraryID),
              let data = try? operations.createBookmark(url, .rootReadOnly) else {
            return nil
        }
        let token = UUID().uuidString.lowercased()
        var bookmarkData = data
        state.provisionalRoots[token] = ProvisionalRootRecord(
            libraryID: libraryID,
            bookmarkData: data
        )
        guard persist() else {
            state.provisionalRoots.removeValue(forKey: token)
            return nil
        }
        guard let activated = activate(
            bookmarkData: data,
            scope: .rootReadOnly,
            refresh: { refreshed in
                bookmarkData = refreshed
                self.state.provisionalRoots[token] = ProvisionalRootRecord(
                    libraryID: libraryID,
                    bookmarkData: refreshed
                )
            }
        ) else {
            state.provisionalRoots.removeValue(forKey: token)
            if !persist() { quarantinePersistence() }
            return nil
        }
        activeProvisionalRootURLs[token] = activated
        return ProvisionalRootGrant(
            token: token,
            libraryID: libraryID,
            bookmarkData: bookmarkData
        )
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
        guard persist(), let activated = activeProvisionalRootURLs.removeValue(forKey: provisional.token) else {
            state = previousState
            if !persist() { quarantinePersistence() }
            return false
        }
        if let previous = activeRootURLs.removeValue(forKey: rootID) {
            operations.stopAccess(previous)
        }
        activeRootURLs[rootID] = activated
        return true
    }

    func discardRootGrant(_ provisional: ProvisionalRootGrant) -> Bool {
        if let active = activeProvisionalRootURLs.removeValue(forKey: provisional.token) {
            operations.stopAccess(active)
        }
        if state.provisionalRoots.removeValue(forKey: provisional.token) != nil {
            guard persist() else {
                quarantinePersistence()
                return false
            }
        }
        return true
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
            quarantinePersistence()
            return false
        }
        if activeLibraryID == libraryID, let url = activeRootURLs.removeValue(forKey: rootID) {
            operations.stopAccess(url)
        }
        return true
    }

    func deactivateAll() {
        for url in activeProvisionalRootURLs.values { operations.stopAccess(url) }
        activeProvisionalRootURLs.removeAll()
        for url in activeRootURLs.values { operations.stopAccess(url) }
        activeRootURLs.removeAll()
        if let activeLibraryURL { operations.stopAccess(activeLibraryURL) }
        activeLibraryURL = nil
        activeLibraryID = nil
    }

    var persistedProvisionalRootCountForTesting: Int { state.provisionalRoots.count }
    var activeProvisionalRootCountForTesting: Int { activeProvisionalRootURLs.count }
    var persistenceQuarantinedForTesting: Bool { persistenceQuarantined }

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
            guard persist() else {
                quarantinePersistence()
                return nil
            }
        }
        guard operations.startAccess(resolved.url) else { return nil }
        return resolved.url
    }

    private func persist() -> Bool {
        guard !persistenceQuarantined,
              let data = try? PropertyListEncoder().encode(state) else { return false }
        return writeState(data, storageURL)
    }

    private func quarantinePersistence() {
        persistenceQuarantined = true
        deactivateAll()
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
