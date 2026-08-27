import XCTest
@testable import ReferenceLibraryMac

final class BoundedRegistryTests: XCTestCase {
    func testCapacityRejectsNewKeysAndReleasesReservations() {
        var registry = BoundedRegistry<String, Int>(limit: 2)
        XCTAssertTrue(registry.insert(1, forKey: "one"))
        XCTAssertTrue(registry.insert(2, forKey: "two"))
        XCTAssertFalse(registry.insert(3, forKey: "three"))
        XCTAssertEqual(registry.count, 2)

        XCTAssertEqual(registry.removeValue(forKey: "one"), 1)
        XCTAssertTrue(registry.insert(3, forKey: "three"))
        XCTAssertEqual(registry.count, 2)

        registry.removeAll()
        XCTAssertEqual(registry.count, 0)
        XCTAssertTrue(registry.insert(4, forKey: "four"))
    }

    func testExistingReservationCanBeUpdatedAtCapacity() {
        var registry = BoundedRegistry<String, Int>(limit: 1)
        XCTAssertTrue(registry.insert(1, forKey: "one"))
        registry["one"] = 2
        XCTAssertEqual(registry["one"], 2)
        XCTAssertFalse(registry.insert(3, forKey: "two"))
    }
}
