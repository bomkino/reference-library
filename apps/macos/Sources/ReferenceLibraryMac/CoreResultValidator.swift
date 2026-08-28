import CoreFoundation
import Foundation

enum CoreResultValidator {
    enum Failure: Error { case invalid }

    private static let availability = Set([
        "present", "missing", "needs_permission", "offline_volume", "unreadable", "unavailable",
        "unsupported"
    ])
    private static let reviewStates = Set(["unreviewed", "keep", "maybe", "reject"])
    private static let jobStates = Set([
        "queued", "running", "cancelled", "completed", "failed"
    ])
    private static let capabilityStates = Set([
        "required_parity", "native_equivalent", "intentionally_absent", "unavailable"
    ])

    static func hello(_ value: Any, protocolVersion: Int) throws {
        let source = try object(
            value,
            keys: ["protocolVersion", "coreVersion", "maxPageSize", "features"]
        )
        guard try integer(source["protocolVersion"], minimum: 1).intValue == protocolVersion,
              try integer(source["maxPageSize"], minimum: 1, maximum: 250).intValue == 250 else {
            throw Failure.invalid
        }
        let coreVersion = try text(source["coreVersion"], maximum: 80)
        guard !coreVersion.isEmpty,
              coreVersion.range(of: "^[A-Za-z0-9][A-Za-z0-9_.+-]*$", options: .regularExpression) != nil else {
            throw Failure.invalid
        }
        _ = try array(source["features"], maximum: 64).map { try token($0, maximum: 80) }
    }

    static func sessionOpened(_ value: Any) throws -> [String: Any] {
        let source = try object(value, keys: ["sessionId", "libraryId", "schemaVersion", "name"])
        return [
            "sessionId": try opaque(source["sessionId"]),
            "libraryId": try opaque(source["libraryId"]),
            "schemaVersion": try integer(source["schemaVersion"], minimum: 1),
            "name": try display(source["name"], maximum: 120)
        ]
    }

    static func rootAdded(_ value: Any) throws -> [String: Any] {
        let source = try object(value, keys: ["rootId", "jobId"])
        return ["rootId": try opaque(source["rootId"]), "jobId": try opaque(source["jobId"])]
    }

    static func libraryClosed(_ value: Any, expectedSessionID: String) throws {
        let source = try object(value, keys: ["sessionId"])
        guard try opaque(source["sessionId"]) == expectedSessionID else { throw Failure.invalid }
    }

    static func roots(_ value: Any) throws -> [[String: Any]] {
        let source = try object(value, keys: ["items"])
        return try array(source["items"], maximum: 10_000).map(root)
    }

    static func rootBound(_ value: Any, expectedRootID: String) throws -> [String: Any] {
        let source = try object(value, keys: ["root"])
        guard let rootValue = source["root"] else { throw Failure.invalid }
        let result = try root(rootValue)
        guard result["rootId"] as? String == expectedRootID else { throw Failure.invalid }
        return result
    }

    static func rootScanStarted(_ value: Any) throws -> [String: Any] {
        try rootAdded(value)
    }

    static func jobCancellation(_ value: Any, expectedJobID: String) throws -> [String: Any] {
        let source = try object(value, keys: ["jobId", "state"])
        let jobID = try opaque(source["jobId"])
        guard jobID == expectedJobID else { throw Failure.invalid }
        return [
            "jobId": jobID,
            "state": try enumerated(
                source["state"], allowed: ["cancellation_requested", "already_terminal", "unknown_job"]
            )
        ]
    }

    static func assetPage(_ value: Any) throws -> [String: Any] {
        let source = try object(
            value,
            keys: ["offset", "limit", "total", "items", "nextOffset", "libraryRevision", "facets"]
        )
        let offset = try integer(source["offset"])
        let limit = try integer(source["limit"], minimum: 1, maximum: 250)
        let total = try integer(source["total"])
        let items = try array(source["items"], maximum: limit.intValue).map(assetSummary)
        let end = offset.uint64Value + UInt64(items.count)
        guard offset.uint64Value <= total.uint64Value, end <= total.uint64Value else {
            throw Failure.invalid
        }
        let nextOffset = try nullableInteger(source["nextOffset"])
        if let next = nextOffset as? NSNumber {
            guard end < total.uint64Value, next.uint64Value == end else { throw Failure.invalid }
        } else if end < total.uint64Value {
            throw Failure.invalid
        }
        return [
            "offset": offset,
            "limit": limit,
            "total": total,
            "items": items,
            "nextOffset": nextOffset,
            "libraryRevision": try integer(source["libraryRevision"]),
            "facets": try assetFacets(source["facets"])
        ]
    }

