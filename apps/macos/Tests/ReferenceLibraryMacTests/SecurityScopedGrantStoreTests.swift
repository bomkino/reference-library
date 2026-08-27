import Foundation
import XCTest
@testable import ReferenceLibraryMac

@MainActor
final class SecurityScopedGrantStoreTests: XCTestCase {
    private let libraryID = "11111111-1111-4111-8111-111111111111"
    private let otherLibraryID = "22222222-2222-4222-8222-222222222222"
    private let rootID = "33333333-3333-4333-8333-333333333333"

    func testLibraryIsReadWriteAndRootIsPersistedReadOnlyBeforeCanonicalAdd() throws {
        let fixture = GrantStoreFixture()
        defer { fixture.remove() }
        let libraryURL = URL(fileURLWithPath: "/Users/editor/Secret.pitchlibrary")
        let rootURL = URL(fileURLWithPath: "/Users/editor/Secret References")

        let library = try XCTUnwrap(
            fixture.store.prepareLibraryGrant(url: libraryURL, libraryID: libraryID)
        )
        XCTAssertEqual(fixture.driver.scopes, [.libraryReadWrite])
        XCTAssertTrue(fixture.store.commitLibraryGrant(library))

        let root = try XCTUnwrap(
            fixture.store.prepareRootGrant(url: rootURL, libraryID: libraryID)
        )
        XCTAssertEqual(fixture.driver.scopes, [.libraryReadWrite, .rootReadOnly])
        XCTAssertEqual(fixture.store.persistedProvisionalRootCountForTesting, 1)
        XCTAssertEqual(fixture.driver.startedURLs, [libraryURL, rootURL])
        XCTAssertTrue(fixture.store.commitRootGrant(root, rootID: rootID))
        XCTAssertEqual(fixture.driver.startedURLs, [libraryURL, rootURL])
        XCTAssertEqual(fixture.store.persistedProvisionalRootCountForTesting, 0)
        XCTAssertTrue(fixture.store.hasPersistedRootForTesting(
            libraryID: libraryID,
            rootID: rootID
        ))
        XCTAssertEqual(
            fixture.store.activeRootURL(libraryID: libraryID, rootID: rootID),
            rootURL
        )
    }

    func testRootActivationFailureRollsBackBeforeCanonicalAdoption() throws {
        let fixture = GrantStoreFixture()
        defer { fixture.remove() }
        let library = try XCTUnwrap(fixture.store.prepareLibraryGrant(
            url: URL(fileURLWithPath: "/Library.pitchlibrary"),
            libraryID: libraryID
        ))
        XCTAssertTrue(fixture.store.commitLibraryGrant(library))
        fixture.driver.startSucceeds = false

        XCTAssertNil(fixture.store.prepareRootGrant(
            url: URL(fileURLWithPath: "/References"),
            libraryID: libraryID
        ))
        XCTAssertEqual(fixture.store.persistedProvisionalRootCountForTesting, 0)
        XCTAssertEqual(fixture.store.activeProvisionalRootCountForTesting, 0)
        XCTAssertFalse(fixture.store.hasPersistedRootForTesting(
            libraryID: libraryID,
            rootID: rootID
        ))
    }

    func testRootActivationCleanupPersistenceFailureQuarantinesStore() throws {
        let fixture = GrantStoreFixture()
        defer { fixture.remove() }
        let library = try XCTUnwrap(fixture.store.prepareLibraryGrant(
            url: URL(fileURLWithPath: "/Library.pitchlibrary"),
            libraryID: libraryID
        ))
        XCTAssertTrue(fixture.store.commitLibraryGrant(library))
        fixture.driver.startSucceeds = false
        fixture.persistence.failingWriteNumbers = [3]

        XCTAssertNil(fixture.store.prepareRootGrant(
            url: URL(fileURLWithPath: "/References"),
            libraryID: libraryID
        ))
        XCTAssertTrue(fixture.store.persistenceQuarantinedForTesting)
        XCTAssertNil(fixture.store.activeLibraryID)
    }

