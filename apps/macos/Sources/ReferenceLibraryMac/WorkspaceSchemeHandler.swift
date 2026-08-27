import Foundation
import WebKit

final class WorkspaceSchemeHandler: NSObject, WKURLSchemeHandler {
    private weak var model: AppModel?
    private let taskLock = NSLock()
    private var assetTasks: [ObjectIdentifier: Task<Void, Never>] = [:]

    init(model: AppModel) {
        self.model = model
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            fail(urlSchemeTask, status: 400)
            return
        }
        if url.scheme == "pitchdog-ui" {
            serveWorkspace(url: url, task: urlSchemeTask)
            return
        }
        guard url.scheme == "pitchdog-asset", let model else {
            fail(urlSchemeTask, status: 403)
            return
        }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard let sessionID = url.host, parts.count == 2 else {
            fail(urlSchemeTask, status: 403)
            return
        }
        let assetID = parts[0]
        let profile = parts[1]
        let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let descriptor = try await model.authorizeResource(
                    sessionID: sessionID,
                    assetID: assetID,
                    profile: profile
                )
                guard descriptor.contentLength >= 0,
                      descriptor.contentLength <= ResourceFileStreamer.maximumBytes,
                      ["image/png", "image/jpeg", "image/webp"].contains(descriptor.mimeType) else {
                    throw SchemeFailure.resourceTooLarge
                }
                try Task.checkCancellation()
                let taskBox = SchemeTaskBox(urlSchemeTask)
                let response = HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: [
                        "Content-Type": descriptor.mimeType,
                        "Content-Length": String(descriptor.contentLength),
                        "Cache-Control": "private, no-store",
                        "X-Content-Type-Options": "nosniff"
                    ]
                )!
                urlSchemeTask.didReceive(response)
                let stream = Task.detached(priority: .userInitiated) {
                    try await ResourceFileStreamer.stream(
                        path: descriptor.nativePath,
                        expectedSize: descriptor.contentLength
                    ) { chunk in
                        try Task.checkCancellation()
                        await MainActor.run { taskBox.task.didReceive(chunk) }
                    }
                }
                try await withTaskCancellationHandler {
                    try await stream.value
                } onCancel: {
                    stream.cancel()
                }
                try Task.checkCancellation()
                urlSchemeTask.didFinish()
            } catch {
                if !Task.isCancelled { urlSchemeTask.didFailWithError(SchemeFailure.denied) }
            }
            removeAssetTask(identifier)
        }
        storeAssetTask(task, identifier: identifier)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
        takeAssetTask(identifier)?.cancel()
    }

    private func storeAssetTask(_ task: Task<Void, Never>, identifier: ObjectIdentifier) {
        taskLock.lock()
        assetTasks[identifier] = task
        taskLock.unlock()
    }

    private func removeAssetTask(_ identifier: ObjectIdentifier) {
        taskLock.lock()
        assetTasks.removeValue(forKey: identifier)
        taskLock.unlock()
    }

    private func takeAssetTask(_ identifier: ObjectIdentifier) -> Task<Void, Never>? {
        taskLock.lock()
        let task = assetTasks.removeValue(forKey: identifier)
        taskLock.unlock()
        return task
    }

    private func serveWorkspace(url: URL, task: WKURLSchemeTask) {
        do {
            guard url.host == "app", let root = Self.workspaceRoot() else {
                throw SchemeFailure.notFound
            }
            let relative = url.path == "/" || url.path.isEmpty ? "index.html" : String(url.path.dropFirst())
            guard !relative.isEmpty, !relative.contains(".."), !relative.contains("\0") else {
                throw SchemeFailure.denied
            }
            let canonicalRoot = root.resolvingSymlinksInPath().standardizedFileURL
            let candidate = canonicalRoot.appendingPathComponent(relative).resolvingSymlinksInPath().standardizedFileURL
            guard candidate.path.hasPrefix(canonicalRoot.path + "/") else { throw SchemeFailure.denied }
            let values = try candidate.resourceValues(forKeys: [.isRegularFileKey])
            guard values.isRegularFile == true else { throw SchemeFailure.notFound }
            let data = try Data(contentsOf: candidate, options: [.mappedIfSafe])
            respond(
                task,
                url: url,
                data: data,
                mimeType: Self.mimeType(for: candidate.pathExtension),
                headers: [
                    "Cache-Control": "no-store",
                    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src pitchdog-asset: data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
                    "X-Content-Type-Options": "nosniff"
                ]
            )
        } catch {
            fail(task, status: 404)
        }
    }

    private func respond(
        _ task: WKURLSchemeTask,
        url: URL,
        data: Data,
        mimeType: String,
        headers: [String: String]
    ) {
        var headers = headers
        headers["Content-Type"] = mimeType
        headers["Content-Length"] = String(data.count)
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        )!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func fail(_ task: WKURLSchemeTask, status: Int) {
        let url = task.request.url ?? URL(string: "pitchdog-ui://app/error")!
        let response = HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"]
        )!
        task.didReceive(response)
        task.didReceive(Data("Unavailable".utf8))
        task.didFinish()
    }

    private static func workspaceRoot() -> URL? {
        #if DEBUG
        if let path = ProcessInfo.processInfo.environment["REFERENCE_WORKSPACE_PATH"] {
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        #endif
        return Bundle.main.resourceURL?.appendingPathComponent("Workspace", isDirectory: true)
    }

    private static func mimeType(for extensionName: String) -> String {
        switch extensionName.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "js": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "webp": "image/webp"
        case "woff2": "font/woff2"
        default: "application/octet-stream"
        }
    }

    enum SchemeFailure: Error {
        case denied
        case notFound
        case resourceTooLarge
        case sourceChanged
    }
}

private final class SchemeTaskBox: @unchecked Sendable {
    let task: WKURLSchemeTask

    init(_ task: WKURLSchemeTask) {
        self.task = task
    }
}
