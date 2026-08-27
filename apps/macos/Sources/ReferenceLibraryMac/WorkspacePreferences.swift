import Darwin
import CoreFoundation
import Foundation

struct WorkspacePreferences: Codable, Equatable, Sendable {
    var interfaceScale: Double = 1
    var thumbnailDensity: Int = 220
    var previewZoom: Double = 1

    func dictionary() -> [String: Any] {
        ["interfaceScale": interfaceScale, "thumbnailDensity": thumbnailDensity, "previewZoom": previewZoom]
    }

    static func applying(_ patch: [String: Any], to current: Self) throws -> Self {
        let allowed = Set(["interfaceScale", "thumbnailDensity", "previewZoom"])
        guard patch.keys.allSatisfy(allowed.contains) else { throw Failure.invalid }
        var value = current
        if let scale = Self.finiteNumber(patch["interfaceScale"]) {
            guard [0.8, 1, 1.25, 1.5].contains(scale) else { throw Failure.invalid }
            value.interfaceScale = scale
        } else if patch["interfaceScale"] != nil { throw Failure.invalid }
        if let number = patch["thumbnailDensity"] as? NSNumber,
           CFGetTypeID(number) != CFBooleanGetTypeID() {
            let density = number.intValue
            guard density >= 140, density <= 340,
                  Double(density) == number.doubleValue else { throw Failure.invalid }
            value.thumbnailDensity = density
        } else if patch["thumbnailDensity"] != nil { throw Failure.invalid }
        if let zoom = Self.finiteNumber(patch["previewZoom"]) {
            guard zoom >= 0.25, zoom <= 4 else { throw Failure.invalid }
            value.previewZoom = zoom
        } else if patch["previewZoom"] != nil { throw Failure.invalid }
        return value
    }

    private static func finiteNumber(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let result = number.doubleValue
        return result.isFinite ? result : nil
    }

    enum Failure: LocalizedError {
        case invalid, unavailable
        var errorDescription: String? { "Workspace preferences could not be read or saved." }
    }
}

@MainActor
final class WorkspacePreferencesStore {
    private let url: URL

    init(url: URL? = nil) {
        if let url { self.url = url; return }
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        self.url = root.appendingPathComponent("io.pitchdog.ReferenceLibrary", isDirectory: true)
            .appendingPathComponent("workspace-preferences.json")
    }

    func read() throws -> WorkspacePreferences {
        do {
            guard FileManager.default.fileExists(atPath: url.path) else { return WorkspacePreferences() }
            let descriptor = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
            guard descriptor >= 0 else { throw WorkspacePreferences.Failure.unavailable }
            defer { Darwin.close(descriptor) }
            var metadata = stat()
            guard fstat(descriptor, &metadata) == 0, (metadata.st_mode & S_IFMT) == S_IFREG,
                  metadata.st_size <= 8_192 else { throw WorkspacePreferences.Failure.unavailable }
            let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: false)
            guard let data = try handle.readToEnd() else { throw WorkspacePreferences.Failure.unavailable }
            return try JSONDecoder().decode(WorkspacePreferences.self, from: data)
        } catch let failure as WorkspacePreferences.Failure { throw failure }
        catch { throw WorkspacePreferences.Failure.unavailable }
    }

    func write(patch: [String: Any]) throws -> WorkspacePreferences {
        do {
            let next = try WorkspacePreferences.applying(patch, to: read())
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let temporary = url.deletingLastPathComponent().appendingPathComponent(".preferences-\(UUID().uuidString).tmp")
            defer { try? FileManager.default.removeItem(at: temporary) }
            let data = try JSONEncoder().encode(next)
            guard FileManager.default.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
                throw WorkspacePreferences.Failure.unavailable
            }
            let handle = try FileHandle(forWritingTo: temporary)
            try handle.write(contentsOf: data)
            try handle.synchronize()
            try handle.close()
            if FileManager.default.fileExists(atPath: url.path) { _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary) }
            else { try FileManager.default.moveItem(at: temporary, to: url) }
            return next
        } catch let failure as WorkspacePreferences.Failure { throw failure }
        catch { throw WorkspacePreferences.Failure.unavailable }
    }
}
