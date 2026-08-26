import AppKit
import SwiftUI
import WebKit

struct WorkspaceWebViewRepresentable: NSViewRepresentable {
    @ObservedObject var model: AppModel

    func makeNSView(context: Context) -> WorkspaceWebView {
        WorkspaceWebView(model: model)
    }

    func updateNSView(_ nsView: WorkspaceWebView, context: Context) {}
}

final class WorkspaceWebView: WKWebView, WKNavigationDelegate, WKUIDelegate {
    private let bridge: WorkspaceBridge
    private let schemeHandler: WorkspaceSchemeHandler

    init(model: AppModel) {
        bridge = WorkspaceBridge(model: model)
        schemeHandler = WorkspaceSchemeHandler(model: model)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.isElementFullscreenEnabled = true
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "pitchdog-ui")
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "pitchdog-asset")
        configuration.userContentController.addScriptMessageHandler(
            bridge,
            contentWorld: .page,
            name: "referenceCommand"
        )
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: WorkspaceBridge.bootstrap,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        super.init(frame: .zero, configuration: configuration)
        navigationDelegate = self
        uiDelegate = self
        allowsMagnification = false
        setValue(false, forKey: "drawsBackground")
        model.attach(workspace: self)
        load(URLRequest(url: URL(string: "pitchdog-ui://app/index.html")!))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    deinit {
        configuration.userContentController.removeScriptMessageHandler(
            forName: "referenceCommand",
            contentWorld: .page
        )
    }

    func deliver(eventJSON: String) {
        evaluateJavaScript("window.__referenceLibraryReceiveEvent?.(\(eventJSON))")
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "pitchdog-ui", url.host == "app" {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        nil
    }
}
