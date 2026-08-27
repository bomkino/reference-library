import CoreFoundation
import Foundation

enum AppModelEventPolicy {
    struct RendererEvent: Equatable {
        let name: String
        let json: String
    }

    static let restartReason = "Reference Core stopped. Writes are frozen until restart."
    static let maximumPendingEvents = 100

    static func restartFrame() -> Data {
        let object: [String: Any] = [
            "kind": "event",
            "protocolVersion": 1,
            "sequence": 0,
            "event": [
                "event": "core_needs_restart",
                "value": ["reason": restartReason]
            ]
        ]
        return (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    }

    static func rendererEvent(fromCoreFrame frame: Data) -> RendererEvent? {
        guard let object = try? JSONSerialization.jsonObject(with: frame) as? [String: Any],
              object["kind"] as? String == "event",
              (object["protocolVersion"] as? NSNumber)?.intValue == 1,
              let event = object["event"] as? [String: Any],
              let name = event["event"] as? String,
              let value = event["value"] as? [String: Any] else {
            return nil
        }
        let safeValue: [String: Any]
        switch name {
        case "core_needs_restart":
            safeValue = ["reason": restartReason]
        case "root_state_changed":
            guard let rootID = opaqueID(value["rootId"]),
                  let state = safeState(value["state"]) else { return nil }
            safeValue = ["rootId": rootID, "state": state]
        case "scan_progress_changed":
            guard let rootID = opaqueID(value["rootId"]),
                  let jobID = opaqueID(value["jobId"]),
                  let observedCount = nonnegativeInteger(value["observedCount"]),
                  let terminal = value["terminal"] as? Bool else { return nil }
            var projection: [String: Any] = [
                "rootId": rootID,
                "jobId": jobID,
                "observedCount": observedCount,
                "terminal": terminal
            ]
            if value["unsupportedCount"] != nil {
                guard let unsupportedCount = nonnegativeInteger(value["unsupportedCount"]) else { return nil }
                projection["unsupportedCount"] = unsupportedCount
            }
            safeValue = projection
        case "assets_inserted":
            guard let rootID = opaqueID(value["rootId"]),
                  let assetIDs = value["assetIds"] as? [String],
                  assetIDs.count <= 250,
                  assetIDs.allSatisfy(BridgeValidation.isOpaqueID),
                  let libraryRevision = nonnegativeInteger(value["libraryRevision"]) else { return nil }
            safeValue = [
                "rootId": rootID,
                "assetIds": assetIDs,
                "libraryRevision": libraryRevision
            ]
        case "job_updated":
            guard let jobID = opaqueID(value["jobId"]),
                  let state = safeState(value["state"]) else { return nil }
            safeValue = ["jobId": jobID, "state": state]
        case "resource_authorization_started":
            guard let requestID = opaqueID(value["requestId"]),
                  let jobID = opaqueID(value["jobId"]),
                  let assetID = opaqueID(value["assetId"]),
                  let profile = value["profile"] as? String,
                  ["grid_standard", "preview"].contains(profile) else { return nil }
            safeValue = [
                "requestId": requestID,
                "jobId": jobID,
                "assetId": assetID,
                "profile": profile
            ]
        case "asset_updated":
            guard let assetID = opaqueID(value["assetId"]),
                  let revision = nonnegativeInteger(value["revision"]),
                  let libraryRevision = nonnegativeInteger(value["libraryRevision"]) else { return nil }
            safeValue = [
                "assetId": assetID,
                "revision": revision,
                "libraryRevision": libraryRevision
            ]
        case "collections_changed":
            guard let collectionID = opaqueID(value["collectionId"]),
                  let libraryRevision = nonnegativeInteger(value["libraryRevision"]) else { return nil }
            safeValue = ["collectionId": collectionID, "libraryRevision": libraryRevision]
        default:
            return nil
        }
        let safeEvent: [String: Any] = ["event": name, "value": safeValue]
        guard let data = try? JSONSerialization.data(withJSONObject: safeEvent),
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        return RendererEvent(name: name, json: json)
    }

    static func appendPending(_ event: String, to queue: inout [String]) {
        queue.append(event)
        let overflow = queue.count - maximumPendingEvents
        if overflow > 0 { queue.removeFirst(overflow) }
    }

    static func libraryOpenedJSON(session: [String: Any]) -> String? {
        let event: [String: Any] = ["event": "library_opened", "value": session]
        guard let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return nil }
        return json
    }

    private static func opaqueID(_ value: Any?) -> String? {
        guard let value = value as? String, BridgeValidation.isOpaqueID(value) else { return nil }
        return value
    }

    private static func safeState(_ value: Any?) -> String? {
        guard let value = value as? String,
              !value.isEmpty,
              value.count <= 40,
              value.range(of: "^[a-z][a-z0-9_]{0,39}$", options: .regularExpression) != nil else {
            return nil
        }
        return value
    }

    private static func nonnegativeInteger(_ value: Any?) -> NSNumber? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue >= 0,
              number.doubleValue.rounded(.towardZero) == number.doubleValue else { return nil }
        return number
    }
}
