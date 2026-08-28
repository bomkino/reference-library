import Darwin
import Foundation

actor ResourceStreamCapacity {
    static let shared = ResourceStreamCapacity(limit: ResourceFileStreamer.maximumConcurrentStreams)

    private let limit: Int
    private var active = 0

    init(limit: Int) {
        precondition(limit > 0)
        self.limit = limit
    }

    func acquire() -> Bool {
        guard active < limit else { return false }
        active += 1
        return true
    }

    func release() {
        precondition(active > 0)
        active -= 1
    }

    func activeCount() -> Int { active }
}

enum ResourceFileStreamer {
    static let maximumPreviewBytes = 512 * 1_024 * 1_024
    static let maximumGridBytes = 8 * 1_024 * 1_024
    static let chunkBytes = 64 * 1_024
    static let maximumConcurrentStreams = 16
    static let maximumNativeInFlightBytes = maximumConcurrentStreams * chunkBytes
    static let defaultPacingNanoseconds: UInt64 = 1_000_000

    enum Failure: LocalizedError {
        case denied, changed, readFailed
        var errorDescription: String? { "Authorized resource could not be delivered." }
    }

    static func stream(
        path: String,
        expectedSize: Int,
        byteLimit: Int = maximumPreviewBytes,
        startOffset: Int = 0,
        endOffsetExclusive: Int? = nil,
        cacheRoot: URL = privateCacheRoot(),
        capacity: ResourceStreamCapacity = .shared,
        pacingNanoseconds: UInt64 = defaultPacingNanoseconds,
        afterValidation: (@Sendable () async throws -> Void)? = nil,
        onClose: (@Sendable () -> Void)? = nil,
        onInFlightBytesChanged: (@Sendable (Int) -> Void)? = nil,
        consume: @escaping @Sendable (Data) async throws -> Void
    ) async throws {
        guard byteLimit > 0,
              byteLimit <= maximumPreviewBytes,
              expectedSize >= 0,
              expectedSize <= byteLimit else { throw Failure.denied }
        let endOffsetExclusive = endOffsetExclusive ?? expectedSize
        guard startOffset >= 0, startOffset <= endOffsetExclusive,
              endOffsetExclusive <= expectedSize else { throw Failure.denied }
        try Task.checkCancellation()
        guard await capacity.acquire() else { throw Failure.denied }
        do {
            try Task.checkCancellation()
            try await streamWithCapacity(
                path: path,
                expectedSize: expectedSize,
                cacheRoot: cacheRoot,
                startOffset: startOffset,
                endOffsetExclusive: endOffsetExclusive,
                pacingNanoseconds: pacingNanoseconds,
                afterValidation: afterValidation,
                onClose: onClose,
                onInFlightBytesChanged: onInFlightBytesChanged,
                consume: consume
            )
            await capacity.release()
        } catch {
            await capacity.release()
            throw error
        }
    }

    static func maximumBytes(for profile: String) -> Int? {
        switch profile {
        case "grid_standard": maximumGridBytes
        case "preview": maximumPreviewBytes
        default: nil
        }
    }

    private static func streamWithCapacity(
        path: String,
        expectedSize: Int,
        cacheRoot: URL,
        startOffset: Int,
        endOffsetExclusive: Int,
        pacingNanoseconds: UInt64,
        afterValidation: (@Sendable () async throws -> Void)?,
        onClose: (@Sendable () -> Void)?,
        onInFlightBytesChanged: (@Sendable (Int) -> Void)?,
        consume: @escaping @Sendable (Data) async throws -> Void
    ) async throws {
        let descriptor = try openVerifiedDescriptor(
            path: path,
            expectedSize: expectedSize,
            cacheRoot: cacheRoot
        )
        defer { Darwin.close(descriptor); onClose?() }
        try await afterValidation?()
        try Task.checkCancellation()

        var position = startOffset
        while position < endOffsetExclusive {
            try Task.checkCancellation()
            let count = min(chunkBytes, endOffsetExclusive - position)
            onInFlightBytesChanged?(count)
            do {
                try await readAndConsume(
                    descriptor: descriptor,
                    position: position,
                    count: count,
                    consume: consume
                )
            } catch {
                onInFlightBytesChanged?(0)
                throw error
            }
            onInFlightBytesChanged?(0)
            position += count
            if position < endOffsetExclusive {
                await Task.yield()
                if pacingNanoseconds > 0 {
                    try await Task.sleep(nanoseconds: pacingNanoseconds)
                }
            }
        }
        try Task.checkCancellation()
    }

