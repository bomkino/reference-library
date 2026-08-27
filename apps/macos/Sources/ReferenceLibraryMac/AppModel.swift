import AppKit
import Combine
import Foundation

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var coreStatus = "Starting Reference Core…"

    private let core = CoreSupervisor()
    private let grants: any SecurityScopedGrantManaging
    private weak var workspace: WorkspaceWebView?
    private var pendingWorkspaceEvents: [String] = []
    private var activeSessionID: String?
    private var activeLibraryID: String?
    private var activeLibraryPath: String?
    private var started = false
    private var writesFrozen = false

    init() {
        grants = SecurityScopedGrantStore.shared
    }

    init(grants: any SecurityScopedGrantManaging) {
        self.grants = grants
    }

    func start() async {
        guard !started else { return }
        started = true
        await core.setEventSink { [weak self] data in
            Task { @MainActor in self?.receiveCoreEvent(data) }
        }
        do {
            try await core.start()
            coreStatus = "Reference Core ready"
        } catch {
            writesFrozen = true
            coreStatus = "Reference Core stopped"
            receiveCoreEvent(AppModelEventPolicy.restartFrame())
        }
    }

    func attach(workspace: WorkspaceWebView) {
        self.workspace = workspace
        for eventJSON in pendingWorkspaceEvents {
            workspace.deliver(eventJSON: eventJSON)
        }
        pendingWorkspaceEvents.removeAll(keepingCapacity: true)
    }

    func stop() async {
        await core.stop()
        grants.deactivateAll()
        clearActiveLibrary()
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
            try await closeActiveLibrary(sessionID: sessionID)
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
        guard panel.runModal() == .OK, let selectedURL = panel.url else { return nil }
        defer { selectedURL.stopAccessingSecurityScopedResource() }
        var packageURL = selectedURL
        if packageURL.pathExtension != "pitchlibrary" {
            packageURL.appendPathExtension("pitchlibrary")
        }
        packageURL = packageURL.standardizedFileURL
        try await closeActiveLibraryForSwitch()
        let opened = try await requestValue(
            method: "create_library",
            params: ["path": packageURL.path, "name": safeName],
            expected: "session_opened"
        )
        try await authorizeAndAdoptOpenedSession(opened, url: packageURL)
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
        defer { url.stopAccessingSecurityScopedResource() }
        guard url.pathExtension == "pitchlibrary" else { throw ModelFailure.notLibraryPackage }
        let packageURL = url.standardizedFileURL
        try await closeActiveLibraryForSwitch()
        let opened = try await requestValue(
            method: "open_library",
            params: ["path": packageURL.path],
            expected: "session_opened"
        )
        try await authorizeAndAdoptOpenedSession(opened, url: packageURL)
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
        defer { url.stopAccessingSecurityScopedResource() }
        guard let libraryID = activeLibraryID, grants.activeLibraryID == libraryID else {
            throw ModelFailure.libraryAuthorizationFailed
        }
        let rootURL = url.standardizedFileURL
        let added = try await RootAuthorityTransition.perform(
            prepare: { [grants] in
                guard let provisional = grants.prepareRootGrant(url: rootURL, libraryID: libraryID) else {
                    throw ModelFailure.rootAuthorizationFailed
                }
                return provisional
            },
            add: { [self] in
                let result = try await self.requestValue(
                    method: "add_root",
                    params: [
                        "sessionId": sessionID,
                        "authorizedPath": rootURL.path,
                        "displayName": rootURL.lastPathComponent
                    ],
                    expected: "root_added"
                )
                return try Self.addedRoot(from: result)
            },
            commit: { [grants] provisional, added in
                guard grants.commitRootGrant(provisional, rootID: added.rootID) else {
                    throw ModelFailure.rootAuthorizationFailed
                }
            },
            rollbackAdded: { [self] added in
                await self.rollbackAddedRoot(added, sessionID: sessionID)
            },
            discard: { [grants] provisional in
                grants.discardRootGrant(provisional)
            }
        )
        return added.value
    }

    private func restartCore() async throws -> Any? {
        let path = activeLibraryPath
        let libraryID = activeLibraryID
        activeSessionID = nil
        do {
            try await core.restart()
            guard let path, let libraryID else {
                writesFrozen = false
                coreStatus = "Reference Core restarted"
                return nil
            }
            let opened = try await requestValue(
                method: "open_library",
                params: ["path": path],
                expected: "session_opened"
            )
            let session = try Self.openedSession(from: opened)
            guard session.libraryID == libraryID else {
                await closeProvisionalSessionOrRestart(session.sessionID)
                throw ModelFailure.invalidCoreResponse
            }
            guard grants.activeLibraryID == libraryID || grants.activatePersistedLibrary(libraryID: libraryID) else {
                await closeProvisionalSessionOrRestart(session.sessionID)
                throw ModelFailure.libraryAuthorizationFailed
            }
            activeSessionID = session.sessionID
            _ = grants.activatePersistedRoots(libraryID: libraryID)
            writesFrozen = false
            coreStatus = "Reference Core restarted"
            return opened
        } catch {
            writesFrozen = true
            coreStatus = "Reference Core stopped"
            throw error
        }
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
            coreStatus = "Reference Core stopped"
            throw ModelFailure.restartRequired
        }
        return try Self.value(from: frame, expected: expected)
    }

    private func cleanupCoreCommand(method: String, params: Any?, expected: String) async throws -> Any {
        var command: [String: Any] = ["method": method]
        if let params { command["params"] = params }
        let commandData = try JSONSerialization.data(withJSONObject: command)
        let frame = try await core.request(commandData: commandData)
        return try Self.value(from: frame, expected: expected)
    }

    private static func value(from frame: Data, expected: String) throws -> Any {
        guard let object = try? JSONSerialization.jsonObject(with: frame) as? [String: Any],
              let kind = object["kind"] as? String else {
            throw ModelFailure.invalidCoreResponse
        }
        if kind == "error" {
            throw ModelFailure.coreRequestFailed
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

    private func authorizeAndAdoptOpenedSession(_ value: Any, url: URL) async throws {
        let opened: OpenedSession
        do {
            opened = try Self.openedSession(from: value)
        } catch {
            if let sessionID = Self.provisionalSessionID(from: value) {
                await closeProvisionalSessionOrRestart(sessionID)
            } else {
                await restartHelperAfterCleanupFailure()
            }
            throw error
        }
        guard let provisional = grants.prepareLibraryGrant(url: url, libraryID: opened.libraryID) else {
            await closeProvisionalSessionOrRestart(opened.sessionID)
            throw ModelFailure.libraryAuthorizationFailed
        }
        do {
            try await LibraryAuthorityTransition.perform(
                persistAndActivate: { [grants] in
                    guard grants.commitLibraryGrant(provisional) else {
                        throw ModelFailure.libraryAuthorizationFailed
                    }
                },
                adopt: { [self] in
                    self.activeSessionID = opened.sessionID
                    self.activeLibraryID = opened.libraryID
                    self.activeLibraryPath = url.path
                    _ = self.grants.activatePersistedRoots(libraryID: opened.libraryID)
                },
                rollback: { [self] in
                    self.grants.rollbackLibraryGrant(provisional)
                    self.clearActiveLibrary()
                    await self.closeProvisionalSessionOrRestart(opened.sessionID)
                }
            )
        } catch {
            clearActiveLibrary()
            throw error
        }
    }

    private static func openedSession(from value: Any) throws -> OpenedSession {
        guard let dictionary = value as? [String: Any],
              let sessionID = dictionary["sessionId"] as? String,
              let libraryID = dictionary["libraryId"] as? String,
              BridgeValidation.isOpaqueID(sessionID),
              BridgeValidation.isOpaqueID(libraryID) else {
            throw ModelFailure.invalidCoreResponse
        }
        return OpenedSession(sessionID: sessionID, libraryID: libraryID)
    }

    private static func provisionalSessionID(from value: Any) -> String? {
        guard let dictionary = value as? [String: Any],
              let sessionID = dictionary["sessionId"] as? String,
              BridgeValidation.isOpaqueID(sessionID) else {
            return nil
        }
        return sessionID
    }

    private static func addedRoot(from value: Any) throws -> AddedRoot {
        guard let dictionary = value as? [String: Any],
              let rootID = dictionary["rootId"] as? String,
              let jobID = dictionary["jobId"] as? String,
              BridgeValidation.isOpaqueID(rootID),
              BridgeValidation.isOpaqueID(jobID) else {
            throw ModelFailure.invalidCoreResponse
        }
        return AddedRoot(value: value, rootID: rootID, jobID: jobID)
    }

    private func closeActiveLibraryForSwitch() async throws {
        guard let sessionID = activeSessionID else {
            grants.deactivateAll()
            clearActiveLibrary()
            return
        }
        try await closeActiveLibrary(sessionID: sessionID)
    }

    private func closeActiveLibrary(sessionID: String) async throws {
        do {
            let value = try await requestValue(
                method: "close_library",
                params: ["sessionId": sessionID],
                expected: "library_closed"
            )
            guard let closed = value as? [String: Any], closed["sessionId"] as? String == sessionID else {
                throw ModelFailure.invalidCoreResponse
            }
        } catch {
            writesFrozen = true
            coreStatus = "Reference Core stopped"
            receiveCoreEvent(AppModelEventPolicy.restartFrame())
            throw error
        }
        grants.deactivateAll()
        clearActiveLibrary()
    }

    private func closeProvisionalSessionOrRestart(_ sessionID: String) async {
        let outcome = await ProvisionalSessionCleanup.perform(
            close: { [self] in
                let value = try await cleanupCoreCommand(
                    method: "close_library",
                    params: ["sessionId": sessionID],
                    expected: "library_closed"
                )
                guard let closed = value as? [String: Any], closed["sessionId"] as? String == sessionID else {
                    throw ModelFailure.invalidCoreResponse
                }
            },
            restartHelper: { [self] in try await core.restart() }
        )
        switch outcome {
        case .closed:
            break
        case .helperRestarted:
            writesFrozen = false
            coreStatus = "Reference Core ready"
        case .helperUnavailable:
            writesFrozen = true
            coreStatus = "Reference Core stopped"
            receiveCoreEvent(AppModelEventPolicy.restartFrame())
        }
    }

    private func restartHelperAfterCleanupFailure() async {
        do {
            try await core.restart()
            writesFrozen = false
            coreStatus = "Reference Core ready"
        } catch {
            writesFrozen = true
            coreStatus = "Reference Core stopped"
            receiveCoreEvent(AppModelEventPolicy.restartFrame())
        }
    }

    private func rollbackAddedRoot(_ added: AddedRoot, sessionID: String) async {
        let rolledBack = await RootCanonicalRollback.perform(
            cancelJob: { [self] in
                _ = try? await cleanupCoreCommand(
                    method: "cancel_job",
                    params: ["sessionId": sessionID, "jobId": added.jobID],
                    expected: "job_cancellation"
                )
            },
            unbindRoot: { [self] in
                let value = try await cleanupCoreCommand(
                    method: "unbind_root",
                    params: ["sessionId": sessionID, "rootId": added.rootID],
                    expected: "root_unbound"
                )
                guard let dictionary = value as? [String: Any],
                      let root = dictionary["root"] as? [String: Any],
                      root["rootId"] as? String == added.rootID else {
                    throw ModelFailure.invalidCoreResponse
                }
            }
        )
        if !rolledBack {
            writesFrozen = true
            coreStatus = "Reference Core stopped"
            receiveCoreEvent(AppModelEventPolicy.restartFrame())
        }
    }

    private func clearActiveLibrary() {
        activeSessionID = nil
        activeLibraryID = nil
        activeLibraryPath = nil
    }

    private func receiveCoreEvent(_ frame: Data) {
        guard let event = AppModelEventPolicy.rendererEvent(fromCoreFrame: frame) else { return }
        if event.name == "core_needs_restart" {
            writesFrozen = true
            coreStatus = "Reference Core stopped"
        }
        if let workspace {
            workspace.deliver(eventJSON: event.json)
        } else {
            AppModelEventPolicy.appendPending(event.json, to: &pendingWorkspaceEvents)
        }
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

    private struct OpenedSession {
        let sessionID: String
        let libraryID: String
    }

    private struct AddedRoot {
        let value: Any
        let rootID: String
        let jobID: String
    }

    enum ModelFailure: LocalizedError {
        case sessionClosed
        case restartRequired
        case unknownCommand
        case invalidCoreResponse
        case notLibraryPackage
        case libraryAuthorizationFailed
        case rootAuthorizationFailed
        case coreRequestFailed

        var errorDescription: String? {
            switch self {
            case .sessionClosed: "Library session is closed."
            case .restartRequired: "Reference Core must restart before writes continue."
            case .unknownCommand: "Unknown workspace command."
            case .invalidCoreResponse: "Reference Core returned an invalid response."
            case .notLibraryPackage: "Choose a .pitchlibrary package directory."
            case .libraryAuthorizationFailed: "The Library authorization could not be persisted."
            case .rootAuthorizationFailed: "The Root authorization could not be persisted."
            case .coreRequestFailed: "Reference Core could not complete the request."
            }
        }
    }
}

struct ResourceDescriptor: Sendable {
    let nativePath: String
    let mimeType: String
    let contentLength: Int
}