    func testLibraryActivationFailureDoesNotReplaceTheCurrentGrant() throws {
        let fixture = GrantStoreFixture()
        defer { fixture.remove() }
        let first = try XCTUnwrap(fixture.store.prepareLibraryGrant(
            url: URL(fileURLWithPath: "/First.pitchlibrary"),
            libraryID: libraryID
        ))
        XCTAssertTrue(fixture.store.commitLibraryGrant(first))
        let second = try XCTUnwrap(fixture.store.prepareLibraryGrant(
            url: URL(fileURLWithPath: "/Second.pitchlibrary"),
            libraryID: otherLibraryID
        ))
        fixture.driver.startSucceeds = false

        XCTAssertFalse(fixture.store.commitLibraryGrant(second))
        XCTAssertEqual(fixture.store.activeLibraryID, libraryID)
    }

    func testPersistedGrantsRestoreOnlyInsideTheirLibrary() throws {
        let fixture = GrantStoreFixture()
        defer { fixture.remove() }
        let library = try XCTUnwrap(fixture.store.prepareLibraryGrant(
            url: URL(fileURLWithPath: "/Library.pitchlibrary"),
            libraryID: libraryID
        ))
        XCTAssertTrue(fixture.store.commitLibraryGrant(library))
        let root = try XCTUnwrap(fixture.store.prepareRootGrant(
            url: URL(fileURLWithPath: "/References"),
            libraryID: libraryID
        ))
        XCTAssertTrue(fixture.store.commitRootGrant(root, rootID: rootID))
        fixture.store.deactivateAll()

        let restored = SecurityScopedGrantStore(
            storageURL: fixture.storageURL,
            operations: fixture.driver.operations
        )
        XCTAssertTrue(restored.activatePersistedLibrary(libraryID: libraryID))
        XCTAssertEqual(restored.activatePersistedRoots(libraryID: libraryID)[rootID]?.path, "/References")
        XCTAssertNil(restored.activeRootURL(libraryID: otherLibraryID, rootID: rootID))
    }

    func testAbandonedProvisionalRootsArePurgedOnRelaunch() throws {
        let fixture = GrantStoreFixture()
        defer { fixture.remove() }
        _ = try XCTUnwrap(fixture.store.prepareRootGrant(
            url: URL(fileURLWithPath: "/References"),
            libraryID: libraryID
        ))
        XCTAssertEqual(fixture.store.persistedProvisionalRootCountForTesting, 1)

        let restored = SecurityScopedGrantStore(
            storageURL: fixture.storageURL,
            operations: fixture.driver.operations
        )
        XCTAssertEqual(restored.persistedProvisionalRootCountForTesting, 0)
    }

