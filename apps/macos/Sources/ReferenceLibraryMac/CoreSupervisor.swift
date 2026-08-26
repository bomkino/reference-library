import Foundation

actor CoreSupervisor {
    static let protocolVersion = 1
    static let maximumFrameBytes = 1_048_576

    enum Failure: LocalizedError {
        case coreNotFound
        case coreExited
        case invalidFrame
        case oversizedFrame
        case protocolMismatch

        var errorDescription: String? {
            switch self {
            case .coreNotFound: "Bundled Reference Core was not found."
            case .coreExited: "Reference Core stopped before replying."
            case .invalidFrame: "Reference Core emitted an invalid frame."
            case .oversizedFrame: "Reference Core emitted a frame larger than 1 MiB."
            case .protocolMismatch: "Reference Core replied to a different request."
            }
        }
    }

    private struct FrameHeader: Decodable {
        let kind: String
        let requestId: String?
    }

    private var process: Process?
    private var input: FileHandle?
    private var output: FileHandle?
    private var errorOutput: FileHandle?
    private var generation: UUID?
    private var isStopping = false
    private var eventSink: (@Sendable (Data) -> Void)?

    func setEventSink(_ sink: @escaping @Sendable (Data) -> Void) {
        eventSink = sink
    }

    func start() throws {
        if process?.isRunning == true { return }
        guard let executable = Self.resolveExecutable() else { throw Failure.coreNotFound }

        let process = Process()
        let standardInput = Pipe()
        let standardOutput = Pipe()
        let standardError = Pipe()
        let generation = UUID()

        process.executableURL = executable
        process.standardInput = standardInput
        process.standardOutput = standardOutput
        process.standardError = standardError
        process.environment = Self.sanitizedEnvironment()
        process.terminationHandler = { [weak self] _ in
            Task { await self?.didTerminate(generation: generation) }
        }
        standardError.fileHandleForReading.readabilityHandler = { handle in
            _ = try? handle.read(upToCount: 2_048)
        }

        try process.run()
        self.process = process
        input = standardInput.fileHandleForWriting
        output = standardOutput.fileHandleForReading
        errorOutput = standardError.fileHandleForReading
        self.generation = generation
        isStopping = false

        let hello = try Self.commandData(
            method: "hello",
            params: [
                "clientName": "apple-silicon-swiftui-webkit",
                "supportedVersions": [Self.protocolVersion]
            ]
        )
        _ = try requestFrame(commandData: hello)
    }

    func request(commandData: Data) throws -> Data {
        guard process?.isRunning == true else { throw Failure.coreExited }
        return try requestFrame(commandData: commandData)
    }

    func restart() throws {
        stop()
        try start()
    }

    func stop() {
        guard let process else { return }
        isStopping = true
        if process.isRunning {
            let shutdown = try? Self.commandData(method: "shutdown", params: nil)
            if let shutdown { _ = try? requestFrame(commandData: shutdown) }
        }
        if process.isRunning { process.terminate() }
        process.waitUntilExit()
        clearProcess()
        isStopping = false
    }

    private func requestFrame(commandData: Data) throws -> Data {
        guard let process, process.isRunning, let input, let output else {
            throw Failure.coreExited
        }
        guard commandData.count <= Self.maximumFrameBytes else { throw Failure.oversizedFrame }

        let requestID = UUID().uuidString.lowercased()
        let requestIDData = try JSONEncoder().encode(requestID)
        var envelope = Data("{\"protocolVersion\":1,\"requestId\":".utf8)
        envelope.append(requestIDData)
        envelope.append(Data(",\"command\":".utf8))
        envelope.append(commandData)
        envelope.append(Data("}".utf8))
        try writeFrame(envelope, to: input)

        while true {
            let frame = try readFrame(from: output)
            let header = try JSONDecoder().decode(FrameHeader.self, from: frame)
            if header.kind == "event" {
                eventSink?(frame)
                continue
            }
            guard header.requestId == requestID else { throw Failure.protocolMismatch }
            return frame
        }
    }

    private func writeFrame(_ data: Data, to handle: FileHandle) throws {
        var length = UInt32(data.count).bigEndian
        try withUnsafeBytes(of: &length) { try handle.write(contentsOf: Data($0)) }
        try handle.write(contentsOf: data)
        try handle.synchronize()
    }

    private func readFrame(from handle: FileHandle) throws -> Data {
        let header = try readExactly(4, from: handle)
        let length = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard length <= Self.maximumFrameBytes else { throw Failure.oversizedFrame }
        return try readExactly(Int(length), from: handle)
    }

    private func readExactly(_ count: Int, from handle: FileHandle) throws -> Data {
        var data = Data()
        while data.count < count {
            guard let part = try handle.read(upToCount: count - data.count), !part.isEmpty else {
                throw Failure.coreExited
            }
            data.append(part)
        }
        return data
    }

    private func didTerminate(generation: UUID) {
        guard self.generation == generation else { return }
        clearProcess()
        guard !isStopping else { return }
        let event = Data(#"{"kind":"event","protocolVersion":1,"sequence":0,"event":{"event":"core_needs_restart","value":{"reason":"Reference Core stopped. Writes are frozen until restart."}}}"#.utf8)
        eventSink?(event)
    }

    private func clearProcess() {
        errorOutput?.readabilityHandler = nil
        process = nil
        input = nil
        output = nil
        errorOutput = nil
        generation = nil
    }

    private static func commandData(method: String, params: Any?) throws -> Data {
        var command: [String: Any] = ["method": method]
        if let params { command["params"] = params }
        return try JSONSerialization.data(withJSONObject: command)
    }

    private static func resolveExecutable() -> URL? {
        let environment = ProcessInfo.processInfo.environment["REFERENCE_CORE_PATH"].map {
            URL(fileURLWithPath: $0).standardizedFileURL
        }
        let bundled = Bundle.main.resourceURL?
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent("reference-core", isDirectory: false)
        return [environment, bundled].compactMap { $0 }.first {
            FileManager.default.isExecutableFile(atPath: $0.path)
        }
    }

    private static func sanitizedEnvironment() -> [String: String] {
        let allowed = ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"]
        let source = ProcessInfo.processInfo.environment
        return Dictionary(uniqueKeysWithValues: allowed.compactMap { key in
            source[key].map { (key, $0) }
        })
    }
}