    static func asset(_ value: Any) throws -> [String: Any] {
        try assetDetail(value)
    }

    static func assetUpdated(_ value: Any) throws -> [String: Any] {
        let source = try object(value, keys: ["asset", "libraryRevision"])
        guard let assetValue = source["asset"] else { throw Failure.invalid }
        return [
            "asset": try assetDetail(assetValue),
            "libraryRevision": try integer(source["libraryRevision"])
        ]
    }

    static func jobPage(_ value: Any) throws -> [String: Any] {
        let source = try object(value, keys: ["offset", "limit", "total", "items", "nextOffset"])
        let offset = try integer(source["offset"])
        let limit = try integer(source["limit"], minimum: 1, maximum: 100)
        let total = try integer(source["total"])
        let items = try array(source["items"], maximum: limit.intValue).map(job)
        let end = offset.uint64Value + UInt64(items.count)
        guard offset.uint64Value <= total.uint64Value, end <= total.uint64Value else {
            throw Failure.invalid
        }
        let nextOffset = try nullableInteger(source["nextOffset"])
        if let next = nextOffset as? NSNumber {
            guard end < total.uint64Value, next.uint64Value == end else { throw Failure.invalid }
        } else if end < total.uint64Value {
            throw Failure.invalid
        }
        return [
            "offset": offset,
            "limit": limit,
            "total": total,
            "items": items,
            "nextOffset": nextOffset
        ]
    }

    static func collections(_ value: Any) throws -> [[String: Any]] {
        let source = try object(value, keys: ["items"])
        return try array(source["items"], maximum: 10_000).map(collection)
    }

    static func collectionUpdated(_ value: Any) throws -> [String: Any] {
        let source = try object(value, keys: ["collection", "libraryRevision"])
        guard let collectionValue = source["collection"] else { throw Failure.invalid }
        return [
            "collection": try collection(collectionValue),
            "libraryRevision": try integer(source["libraryRevision"])
        ]
    }

    static func collectionDeleted(_ value: Any, expectedCollectionID: String) throws {
        let source = try object(value, keys: ["collectionId", "libraryRevision"])
        guard try opaque(source["collectionId"]) == expectedCollectionID else { throw Failure.invalid }
        _ = try integer(source["libraryRevision"])
    }

    static func collectionMembershipUpdated(_ value: Any, expectedCollectionID: String) throws -> [String: Any] {
        let source = try object(value, keys: ["collectionId", "affected", "libraryRevision"])
        let collectionID = try opaque(source["collectionId"])
        guard collectionID == expectedCollectionID else { throw Failure.invalid }
        return [
            "collectionId": collectionID,
            "affected": try integer(source["affected"], maximum: 250),
            "libraryRevision": try integer(source["libraryRevision"])
        ]
    }

    static func capabilities(_ value: Any) throws -> [[String: Any]] {
        let source = try object(
            value,
            keys: ["chooseRoot", "revealLocation", "opaqueAssetResources", "sourceMutation", "detail"]
        )
        for key in ["chooseRoot", "revealLocation", "opaqueAssetResources", "sourceMutation"] {
            _ = try boolean(source[key])
        }
        return try array(source["detail"], maximum: 32).map { item in
            let detail = try object(item, keys: ["name", "state", "reason"])
            return [
                "name": try token(detail["name"], maximum: 80),
                "state": try enumerated(detail["state"], allowed: capabilityStates),
                "reason": try nullableText(detail["reason"], maximum: 500)
            ]
        }
    }