    func testUnknownPersistenceSchemaIsQuarantinedWithoutByteChanges() throws {
        let fixture = GrantStoreFixture()
        defer { fixture.remove() }
        let unknownState: [String: Any] = [
            "schemaVersion": 999,
            "libraries": [String: Data](),
            "roots": [String: [String: Data]](),
            "provisionalRoots": [String: Data]()
        ]
        let unknown = try PropertyListSerialization.data(
            fromPropertyList: unknownState,
            format: .binary,
            options: 0
        )
        try FileManager.default.createDirectory(
            at: fixture.storageURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try unknown.write(to: fixture.storageURL, options: .atomic)

        let restored = SecurityScopedGrantStore(
            storageURL: fixture.storageURL,
            operations: fixture.driver.operations
        )
        XCTAssertTrue(restored.persistenceQuarantinedForTesting)
        XCTAssertNil(restored.prepareRootGrant(
            url: URL(fileURLWithPath: "/References"),
            libraryID: libraryID
        ))
        XCTAssertEqual(try Data(contentsOf: fixture.storageURL), unknown)
    }

    func testLibraryRollbackPersistenceFailureQuarantinesAndDeactivates() throws {
        let fixture = GrantStoreFixture()
        defer { fixture.remove() }
        let first = try XCTUnwrap(fixture.store.prepareLibraryGrant(
            url: URL(fileURLWithPath: "/First.pitchlibrary"),
            libraryID: libraryID
        ))
        XCTAssertTrue(fixture.store.commitLibraryGrant(first))
        let replacement = try XCTUnwrap(fixture.store.prepareLibraryGrant(
            url: URL(fileURLWithPath: "/Replacement.pitchlibrary"),
            libraryID: libraryID
        ))
        XCTAssertTrue(fixture.store.commitLibraryGrant(replacement))
        fixture.persistence.succeeds = false

        XCTAssertFalse(fixture.store.rollbackLibraryGrant(replacement))
        XCTAssertTrue(fixture.store.persistenceQuarantinedForTesting)
        XCTAssertNil(fixture.store.activeLibraryID)
        XCTAssertFalse(fixture.store.activatePersistedLibrary(libraryID: libraryID))
    }

    func testDeactivateAllBalancesLibraryAndRootScopes() throws {
        let fixture = GrantStoreFixture()
        defer { fixture.remove() }
        let libraryURL = URL(fileURLWithPath: "/Library.pitchlibrary")
        let rootURL = URL(fileURLWithPath: "/References")
        let library = try XCTUnwrap(fixture.store.prepareLibraryGrant(
            url: libraryURL,
            libraryID: libraryID
        ))
        XCTAssertTrue(fixture.store.commitLibraryGrant(library))
        let root = try XCTUnwrap(fixture.store.prepareRootGrant(
            url: rootURL,
            libraryID: libraryID
        ))
        XCTAssertTrue(fixture.store.commitRootGrant(root, rootID: rootID))

        fixture.store.deactivateAll()

        XCTAssertNil(fixture.store.activeLibraryID)
        XCTAssertEqual(Set(fixture.driver.stoppedURLs), Set([libraryURL, rootURL]))
    }
}

@MainActor
private final class GrantStoreFixture {
    let directory: URL
    let storageURL: URL
    let driver: FakeGrantOperations
    let persistence: FakeGrantPersistence
    let store: SecurityScopedGrantStore

    init() {
        let driver = FakeGrantOperations()
        let persistence = FakeGrantPersistence()
        self.driver = driver
        self.persistence = persistence
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let storageURL = directory.appendingPathComponent("grants.plist")
        self.directory = directory
        self.storageURL = storageURL
        self.store = SecurityScopedGrantStore(
            storageURL: storageURL,
            operations: driver.operations,
            writeState: { [unowned persistence] data, url in persistence.write(data, to: url) }
        )
    }

    func remove() {
        store.deactivateAll()
        try? FileManager.default.removeItem(at: directory)
    }
}

@MainActor
private final class FakeGrantOperations {
    var scopes: [SecurityScopedGrantOperations.BookmarkScope] = []
    var startSucceeds = true
    var startedURLs: [URL] = []
    var stoppedURLs: [URL] = []
    private var nextBookmark = 0
    private var urls: [Data: URL] = [:]

    var operations: SecurityScopedGrantOperations {
        SecurityScopedGrantOperations(
            createBookmark: { [unowned self] url, scope in
                scopes.append(scope)
                nextBookmark += 1
                let data = Data("bookmark-\(nextBookmark)".utf8)
                urls[data] = url
                return data
            },
            resolveBookmark: { [unowned self] data in
                guard let url = urls[data] else { throw CocoaError(.fileReadCorruptFile) }
                return .init(url: url, isStale: false)
            },
            startAccess: { [unowned self] url in
                startedURLs.append(url)
                return startSucceeds
            },
            stopAccess: { [unowned self] url in stoppedURLs.append(url) }
        )
    }
}

@MainActor
private final class FakeGrantPersistence {
    var succeeds = true
    var failingWriteNumbers: Set<Int> = []
    private var writeCount = 0

    func write(_ data: Data, to url: URL) -> Bool {
        writeCount += 1
        guard succeeds, !failingWriteNumbers.contains(writeCount) else { return false }
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }
}
