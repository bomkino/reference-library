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
        XCTAssertTrue(fixture.store.commitRootGrant(root, rootID: rootID))
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

    func testRootActivationFailurePreservesProvisionalStateForCallerRollback() throws {
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
        fixture.driver.startSucceeds = false

        XCTAssertFalse(fixture.store.commitRootGrant(root, rootID: rootID))
        XCTAssertEqual(fixture.store.persistedProvisionalRootCountForTesting, 1)
        XCTAssertFalse(fixture.store.hasPersistedRootForTesting(
            libraryID: libraryID,
            rootID: rootID
        ))
        fixture.store.discardRootGrant(root)
        XCTAssertEqual(fixture.store.persistedProvisionalRootCountForTesting, 0)
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
}

@MainActor
private final class GrantStoreFixture {
    let directory: URL
    let storageURL: URL
    let driver = FakeGrantOperations()
    let store: SecurityScopedGrantStore

    init() {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        storageURL = directory.appendingPathComponent("grants.plist")
        store = SecurityScopedGrantStore(storageURL: storageURL, operations: driver.operations)
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
            startAccess: { [unowned self] _ in startSucceeds },
            stopAccess: { _ in }
        )
    }
}
