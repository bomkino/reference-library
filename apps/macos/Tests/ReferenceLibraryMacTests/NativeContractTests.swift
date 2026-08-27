import Foundation
import XCTest
@testable import ReferenceLibraryMac

final class NativeContractTests: XCTestCase {
    @MainActor
    func testBridgeV3IsFixedAndExcludesRootRemoval() {
        let source = WorkspaceBridge.bootstrap
        XCTAssertTrue(source.contains("version: 3"))
        for operation in [
            "completeOpenIntent", "listRoots", "reauthorizeRoot", "scanRoot", "cancelJob",
            "queryJobs", "queryAssets", "getAsset", "updateAsset", "listCollections",
            "createCollection", "renameCollection", "deleteCollection", "setCollectionMembership",
            "readPreferences", "writePreferences",
        ] { XCTAssertTrue(source.contains(operation), "missing \(operation)") }
        XCTAssertFalse(source.contains("removeRoot"))
        XCTAssertFalse(source.contains("unbindRoot"))
        XCTAssertFalse(source.contains("nativePath"))
    }

    func testCoreErrorsUseFixedIntegrityMessages() {
        for code in [
            "LibraryIntegrityFailedPreserved",
            "LibraryDatabaseIntegrityInvalid",
            "LibraryMigrationLedgerInvalid"
        ] {
            let message = RendererErrorPolicy.message(code: code)
            XCTAssertTrue(message.contains("preserved unchanged"))
            XCTAssertFalse(message.contains("/Users/"))
        }
        XCTAssertEqual(RendererErrorPolicy.message(code: "/Users/private"), "Reference Core could not complete the operation.")
    }

    @MainActor
    func testOpenIntentIsOpaqueBoundedAndPathFree() throws {
        let queue = LibraryOpenIntentQueue()
        XCTAssertTrue(queue.enqueue(URL(fileURLWithPath: "/private/Project.pitchlibrary")))
        let publicValue = try XCTUnwrap(queue.requestNext())
        XCTAssertEqual(Set(publicValue.keys), Set(["intentId", "displayName"]))
        XCTAssertFalse(publicValue.values.contains { $0.contains("/private/") })
        XCTAssertThrowsError(try queue.activeURL(id: UUID().uuidString.lowercased()))
    }

    @MainActor
    func testPackageOpenRejectsFinalSymlinkAndCanonicalizesParentAlias() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("reference-open-\(UUID().uuidString)", isDirectory: true)
        let realParent = directory.appendingPathComponent("real", isDirectory: true)
        let aliasParent = directory.appendingPathComponent("alias", isDirectory: true)
        let package = realParent.appendingPathComponent("Project.pitchlibrary", isDirectory: true)
        try FileManager.default.createDirectory(at: package, withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: package.appendingPathComponent("manifest.json"))
        try Data("sqlite".utf8).write(to: package.appendingPathComponent("library.sqlite"))
        try FileManager.default.createSymbolicLink(at: aliasParent, withDestinationURL: realParent)
        defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertEqual(
            try AppModel.validatePackage(aliasParent.appendingPathComponent("Project.pitchlibrary")),
            package
        )
        XCTAssertEqual(
            AppModel.canonicalCreationURL(aliasParent.appendingPathComponent("New.pitchlibrary")),
            realParent.appendingPathComponent("New.pitchlibrary")
        )
        let linked = directory.appendingPathComponent("Linked.pitchlibrary")
        try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: package)
        XCTAssertThrowsError(try AppModel.validatePackage(linked))
    }

    @MainActor
    func testHostPreferencesPatchIndependentlyAndUseZoomRatio() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("reference-prefs-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = WorkspacePreferencesStore(url: directory.appendingPathComponent("preferences.json"))
        XCTAssertEqual(try store.read(), WorkspacePreferences())
        XCTAssertEqual(
            try store.write(patch: ["interfaceScale": 1.25, "previewZoom": 2]),
            WorkspacePreferences(interfaceScale: 1.25, thumbnailDensity: 220, previewZoom: 2)
        )
        XCTAssertThrowsError(try store.write(patch: ["previewZoom": 25]))
    }

    func testResponseParserRejectsWrongPublicResult() throws {
        let valid = Data(#"{"kind":"response","result":{"result":"roots","value":{"items":[]}}}"#.utf8)
        XCTAssertNoThrow(try CoreSupervisor.responseValue(valid, expected: "roots"))
        XCTAssertThrowsError(try CoreSupervisor.responseValue(valid, expected: "asset_page"))
    }
}