    static func resourceDescriptor(
        _ value: Any,
        sessionID: String,
        assetID: String,
        profile: String,
        maximumBytes: Int
    ) throws -> [String: Any] {
        let source = try object(
            value,
            keys: [
                "resourceToken", "sessionId", "assetId", "locationId", "profile", "mimeType",
                "contentLength", "nativePathForHandler"
            ]
        )
        guard try opaque(source["sessionId"]) == sessionID,
              try opaque(source["assetId"]) == assetID,
              try enumerated(source["profile"], allowed: ["grid_standard", "preview"]) == profile else {
            throw Failure.invalid
        }
        let nativePath = try absoluteNativePath(source["nativePathForHandler"])
        let mime = try enumerated(source["mimeType"], allowed: [
            "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml",
            "image/bmp", "image/avif", "image/x-icon", "application/pdf", "video/mp4",
            "video/quicktime", "video/webm", "audio/mpeg", "audio/wav", "audio/ogg",
            "audio/flac", "audio/mp4", "audio/aiff", "font/otf", "font/ttf",
            "font/woff", "font/woff2", "text/plain", "text/markdown"
        ])
        return [
            "resourceToken": try opaque(source["resourceToken"]),
            "sessionId": sessionID,
            "assetId": assetID,
            "locationId": try opaque(source["locationId"]),
            "profile": profile,
            "mimeType": mime,
            "contentLength": try integer(source["contentLength"], maximum: maximumBytes),
            "nativePathForHandler": nativePath
        ]
    }

    static func location(_ value: Any, expectedLocationID: String) throws -> String {
        let source = try object(value, keys: ["locationId", "nativePathForShell"])
        guard try opaque(source["locationId"]) == expectedLocationID else { throw Failure.invalid }
        return try absoluteNativePath(source["nativePathForShell"])
    }

    static func canonicalDump(_ value: Any) throws -> [String: Any] {
        let source = try object(value, keys: ["dump"])
        let dump = try object(
            source["dump"],
            keys: [
                "format", "library", "roots", "sources", "sourceRevisions", "locations", "assets",
                "assetOrigins", "renditions", "jobs"
            ]
        )
        guard dump["format"] as? String == "pitchdog-reference-canonical-dump-v1" else {
            throw Failure.invalid
        }
        var budget = 20_000
        let library = try object(
            dump["library"], keys: ["id", "schemaVersion", "name", "libraryRevision"]
        )
        return [
            "format": "pitchdog-reference-canonical-dump-v1",
            "library": [
                "id": try opaque(library["id"]),
                "schemaVersion": try integer(library["schemaVersion"], minimum: 1),
                "name": try display(library["name"], maximum: 120),
                "libraryRevision": try integer(library["libraryRevision"])
            ],
            "roots": try array(dump["roots"], maximum: 10_000).map(canonicalRoot),
            "sources": try array(dump["sources"], maximum: 10_000).map(canonicalSource),
            "sourceRevisions": try array(dump["sourceRevisions"], maximum: 10_000).map {
                try canonicalSourceRevision($0, budget: &budget)
            },
            "locations": try array(dump["locations"], maximum: 10_000).map(canonicalLocation),
            "assets": try array(dump["assets"], maximum: 10_000).map(canonicalAsset),
            "assetOrigins": try array(dump["assetOrigins"], maximum: 10_000).map {
                try canonicalAssetOrigin($0, budget: &budget)
            },
            "renditions": try array(dump["renditions"], maximum: 10_000).map(canonicalRendition),
            "jobs": try array(dump["jobs"], maximum: 10_000).map {
                try canonicalJob($0, budget: &budget)
            }
        ]
    }

    private static func canonicalRoot(_ value: Any) throws -> [String: Any] {
        let source = try object(value, keys: ["id", "displayName", "rootKind", "state"])
        return [
            "id": try opaque(source["id"]),
            "displayName": try display(source["displayName"], maximum: 255),
            "rootKind": try token(source["rootKind"], maximum: 40),
            "state": try token(source["state"], maximum: 40)
        ]
    }

