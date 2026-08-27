import Foundation
import XCTest
@testable import ReferenceLibraryMac

final class CoreResultValidatorTests: XCTestCase {
    func testCancellationRequestedIsOnlyACancellationDisposition() throws {
        XCTAssertThrowsError(try CoreResultValidator.jobPage([
            "items": [[
                "jobId": "11111111-1111-4111-8111-111111111111",
                "rootId": "22222222-2222-4222-8222-222222222222",
                "state": "cancellation_requested",
                "jobKind": "root_scan",
                "observedCount": 0,
                "unsupportedCount": 0,
                "createdAtMs": 1,
                "updatedAtMs": 1,
                "finishedAtMs": NSNull(),
                "errorCode": NSNull()
            ]],
            "total": 1,
            "offset": 0,
            "limit": 100,
            "nextOffset": NSNull()
        ]))

        XCTAssertNoThrow(try CoreResultValidator.jobCancellation([
            "jobId": "11111111-1111-4111-8111-111111111111",
            "state": "cancellation_requested"
        ], expectedJobID: "11111111-1111-4111-8111-111111111111"))
    }

    private let assetID = "11111111-1111-4111-8111-111111111111"
    private let locationID = "22222222-2222-4222-8222-222222222222"
    private let sessionID = "33333333-3333-4333-8333-333333333333"

    func testAssetPageIsRebuiltFromExactBoundedShape() throws {
        let page: [String: Any] = [
            "offset": 0,
            "limit": 1,
            "total": 1,
            "items": [assetSummary()],
            "nextOffset": NSNull(),
            "libraryRevision": 4
        ]
        let safe = try CoreResultValidator.assetPage(page)
        XCTAssertEqual(Set(safe.keys), Set([
            "offset", "limit", "total", "items", "nextOffset", "libraryRevision"
        ]))
        XCTAssertEqual((safe["items"] as? [[String: Any]])?.count, 1)
    }

    func testAssetPageRejectsInventedPathFieldAndOversizedWindow() {
        var malicious = assetSummary()
        malicious["nativePath"] = "/Users/private/secret.png"
        XCTAssertThrowsError(try CoreResultValidator.assetPage([
            "offset": 0, "limit": 1, "total": 1, "items": [malicious],
            "nextOffset": NSNull(), "libraryRevision": 4
        ]))
        XCTAssertThrowsError(try CoreResultValidator.assetPage([
            "offset": 0, "limit": 1, "total": 2, "items": [assetSummary(), assetSummary()],
            "nextOffset": NSNull(), "libraryRevision": 4
        ]))
    }

    func testAssetPageRejectsAbsoluteDisplayPathAndOversizedString() {
        var absolute = assetSummary()
        absolute["relativeDisplayPath"] = "/Users/private/secret.png"
        XCTAssertThrowsError(try CoreResultValidator.assetPage([
            "offset": 0, "limit": 1, "total": 1, "items": [absolute],
            "nextOffset": NSNull(), "libraryRevision": 4
        ]))

        var oversized = assetSummary()
        oversized["displayName"] = String(repeating: "x", count: 256)
        XCTAssertThrowsError(try CoreResultValidator.assetPage([
            "offset": 0, "limit": 1, "total": 1, "items": [oversized],
            "nextOffset": NSNull(), "libraryRevision": 4
        ]))
    }

    func testUnsupportedAvailabilityRemainsDistinctCatalogueTruth() throws {
        var unsupported = assetSummary()
        unsupported["availability"] = "unsupported"
        let page = try CoreResultValidator.assetPage([
            "offset": 0, "limit": 1, "total": 1, "items": [unsupported],
            "nextOffset": NSNull(), "libraryRevision": 4
        ])
        let safe = try XCTUnwrap((page["items"] as? [[String: Any]])?.first)
        XCTAssertEqual(safe["availability"] as? String, "unsupported")
    }

    func testLegalBackslashUnicodeAndPunctuationRemainDisplayData() throws {
        let weirdName = "draft\\final – 你好 (100%) #1.png"
        var summary = assetSummary()
        summary["displayName"] = weirdName
        summary["relativeDisplayPath"] = "References/Client (A)/\(weirdName)"
        let page = try CoreResultValidator.assetPage([
            "offset": 0, "limit": 1, "total": 1, "items": [summary],
            "nextOffset": NSNull(), "libraryRevision": 4
        ])
        let safeSummary = try XCTUnwrap((page["items"] as? [[String: Any]])?.first)
        XCTAssertEqual(safeSummary["displayName"] as? String, weirdName)
        XCTAssertEqual(
            safeSummary["relativeDisplayPath"] as? String,
            "References/Client (A)/\(weirdName)"
        )

        let detail = try CoreResultValidator.asset([
            "assetId": assetID,
            "locationId": locationID,
            "originalDisplayName": weirdName,
            "relativeDisplayPath": "References/Client (A)/\(weirdName)",
            "mediaFamily": "still_image",
            "availability": "present",
            "reviewState": "unreviewed",
            "customTitle": NSNull(),
            "note": NSNull(),
            "revision": 0,
            "collectionIds": []
        ])
        XCTAssertEqual(detail["originalDisplayName"] as? String, weirdName)

        var maximumUnicode = assetSummary()
        maximumUnicode["displayName"] = String(repeating: "界", count: 255)
        XCTAssertNoThrow(try CoreResultValidator.assetPage([
            "offset": 0, "limit": 1, "total": 1, "items": [maximumUnicode],
            "nextOffset": NSNull(), "libraryRevision": 4
        ]))
    }

