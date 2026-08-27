import Foundation

actor LibraryTransitionGate {
    private var held = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func run<T>(_ operation: @MainActor @Sendable () async throws -> T) async rethrows -> T {
        await acquire()
        do {
            let value = try await operation()
            release()
            return value
        } catch {
            release()
            throw error
        }
    }

    private func acquire() async {
        if !held { held = true; return }
        await withCheckedContinuation { waiters.append($0) }
    }

    private func release() {
        if waiters.isEmpty { held = false }
        else { waiters.removeFirst().resume() }
    }
}

@MainActor
final class LibraryOpenIntentQueue {
    static let maximumCount = 16
    struct Intent {
        let id: String
        let displayName: String
        let url: URL
    }

    private var active: Intent?
    private var pending: [Intent] = []

    var count: Int { pending.count + (active == nil ? 0 : 1) }

    func enqueue(_ url: URL) -> Bool {
        guard count < Self.maximumCount else { return false }
        pending.append(Intent(
            id: UUID().uuidString.lowercased(),
            displayName: Self.safeDisplayName(url.lastPathComponent),
            url: url
        ))
        return true
    }

    func requestNext() -> [String: String]? {
        guard active == nil, !pending.isEmpty else { return nil }
        active = pending.removeFirst()
        return ["intentId": active!.id, "displayName": active!.displayName]
    }

    func activeURL(id: String) throws -> URL {
        guard active?.id == id else { throw IntentFailure.stale }
        return active!.url
    }

    func resolve(id: String) throws -> URL {
        let url = try activeURL(id: id)
        active = nil
        return url
    }

    private static func safeDisplayName(_ raw: String) -> String {
        let forbidden = CharacterSet.controlCharacters
            .union(.illegalCharacters)
            .union(CharacterSet(charactersIn: "\u{2028}\u{2029}"))
        var value = ""
        for scalar in raw.unicodeScalars where !forbidden.contains(scalar) {
            guard value.unicodeScalars.count < 120 else { break }
            value.unicodeScalars.append(scalar)
        }
        return value.isEmpty ? "Reference Library" : value
    }

    enum IntentFailure: LocalizedError {
        case stale
        var errorDescription: String? { "The Library open request is no longer active." }
    }
}