    private static func canonicalSource(_ value: Any) throws -> [String: Any] {
        let source = try object(
            value, keys: ["id", "mediaFamily", "currentRevisionId", "lineageState"]
        )
        return [
            "id": try opaque(source["id"]),
            "mediaFamily": try token(source["mediaFamily"], maximum: 40),
            "currentRevisionId": try opaque(source["currentRevisionId"]),
            "lineageState": try token(source["lineageState"], maximum: 40)
        ]
    }

    private static func canonicalSourceRevision(
        _ value: Any,
        budget: inout Int
    ) throws -> [String: Any] {
        let source = try object(
            value,
            keys: [
                "id", "sourceId", "byteSize", "quickFingerprint", "mimeDetected",
                "extensionObserved", "mediaMetadata"
            ]
        )
        return [
            "id": try opaque(source["id"]),
            "sourceId": try opaque(source["sourceId"]),
            "byteSize": try integer(source["byteSize"]),
            "quickFingerprint": try nullableText(source["quickFingerprint"], maximum: 256),
            "mimeDetected": try text(source["mimeDetected"], maximum: 120),
            "extensionObserved": try nullableText(source["extensionObserved"], maximum: 32),
            "mediaMetadata": try sanitizeJSON(
                source["mediaMetadata"]!,
                depth: 0,
                budget: &budget,
                permitRelativePathFields: false
            )
        ]
    }

    private static func canonicalLocation(_ value: Any) throws -> [String: Any] {
        let source = try object(
            value,
            keys: [
                "id", "rootId", "sourceId", "relativePathBytesHex", "relativePathDisplay",
                "state", "lastStatSize"
            ]
        )
        let bytes = try text(source["relativePathBytesHex"], maximum: 8_192)
        guard bytes.count.isMultiple(of: 2),
              bytes.range(of: "^[0-9a-f]*$", options: .regularExpression) != nil else {
            throw Failure.invalid
        }
        return [
            "id": try opaque(source["id"]),
            "rootId": try opaque(source["rootId"]),
            "sourceId": try opaque(source["sourceId"]),
            "relativePathBytesHex": bytes,
            "relativePathDisplay": try relativePath(source["relativePathDisplay"]),
            "state": try token(source["state"], maximum: 40),
            "lastStatSize": try nullableInteger(source["lastStatSize"])
        ]
    }

    private static func canonicalAsset(_ value: Any) throws -> [String: Any] {
        let source = try object(value, keys: ["id", "customTitle", "reviewState"])
        return [
            "id": try opaque(source["id"]),
            "customTitle": try nullableText(source["customTitle"], maximum: 500),
            "reviewState": try enumerated(source["reviewState"], allowed: reviewStates)
        ]
    }

    private static func canonicalAssetOrigin(
        _ value: Any,
        budget: inout Int
    ) throws -> [String: Any] {
        let source = try object(
            value,
            keys: ["id", "assetId", "sourceId", "originKind", "originSpec", "revisionBinding"]
        )
        return [
            "id": try opaque(source["id"]),
            "assetId": try opaque(source["assetId"]),
            "sourceId": try opaque(source["sourceId"]),
            "originKind": try token(source["originKind"], maximum: 40),
            "originSpec": try sanitizeJSON(
                source["originSpec"]!,
                depth: 0,
                budget: &budget,
                permitRelativePathFields: false
            ),
            "revisionBinding": try token(source["revisionBinding"], maximum: 40)
        ]
    }

    private static func canonicalRendition(_ value: Any) throws -> [String: Any] {
        let source = try object(
            value,
            keys: [
                "id", "assetOriginId", "sourceRevisionId", "profile", "provider",
                "providerVersion", "state", "errorCode"
            ]
        )
        return [
            "id": try opaque(source["id"]),
            "assetOriginId": try opaque(source["assetOriginId"]),
            "sourceRevisionId": try opaque(source["sourceRevisionId"]),
            "profile": try enumerated(source["profile"], allowed: ["grid_standard", "preview"]),
            "provider": try token(source["provider"], maximum: 80),
            "providerVersion": try text(source["providerVersion"], maximum: 80),
            "state": try token(source["state"], maximum: 40),
            "errorCode": try nullableToken(source["errorCode"], maximum: 80)
        ]
    }

