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
              var event = object["event"] as? [String: Any],
              let name = event["event"] as? String else {
            return nil
        }
        if name == "core_needs_restart" {
            event["value"] = ["reason": restartReason]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: event),
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
}
