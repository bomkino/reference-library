import Darwin
import Foundation

enum ResourceFileStreamer {
    static let maximumBytes = 512 * 1_024 * 1_024
    static let chunkBytes = 64 * 1_024

    enum Failure: LocalizedError {
        case denied, changed, readFailed
        var errorDescription: String? { "Authorized resource could not be delivered." }
    }

    static func stream(
        path: String,
        expectedSize: Int,
        cacheRoot: URL = privateCacheRoot(),
        afterValidation: (@Sendable () async throws -> Void)? = nil,
        onClose: (@Sendable () -> Void)? = nil,
        consume: @escaping @Sendable (Data) async throws -> Void
    ) async throws {
        guard expectedSize >= 0, expectedSize <= maximumBytes else { throw Failure.denied }
        let descriptor = try openVerifiedDescriptor(
            path: path,
            expectedSize: expectedSize,
            cacheRoot: cacheRoot
        )
        defer { Darwin.close(descriptor); onClose?() }
        try await afterValidation?()
        try Task.checkCancellation()

        var position = 0
        while position < expectedSize {
            try Task.checkCancellation()
            let count = min(chunkBytes, expectedSize - position)
            var bytes = [UInt8](repeating: 0, count: count)
            let readCount = bytes.withUnsafeMutableBytes { pointer in
                pread(descriptor, pointer.baseAddress, count, off_t(position))
            }
            guard readCount == count else { throw Failure.changed }
            position += count
            try await consume(Data(bytes))
        }
        try Task.checkCancellation()
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