    private static func canonicalJob(_ value: Any, budget: inout Int) throws -> [String: Any] {
        let source = try object(value, keys: ["id", "jobKind", "state", "progress", "errorCode"])
        return [
            "id": try opaque(source["id"]),
            "jobKind": try token(source["jobKind"], maximum: 40),
            "state": try enumerated(source["state"], allowed: jobStates),
            "progress": try sanitizeJSON(
                source["progress"]!,
                depth: 0,
                budget: &budget,
                permitRelativePathFields: false
            ),
            "errorCode": try nullableToken(source["errorCode"], maximum: 80)
        ]
    }

    private static func root(_ value: Any) throws -> [String: Any] {
        let source = try object(
            value,
            keys: [
                "rootId", "displayName", "rootKind", "state", "authorized", "activeJobId",
                "observedCount", "unsupportedCount"
            ]
        )
        let authorized = try boolean(source["authorized"])
        return [
            "rootId": try opaque(source["rootId"]),
            "displayName": try display(source["displayName"], maximum: 255),
            "rootKind": try token(source["rootKind"], maximum: 40),
            "state": try token(source["state"], maximum: 40),
            "authorized": authorized,
            "activeJobId": try nullableOpaque(source["activeJobId"]),
            "observedCount": try integer(source["observedCount"]),
            "unsupportedCount": try integer(source["unsupportedCount"])
        ]
    }

    private static func assetSummary(_ value: Any) throws -> [String: Any] {
        let source = try object(
            value,
            keys: [
                "assetId", "locationId", "displayName", "relativeDisplayPath", "mediaFamily",
                "mimeType", "extension", "byteSize", "category", "previewKind", "availability",
                "reviewState", "customTitle", "tags", "usedIn", "previewAssetIds", "createdAtMs",
                "revision"
            ]
        )
        return [
            "assetId": try opaque(source["assetId"]),
            "locationId": try opaque(source["locationId"]),
            "displayName": try display(source["displayName"], maximum: 255),
            "relativeDisplayPath": try relativePath(source["relativeDisplayPath"]),
            "mediaFamily": try token(source["mediaFamily"], maximum: 40),
            "mimeType": try text(source["mimeType"], maximum: 160),
            "extension": try nullableToken(source["extension"], maximum: 24),
            "byteSize": try integer(source["byteSize"]),
            "category": try text(source["category"], maximum: 255),
            "previewKind": try enumerated(
                source["previewKind"], allowed: ["image", "video", "audio", "pdf", "font", "text", "none"]
            ),
            "availability": try enumerated(source["availability"], allowed: availability),
            "reviewState": try enumerated(source["reviewState"], allowed: reviewStates),
            "customTitle": try nullableText(source["customTitle"], maximum: 500),
            "tags": try stringList(source["tags"]),
            "usedIn": try stringList(source["usedIn"]),
            "previewAssetIds": try array(source["previewAssetIds"], maximum: 3).map(opaque),
            "createdAtMs": try integer(source["createdAtMs"]),
            "revision": try integer(source["revision"])
        ]
    }

    private static func assetDetail(_ value: Any) throws -> [String: Any] {
        let source = try object(
            value,
            keys: [
                "assetId", "locationId", "originalDisplayName", "relativeDisplayPath", "mediaFamily",
                "mimeType", "extension", "byteSize", "category", "previewKind", "availability",
                "reviewState", "customTitle", "note", "tags", "usedIn", "revision", "collectionIds"
            ]
        )
        return [
            "assetId": try opaque(source["assetId"]),
            "locationId": try opaque(source["locationId"]),
            "originalDisplayName": try display(source["originalDisplayName"], maximum: 255),
            "relativeDisplayPath": try relativePath(source["relativeDisplayPath"]),
            "mediaFamily": try token(source["mediaFamily"], maximum: 40),
            "mimeType": try text(source["mimeType"], maximum: 160),
            "extension": try nullableToken(source["extension"], maximum: 24),
            "byteSize": try integer(source["byteSize"]),
            "category": try text(source["category"], maximum: 255),
            "previewKind": try enumerated(
                source["previewKind"], allowed: ["image", "video", "audio", "pdf", "font", "text", "none"]
            ),
            "availability": try enumerated(source["availability"], allowed: availability),
            "reviewState": try enumerated(source["reviewState"], allowed: reviewStates),
            "customTitle": try nullableText(source["customTitle"], maximum: 500),
            "note": try nullableText(source["note"], maximum: 5_000),
            "tags": try stringList(source["tags"]),
            "usedIn": try stringList(source["usedIn"]),
            "revision": try integer(source["revision"]),
            "collectionIds": try array(source["collectionIds"], maximum: 10_000).map(opaque)
        ]
    }

