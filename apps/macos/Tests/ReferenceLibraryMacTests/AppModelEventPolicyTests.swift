import Foundation
import XCTest
@testable import ReferenceLibraryMac

final class AppModelEventPolicyTests: XCTestCase {
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
}
