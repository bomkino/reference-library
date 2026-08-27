import AppKit
import Foundation

@MainActor
final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private weak var model: AppModel?
    private var pendingURLs: [URL] = []

    func attach(model: AppModel) {
        self.model = model
        let urls = pendingURLs
        pendingURLs.removeAll(keepingCapacity: true)
        if !urls.isEmpty { model.receiveExternalOpen(urls: urls) }
    }

    nonisolated func application(_ application: NSApplication, open urls: [URL]) {
        Task { @MainActor in
            let candidates = Array(urls.prefix(LibraryOpenIntentQueue.maximumCount))
            if let model { model.receiveExternalOpen(urls: candidates) }
            else {
                let available = max(0, LibraryOpenIntentQueue.maximumCount - pendingURLs.count)
                pendingURLs.append(contentsOf: candidates.prefix(available))
            }
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model else { return .terminateNow }
        Task { @MainActor in
            await model.stop()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}