    private static func assetFacets(_ value: Any?) throws -> [String: Any] {
        let source = try object(
            value,
            keys: ["categories", "extensions", "mediaFamilies", "tags", "usedIn"]
        )
        var result: [String: Any] = [:]
        for key in ["categories", "extensions", "mediaFamilies", "tags", "usedIn"] {
            result[key] = try array(source[key], maximum: 256).map { item in
                let facet = try object(item, keys: ["value", "count"])
                return [
                    "value": try text(facet["value"], maximum: 255),
                    "count": try integer(facet["count"])
                ]
            }
        }
        return result
    }

    private static func job(_ value: Any) throws -> [String: Any] {
        let source = try object(
            value,
            keys: [
                "jobId", "rootId", "jobKind", "state", "observedCount", "unsupportedCount",
                "errorCode", "createdAtMs", "updatedAtMs", "finishedAtMs"
            ]
        )
        return [
            "jobId": try opaque(source["jobId"]),
            "rootId": try nullableOpaque(source["rootId"]),
            "jobKind": try token(source["jobKind"], maximum: 40),
            "state": try enumerated(source["state"], allowed: jobStates),
            "observedCount": try integer(source["observedCount"]),
            "unsupportedCount": try integer(source["unsupportedCount"]),
            "errorCode": try nullableToken(source["errorCode"], maximum: 80),
            "createdAtMs": try integer(source["createdAtMs"]),
            "updatedAtMs": try integer(source["updatedAtMs"]),
            "finishedAtMs": try nullableInteger(source["finishedAtMs"])
        ]
    }

    private static func collection(_ value: Any) throws -> [String: Any] {
        let source = try object(value, keys: ["collectionId", "name", "assetCount", "revision"])
        return [
            "collectionId": try opaque(source["collectionId"]),
            "name": try text(source["name"], maximum: 200),
            "assetCount": try integer(source["assetCount"]),
            "revision": try integer(source["revision"])
        ]
    }

