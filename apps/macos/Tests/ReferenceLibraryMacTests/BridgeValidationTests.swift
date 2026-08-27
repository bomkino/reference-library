import XCTest
@testable import ReferenceLibraryMac

final class BridgeValidationTests: XCTestCase {
    private let sessionID = "018f06ae-f24e-7bf2-8d65-04304f01a8f0"
    private let assetID = "018f06ae-f24e-7bf2-8d65-04304f01a8f1"

    func testOpaqueAssetResourceContainsNoNativePath() throws {
        let url = try BridgeValidation.assetResourceURL(
            sessionID: sessionID,
            assetID: assetID,
            profile: "preview"
        )
        XCTAssertEqual(
            url.absoluteString,
            "pitchdog-asset://\(sessionID)/\(assetID)/preview"
        )
        XCTAssertFalse(url.absoluteString.contains("/Users/"))
    }

    func testRawPathsAndUnknownProfilesAreRejected() {
        XCTAssertThrowsError(
            try BridgeValidation.assetResourceURL(
                sessionID: "/Users/example",
                assetID: assetID,
                profile: "preview"
            )
        )
        XCTAssertThrowsError(
            try BridgeValidation.assetResourceURL(
                sessionID: sessionID,
                assetID: assetID,
                profile: "original"
            )
        )
    }

    func testOptionalLibraryRevisionIsExactNonnegativeSafeInteger() throws {
        XCTAssertNil(try BridgeValidation.optionalLibraryRevision(nil))
        XCTAssertNil(try BridgeValidation.optionalLibraryRevision(NSNull()))
        let zero = try XCTUnwrap(BridgeValidation.optionalLibraryRevision(0))
        let maximum = try XCTUnwrap(
            BridgeValidation.optionalLibraryRevision(9_007_199_254_740_991)
        )
        XCTAssertEqual(zero.intValue, 0)
        XCTAssertEqual(maximum.int64Value, 9_007_199_254_740_991)
        let invalidValues: [Any] = [true, -1, 1.5, 9_007_199_254_740_992]
        for invalid in invalidValues {
            XCTAssertThrowsError(try BridgeValidation.optionalLibraryRevision(invalid))
        }
    }
}
