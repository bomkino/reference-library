import AppKit
import Combine
import CoreFoundation
import Foundation
import UniformTypeIdentifiers

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var coreStatus = "Starting Reference Core…"

    private let core = CoreSupervisor()
    private let grants: any SecurityScopedGrantManaging
    private let transitions = LibraryTransitionGate()
    private let openIntents = LibraryOpenIntentQueue()
    private let preferences = WorkspacePreferencesStore()
    private weak var workspace: WorkspaceWebView?
    private var pendingWorkspaceEvents: [String] = []
    private var activeSessionID: String?
    private var activeLibraryID: String?
    private var activeLibraryPath: String?
    private var activeOpenedSession: OpenedSession?
    private var transitionEpoch: UInt64 = 0
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
        writesFrozen = false
        coreStatus = "Choose or open a Reference Library"
    }

    // Authority transitions call this only after the exact Library and Root
    // security-scoped leases required by the child are active.
    func startCoreAfterAuthority() async throws {
        guard grants.activeLibraryID != nil else { throw ModelFailure.libraryAuthorizationFailed }
        do {
            try await core.start()
            writesFrozen = false
            coreStatus = "Reference Core ready"
            drainOpenIntent()
        } catch {
            writesFrozen = true
            coreStatus = "Reference Core stopped"
            receiveCoreEvent(AppModelEventPolicy.restartFrame())
            throw error
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
        _ = beginTransition()
        writesFrozen = true
        await core.stop()
        grants.deactivateAll()
        clearActiveLibrary()
        started = false
    }

    func receiveExternalOpen(urls: [URL]) {
        for url in urls.prefix(LibraryOpenIntentQueue.maximumCount) {
            Task { @MainActor [weak self] in await self?.receiveExternalOpen(url: url) }
        }
    }

    func handleBridge(command: String, payload: [String: Any]) async throws -> String {
        let value: Any
        switch command {
        case "createLibrary":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            value = try await transitions.run { [self] in
                try await createLibrary(name: try Self.string(payload, "name"))
            } ?? NSNull()
        case "openLibrary":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            value = try await transitions.run { [self] in try await openLibrary() } ?? NSNull()
        case "completeOpenIntent":
            value = try await completeOpenIntent(
                id: try Self.opaqueID(payload, "intentId"),
                decision: try Self.openDecision(payload["decision"])
            ) ?? NSNull()
        case "closeLibrary":
            let sessionID = try requireActiveSession(payload)
            try await transitions.run { [self] in try await closeActiveLibrary(sessionID: sessionID) }
            value = NSNull()
        case "chooseRoot":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            let sessionID = try requireActiveSession(payload)
            value = try await transitions.run { [self] in try await chooseRoot(sessionID: sessionID) } ?? NSNull()
        case "reauthorizeRoot":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            let sessionID = try requireActiveSession(payload)
            let rootID = try Self.opaqueID(payload, "rootId")
            value = try await transitions.run { [self] in
                try await reauthorizeRoot(sessionID: sessionID, rootID: rootID)
            } ?? NSNull()
        case "listRoots":
            value = try await roots(sessionID: try requireActiveSession(payload))
        case "scanRoot":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            let sessionID = try requireActiveSession(payload)
            value = try await epochCheckedRequest(
                method: "scan_root",
                params: ["sessionId": sessionID, "rootId": try Self.opaqueID(payload, "rootId")],
                expected: "root_scan_started",
                sessionID: sessionID
            )
        case "cancelJob":
            let sessionID = try requireActiveSession(payload)
            _ = try await epochCheckedRequest(
                method: "cancel_job",
                params: ["sessionId": sessionID, "jobId": try Self.opaqueID(payload, "jobId")],
                expected: "job_cancellation",
                sessionID: sessionID
            )
            value = NSNull()
        case "queryJobs":
            value = try await queryJobs(payload)
        case "queryAssets":
            value = try await queryAssets(payload)
        case "getAsset":
            let sessionID = try requireActiveSession(payload)
            value = try await epochCheckedRequest(
                method: "get_asset",
                params: ["sessionId": sessionID, "assetId": try Self.opaqueID(payload, "assetId")],
                expected: "asset",
                sessionID: sessionID
            )
        case "updateAsset":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            value = try await updateAsset(payload)
        case "listCollections":
            let sessionID = try requireActiveSession(payload)
            let result = try Self.dictionary(try await epochCheckedRequest(
                method: "list_collections", params: ["sessionId": sessionID],
                expected: "collections", sessionID: sessionID
            ), "collections")
            value = result["items"] ?? []
        case "createCollection":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            let sessionID = try requireActiveSession(payload)
            let result = try Self.dictionary(try await epochCheckedRequest(
                method: "create_collection",
                params: ["sessionId": sessionID, "name": try Self.text(payload, "name", maximumScalars: 200)],
                expected: "collection_updated", sessionID: sessionID
            ), "collection")
            value = result["collection"] ?? NSNull()
        case "renameCollection":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            let sessionID = try requireActiveSession(payload)
            let result = try Self.dictionary(try await epochCheckedRequest(
                method: "rename_collection",
                params: [
                    "sessionId": sessionID,
                    "collectionId": try Self.opaqueID(payload, "collectionId"),
                    "expectedRevision": try Self.integer(payload, "expectedRevision", minimum: 0, maximum: Int.max),
                    "name": try Self.text(payload, "name", maximumScalars: 200)
                ],
                expected: "collection_updated", sessionID: sessionID
            ), "collection")
            value = result["collection"] ?? NSNull()
        case "deleteCollection":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            let sessionID = try requireActiveSession(payload)
            _ = try await epochCheckedRequest(
                method: "delete_collection",
                params: ["sessionId": sessionID, "collectionId": try Self.opaqueID(payload, "collectionId")],
                expected: "collection_deleted", sessionID: sessionID
            )
            value = NSNull()
        case "setCollectionMembership":
            guard !writesFrozen else { throw ModelFailure.restartRequired }
            value = try await setCollectionMembership(payload)
        case "revealLocation":
            let sessionID = try requireActiveSession(payload)
            let epoch = transitionEpoch
            let locationID = try Self.opaqueID(payload, "locationId")
            let location = try await requestValue(
                method: "resolve_location",
                params: ["sessionId": sessionID, "locationId": locationID],
                expected: "location_resolved"
            )
            try requireCurrentTransition(epoch, sessionID: sessionID)
            guard let dictionary = location as? [String: Any],
                  let nativePath = dictionary["nativePathForShell"] as? String else {
                throw ModelFailure.invalidCoreResponse
            }
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: nativePath)])
            value = NSNull()
        case "readPreferences":
            value = try preferences.read().dictionary()
        case "writePreferences":
            value = try preferences.write(patch: try Self.dictionary(payload["patch"], "patch")).dictionary()
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
            let capabilityEpoch = transitionEpoch
            let capabilities = try await requestValue(
                method: "get_capabilities",
                params: ["sessionId": sessionValue],
                expected: "capabilities"
            )
            try requireCurrentTransition(capabilityEpoch, sessionID: requestedSession)
            if let dictionary = capabilities as? [String: Any], let detail = dictionary["detail"] {
                value = detail
            } else {
                throw ModelFailure.invalidCoreResponse
            }
        case "canonicalDump":
            let sessionID = try requireActiveSession(payload)
            let epoch = transitionEpoch
            let result = try await requestValue(
                method: "canonical_dump",
                params: ["sessionId": sessionID],
                expected: "canonical_dump"
            )
            try requireCurrentTransition(epoch, sessionID: sessionID)
            guard let dictionary = result as? [String: Any], let dump = dictionary["dump"] else {
                throw ModelFailure.invalidCoreResponse
            }
            value = dump
        case "restartCore":
            value = try await transitions.run { [self] in try await restartCore() } ?? NSNull()
        default:
            throw ModelFailure.unknownCommand
        }
        return try Self.jsonString(value)
    }

    func rendererMessage(for error: Error) -> String {
        switch error {
        case let failure as ModelFailure:
            return failure.localizedDescription
        case let failure as BridgeValidation.ValidationError:
            return failure.localizedDescription
        case let failure as WorkspacePreferences.Failure:
            return failure.localizedDescription
        case let failure as LibraryOpenIntentQueue.IntentFailure:
            return failure.localizedDescription
        case let failure as AuthorityTransitionFailure:
            return failure.localizedDescription
        default:
            return "The native Reference Library operation failed."
        }
    }

    func authorizeResource(sessionID: String, assetID: String, profile: String) async throws -> ResourceDescriptor {
        guard sessionID == activeSessionID else { throw ModelFailure.sessionClosed }
        let epoch = transitionEpoch
        _ = try BridgeValidation.assetResourceURL(
            sessionID: sessionID,
            assetID: assetID,
            profile: profile
        )
        let frame: Data
        do {
            frame = try await core.authorizeResource(sessionID: sessionID, assetID: assetID, profile: profile)
        } catch let failure as CoreSupervisor.RequestFailure {
            throw ModelFailure.core(failure.code)
        } catch {
            throw ModelFailure.restartRequired
        }
        try requireCurrentTransition(epoch, sessionID: sessionID)
        let value = try CoreSupervisor.responseValue(frame, expected: "resource_authorized")
        guard let dictionary = value as? [String: Any],
              dictionary["sessionId"] as? String == sessionID,
              dictionary["assetId"] as? String == assetID,
              dictionary["profile"] as? String == profile,
              let nativePath = dictionary["nativePathForHandler"] as? String,
              let mimeType = dictionary["mimeType"] as? String,
              let length = dictionary["contentLength"] as? NSNumber,
              Self.nonnegativeInteger(length),
              length.intValue <= ResourceFileStreamer.maximumBytes else {
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
        panel.allowedContentTypes = [Self.libraryContentType]
        panel.allowsOtherFileTypes = false
        panel.isExtensionHidden = false
        panel.canCreateDirectories = true
        panel.prompt = "Create Library"
        guard panel.runModal() == .OK, let selectedURL = panel.url else { return nil }
        var panelScopeActive = selectedURL.startAccessingSecurityScopedResource()
        defer {
            if panelScopeActive { selectedURL.stopAccessingSecurityScopedResource() }
        }
        guard selectedURL.pathExtension.lowercased() == "pitchlibrary" else {
            throw ModelFailure.notLibraryPackage
        }
        let packageURL = Self.canonicalCreationURL(selectedURL)
        let previous = currentLibrarySnapshot()
        try await closeActiveLibraryForSwitch()
        let epoch = beginTransition()
        let created: OpenedSession
        do {
            try await core.start()
            try requireCurrentTransition(epoch)
            let opened = try await requestValue(
                method: "create_library",
                params: ["path": packageURL.path, "name": safeName],
                expected: "session_opened"
            )
            created = try Self.openedSession(from: opened)
            try requireCurrentTransition(epoch)
        } catch {
            await core.stop()
            clearActiveLibrary()
            await restorePreviousLibrary(previous, epoch: epoch)
            throw error
        }
        guard let provisional = grants.prepareLibraryGrant(url: packageURL, libraryID: created.libraryID),
              grants.commitLibraryGrant(provisional) else {
            _ = try? await cleanupCoreCommand(
                method: "close_library",
                params: ["sessionId": created.sessionID],
                expected: "library_closed"
            )
            await core.stop()
            clearActiveLibrary()
            await restorePreviousLibrary(previous, epoch: epoch)
            throw ModelFailure.libraryAuthorizationFailed
        }
        if panelScopeActive {
            selectedURL.stopAccessingSecurityScopedResource()
            panelScopeActive = false
        }
        await closeProvisionalSessionOrRestart(created.sessionID)
        do {
            let session = try await launchCoreWithAuthorizedLibrary(
                path: packageURL.path,
                libraryID: created.libraryID,
                epoch: epoch
            )
            deliverLibraryOpened(session)
            return session.value
        } catch {
            let rolledBack = grants.rollbackLibraryGrant(provisional)
            clearActiveLibrary()
            if !rolledBack {
                await failClosedAuthority()
                throw AuthorityTransitionFailure.rollbackPersistenceFailed
            }
            await restorePreviousLibrary(previous, epoch: epoch)
            throw error
        }
    }

    private func openLibrary() async throws -> Any? {
        let panel = NSOpenPanel()
        panel.title = "Open Reference Library"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowedContentTypes = [Self.libraryContentType]
        panel.allowsMultipleSelection = false
        panel.prompt = "Open Library"
        guard panel.runModal() == .OK, let selectedURL = panel.url else { return nil }
        let panelScopeActive = selectedURL.startAccessingSecurityScopedResource()
        defer {
            if panelScopeActive { selectedURL.stopAccessingSecurityScopedResource() }
        }
        let packageURL = try Self.validatePackage(selectedURL)
        return try await openAuthorizedLibrary(packageURL)
    }

    private func openAuthorizedLibrary(_ packageURL: URL) async throws -> Any {
        let libraryID = try Self.libraryIDForAuthority(at: packageURL)
        if activeLibraryID == libraryID,
           activeLibraryPath == packageURL.path,
           let activeOpenedSession {
            return activeOpenedSession.value
        }
        let previous = currentLibrarySnapshot()
        try await closeActiveLibraryForSwitch()
        let epoch = beginTransition()
        guard let provisional = grants.prepareLibraryGrant(url: packageURL, libraryID: libraryID),
              grants.commitLibraryGrant(provisional) else {
            await restorePreviousLibrary(previous, epoch: epoch)
            throw ModelFailure.libraryAuthorizationFailed
        }
        do {
            let session = try await launchCoreWithAuthorizedLibrary(
                path: packageURL.path,
                libraryID: libraryID,
                epoch: epoch
            )
            deliverLibraryOpened(session)
            return session.value
        } catch {
            let rolledBack = grants.rollbackLibraryGrant(provisional)
            clearActiveLibrary()
            if !rolledBack {
                await failClosedAuthority()
                throw AuthorityTransitionFailure.rollbackPersistenceFailed
            }
            await restorePreviousLibrary(previous, epoch: epoch)
            throw error
        }
    }

    private func chooseRoot(sessionID: String) async throws -> Any? {
        let panel = NSOpenPanel()
        panel.title = "Add Source Root"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Add Root"
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        var panelScopeActive = url.startAccessingSecurityScopedResource()
        defer {
            if panelScopeActive { url.stopAccessingSecurityScopedResource() }
        }
        guard activeSessionID == sessionID,
              let libraryID = activeLibraryID,
              grants.activeLibraryID == libraryID else {
            throw ModelFailure.libraryAuthorizationFailed
        }
        let epoch = beginTransition()
        let rootURL = url.standardizedFileURL
        guard let provisional = grants.prepareRootGrant(url: rootURL, libraryID: libraryID) else {
            throw ModelFailure.rootAuthorizationFailed
        }
        if panelScopeActive {
            url.stopAccessingSecurityScopedResource()
            panelScopeActive = false
        }
        var replacement: OpenedSession?
        do {
            let added = try await RootAuthorityTransition.perform(
                prepare: { provisional },
                adoptInCore: { [self] in
                    let session = try await recycleCoreForCurrentAuthority(epoch: epoch)
                    replacement = session
                    let result = try await self.requestValue(
                        method: "add_root",
                        params: [
                            "sessionId": session.sessionID,
                            "authorizedPath": rootURL.path,
                            "displayName": rootURL.lastPathComponent
                        ],
                        expected: "root_added"
                    )
                    try self.requireCurrentTransition(epoch, sessionID: session.sessionID)
                    return try Self.addedRoot(from: result, session: session)
                },
                finalizeHostAuthority: { [grants] provisional, added in
                    try self.requireCurrentTransition(epoch, sessionID: added.session.sessionID)
                    guard grants.commitRootGrant(provisional, rootID: added.rootID) else {
                        throw ModelFailure.rootAuthorizationNeedsRepair
                    }
                },
                discardBeforeAdoption: { [grants] provisional in
                    grants.discardRootGrant(provisional)
                }
            )
            deliverLibraryOpened(added.session)
            return [
                "session": added.session.value,
                "rootId": added.rootID,
                "jobId": added.jobID
            ]
        } catch {
            if let failure = error as? ModelFailure, case .rootAuthorizationNeedsRepair = failure {
                await failClosedAuthority()
                throw error
            }
            if replacement == nil, transitionEpoch == epoch {
                replacement = try? await recycleCoreForCurrentAuthority(epoch: epoch)
            }
            if let replacement {
                deliverLibraryOpened(replacement)
            }
            if error is AuthorityTransitionFailure {
                await failClosedAuthority()
            }
            throw error
        }
    }

    private func reauthorizeRoot(sessionID: String, rootID: String) async throws -> Any? {
        let panel = NSOpenPanel()
        panel.title = "Reauthorize Source Root"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Reauthorize"
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        var panelScopeActive = url.startAccessingSecurityScopedResource()
        defer {
            if panelScopeActive { url.stopAccessingSecurityScopedResource() }
        }
        guard activeSessionID == sessionID,
              let libraryID = activeLibraryID,
              grants.activeLibraryID == libraryID else {
            throw ModelFailure.libraryAuthorizationFailed
        }
        let epoch = beginTransition()
        let rootURL = url.standardizedFileURL
        guard let provisional = grants.prepareRootGrant(url: rootURL, libraryID: libraryID) else {
            throw ModelFailure.rootAuthorizationFailed
        }
        if panelScopeActive {
            url.stopAccessingSecurityScopedResource()
            panelScopeActive = false
        }
        var replacement: OpenedSession?
        do {
            let bound = try await RootAuthorityTransition.perform(
                prepare: { provisional },
                adoptInCore: { [self] in
                    let session = try await recycleCoreForCurrentAuthority(epoch: epoch)
                    replacement = session
                    let result = try await self.requestValue(
                        method: "bind_root",
                        params: [
                            "sessionId": session.sessionID,
                            "rootId": rootID,
                            "authorizedPath": rootURL.path
                        ],
                        expected: "root_bound"
                    )
                    try self.requireCurrentTransition(epoch, sessionID: session.sessionID)
                    return try Self.boundRoot(from: result, expectedRootID: rootID, session: session)
                },
                finalizeHostAuthority: { [grants] provisional, bound in
                    try self.requireCurrentTransition(epoch, sessionID: bound.session.sessionID)
                    guard grants.commitRootGrant(provisional, rootID: rootID) else {
                        throw ModelFailure.rootAuthorizationNeedsRepair
                    }
                },
                discardBeforeAdoption: { [grants] provisional in
                    grants.discardRootGrant(provisional)
                }
            )
            deliverLibraryOpened(bound.session)
            return ["session": bound.session.value, "root": bound.root]
        } catch {
            if let failure = error as? ModelFailure, case .rootAuthorizationNeedsRepair = failure {
                await failClosedAuthority()
                throw error
            }
            if replacement == nil, transitionEpoch == epoch {
                replacement = try? await recycleCoreForCurrentAuthority(epoch: epoch)
            }
            if let replacement { deliverLibraryOpened(replacement) }
            if error is AuthorityTransitionFailure {
                await failClosedAuthority()
            }
            throw error
        }
    }

    private func roots(sessionID: String) async throws -> Any {
        let result = try Self.dictionary(try await epochCheckedRequest(
            method: "list_roots",
            params: ["sessionId": sessionID],
            expected: "roots",
            sessionID: sessionID
        ), "roots")
        return result["items"] ?? []
    }

    private func queryJobs(_ payload: [String: Any]) async throws -> Any {
        let sessionID = try requireActiveSession(payload)
        let query = try Self.dictionary(payload["query"], "query")
        if let rootID = query["rootId"], !(rootID is NSNull) {
            _ = try Self.opaqueID(query, "rootId")
        }
        _ = try Self.stringSet(
            query["states"],
            allowed: Self.jobStates,
            maximum: Self.jobStates.count,
            name: "states"
        )
        return try await epochCheckedRequest(
            method: "query_jobs",
            params: [
                "sessionId": sessionID,
                "offset": try Self.integer(payload, "offset", minimum: 0, maximum: Int.max),
                "limit": try Self.integer(payload, "limit", minimum: 1, maximum: 100),
                "query": query
            ],
            expected: "job_page",
            sessionID: sessionID
        )
    }

    private func queryAssets(_ payload: [String: Any]) async throws -> Any {
        let sessionID = try requireActiveSession(payload)
        let projection = try Self.string(payload, "projection")
        guard Self.projections.contains(projection) else { throw ModelFailure.invalidArgument }
        var query = try Self.dictionary(payload["query"], "query")
        if let search = query["search"], !(search is NSNull) {
            guard let text = search as? String, text.unicodeScalars.count <= 200 else {
                throw ModelFailure.invalidArgument
            }
            let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
            query["search"] = normalized.isEmpty ? NSNull() : normalized
        }
        for key in ["rootId", "collectionId"] where !(query[key] is NSNull) {
            _ = try Self.opaqueID(query, key)
        }
        _ = try Self.stringSet(
            query["reviewStates"], allowed: Self.reviewStates,
            maximum: Self.reviewStates.count, name: "reviewStates"
        )
        _ = try Self.stringSet(
            query["availability"], allowed: Self.availability,
            maximum: Self.availability.count, name: "availability"
        )
        guard let sort = query["sort"] as? String, Self.sorts.contains(sort) else {
            throw ModelFailure.invalidArgument
        }
        return try await epochCheckedRequest(
            method: "query_asset_index",
            params: [
                "sessionId": sessionID,
                "offset": try Self.integer(payload, "offset", minimum: 0, maximum: Int.max),
                "limit": try Self.integer(payload, "limit", minimum: 1, maximum: 250),
                "projection": projection,
                "query": query
            ],
            expected: "asset_page",
            sessionID: sessionID
        )
    }

    private func updateAsset(_ payload: [String: Any]) async throws -> Any {
        let sessionID = try requireActiveSession(payload)
        let patch = try Self.dictionary(payload["patch"], "patch")
        try Self.validateTextPatch(patch["customTitle"], maximum: 500)
        try Self.validateTextPatch(patch["note"], maximum: 5_000)
        if let review = patch["reviewState"] {
            guard let review = review as? String, Self.reviewStates.contains(review) else {
                throw ModelFailure.invalidArgument
            }
        }
        return try await epochCheckedRequest(
            method: "update_asset",
            params: [
                "sessionId": sessionID,
                "assetId": try Self.opaqueID(payload, "assetId"),
                "expectedRevision": try Self.integer(
                    payload, "expectedRevision", minimum: 0, maximum: Int.max
                ),
                "patch": patch
            ],
            expected: "asset_updated",
            sessionID: sessionID
        )
    }

    private func setCollectionMembership(_ payload: [String: Any]) async throws -> Any {
        let sessionID = try requireActiveSession(payload)
        guard let assetIDs = payload["assetIds"] as? [String],
              (1...250).contains(assetIDs.count),
              Set(assetIDs).count == assetIDs.count,
              assetIDs.allSatisfy(BridgeValidation.isOpaqueID),
              let member = payload["member"] as? Bool else {
            throw ModelFailure.invalidArgument
        }
        return try await epochCheckedRequest(
            method: "set_collection_membership",
            params: [
                "sessionId": sessionID,
                "collectionId": try Self.opaqueID(payload, "collectionId"),
                "assetIds": assetIDs,
                "member": member
            ],
            expected: "collection_membership_updated",
            sessionID: sessionID
        )
    }

    private func completeOpenIntent(id: String, decision: String) async throws -> Any? {
        _ = try openIntents.activeURL(id: id)
        if decision == "cancel" {
            _ = try openIntents.resolve(id: id)
            drainOpenIntent()
            return nil
        }
        guard !writesFrozen else { throw ModelFailure.restartRequired }
        let url = try openIntents.resolve(id: id)
        do {
            let opened = try await transitions.run { [self] in try await openAuthorizedLibrary(url) }
            drainOpenIntent()
            return opened
        } catch {
            drainOpenIntent()
            throw error
        }
    }

    private func receiveExternalOpen(url: URL) async {
        do {
            let canonical = try Self.validatePackage(url)
            if canonical.path == activeLibraryPath { return }
            guard openIntents.enqueue(canonical) else { return }
            drainOpenIntent()
        } catch {
            // Finder open errors remain private until an acknowledged intent exists.
        }
    }

    private func drainOpenIntent() {
        guard !writesFrozen, let request = openIntents.requestNext() else { return }
        deliver(event: ["event": "library_open_requested", "value": request])
    }

    private func restartCore() async throws -> Any? {
        let path = activeLibraryPath
        let libraryID = activeLibraryID
        let epoch = beginTransition()
        activeSessionID = nil
        do {
            guard let path, let libraryID else {
                await core.stop()
                writesFrozen = false
                coreStatus = "Choose or open a Reference Library"
                return nil
            }
            guard grants.activeLibraryID == libraryID || grants.activatePersistedLibrary(libraryID: libraryID) else {
                throw ModelFailure.libraryAuthorizationFailed
            }
            let session = try await launchCoreWithAuthorizedLibrary(
                path: path,
                libraryID: libraryID,
                epoch: epoch
            )
            coreStatus = "Reference Core restarted"
            deliverLibraryOpened(session)
            return session.value
        } catch {
            await failClosedAuthority()
            throw error
        }
    }

    private func requestValue(method: String, params: Any?, expected: String) async throws -> Any {
        let commandData = try CoreSupervisor.commandData(method: method, params: params)
        do {
            return try CoreSupervisor.responseValue(
                try await core.request(commandData: commandData),
                expected: expected
            )
        } catch let failure as CoreSupervisor.RequestFailure {
            throw ModelFailure.core(failure.code)
        } catch let failure as ModelFailure {
            throw failure
        } catch {
            writesFrozen = true
            coreStatus = "Reference Core stopped"
            throw ModelFailure.restartRequired
        }
    }

    private func epochCheckedRequest(
        method: String,
        params: Any?,
        expected: String,
        sessionID: String
    ) async throws -> Any {
        let epoch = transitionEpoch
        let value = try await requestValue(method: method, params: params, expected: expected)
        try requireCurrentTransition(epoch, sessionID: sessionID)
        return value
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

    private static func openedSession(from value: Any) throws -> OpenedSession {
        guard let dictionary = value as? [String: Any],
              let sessionID = dictionary["sessionId"] as? String,
              let libraryID = dictionary["libraryId"] as? String,
              let schemaVersion = dictionary["schemaVersion"] as? NSNumber,
              schemaVersion.intValue >= 1,
              Double(schemaVersion.intValue) == schemaVersion.doubleValue,
              let name = dictionary["name"] as? String,
              safeDisplayName(name, maximumScalars: 120),
              BridgeValidation.isOpaqueID(sessionID),
              BridgeValidation.isOpaqueID(libraryID) else {
            throw ModelFailure.invalidCoreResponse
        }
        let safeValue: [String: Any] = [
            "sessionId": sessionID,
            "libraryId": libraryID,
            "schemaVersion": schemaVersion,
            "name": name
        ]
        return OpenedSession(value: safeValue, sessionID: sessionID, libraryID: libraryID)
    }

    private static func addedRoot(from value: Any, session: OpenedSession) throws -> AddedRoot {
        guard let dictionary = value as? [String: Any],
              let rootID = dictionary["rootId"] as? String,
              let jobID = dictionary["jobId"] as? String,
              BridgeValidation.isOpaqueID(rootID),
              BridgeValidation.isOpaqueID(jobID) else {
            throw ModelFailure.invalidCoreResponse
        }
        return AddedRoot(rootID: rootID, jobID: jobID, session: session)
    }

    private static func boundRoot(
        from value: Any,
        expectedRootID: String,
        session: OpenedSession
    ) throws -> BoundRoot {
        guard let dictionary = value as? [String: Any],
              let root = dictionary["root"] as? [String: Any],
              root["rootId"] as? String == expectedRootID,
              let displayName = root["displayName"] as? String,
              safeDisplayName(displayName, maximumScalars: 255),
              let rootKind = root["rootKind"] as? String,
              safeToken(rootKind),
              let state = root["state"] as? String,
              safeToken(state),
              let authorized = root["authorized"] as? Bool,
              let observedCount = root["observedCount"] as? NSNumber,
              nonnegativeInteger(observedCount),
              let unsupportedCount = root["unsupportedCount"] as? NSNumber,
              nonnegativeInteger(unsupportedCount) else {
            throw ModelFailure.invalidCoreResponse
        }
        let activeJobID: Any
        if let candidate = root["activeJobId"] as? String {
            guard BridgeValidation.isOpaqueID(candidate) else { throw ModelFailure.invalidCoreResponse }
            activeJobID = candidate
        } else {
            activeJobID = NSNull()
        }
        let safeRoot: [String: Any] = [
            "rootId": expectedRootID,
            "displayName": displayName,
            "rootKind": rootKind,
            "state": state,
            "authorized": authorized,
            "activeJobId": activeJobID,
            "observedCount": observedCount,
            "unsupportedCount": unsupportedCount
        ]
        return BoundRoot(root: safeRoot, session: session)
    }

    private func recycleCoreForCurrentAuthority(epoch: UInt64) async throws -> OpenedSession {
        guard let libraryID = activeLibraryID,
              let libraryPath = activeLibraryPath,
              grants.activeLibraryID == libraryID else {
            throw ModelFailure.libraryAuthorizationFailed
        }
        try requireCurrentTransition(epoch)
        if let sessionID = activeSessionID {
            _ = try? await cleanupCoreCommand(
                method: "close_library",
                params: ["sessionId": sessionID],
                expected: "library_closed"
            )
        }
        activeSessionID = nil
        return try await launchCoreWithAuthorizedLibrary(
            path: libraryPath,
            libraryID: libraryID,
            epoch: epoch
        )
    }

    private func launchCoreWithAuthorizedLibrary(
        path: String,
        libraryID: String,
        epoch: UInt64
    ) async throws -> OpenedSession {
        guard grants.activeLibraryID == libraryID else {
            throw ModelFailure.libraryAuthorizationFailed
        }
        let roots = grants.activatePersistedRoots(libraryID: libraryID)
        try await core.restart()
        try requireCurrentTransition(epoch)
        let value = try await requestValue(
            method: "open_library",
            params: ["path": path],
            expected: "session_opened"
        )
        let opened = try Self.openedSession(from: value)
        guard opened.libraryID == libraryID else {
            await closeProvisionalSessionOrRestart(opened.sessionID)
            throw ModelFailure.invalidCoreResponse
        }
        try requireCurrentTransition(epoch)
        do {
            for (rootID, rootURL) in roots.sorted(by: { $0.key < $1.key }) {
                let bound = try await requestValue(
                    method: "bind_root",
                    params: [
                        "sessionId": opened.sessionID,
                        "rootId": rootID,
                        "authorizedPath": rootURL.path
                    ],
                    expected: "root_bound"
                )
                try requireCurrentTransition(epoch)
                guard let dictionary = bound as? [String: Any],
                      let root = dictionary["root"] as? [String: Any],
                      root["rootId"] as? String == rootID else {
                    throw ModelFailure.invalidCoreResponse
                }
            }
        } catch {
            await closeProvisionalSessionOrRestart(opened.sessionID)
            throw error
        }
        activeSessionID = opened.sessionID
        activeLibraryID = libraryID
        activeLibraryPath = path
        activeOpenedSession = opened
        writesFrozen = false
        coreStatus = "Reference Core ready"
        return opened
    }

    private func currentLibrarySnapshot() -> LibrarySnapshot? {
        guard let libraryID = activeLibraryID, let path = activeLibraryPath else { return nil }
        return LibrarySnapshot(libraryID: libraryID, path: path)
    }

    private func restorePreviousLibrary(_ snapshot: LibrarySnapshot?, epoch: UInt64) async {
        guard let snapshot, transitionEpoch == epoch else { return }
        guard grants.activatePersistedLibrary(libraryID: snapshot.libraryID) else {
            await failClosedAuthority()
            return
        }
        do {
            let restored = try await launchCoreWithAuthorizedLibrary(
                path: snapshot.path,
                libraryID: snapshot.libraryID,
                epoch: epoch
            )
            deliverLibraryOpened(restored)
        } catch {
            await failClosedAuthority()
        }
    }

    private func failClosedAuthority() async {
        _ = beginTransition()
        writesFrozen = true
        await core.stop()
        grants.deactivateAll()
        clearActiveLibrary()
        coreStatus = "Reference Core stopped"
        receiveCoreEvent(AppModelEventPolicy.restartFrame())
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
        let epoch = beginTransition()
        do {
            let value = try await requestValue(
                method: "close_library",
                params: ["sessionId": sessionID],
                expected: "library_closed"
            )
            try requireCurrentTransition(epoch, sessionID: sessionID)
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

    private func clearActiveLibrary() {
        activeSessionID = nil
        activeLibraryID = nil
        activeLibraryPath = nil
        activeOpenedSession = nil
    }

    @discardableResult
    private func beginTransition() -> UInt64 {
        transitionEpoch &+= 1
        return transitionEpoch
    }

    private func requireCurrentTransition(_ epoch: UInt64, sessionID: String? = nil) throws {
        guard transitionEpoch == epoch else { throw ModelFailure.transitionSuperseded }
        if let sessionID, activeSessionID != sessionID { throw ModelFailure.transitionSuperseded }
    }

    private func receiveCoreEvent(_ frame: Data) {
        guard let event = AppModelEventPolicy.rendererEvent(fromCoreFrame: frame) else { return }
        if event.name == "core_needs_restart" {
            _ = beginTransition()
            writesFrozen = true
            coreStatus = "Reference Core stopped"
        }
        if let workspace {
            workspace.deliver(eventJSON: event.json)
        } else {
            AppModelEventPolicy.appendPending(event.json, to: &pendingWorkspaceEvents)
        }
    }

    private func deliverLibraryOpened(_ session: OpenedSession) {
        guard let value = session.value as? [String: Any],
              let eventJSON = AppModelEventPolicy.libraryOpenedJSON(session: value) else { return }
        if let workspace {
            workspace.deliver(eventJSON: eventJSON)
        } else {
            AppModelEventPolicy.appendPending(eventJSON, to: &pendingWorkspaceEvents)
        }
    }

    private func deliver(event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        if let workspace {
            workspace.deliver(eventJSON: json)
        } else {
            AppModelEventPolicy.appendPending(json, to: &pendingWorkspaceEvents)
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

    private static func text(
        _ payload: [String: Any],
        _ name: String,
        maximumScalars: Int
    ) throws -> String {
        let value = try string(payload, name).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.unicodeScalars.count <= maximumScalars else {
            throw ModelFailure.invalidArgument
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
        guard CFGetTypeID(number) != CFBooleanGetTypeID(),
              Double(value) == number.doubleValue,
              (minimum...maximum).contains(value) else {
            throw BridgeValidation.ValidationError.invalidArgument(name)
        }
        return value
    }

    private static func dictionary(_ value: Any?, _ name: String) throws -> [String: Any] {
        guard let value = value as? [String: Any] else {
            throw BridgeValidation.ValidationError.invalidArgument(name)
        }
        return value
    }

    private static func stringSet(
        _ value: Any?,
        allowed: Set<String>,
        maximum: Int,
        name: String
    ) throws -> [String] {
        guard let values = value as? [String],
              values.count <= maximum,
              Set(values).count == values.count,
              values.allSatisfy(allowed.contains) else {
            throw BridgeValidation.ValidationError.invalidArgument(name)
        }
        return values
    }

    private static func validateTextPatch(_ value: Any?, maximum: Int) throws {
        let patch = try dictionary(value, "patch")
        guard let action = patch["action"] as? String,
              ["unchanged", "clear", "set"].contains(action) else {
            throw ModelFailure.invalidArgument
        }
        if action == "set" {
            guard let text = patch["value"] as? String,
                  text.unicodeScalars.count <= maximum else {
                throw ModelFailure.invalidArgument
            }
        } else if patch["value"] != nil {
            throw ModelFailure.invalidArgument
        }
    }

    private static func libraryName(_ raw: String) throws -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let forbidden = CharacterSet(charactersIn: "\\/:*?\"<>|")
        guard !value.isEmpty, value.count <= 120, value.rangeOfCharacter(from: forbidden) == nil else {
            throw BridgeValidation.ValidationError.invalidArgument("name")
        }
        return value
    }

    private static func openDecision(_ value: Any?) throws -> String {
        guard let value = value as? String,
              ["save", "discard", "cancel"].contains(value) else {
            throw ModelFailure.invalidArgument
        }
        return value
    }

    static func validatePackage(_ input: URL) throws -> URL {
        do {
            let url = input.standardizedFileURL
            guard url.pathExtension.lowercased() == "pitchlibrary" else {
                throw ModelFailure.notLibraryPackage
            }
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else {
                throw ModelFailure.notLibraryPackage
            }
            for child in ["manifest.json", "library.sqlite"] {
                let childValues = try url.appendingPathComponent(child).resourceValues(
                    forKeys: [.isRegularFileKey, .isSymbolicLinkKey]
                )
                guard childValues.isRegularFile == true, childValues.isSymbolicLink != true else {
                    throw ModelFailure.notLibraryPackage
                }
            }
            return url.resolvingSymlinksInPath().standardizedFileURL
        } catch let failure as ModelFailure {
            throw failure
        } catch {
            throw ModelFailure.notLibraryPackage
        }
    }

    static func canonicalCreationURL(_ input: URL) -> URL {
        let value = input.standardizedFileURL
        return value.deletingLastPathComponent().resolvingSymlinksInPath()
            .appendingPathComponent(value.lastPathComponent, isDirectory: true)
            .standardizedFileURL
    }

    private static func libraryIDForAuthority(at packageURL: URL) throws -> String {
        let manifestURL = packageURL.appendingPathComponent("manifest.json", isDirectory: false)
        guard let values = try? manifestURL.resourceValues(forKeys: [
            .isRegularFileKey,
            .isSymbolicLinkKey,
            .fileSizeKey
        ]),
        values.isRegularFile == true,
        values.isSymbolicLink != true,
        let fileSize = values.fileSize,
        (1...1_048_576).contains(fileSize),
        let data = try? Data(contentsOf: manifestURL, options: .mappedIfSafe),
        data.count == fileSize,
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let libraryID = object["libraryId"] as? String,
        BridgeValidation.isOpaqueID(libraryID) else {
            throw ModelFailure.notLibraryPackage
        }
        return libraryID
    }

    private static func safeDisplayName(_ value: String, maximumScalars: Int) -> Bool {
        let forbidden = CharacterSet(charactersIn: "/\\").union(.controlCharacters)
        return !value.isEmpty && value.unicodeScalars.count <= maximumScalars &&
            value.rangeOfCharacter(from: forbidden) == nil
    }

    private static func safeToken(_ value: String) -> Bool {
        value.range(of: "^[a-z][a-z0-9_]{0,39}$", options: .regularExpression) != nil
    }

    private static func nonnegativeInteger(_ number: NSNumber) -> Bool {
        CFGetTypeID(number) != CFBooleanGetTypeID() && number.doubleValue.isFinite && number.doubleValue >= 0 &&
            number.doubleValue.rounded(.towardZero) == number.doubleValue
    }

    private static func jsonString(_ value: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        guard let string = String(data: data, encoding: .utf8) else {
            throw ModelFailure.invalidCoreResponse
        }
        return string
    }

    private static let libraryContentType = UTType(
        filenameExtension: "pitchlibrary",
        conformingTo: .package
    ) ?? UTType(importedAs: "io.pitchdog.pitchlibrary")

    private static let projections = Set([
        "contact_sheet_tiny", "contact_sheet_standard", "contact_sheet_detailed"
    ])
    private static let reviewStates = Set(["unreviewed", "keep", "maybe", "reject"])
    private static let availability = Set([
        "present", "missing", "needs_permission", "offline_volume", "unreadable", "unavailable"
    ])
    private static let sorts = Set([
        "created_ascending", "created_descending", "name_ascending", "name_descending", "review_state"
    ])
    private static let jobStates = Set([
        "queued", "running", "cancellation_requested", "cancelled", "completed", "failed"
    ])

    private struct OpenedSession {
        let value: Any
        let sessionID: String
        let libraryID: String
    }

    private struct AddedRoot {
        let rootID: String
        let jobID: String
        let session: OpenedSession
    }

    private struct BoundRoot {
        let root: [String: Any]
        let session: OpenedSession
    }

    private struct LibrarySnapshot {
        let libraryID: String
        let path: String
    }

    enum ModelFailure: LocalizedError {
        case sessionClosed
        case transitionSuperseded
        case restartRequired
        case unknownCommand
        case invalidCoreResponse
        case notLibraryPackage
        case libraryAuthorizationFailed
        case rootAuthorizationFailed
        case rootAuthorizationNeedsRepair
        case coreRequestFailed
        case invalidArgument
        case core(String)

        var errorDescription: String? {
            switch self {
            case .sessionClosed: "Library session is closed."
            case .transitionSuperseded: "A newer Library transition replaced this request."
            case .restartRequired: "Reference Core must restart before writes continue."
            case .unknownCommand: "Unknown workspace command."
            case .invalidCoreResponse: "Reference Core returned an invalid response."
            case .notLibraryPackage: "Choose a .pitchlibrary package directory."
            case .libraryAuthorizationFailed: "The Library authorization could not be persisted."
            case .rootAuthorizationFailed: "The Root authorization could not be persisted."
            case .rootAuthorizationNeedsRepair:
                "The Root was added, but its authorization must be chosen again."
            case .coreRequestFailed: "Reference Core could not complete the request."
            case .invalidArgument: "The native operation received an invalid argument."
            case let .core(code): RendererErrorPolicy.message(code: code)
            }
        }
    }
}

struct ResourceDescriptor: Sendable {
    let nativePath: String
    let mimeType: String
    let contentLength: Int
}