    private static func stringList(_ value: Any?) throws -> [String] {
        let items = try array(value, maximum: 64)
        let strings = try items.map { try text($0, maximum: 100) }
        guard Set(strings).count == strings.count,
              strings.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            throw Failure.invalid
        }
        return strings
    }

    private static func object(_ value: Any?, keys: Set<String>) throws -> [String: Any] {
        guard let value = value as? [String: Any], Set(value.keys) == keys else { throw Failure.invalid }
        return value
    }

    private static func array(_ value: Any?, maximum: Int) throws -> [Any] {
        guard let value = value as? [Any], value.count <= maximum else { throw Failure.invalid }
        return value
    }

    private static func opaque(_ value: Any?) throws -> String {
        guard let value = value as? String, BridgeValidation.isOpaqueID(value) else { throw Failure.invalid }
        return value
    }

    private static func nullableOpaque(_ value: Any?) throws -> Any {
        if value is NSNull { return NSNull() }
        return try opaque(value)
    }

    private static func integer(
        _ value: Any?,
        minimum: UInt64 = 0,
        maximum: Int = 9_007_199_254_740_991
    ) throws -> NSNumber {
        guard let value = value as? NSNumber,
              CFGetTypeID(value) != CFBooleanGetTypeID(),
              value.doubleValue.isFinite,
              value.doubleValue >= Double(minimum),
              value.doubleValue <= Double(maximum),
              value.doubleValue.rounded(.towardZero) == value.doubleValue else {
            throw Failure.invalid
        }
        return value
    }

    private static func nullableInteger(_ value: Any?) throws -> Any {
        if value is NSNull { return NSNull() }
        return try integer(value)
    }

    private static func boolean(_ value: Any?) throws -> Bool {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID() else { throw Failure.invalid }
        return number.boolValue
    }

    private static func text(_ value: Any?, maximum: Int) throws -> String {
        guard let value = value as? String,
              value.unicodeScalars.count <= maximum,
              !value.unicodeScalars.contains(where: { $0.value == 0 }) else { throw Failure.invalid }
        return value
    }

    private static func nullableText(_ value: Any?, maximum: Int) throws -> Any {
        if value is NSNull { return NSNull() }
        return try text(value, maximum: maximum)
    }

    private static func display(_ value: Any?, maximum: Int) throws -> String {
        let value = try text(value, maximum: maximum)
        guard !value.isEmpty,
              value.rangeOfCharacter(from: CharacterSet(charactersIn: "/").union(.controlCharacters)) == nil else {
            throw Failure.invalid
        }
        return value
    }

    private static func token(_ value: Any?, maximum: Int) throws -> String {
        guard let value = value as? String,
              !value.isEmpty,
              value.unicodeScalars.count <= maximum,
              value.range(of: "^[A-Za-z][A-Za-z0-9_.-]*$", options: .regularExpression) != nil else {
            throw Failure.invalid
        }
        return value
    }

    private static func nullableToken(_ value: Any?, maximum: Int) throws -> Any {
        if value is NSNull { return NSNull() }
        return try token(value, maximum: maximum)
    }

    private static func enumerated(_ value: Any?, allowed: Set<String>) throws -> String {
        guard let value = value as? String, allowed.contains(value) else { throw Failure.invalid }
        return value
    }

    private static func relativePath(_ value: Any?) throws -> String {
        let value = try text(value, maximum: 4_096)
        let components = value.split(separator: "/", omittingEmptySubsequences: false)
        guard !value.isEmpty,
              !value.hasPrefix("/"),
              value.rangeOfCharacter(from: .controlCharacters) == nil,
              components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw Failure.invalid
        }
        return value
    }

    private static func absoluteNativePath(_ value: Any?) throws -> String {
        let value = try text(value, maximum: 16_384)
        guard value.hasPrefix("/"), !value.contains("\0") else { throw Failure.invalid }
        return value
    }

    private static func sanitizeJSON(
        _ value: Any,
        depth: Int,
        budget: inout Int,
        permitRelativePathFields: Bool
    ) throws -> Any {
        guard depth <= 12, budget > 0 else { throw Failure.invalid }
        budget -= 1
        if value is NSNull { return value }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
            return try integer(number)
        }
        if let string = value as? String {
            let string = try text(string, maximum: 5_000)
            guard !string.hasPrefix("/"),
                  string.range(of: "^[A-Za-z]:[\\\\/]", options: .regularExpression) == nil else {
                throw Failure.invalid
            }
            return string
        }
        if let array = value as? [Any] {
            guard array.count <= 10_000 else { throw Failure.invalid }
            return try array.map {
                try sanitizeJSON($0, depth: depth + 1, budget: &budget, permitRelativePathFields: permitRelativePathFields)
            }
        }
        if let dictionary = value as? [String: Any] {
            guard dictionary.count <= 128 else { throw Failure.invalid }
            var result: [String: Any] = [:]
            for (key, nested) in dictionary {
                guard key.unicodeScalars.count <= 80,
                      key.range(of: "^[A-Za-z][A-Za-z0-9]*$", options: .regularExpression) != nil else {
                    throw Failure.invalid
                }
                let lower = key.lowercased()
                if lower.contains("nativepath") || lower.contains("authorizedpath") ||
                    (!permitRelativePathFields && lower.contains("path")) {
                    throw Failure.invalid
                }
                result[key] = try sanitizeJSON(
                    nested,
                    depth: depth + 1,
                    budget: &budget,
                    permitRelativePathFields: permitRelativePathFields
                )
            }
            return result
        }
        throw Failure.invalid
    }
}
