import Darwin
import Foundation

actor CoreSupervisor {
    static let protocolVersion = 1
    static let maximumFrameBytes = 1_048_576
    static let resourceRetryDelaysNanoseconds: [UInt64] = [25_000_000, 75_000_000]

    enum Failure: LocalizedError {
        case coreNotFound, coreExited, invalidFrame, oversizedFrame, protocolMismatch, timedOut

        var errorDescription: String? {
            switch self {
            case .coreNotFound: "Bundled Reference Core was not found."
            case .coreExited: "Reference Core stopped before replying."
            case .invalidFrame: "Reference Core emitted an invalid frame."
            case .oversizedFrame: "Reference Core emitted a frame larger than 1 MiB."
            case .protocolMismatch: "Reference Core protocol validation failed."
            case .timedOut: "Reference Core did not reply in time."
            }
        }
    }

    struct RequestFailure: Error {
        let code: String
        let retryable: Bool
    }

    private struct Pending {
        let continuation: CheckedContinuation<Data, Error>
        let timeout: Task<Void, Never>
    }

    private struct Authorization {
        let sessionID: String
        let assetID: String
        let profile: String
        var jobID: String?
        var cancelled: Bool
    }

    private var process: Process?
    private var input: FileHandle?
    private var output: FileHandle?
    private var errorOutput: FileHandle?
    private var generation: UUID?
    private var pending: [String: Pending] = [:]
    private var authorizations: [String: Authorization] = [:]
    private var isStopping = false
    private var generationFailed = false
    private var lastEventSequence: UInt64 = 0
    private var eventSink: (@Sendable (Data) -> Void)?

    func setEventSink(_ sink: @escaping @Sendable (Data) -> Void) { eventSink = sink }

    func start() async throws {
        if process?.isRunning == true { return }
        guard let executable = Self.resolveExecutable() else { throw Failure.coreNotFound }
        let child = Process()
        let standardInput = Pipe()
        let standardOutput = Pipe()
        let standardError = Pipe()
        let generation = UUID()
        child.executableURL = executable
        child.standardInput = standardInput
        child.standardOutput = standardOutput
        child.standardError = standardError
        child.environment = Self.sanitizedEnvironment()
        child.terminationHandler = { [weak self] _ in
            Task { await self?.transportFailed(generation: generation, failure: Failure.coreExited) }
        }
        standardError.fileHandleForReading.readabilityHandler = { handle in
            _ = try? handle.read(upToCount: 2_048)
        }
        try child.run()
        process = child
        input = standardInput.fileHandleForWriting
        output = standardOutput.fileHandleForReading
        errorOutput = standardError.fileHandleForReading
        self.generation = generation
        isStopping = false
        generationFailed = false
        lastEventSequence = 0
        Self.startReader(handle: standardOutput.fileHandleForReading, supervisor: self, generation: generation)

        do {
            let frame = try await request(commandData: Self.commandData(
                method: "hello",
                params: ["clientName": "apple-silicon-swiftui-webkit", "supportedVersions": [Self.protocolVersion]]
            ))
            guard let result = try Self.responseValue(frame, expected: "hello") as? [String: Any],
                  (result["protocolVersion"] as? NSNumber)?.intValue == Self.protocolVersion else {
                throw Failure.protocolMismatch
            }
        } catch {
            failGeneration(Failure.protocolMismatch)
            throw error
        }
    }

    func request(commandData: Data, timeoutNanoseconds: UInt64 = 30_000_000_000) async throws -> Data {
        try await request(commandData: commandData, requestID: UUID().uuidString.lowercased(), timeoutNanoseconds: timeoutNanoseconds)
    }

    func authorizeResource(sessionID: String, assetID: String, profile: String) async throws -> Data {
        for attempt in 0...Self.resourceRetryDelaysNanoseconds.count {
            try Task.checkCancellation()
            let requestID = UUID().uuidString.lowercased()
            authorizations[requestID] = Authorization(
                sessionID: sessionID, assetID: assetID, profile: profile, jobID: nil, cancelled: false
            )
            do {
                let command = try Self.commandData(method: "authorize_resource", params: [
                    "sessionId": sessionID, "assetId": assetID, "profile": profile,
                ])
                let frame = try await withTaskCancellationHandler {
                    try await request(commandData: command, requestID: requestID, timeoutNanoseconds: 30_000_000_000)
                } onCancel: {
                    Task { await self.cancelAuthorization(requestID: requestID) }
                }
                guard authorizations[requestID]?.jobID != nil else {
                    failGeneration(Failure.protocolMismatch)
                    throw Failure.protocolMismatch
                }
                try Task.checkCancellation()
                authorizations.removeValue(forKey: requestID)
                return frame
            } catch let failure as RequestFailure
                where failure.code == "RenditionQueueFull" && failure.retryable && attempt < Self.resourceRetryDelaysNanoseconds.count {
                authorizations.removeValue(forKey: requestID)
                try await Task.sleep(nanoseconds: Self.resourceRetryDelaysNanoseconds[attempt])
            } catch {
                authorizations.removeValue(forKey: requestID)
                throw error
            }
        }
        throw Failure.protocolMismatch
    }

    func restart() async throws { await stop(); try await start() }

    func stop() async {
        guard let process else { return }
        isStopping = true
        if process.isRunning, let shutdown = try? Self.commandData(method: "shutdown", params: nil) {
            _ = try? await request(commandData: shutdown, timeoutNanoseconds: 2_000_000_000)
        }
        if process.isRunning { process.terminate() }
        if process.isRunning {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if process.isRunning { Darwin.kill(process.processIdentifier, SIGKILL) }
        }
        clearProcess(failure: Failure.coreExited)
        isStopping = false
    }

    private func request(commandData: Data, requestID: String, timeoutNanoseconds: UInt64) async throws -> Data {
        guard process?.isRunning == true, let input else { throw Failure.coreExited }
        guard commandData.count <= Self.maximumFrameBytes else { throw Failure.oversizedFrame }
        let envelope = try Self.envelope(commandData: commandData, requestID: requestID)
        return try await withCheckedThrowingContinuation { continuation in
            let timeout = Task { [weak self] in
                try? await Task.sleep(nanoseconds: timeoutNanoseconds)
                await self?.requestTimedOut(requestID: requestID)
            }
            pending[requestID] = Pending(continuation: continuation, timeout: timeout)
            do { try Self.writeFrame(envelope, to: input) }
            catch { failGeneration(Failure.coreExited) }
        }
    }

    private func receive(_ frame: Data, generation: UUID) {
        guard self.generation == generation, !generationFailed,
              let object = try? JSONSerialization.jsonObject(with: frame) as? [String: Any],
              (object["protocolVersion"] as? NSNumber)?.intValue == Self.protocolVersion,
              let kind = object["kind"] as? String else {
            failGeneration(Failure.invalidFrame); return
        }
        if kind == "event" {
            guard let event = object["event"] as? [String: Any], let name = event["event"] as? String else {
                failGeneration(Failure.invalidFrame); return
            }
            guard let sequence = object["sequence"] as? NSNumber,
                  sequence.doubleValue >= 0,
                  sequence.doubleValue.rounded(.towardZero) == sequence.doubleValue,
                  sequence.uint64Value > lastEventSequence else {
                failGeneration(Failure.protocolMismatch); return
            }
            lastEventSequence = sequence.uint64Value
            if name == "resource_authorization_started" {
                receiveAuthorizationStarted(event["value"] as? [String: Any])
            } else { eventSink?(frame) }
            return
        }
        guard (kind == "response" || kind == "error"), let requestID = object["requestId"] as? String,
              let item = pending.removeValue(forKey: requestID) else {
            failGeneration(Failure.protocolMismatch); return
        }
        item.timeout.cancel()
        if kind == "error" {
            guard let payload = object["error"] as? [String: Any], let code = payload["code"] as? String else {
                item.continuation.resume(throwing: Failure.invalidFrame)
                failGeneration(Failure.invalidFrame); return
            }
            item.continuation.resume(throwing: RequestFailure(code: code, retryable: payload["retryable"] as? Bool ?? false))
        } else {
            guard object["result"] is [String: Any] else {
                item.continuation.resume(throwing: Failure.invalidFrame)
                failGeneration(Failure.invalidFrame); return
            }
            item.continuation.resume(returning: frame)
        }
    }

    private func receiveAuthorizationStarted(_ value: [String: Any]?) {
        guard let value, let requestID = value["requestId"] as? String,
              let jobID = value["jobId"] as? String, var authorization = authorizations[requestID],
              authorization.jobID == nil,
              (value["sessionId"] == nil || value["sessionId"] as? String == authorization.sessionID),
              value["assetId"] as? String == authorization.assetID,
              value["profile"] as? String == authorization.profile else {
            failGeneration(Failure.protocolMismatch); return
        }
        authorization.jobID = jobID
        authorizations[requestID] = authorization
        if authorization.cancelled { sendCancellation(sessionID: authorization.sessionID, jobID: jobID) }
    }

    private func cancelAuthorization(requestID: String) {
        guard var authorization = authorizations[requestID] else { return }
        authorization.cancelled = true
        authorizations[requestID] = authorization
        if let jobID = authorization.jobID { sendCancellation(sessionID: authorization.sessionID, jobID: jobID) }
    }

    private func sendCancellation(sessionID: String, jobID: String) {
        Task { [weak self] in
            guard let self, let command = try? Self.commandData(
                method: "cancel_job", params: ["sessionId": sessionID, "jobId": jobID]
            ) else { return }
            _ = try? await self.request(commandData: command, timeoutNanoseconds: 2_000_000_000)
        }
    }

    private func requestTimedOut(requestID: String) {
        guard pending[requestID] != nil else { return }
        failGeneration(Failure.timedOut)
    }

    private func transportFailed(generation: UUID, failure: Error) {
        guard self.generation == generation else { return }
        failGeneration(failure)
    }

    private func failGeneration(_ failure: Error) {
        guard !generationFailed else { return }
        generationFailed = true
        let child = process
        clearProcess(failure: failure)
        if let child, child.isRunning { Darwin.kill(child.processIdentifier, SIGKILL) }
        if !isStopping { eventSink?(Self.restartFrame()) }
    }

    private func clearProcess(failure: Error) {
        errorOutput?.readabilityHandler = nil
        for item in pending.values { item.timeout.cancel(); item.continuation.resume(throwing: failure) }
        pending.removeAll()
        authorizations.removeAll()
        process = nil; input = nil; output = nil; errorOutput = nil; generation = nil
    }

    private static func startReader(handle: FileHandle, supervisor: CoreSupervisor, generation: UUID) {
        let box = FileHandleBox(handle)
        Task.detached(priority: .userInitiated) {
            do {
                while true {
                    let frame = try readFrame(from: box.handle)
                    await supervisor.receive(frame, generation: generation)
                }
            } catch { await supervisor.transportFailed(generation: generation, failure: error) }
        }
    }

    private static func readFrame(from handle: FileHandle) throws -> Data {
        let header = try readExactly(4, from: handle)
        let length = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard length > 0, length <= maximumFrameBytes else { throw Failure.oversizedFrame }
        return try readExactly(Int(length), from: handle)
    }

    private static func readExactly(_ count: Int, from handle: FileHandle) throws -> Data {
        var data = Data()
        while data.count < count {
            guard let part = try handle.read(upToCount: count - data.count), !part.isEmpty else { throw Failure.coreExited }
            data.append(part)
        }
        return data
    }

    private static func writeFrame(_ data: Data, to handle: FileHandle) throws {
        var length = UInt32(data.count).bigEndian
        try withUnsafeBytes(of: &length) { try handle.write(contentsOf: Data($0)) }
        try handle.write(contentsOf: data)
    }

    private static func envelope(commandData: Data, requestID: String) throws -> Data {
        let command = try JSONSerialization.jsonObject(with: commandData)
        return try JSONSerialization.data(withJSONObject: [
            "protocolVersion": protocolVersion, "requestId": requestID, "command": command,
        ])
    }

    static func commandData(method: String, params: Any?) throws -> Data {
        var command: [String: Any] = ["method": method]
        if let params { command["params"] = params }
        return try JSONSerialization.data(withJSONObject: command)
    }

    static func responseValue(_ frame: Data, expected: String) throws -> Any {
        guard let object = try? JSONSerialization.jsonObject(with: frame) as? [String: Any],
              object["kind"] as? String == "response",
              let result = object["result"] as? [String: Any], result["result"] as? String == expected else {
            throw Failure.invalidFrame
        }
        return result["value"] ?? NSNull()
    }

    private static func restartFrame() -> Data {
        Data(#"{"kind":"event","protocolVersion":1,"sequence":0,"event":{"event":"core_needs_restart","value":{"reason":"Reference Core stopped. Writes are frozen until restart."}}}"#.utf8)
    }

    private static func resolveExecutable() -> URL? {
        #if DEBUG
        let environment = ProcessInfo.processInfo.environment["REFERENCE_CORE_PATH"].map { URL(fileURLWithPath: $0).standardizedFileURL }
        #else
        let environment: URL? = nil
        #endif
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("bin", isDirectory: true).appendingPathComponent("reference-core")
        return [environment, bundled].compactMap { $0 }.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    private static func sanitizedEnvironment() -> [String: String] {
        let allowed = ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"]
        let source = ProcessInfo.processInfo.environment
        return Dictionary(uniqueKeysWithValues: allowed.compactMap { key in source[key].map { (key, $0) } })
    }
}

private final class FileHandleBox: @unchecked Sendable {
    let handle: FileHandle
    init(_ handle: FileHandle) { self.handle = handle }
}
