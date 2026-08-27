import Foundation
import XCTest
@testable import ReferenceLibraryMac

final class AppModelEventPolicyTests: XCTestCase {
    private let rootID = "11111111-1111-4111-8111-111111111111"
    private let jobID = "22222222-2222-4222-8222-222222222222"

    func testRestartReasonsAreFixedAndPathFree() throws {
        let frame = try JSONSerialization.data(withJSONObject: [
            "kind": "event",
            "protocolVersion": 1,
            "sequence": 4,
            "event": [
                "event": "core_needs_restart",
                "value": ["reason": "read /Users/editor/Secret.pitchlibrary failed"]
            ]
        ])

        let event = try XCTUnwrap(AppModelEventPolicy.rendererEvent(fromCoreFrame: frame))
        XCTAssertEqual(event.name, "core_needs_restart")
        XCTAssertTrue(event.json.contains(AppModelEventPolicy.restartReason))
        XCTAssertFalse(event.json.contains("/Users/"))
        XCTAssertFalse(event.json.contains("Secret.pitchlibrary"))
    }

    func testPendingRendererEventsStayBounded() {
        var events: [String] = []
        for index in 0..<(AppModelEventPolicy.maximumPendingEvents + 17) {
            AppModelEventPolicy.appendPending("event-\(index)", to: &events)
        }
        XCTAssertEqual(events.count, AppModelEventPolicy.maximumPendingEvents)
        XCTAssertEqual(events.first, "event-17")
    }

    func testKnownEventIsRebuiltWithoutUnexpectedOrPathFields() throws {
        let frame = try JSONSerialization.data(withJSONObject: [
            "kind": "event",
            "protocolVersion": 1,
            "sequence": 5,
            "event": [
                "event": "root_state_changed",
                "value": [
                    "rootId": rootID,
                    "state": "ready",
                    "nativePath": "/Users/editor/Secret References"
                ]
            ]
        ])

        let event = try XCTUnwrap(AppModelEventPolicy.rendererEvent(fromCoreFrame: frame))
        XCTAssertTrue(event.json.contains(rootID))
        XCTAssertTrue(event.json.contains("ready"))
        XCTAssertFalse(event.json.contains("nativePath"))
        XCTAssertFalse(event.json.contains("/Users/"))
    }

    func testUnknownEventAndPathShapedStateAreRejected() throws {
        let unknown = try JSONSerialization.data(withJSONObject: [
            "kind": "event",
            "protocolVersion": 1,
            "event": ["event": "debug_path", "value": ["path": "/Users/secret"]]
        ])
        let maliciousState = try JSONSerialization.data(withJSONObject: [
            "kind": "event",
            "protocolVersion": 1,
            "event": [
                "event": "job_updated",
                "value": ["jobId": jobID, "state": "/Users/secret"]
            ]
        ])

        XCTAssertNil(AppModelEventPolicy.rendererEvent(fromCoreFrame: unknown))
        XCTAssertNil(AppModelEventPolicy.rendererEvent(fromCoreFrame: maliciousState))
    }
}
