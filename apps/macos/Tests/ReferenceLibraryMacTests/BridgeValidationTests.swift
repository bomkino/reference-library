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
}
