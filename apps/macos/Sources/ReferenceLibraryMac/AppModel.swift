import AppKit
import Combine
import Foundation

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var coreStatus = "Starting Reference Core…"

    private let core = CoreSupervisor()
    private let grants = SecurityScopedGrantStore.shared
    private weak var workspace: WorkspaceWebView?
    private var activeSessionID: String?
    private var activeLibraryPath: String?
    private var started = false
    private var writesFrozen = false

    func start() async {
        guard !started else { return }
        started = true
        grants.restoreAll()
        await core.setEventSink { [weak self] data in
            Task { @MainActor in self?.receiveCoreEvent(data) }
        }
        do {
            try await core.start()
            coreStatus = "Reference Core ready"
        } catch {
            writesFrozen = true
            coreStatus = error.localizedDescription
            receiveCoreEvent(Self.restartEvent(reason: error.localizedDescription))
        }
    }

    func attach(workspace: WorkspaceWebView) {
        self.workspace = workspace
    }

    func stop() async {
        await core.stop()
    }

    func handleBridge(command: String, payload: [String: Any]) async throws -> String {
        let value: Any
        switch command {
        case "createLibrary":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            value = try await createLibrary(name: try Self.string(payload, "name")) ?? NSNull()
        case "openLibrary":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            value = try await openLibrary() ?? NSNull()
        case "closeLibrary":
            let sessionID = try requireActiveSession(payload)
            _ = try await requestValue(
                method: "close_library",
                params: ["sessionId": sessionID],
                expected: "library_closed"
            )
            activeSessionID = nil
            activeLibraryPath = nil
            value = NSNull()
        case "chooseRoot":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            value = try await chooseRoot(sessionID: try requireActiveSession(payload)) ?? NSNull()
        case "queryAssets":
            let sessionID = try requireActiveSession(payload)
            let offset = try Self.integer(payload, "offset", minimum: 0, maximum: Int.max)
            let limit = try Self.integer(payload, "limit", minimum: 1, maximum: 250)
            let projection = try Self.string(payload, "projection")
            guard ["contact_sheet_tiny", "contact_sheet_standard", "contact_sheet_detailed"].contains(projection) else {
                throw BridgeValidation.ValidationError.invalidArgument("projection")
            }
            value = try await requestValue(
                method: "query_assets",
                params: [
                    "sessionId": sessionID,
                    "offset": offset,
                    "limit": limit,
                    "projection": projection
                ],
                expected: "asset_page"
            )
        case "revealLocation":
            let sessionID = try requireActiveSession(payload)
            let locationID = try Self.opaqueID(payload, "locationId")
            let location = try await requestValue(
                method: "resolve_location",
                params: ["sessionId": sessionID, "locationId": locationID],
                expected: "location_resolved"
            )
            guard let dictionary = location as? [String: Any],
                  let nativePath = dictionary["nativePathForShell"] as? String else {
                throw ModelFailure.invalidCoreResponse
            }
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: nativePath)])
            value = NSNull()
        case "queryCapabilities":
            let requestedSession = payload["sessionId"] as? String
            if let requestedSession {
                guard requestedSession == activeSessionID else { throw ModelFailure.sessionClosed }
                _ = try Self.opaqueID(payload, "sessionId")
            }
            let sessionValue: Any
            if let requestedSession {
                sessionValue = requestedSession
            } else {
                sessionValue = NSNull()
            }
            let capabilities = try await requestValue(
                method: "get_capabilities",
                params: ["sessionId": sessionValue],
                expected: "capabilities"
            )
            if let dictionary = capabilities as? [String: Any], let detail = dictionary["detail"] {
                value = detail
            } else {
                throw ModelFailure.invalidCoreResponse
            }
        case "canonicalDump":
            let sessionID = try requireActiveSession(payload)
            let result = try await requestValue(
                method: "canonical_dump",
                params: ["sessionId": sessionID],
                expected: "canonical_dump"
            )
            guard let dictionary = result as? [String: Any], let dump = dictionary["dump"] else {
                throw ModelFailure.invalidCoreResponse
            }
            value = dump
        case "restartCore":
            value = try await restartCore() ?? NSNull()
        default:
            throw ModelFailure.unknownCommand
        }
        return try Self.jsonString(value)
    }

    func authorizeResource(sessionID: String, assetID: String, profile: String) async throws -> ResourceDescriptor {
        guard sessionID == activeSessionID else { throw ModelFailure.sessionClosed }
        _ = try BridgeValidation.assetResourceURL(
            sessionID: sessionID,
            assetID: assetID,
            profile: profile
        )
        let value = try await requestValue(
            method: "authorize_resource",
            params: ["sessionId": sessionID, "assetId": assetID, "profile": profile],
            expected: "resource_authorized"
        )
        guard let dictionary = value as? [String: Any],
              dictionary["sessionId"] as? String == sessionID,
              dictionary["assetId"] as? String == assetID,
              dictionary["profile"] as? String == profile,
              let nativePath = dictionary["nativePathForHandler"] as? String,
              let mimeType = dictionary["mimeType"] as? String,
              let length = dictionary["contentLength"] as? NSNumber else {
            throw ModelFailure.invalidCoreResponse
        }
        return ResourceDescriptor(
            nativePath: nativePath,
            mimeType: mimeType,
            contentLength: length.intValue
        )
    }

    private func createLibrary(name: String) async throws -> Any? {
        let safeName = try Self.libraryName(name)
        let panel = NSSavePanel()
        panel.title = "New Reference Library"
        panel.nameFieldStringValue = "\(safeName).pitchlibrary"
        panel.canCreateDirectories = true
        panel.prompt = "Create Library"
        guard panel.runModal() == .OK, var url = panel.url else { return nil }
        if url.pathExtension != "pitchlibrary" { url.appendPathExtension("pitchlibrary") }
        let path = url.standardizedFileURL.path
        let opened = try await requestValue(
            method: "create_library",
            params: ["path": path, "name": safeName],
            expected: "session_opened"
        )
        try acceptOpenedSession(opened, path: path)
        return opened
    }

    private func openLibrary() async throws -> Any? {
        let panel = NSOpenPanel()
        panel.title = "Open Reference Library"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Open Library"
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        guard url.pathExtension == "pitchlibrary" else { throw ModelFailure.notLibraryPackage }
        let path = url.standardizedFileURL.path
        let opened = try await requestValue(
            method: "open_library",
            params: ["path": path],
            expected: "session_opened"
        )
        try acceptOpenedSession(opened, path: path)
        return opened
    }

    private func chooseRoot(sessionID: String) async throws -> Any? {
        let panel = NSOpenPanel()
        panel.title = "Add Source Root"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Add Root"
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        let result = try await requestValue(
            method: "add_root",
            params: [
                "sessionId": sessionID,
                "authorizedPath": url.standardizedFileURL.path,
                "displayName": url.lastPathComponent
            ],
            expected: "root_added"
        )
        guard let dictionary = result as? [String: Any], let rootID = dictionary["rootId"] as? String else {
            throw ModelFailure.invalidCoreResponse
        }
        guard grants.storeAndActivate(url: url, rootID: rootID) else {
            throw ModelFailure.bookmarkFailed
        }
        return result
    }

    private func restartCore() async throws -> Any? {
        let path = activeLibraryPath
        activeSessionID = nil
        try await core.restart()
        writesFrozen = false
        coreStatus = "Reference Core restarted"
        guard let path else { return nil }
        let opened = try await requestValue(
            method: "open_library",
            params: ["path": path],
            expected: "session_opened"
        )
        try acceptOpenedSession(opened, path: path)
        return opened
    }

    private func requestValue(method: String, params: Any?, expected: String) async throws -> Any {
        var command: [String: Any] = ["method": method]
        if let params { command["params"] = params }
        let commandData = try JSONSerialization.data(withJSONObject: command)
        let frame: Data
        do {
            frame = try await core.request(commandData: commandData)
        } catch {
            writesFrozen = true
            coreStatus = error.localizedDescription
            throw error
        }
        guard let object = try JSONSerialization.jsonObject(with: frame) as? [String: Any],
              let kind = object["kind"] as? String else {
            throw ModelFailure.invalidCoreResponse
        }
        if kind == "error" {
            let error = object["error"] as? [String: Any]
            throw ModelFailure.core(error?["message"] as? String ?? "Reference Core request failed.")
        }
        guard kind == "response",
              let result = object["result"] as? [String: Any],
              result["result"] as? String == expected else {
            throw ModelFailure.invalidCoreResponse
        }
        return result["value"] ?? NSNull()
    }

    private func requireActiveSession(_ payload: [String: Any]) throws -> String {
        let requested = try Self.opaqueID(payload, "sessionId")
        guard requested == activeSessionID else { throw ModelFailure.sessionClosed }
        return requested
    }

    private func acceptOpenedSession(_ value: Any, path: String) throws {
        guard let dictionary = value as? [String: Any],
              let sessionID = dictionary["sessionId"] as? String,
              BridgeValidation.isOpaqueID(sessionID) else {
            throw ModelFailure.invalidCoreResponse
        }
        activeSessionID = sessionID
        activeLibraryPath = path
    }

    private func receiveCoreEvent(_ frame: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: frame) as? [String: Any],
              let event = object["event"] as? [String: Any] else { return }
        if event["event"] as? String == "core_needs_restart" {
            writesFrozen = true
            coreStatus = "Reference Core stopped"
        }
        guard let eventData = try? JSONSerialization.data(withJSONObject: event),
              let eventJSON = String(data: eventData, encoding: .utf8) else { return }
        workspace?.deliver(eventJSON: eventJSON)
    }

    private static func restartEvent(reason: String) -> Data {
        let object: [String: Any] = [
            "kind": "event",
            "protocolVersion": 1,
            "sequence": 0,
            "event": [
                "event": "core_needs_restart",
                "value": ["reason": reason]
            ]
        ]
        return (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    }

    private static func string(_ payload: [String: Any], _ name: String) throws -> String {
        guard let value = payload[name] as? String else {
            throw BridgeValidation.ValidationError.invalidArgument(name)
        }
        return value
    }

    private static func opaqueID(_ payload: [String: Any], _ name: String) throws -> String {
        let value = try string(payload, name)
        guard BridgeValidation.isOpaqueID(value) else {
            throw BridgeValidation.ValidationError.invalidOpaqueID
        }
        return value
    }

    private static func integer(
        _ payload: [String: Any],
        _ name: String,
        minimum: Int,
        maximum: Int
    ) throws -> Int {
        guard let number = payload[name] as? NSNumber else {
            throw BridgeValidation.ValidationError.invalidArgument(name)
        }
        let value = number.intValue
        guard Double(value) == number.doubleValue, (minimum...maximum).contains(value) else {
            throw BridgeValidation.ValidationError.invalidArgument(name)
        }
        return value
    }

    private static func libraryName(_ raw: String) throws -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let forbidden = CharacterSet(charactersIn: "\\/:*?\"<>|")
        guard !value.isEmpty, value.count <= 120, value.rangeOfCharacter(from: forbidden) == nil else {
            throw BridgeValidation.ValidationError.invalidArgument("name")
        }
        return value
    }

    private static func jsonString(_ value: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        guard let string = String(data: data, encoding: .utf8) else {
            throw ModelFailure.invalidCoreResponse
        }
        return string
    }

    enum ModelFailure: LocalizedError {
        case sessionClosed
        case restartRequired
        case unknownCommand
        case invalidCoreResponse
        case notLibraryPackage
        case bookmarkFailed
        case core(String)

        var errorDescription: String? {
            switch self {
            case .sessionClosed: "Library session is closed."
            case .restartRequired: "Reference Core must restart before writes continue."
            case .unknownCommand: "Unknown workspace command."
            case .invalidCoreResponse: "Reference Core returned an invalid response."
            case .notLibraryPackage: "Choose a .pitchlibrary package directory."
            case .bookmarkFailed: "The Root authorization could not be persisted."
            case let .core(message): message
            }
        }
    }
}

struct ResourceDescriptor: Sendable {
    let nativePath: String
    let mimeType: String
    let contentLength: Int
}