    func testDisplayHierarchyAndControlCharactersRemainRejected() {
        var hierarchy = assetSummary()
        hierarchy["displayName"] = "folder/still.png"
        XCTAssertThrowsError(try CoreResultValidator.assetPage([
            "offset": 0, "limit": 1, "total": 1, "items": [hierarchy],
            "nextOffset": NSNull(), "libraryRevision": 4
        ]))

        var traversal = assetSummary()
        traversal["relativeDisplayPath"] = "References/../still.png"
        XCTAssertThrowsError(try CoreResultValidator.assetPage([
            "offset": 0, "limit": 1, "total": 1, "items": [traversal],
            "nextOffset": NSNull(), "libraryRevision": 4
        ]))

        var control = assetSummary()
        control["relativeDisplayPath"] = "References/draft\nfinal.png"
        XCTAssertThrowsError(try CoreResultValidator.assetPage([
            "offset": 0, "limit": 1, "total": 1, "items": [control],
            "nextOffset": NSNull(), "libraryRevision": 4
        ]))
    }

    func testCapabilitiesRejectUnexpectedFieldsAndInvalidEnums() {
        let valid: [String: Any] = [
            "chooseRoot": true,
            "revealLocation": true,
            "opaqueAssetResources": true,
            "sourceMutation": false,
            "detail": [["name": "reveal_location", "state": "native_equivalent", "reason": NSNull()]]
        ]
        XCTAssertNoThrow(try CoreResultValidator.capabilities(valid))
        var extra = valid
        extra["nativePath"] = "/Users/private"
        XCTAssertThrowsError(try CoreResultValidator.capabilities(extra))
        var invalid = valid
        invalid["detail"] = [["name": "reveal_location", "state": "invented", "reason": NSNull()]]
        XCTAssertThrowsError(try CoreResultValidator.capabilities(invalid))
    }

    func testPrivilegedDescriptorRequiresExactCorrelatedShape() {
        let valid: [String: Any] = [
            "resourceToken": "44444444-4444-4444-8444-444444444444",
            "sessionId": sessionID,
            "assetId": assetID,
            "locationId": locationID,
            "profile": "preview",
            "mimeType": "image/png",
            "contentLength": 8,
            "nativePathForHandler": "/private/cache/still.png"
        ]
        XCTAssertNoThrow(try CoreResultValidator.resourceDescriptor(
            valid,
            sessionID: sessionID,
            assetID: assetID,
            profile: "preview",
            maximumBytes: 512
        ))
        var extra = valid
        extra["path"] = "/Users/private"
        XCTAssertThrowsError(try CoreResultValidator.resourceDescriptor(
            extra,
            sessionID: sessionID,
            assetID: assetID,
            profile: "preview",
            maximumBytes: 512
        ))
    }

    func testCanonicalDumpRejectsUnknownTopLevelAndNestedNativePath() {
        var valid = canonicalDump()
        XCTAssertNoThrow(try CoreResultValidator.canonicalDump(["dump": valid]))
        valid["unexpected"] = []
        XCTAssertThrowsError(try CoreResultValidator.canonicalDump(["dump": valid]))

        var nested = canonicalDump()
        nested["library"] = [
            "id": assetID,
            "schemaVersion": 1,
            "name": "Library",
            "libraryRevision": 0,
            "nativePath": "/Users/private"
        ]
        XCTAssertThrowsError(try CoreResultValidator.canonicalDump(["dump": nested]))
    }

    private func assetSummary() -> [String: Any] {
        [
            "assetId": assetID,
            "locationId": locationID,
            "displayName": "still.png",
            "relativeDisplayPath": "References/still.png",
            "mediaFamily": "still_image",
            "availability": "present",
            "reviewState": "unreviewed",
            "customTitle": NSNull(),
            "revision": 0
        ]
    }

    private func canonicalDump() -> [String: Any] {
        [
            "format": "pitchdog-reference-canonical-dump-v1",
            "library": [
                "id": assetID,
                "schemaVersion": 1,
                "name": "Library",
                "libraryRevision": 0
            ],
            "roots": [],
            "sources": [],
            "sourceRevisions": [],
            "locations": [],
            "assets": [],
            "assetOrigins": [],
            "renditions": [],
            "jobs": []
        ]
    }
}
