import Foundation

final class SecurityScopedGrantStore {
    static let shared = SecurityScopedGrantStore()

    private let defaults = UserDefaults.standard
    private let bookmarkPrefix = "reference-library.root-bookmark."
    private var activeURLs: [String: URL] = [:]

    private init() {}

    func restoreAll() {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(bookmarkPrefix) {
            let rootID = String(key.dropFirst(bookmarkPrefix.count))
            guard let data = defaults.data(forKey: key) else { continue }
            _ = restore(data: data, rootID: rootID)
        }
    }

    @discardableResult
    func storeAndActivate(url: URL, rootID: String) -> Bool {
        guard BridgeValidation.isOpaqueID(rootID) else { return false }
        do {
            let data = try url.bookmarkData(
                options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            defaults.set(data, forKey: bookmarkPrefix + rootID)
            if url.startAccessingSecurityScopedResource() { activeURLs[rootID] = url }
            return true
        } catch {
            return false
        }
    }

    private func restore(data: Data, rootID: String) -> Bool {
        do {
            var stale = false
            let url = try URL(
                resolvingBookmarkData: data,
                options: [.withSecurityScope, .withoutUI],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            )
            if stale { _ = storeAndActivate(url: url, rootID: rootID) }
            if url.startAccessingSecurityScopedResource() { activeURLs[rootID] = url }
            return true
        } catch {
            return false
        }
    }
}