    private static func readAndConsume(
        descriptor: Int32,
        position: Int,
        count: Int,
        consume: @escaping @Sendable (Data) async throws -> Void
    ) async throws {
        var chunk = Data(count: count)
        let readCount = chunk.withUnsafeMutableBytes { pointer in
            pread(descriptor, pointer.baseAddress, count, off_t(position))
        }
        guard readCount == count else { throw Failure.changed }
        try await consume(chunk)
    }

    static func privateCacheRoot() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("pitchdog-reference-cache", isDirectory: true)
            .appendingPathComponent("reference-library-v1", isDirectory: true)
            .standardizedFileURL
    }

    private static func openVerifiedDescriptor(
        path: String,
        expectedSize: Int,
        cacheRoot: URL
    ) throws -> Int32 {
        guard path.hasPrefix("/"),
              let canonicalRoot = canonicalPath(cacheRoot.path),
              let canonicalCandidate = canonicalPath(path),
              isRegularNonSymlink(path),
              let relativeComponents = descendantComponents(
                candidate: canonicalCandidate,
                root: canonicalRoot
              ) else {
            throw Failure.denied
        }

        var directoryDescriptor = Darwin.open(
            canonicalRoot,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard directoryDescriptor >= 0 else { throw Failure.denied }
        defer { Darwin.close(directoryDescriptor) }
        guard isPrivateDirectory(descriptor: directoryDescriptor) else { throw Failure.denied }

        for component in relativeComponents.dropLast() {
            let next = component.withCString { pointer in
                Darwin.openat(
                    directoryDescriptor,
                    pointer,
                    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
                )
            }
            guard next >= 0 else { throw Failure.denied }
            guard isPrivateDirectory(descriptor: next) else {
                Darwin.close(next)
                throw Failure.denied
            }
            Darwin.close(directoryDescriptor)
            directoryDescriptor = next
        }

        let descriptor = relativeComponents.last!.withCString { pointer in
            Darwin.openat(directoryDescriptor, pointer, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard descriptor >= 0 else { throw Failure.denied }
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0,
              (metadata.st_mode & S_IFMT) == S_IFREG,
              metadata.st_size == off_t(expectedSize),
              metadata.st_uid == geteuid(),
              (metadata.st_mode & mode_t(0o022)) == 0,
              metadata.st_nlink == 1 else {
            Darwin.close(descriptor)
            throw Failure.changed
        }
        return descriptor
    }

    private static func canonicalPath(_ path: String) -> String? {
        path.withCString { pointer in
            guard let resolved = Darwin.realpath(pointer, nil) else { return nil }
            defer { Darwin.free(resolved) }
            return String(cString: resolved)
        }
    }

    private static func descendantComponents(candidate: String, root: String) -> [String]? {
        let rootComponents = URL(fileURLWithPath: root).pathComponents
        let candidateComponents = URL(fileURLWithPath: candidate).pathComponents
        guard candidateComponents.count > rootComponents.count,
              candidateComponents.prefix(rootComponents.count).elementsEqual(rootComponents) else {
            return nil
        }
        let relative = Array(candidateComponents.dropFirst(rootComponents.count))
        return relative.isEmpty ? nil : relative
    }

    private static func isRegularNonSymlink(_ path: String) -> Bool {
        var metadata = stat()
        guard path.withCString({ Darwin.lstat($0, &metadata) }) == 0 else { return false }
        return (metadata.st_mode & S_IFMT) == S_IFREG
    }

    private static func isPrivateDirectory(descriptor: Int32) -> Bool {
        var metadata = stat()
        return fstat(descriptor, &metadata) == 0 &&
            (metadata.st_mode & S_IFMT) == S_IFDIR &&
            metadata.st_uid == geteuid() &&
            (metadata.st_mode & mode_t(0o022)) == 0
    }
}
