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
        afterValidation: (@Sendable () async throws -> Void)? = nil,
        onClose: (@Sendable () -> Void)? = nil,
        consume: @escaping @Sendable (Data) async throws -> Void
    ) async throws {
        guard expectedSize >= 0, expectedSize <= maximumBytes else { throw Failure.denied }
        let descriptor = Darwin.open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw Failure.denied }
        defer { Darwin.close(descriptor); onClose?() }

        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0,
              (metadata.st_mode & S_IFMT) == S_IFREG,
              metadata.st_size == off_t(expectedSize) else { throw Failure.changed }
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
}
